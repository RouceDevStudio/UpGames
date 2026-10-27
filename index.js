require('dotenv').config();
const express = require('express');
const cloudinary = require('cloudinary').v2;
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult, param } = require('express-validator');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// ========== NORMALIZACIÓN DE EMAIL (CONSISTENTE) ==========
// Solo pasa a minúsculas. NO elimina puntos ni subdirecciones (+tag).
// Motivo: por defecto normalizeEmail() borra los puntos de Gmail, así que
// "maria.gonzalez@gmail.com" se guardaba como "mariagonzalez@gmail.com" en el
// registro, pero el login solo hace toLowerCase() y buscaba el email tal cual
// lo escribió la persona → no lo encontraba y no podía entrar. Preservando el
// email evitamos ese desajuste (y pagos de PayPal a una dirección equivocada).
const EMAIL_NORMALIZE_OPTS = {
    gmail_remove_dots: false,
    gmail_remove_subaddress: false,
    outlookdotcom_remove_subaddress: false,
    yahoo_remove_subaddress: false,
    icloud_remove_subaddress: false
};

// Variante "sin puntos" de un email de Gmail, tal como lo guardaba el
// normalizeEmail anterior. Sirve como fallback en el login para que las cuentas
// creadas ANTES de este arreglo (guardadas sin puntos) sigan pudiendo entrar
// escribiendo su email real. Devuelve null si no aplica o si no cambia nada.
function gmailLegacyEmail(email) {
    const m = /^([^@]+)@(gmail\.com|googlemail\.com)$/i.exec(String(email || '').trim());
    if (!m) return null;
    const local = m[1].split('+')[0].replace(/\./g, '');
    const legacy = `${local}@gmail.com`;
    return legacy !== email.toLowerCase() ? legacy : null;
}

// ========== MÓDULOS CENTRALIZADOS ==========
const config       = require('./modulos/config');
const logger       = require('./modulos/logger');
const fraudDetector = require('./modulos/fraudDetector.js');
const { crearIndices } = require('./modulos/crearIndices');
const {
    calcularScoreRecomendacion,
    recalcularScoresUsuario,
    recalcularTodosLosScores,
} = require('./modulos/scoreHelpers');

// ========== MÓDULOS DE MEJORAS v2 ==========
const gamification    = require('./modulos/gamification');
const recommendations = require('./modulos/recommendations');
const twoFactor       = require('./modulos/twoFactor');
const nexusLLM        = require('./modulos/nexus/llm');
const nexusMemoria    = require('./modulos/nexus/memoria');
const nexusMentor     = require('./modulos/nexus/mentor');
const gameDetector    = require('./modulos/gameDetector');
const series          = require('./modulos/series');
const push            = require('./modulos/push');
const autoInfo        = require('./modulos/autoInfo');
const memCache        = require('./modulos/cache');
const searchModule    = require('./modulos/search');
// ==========================================

const https = require('https');

// ========================================
// 💳 PAYPAL PAYOUTS API - PAGOS AUTOMÁTICOS
// ========================================

async function getPayPalAccessToken() {
    const clientId     = config.PAYPAL_CLIENT_ID;
    const clientSecret = config.PAYPAL_CLIENT_SECRET;
    const baseUrl      = config.PAYPAL_MODE === 'live'
        ? 'api-m.paypal.com'
        : 'api-m.sandbox.paypal.com';

    if (!clientId || !clientSecret) {
        throw new Error('PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET son requeridos para pagos automáticos');
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const postData = 'grant_type=client_credentials';

    return new Promise((resolve, reject) => {
        const options = {
            hostname: baseUrl,
            path: '/v1/oauth2/token',
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.access_token) resolve(parsed.access_token);
                    else reject(new Error(`PayPal token error: ${JSON.stringify(parsed)}`));
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function enviarPagoPayPal(paypalEmail, monto, pagoId) {
    const baseUrl = config.PAYPAL_MODE === 'live'
        ? 'api-m.paypal.com'
        : 'api-m.sandbox.paypal.com';

    const accessToken = await getPayPalAccessToken();

    const payload = JSON.stringify({
        sender_batch_header: {
            sender_batch_id: `UPGAMES_${pagoId}_${Date.now()}`,
            email_subject: '¡Tu pago de UpGames ha llegado!',
            email_message: 'Has recibido un pago por tus descargas en UpGames. ¡Gracias por crear!'
        },
        items: [{
            recipient_type: 'EMAIL',
            amount: { value: monto.toFixed(2), currency: 'USD' },
            receiver: paypalEmail,
            note: `Retiro UpGames #${pagoId}`,
            sender_item_id: `item_${pagoId}`
        }]
    });

    return new Promise((resolve, reject) => {
        const options = {
            hostname: baseUrl,
            path: '/v1/payments/payouts',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (res.statusCode === 201) {
                        resolve({
                            batchId:     parsed.batch_header?.payout_batch_id || 'N/A',
                            batchStatus: parsed.batch_header?.batch_status    || 'PENDING'
                        });
                    } else {
                        const msg = parsed.message || parsed.error_description || JSON.stringify(parsed);
                        reject(new Error(`PayPal Payout falló [HTTP ${res.statusCode}]: ${msg}`));
                    }
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}


const app = express();

// ========== PROXY PLAZMA BURST 2 (TÁCTIL) ==========
// Reservir el juego original H5 same-origin + inyectar controles táctiles.
// Se monta ANTES de helmet/rate-limit: el juego carga ~90 archivos y no debe
// consumir el límite de peticiones ni verse afectado por políticas de la API.
const pb2proxy = require('./modulos/pb2proxy');
pb2proxy.registrar(app);
// ===================================================

// ========== CONFIGURACIÓN DE SEGURIDAD ==========
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

const allowedOrigins = config.ALLOWED_ORIGINS;

app.options('*', cors());

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.some(allowed => origin === allowed || origin.startsWith(allowed + '/'))) {
            callback(null, true);
        } else {
            callback(new Error(`CORS: Origen no permitido → ${origin}`));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token']
}));

app.use(express.json({ limit: '25mb' }));

// ========== ENLACES DE DESCARGA PROTEGIDOS ==========
// El enlace real solo se entrega por POST /economia/validar-descarga (página
// puente: anuncio + contador de descargas = ingresos del creador). Antes /items,
// /items/:id, la búsqueda y el feed lo devolvían en claro y se podía saltar el
// puente. Excepciones: videos (el enlace ES el video) y el propio autor.
// También oculta campos internos (análisis de Nexus, motivo de rechazo).
const CAMPOS_INTERNOS = ['analisisIA', 'nexusMentor', 'motivoRechazo'];
function limpiarPublico(v, yo, prof) {
    if (prof > 6 || !v || typeof v !== 'object' || v instanceof Date) return v;
    if (typeof v.toJSON === 'function' && !Array.isArray(v) && v.constructor?.name !== 'Object') v = v.toJSON();
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(x => limpiarPublico(x, yo, prof + 1));
    const esItem = 'title' in v && 'usuario' in v;
    const out = {};
    for (const [k, val] of Object.entries(v)) {
        if (esItem && v.usuario !== yo) {
            if (k === 'link' && v.category !== 'Video') continue;
            if (CAMPOS_INTERNOS.includes(k)) continue;
        }
        out[k] = limpiarPublico(val, yo, prof + 1);
    }
    return out;
}
app.use((req, res, next) => {
    if (req.method !== 'GET' || /^\/(admin|auth|economia|nexus)\b/.test(req.path)) return next();
    let yo = null;
    const t = req.headers.authorization?.split(' ')[1];
    if (t && t.length > 20) { try { yo = jwt.verify(t, JWT_SECRET).usuario; } catch (_) {} }
    const json = res.json.bind(res);
    res.json = body => json(limpiarPublico(body, yo, 0));
    next();
});
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// ========== RATE LIMITING ==========
const generalLimiter = rateLimit({
    windowMs: config.RATE_LIMIT.GENERAL.windowMs,
    max: config.RATE_LIMIT.GENERAL.max,
    message: { error: "Demasiadas peticiones, intenta en 15 minutos" },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => config.NODE_ENV === 'development'
});

const authLimiter = rateLimit({
    windowMs: config.RATE_LIMIT.AUTH.windowMs,
    max: config.RATE_LIMIT.AUTH.max,
    message: { error: "Demasiados intentos de login, espera 15 minutos" },
    skipSuccessfulRequests: true,
    skip: () => config.NODE_ENV === 'development'
});

const createLimiter = rateLimit({
    windowMs: config.RATE_LIMIT.CREATE.windowMs,
    max: config.RATE_LIMIT.CREATE.max,
    message: { error: "Has alcanzado el límite de creación por hora" },
    skip: () => config.NODE_ENV === 'development'
});

const downloadValidationLimiter = rateLimit({
    windowMs: config.RATE_LIMIT.DOWNLOAD_VALIDATION.windowMs,
    max: config.RATE_LIMIT.DOWNLOAD_VALIDATION.max,
    message: { error: "Demasiadas validaciones de descarga. Espera un minuto." },
    skip: () => config.NODE_ENV === 'development'
});

app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);
app.use('/items/add', createLimiter);
app.use('/economia/validar-descarga', downloadValidationLimiter);
app.use(generalLimiter);

// ========== LOGGING DE REQUESTS ==========
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const msg = `[${req.method}] ${req.path} - ${res.statusCode} (${duration}ms)`;
        if (res.statusCode >= 400) logger.warn(msg);
        else logger.info(msg);
    });
    next();
});

// ========== CONEXIÓN MONGODB ==========
const MONGODB_URI = config.MONGODB_URI;
const JWT_SECRET  = config.JWT_SECRET;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (process.env.NODE_ENV === 'production' && (!JWT_REFRESH_SECRET || JWT_REFRESH_SECRET === JWT_SECRET)) {
    logger.error('❌ JWT_REFRESH_SECRET debe ser un secreto INDEPENDIENTE en producción');
    process.exit(1);
}

const APP_URL = process.env.APP_URL || 'https://roucedevstudio.github.io/UpGames';
const API_URL_SELF = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${process.env.PORT || 10000}`;

// ── NODEMAILER — Gmail ───────────────────────────────────────────────
let emailTransporter = null;
try {
    emailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD,
        },
    });
    logger.info('📧 Transporter de email configurado (Gmail)');
} catch (e) {
    logger.warn('⚠️ Email no configurado — GMAIL_USER o GMAIL_APP_PASSWORD faltantes');
}

async function sendEmail({ to, subject, html }) {
    if (!emailTransporter) {
        logger.warn(`[Email] No configurado — no se envió a ${to}`);
        return false;
    }
    try {
        await emailTransporter.sendMail({
            from: `"UpGames" <${process.env.GMAIL_USER}>`,
            to,
            subject,
            html,
        });
        logger.info(`[Email] Enviado a ${to} — ${subject}`);
        return true;
    } catch (e) {
        logger.error(`[Email] Error enviando a ${to}: ${e.message}`);
        return false;
    }
}

// ── TEMPLATES DE EMAIL ────────────────────────────────────────────────
function emailVerifTemplate(usuario, link) {
    return `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#0a0a0f;color:#f0f0f8;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1a1a24,#0f0f18);padding:32px 28px;text-align:center;border-bottom:1px solid rgba(94,255,67,.15)">
        <div style="font-size:32px;font-weight:900;letter-spacing:-.5px">
          <span style="color:#5EFF43">UP</span><span>GAMES</span>
        </div>
        <div style="color:#60607a;font-size:12px;margin-top:4px;letter-spacing:.1em">VERIFICACIÓN DE CUENTA</div>
      </div>
      <div style="padding:32px 28px">
        <h2 style="font-size:20px;margin:0 0 12px;font-weight:700">Hola, @${usuario} 👋</h2>
        <p style="color:#a0a0b8;line-height:1.6;margin:0 0 24px">
          Gracias por registrarte en UpGames. Confirma tu email para activar tu cuenta y empezar a publicar, descargar y ganar dinero.
        </p>
        <div style="text-align:center;margin:28px 0">
          <a href="${link}" style="display:inline-block;padding:14px 32px;background:#5EFF43;color:#000;font-weight:800;font-size:15px;border-radius:8px;text-decoration:none;letter-spacing:.02em">
            ✅ Verificar mi email
          </a>
        </div>
        <p style="color:#60607a;font-size:12px;text-align:center;margin:0">
          Este link expira en <strong>24 horas</strong>. Si no creaste esta cuenta, ignora este mensaje.
        </p>
      </div>
    </div>`;
}

function emailResetTemplate(usuario, link) {
    return `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#0a0a0f;color:#f0f0f8;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1a1a24,#0f0f18);padding:32px 28px;text-align:center;border-bottom:1px solid rgba(94,255,67,.15)">
        <div style="font-size:32px;font-weight:900;letter-spacing:-.5px">
          <span style="color:#5EFF43">UP</span><span>GAMES</span>
        </div>
        <div style="color:#60607a;font-size:12px;margin-top:4px;letter-spacing:.1em">RECUPERACIÓN DE CONTRASEÑA</div>
      </div>
      <div style="padding:32px 28px">
        <h2 style="font-size:20px;margin:0 0 12px;font-weight:700">Hola, @${usuario} 🔐</h2>
        <p style="color:#a0a0b8;line-height:1.6;margin:0 0 24px">
          Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón de abajo para crear una nueva.
        </p>
        <div style="text-align:center;margin:28px 0">
          <a href="${link}" style="display:inline-block;padding:14px 32px;background:#5EFF43;color:#000;font-weight:800;font-size:15px;border-radius:8px;text-decoration:none;letter-spacing:.02em">
            🔑 Restablecer contraseña
          </a>
        </div>
        <p style="color:#60607a;font-size:12px;text-align:center;margin:0">
          Este link expira en <strong>1 hora</strong>. Si no solicitaste esto, ignora este mensaje.
        </p>
      </div>
    </div>`;
}

mongoose.connect(MONGODB_URI, config.MONGODB_OPTIONS)
.then(() => logger.info('MONGODB CONECTADO EXITOSAMENTE'))
.catch(err => {
    logger.error(`ERROR CONEXIÓN MONGODB: ${err.message}`);
    process.exit(1);
});

mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB desconectado. Intentando reconectar...');
});

// ========== SCHEMAS ==========

const DescargaIPSchema = new mongoose.Schema({
    juegoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Juego', required: true },
    ip:      { type: String, required: true },
    contadorHoy: { type: Number, default: 1 },
    fecha: { type: Date, default: Date.now, expires: 86400 }
});
DescargaIPSchema.index({ juegoId: 1, ip: 1 });
const DescargaIP = mongoose.model('DescargaIP', DescargaIPSchema);

const ReporteSchema = new mongoose.Schema({
    juegoId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Juego', required: true, index: true },
    motivo:           { type: String, enum: ['caido', 'viejo', 'malware'], required: true },
    usuarioReportante:{ type: String, default: 'Anónimo' },
    ip:               { type: String, required: true },
    fecha:            { type: Date, default: Date.now, index: true }
});
ReporteSchema.index({ juegoId: 1, ip: 1, fecha: -1 });
const Reporte = mongoose.model('Reporte', ReporteSchema);

const JuegoSchema = new mongoose.Schema({
    usuario:    { type: String, required: true, trim: true, default: "Cloud User" },
    title:      { type: String, required: true, maxlength: 200, trim: true },
    description:{ type: String, maxlength: 1000, default: '' },
    image:      { type: String, default: '' },
    images:     { type: [String], default: [], validate: { validator: arr => arr.length <= 4, message: 'Máximo 4 medias adicionales' } },
    link:       { type: String, required: true },
    status:     { type: String, enum: ["pendiente", "aprobado", "rechazado", "pending", "privado"], default: "pendiente" },
    linkStatus: { type: String, enum: ["online", "revision", "caido"], default: "online" },
    visibility: { type: String, enum: ["public", "private"], default: "public" },
    reportes:   { type: Number, default: 0, min: 0 },
    reportesDesglose: {
        caido:   { type: Number, default: 0 },
        viejo:   { type: Number, default: 0 },
        malware: { type: Number, default: 0 }
    },
    category:           { type: String, default: "General", trim: true },
    tags:               [String],
    descargasEfectivas: { type: Number, default: 0, min: 0 },
    likesCount:         { type: Number, default: 0, min: 0 },
    scoreRecomendacion: { type: Number, default: 0 },
    videoType:          { type: String, default: '' },
    featuredItemId:     { type: String, default: '' },
    extraData:          { type: mongoose.Schema.Types.Mixed, default: {} },
    nexusMentor:        { type: mongoose.Schema.Types.Mixed, default: null },
    // Publicaciones divididas en partes (modulos/series.js)
    serie: { clave: { type: String }, base: String, parte: Number, total: Number }
}, { timestamps: true, strict: false });
JuegoSchema.index({ 'serie.clave': 1, 'serie.parte': 1 });

JuegoSchema.index({ usuario: 1, status: 1 });
JuegoSchema.index({ createdAt: -1 });
JuegoSchema.index({ linkStatus: 1 });
JuegoSchema.index({ descargasEfectivas: -1 });
JuegoSchema.index({ likesCount: -1 });
JuegoSchema.index({ status: 1 });
JuegoSchema.index({ scoreRecomendacion: -1 });
JuegoSchema.index({ usuario: 1, descargasEfectivas: -1 }); // ⭐ Para topUploaders en dashboard

JuegoSchema.pre('save', function(next) {
    if (this.reportes >= 3) this.linkStatus = 'revision';
    next();
});
// Cambios en publicaciones invalidan el catálogo cacheado (ver cacheado()). Los que
// solo suben contadores (cada descarga, like o vista) no: vaciarían la caché a cada
// descarga y el TTL de 30 s ya los refresca.
const CONTADORES_JUEGO = new Set(['descargasEfectivas', 'likesCount', 'vistas', 'scoreRecomendacion', 'reportes']);
const soloContadores = u => !!u && !Array.isArray(u) && Object.keys(u).length > 0 &&
    Object.entries(u).every(([op, campos]) => (op === '$inc' || op === '$set') && campos && Object.keys(campos).every(f => CONTADORES_JUEGO.has(f)));
JuegoSchema.post(['save', 'insertMany', 'updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndReplace', 'replaceOne'], function () {
    if (typeof this?.getUpdate === 'function' && soloContadores(this.getUpdate())) return;
    memCache.invalidate('items:*');
});
const Juego = mongoose.model('Juego', JuegoSchema);

// ── Caché de lecturas públicas calientes ──
// TTL corto + invalidación por hooks del modelo. Las peticiones simultáneas con
// la misma clave comparten UNA consulta (sin estampida al expirar). El resultado
// se sirve igual que antes: limpiarPublico() sigue filtrando enlaces por usuario.
const enVuelo = new Map();
function cacheado(clave, ttlSeg, cargar) {
    const hit = memCache.get(clave);
    if (hit !== null) return Promise.resolve(hit);
    if (enVuelo.has(clave)) return enVuelo.get(clave);
    const p = Promise.resolve().then(cargar)
        .then(v => { if (v !== null && v !== undefined) memCache.set(clave, v, ttlSeg); return v; })
        .finally(() => enVuelo.delete(clave));
    enVuelo.set(clave, p);
    return p;
}

const UsuarioSchema = new mongoose.Schema({
    usuario:    { type: String, required: true, unique: true, index: true, minlength: 3, maxlength: 20, trim: true, lowercase: true },
    email:      { type: String, required: true, unique: true, lowercase: true, trim: true, index: true, match: [/^\S+@\S+\.\S+$/, 'Email inválido'] },
    password:   { type: String, required: true, minlength: 6 },
    paypalEmail:{ type: String, default: '', lowercase: true, trim: true, match: [/^(\S+@\S+\.\S+)?$/, 'Email de PayPal inválido'] },
    saldo:      { type: Number, default: 0, min: 0 },
    // Live: monedas compradas (para regalar) y ganancias de regalos aún en retención
    monedas:       { type: Number, default: 0, min: 0 },
    saldoRetenido: { type: Number, default: 0, min: 0 },
    liveKey:       { type: String, default: null, select: false },   // clave de transmisión (OBS)
    descargasTotales:      { type: Number, default: 0, min: 0 },
    isVerificado:          { type: Boolean, default: false, index: true },
    solicitudPagoPendiente:{ type: Boolean, default: false },
    reputacion: { type: Number, default: 0 },
    listaSeguidores: [String],
    siguiendo:       [String],
    verificadoNivel: { type: Number, default: 0, min: 0, max: 3, index: true },
    avatar:   { type: String, default: "" },
    banner:   { type: String, default: "" },   // portada del perfil (detrás del avatar)
    bio:      { type: String, maxlength: 200, default: '' },
    fecha:    { type: Date, default: Date.now },
    registrationIP:  { type: String, default: '' },
    listaNegraAdmin: { type: Boolean, default: false, index: true },
    notasAdmin:      { type: String, default: '', maxlength: 500 },
    fechaListaNegra: { type: Date, default: null },
    ultimoLogin:     { type: Date, default: Date.now, index: true },
    emailVerificado:     { type: Boolean, default: false, index: true },
    emailVerifToken:     { type: String, default: null },
    emailVerifExpires:   { type: Date, default: null },
    resetPasswordToken:  { type: String, default: null },
    resetPasswordExpires:{ type: Date, default: null },
    bloqueados:  { type: [String], default: [] },   // usuarios bloqueados en el chat
    // Panel admin: '' = usuario normal. El dueño se reconoce por OWNER_EMAIL (rutas/adminPanel.js)
    adminRol:      { type: String, default: '', index: true },   // clave de ROLES en rutas/adminPanel.js
    adminPermisos: { type: [String], default: [] },
    adminPermisosV:{ type: Number, default: 0 },    // 2 = permisos granulares (roles exclusivos)
    adminDesde:    { type: Date, default: null },
    adminPor:      { type: String, default: '' },
    adminPausado:  { type: Boolean, default: false },
    adminHasta:    { type: Date, default: null },   // acceso temporal
    adminSesionVer:{ type: Number, default: 0 },    // +1 = cierra todas sus sesiones del panel
    // Qué avisos push quiere recibir en el móvil (Revisión/Equipo se envían siempre)
    notifPrefs: {
        publicaciones: { type: Boolean, default: true },   // creadores que sigo publican algo
        mensajes:      { type: Boolean, default: true },
        social:        { type: Boolean, default: true },   // seguidores, likes, comentarios, logros
        anuncios:      { type: Boolean, default: true },
    },
    suspendido:       { type: Boolean, default: false, index: true },   // no puede iniciar sesión ni usar su token
    motivoSuspension: { type: String, default: '', maxlength: 300 },
    fechaSuspension:  { type: Date, default: null },
    socialLinks: { type: [String], default: [], validate: { validator: v => v.length <= 4, message: 'Máximo 4 links sociales' } },
    lastUsernameChange: { type: Date, default: null },
    lastEmailChange:    { type: Date, default: null },
    tarjetas: [{
        alias:         { type: String, maxlength: 40, default: '' },
        titular:       { type: String, required: true, maxlength: 100 },
        ultimos4:      { type: String, required: true, match: /^\d{4}$/ },
        mesExp:        { type: String, required: true },
        anioExp:       { type: String, required: true },
        tipo:          { type: String, enum: ['visa', 'mastercard', 'amex', 'otro'], default: 'otro' },
        proposito:     { type: String, enum: ['cobros', 'pagos', 'ambos'], default: 'ambos' },
        esPrincipal:   { type: Boolean, default: false },
        fechaAgregada: { type: Date, default: Date.now }
    }]
}, { collection: 'usuarios', timestamps: true });

UsuarioSchema.pre('save', function(next) {
    if (this.verificadoNivel >= 1 && !this.isVerificado) this.isVerificado = true;
    next();
});
const Usuario = mongoose.model('Usuario', UsuarioSchema);

const PagoSchema = new mongoose.Schema({
    usuario:    { type: String, required: true, index: true },
    monto:      { type: Number, required: true, min: 0 },
    paypalEmail:{ type: String, required: true },
    estado:     { type: String, enum: ['pendiente', 'procesado', 'completado', 'rechazado'], default: 'pendiente', index: true },
    fecha:      { type: Date, default: Date.now },
    notas:      { type: String, default: '' }
}, { timestamps: true });
const Pago = mongoose.model('Pago', PagoSchema);

const CommentSchema = new mongoose.Schema({
    usuario: String,
    texto:   String,
    itemId:  String,
    fecha:   { type: Date, default: Date.now }
});
const Comentario = mongoose.model('Comentario', CommentSchema);

// ⭐ FavoritosSchema con índices (corrige COLLSCAN en GET /favoritos/:usuario)
const FavoritosSchema = new mongoose.Schema({
    usuario: { type: String, required: true, index: true },
    itemId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Juego' }
});
FavoritosSchema.index({ usuario: 1, itemId: 1 }, { unique: true });
const Favorito = mongoose.model('Favoritos', FavoritosSchema);

const NotificacionSchema = new mongoose.Schema({
    destinatario: { type: String, required: true, index: true },
    tipo:     { type: String, enum: ['nueva_publicacion', 'favorito', 'descarga', 'sistema', 'comentario', 'seguidor', 'logro'], required: true },
    emisor:   { type: String, required: true },
    itemId:   { type: String, default: '' },
    itemTitle:{ type: String, default: '' },
    itemImage:{ type: String, default: '' },
    mensaje:  { type: String, default: '' },
    leida:    { type: Boolean, default: false, index: true },
    fecha:    { type: Date, default: Date.now, index: true, expires: 30 * 24 * 60 * 60 }
}, { collection: 'notificaciones', timestamps: false });
NotificacionSchema.index({ destinatario: 1, leida: 1, fecha: -1 });
// Push real al móvil: cada notificación NUEVA dispara su push (modulos/push.js)
NotificacionSchema.pre('save', function (next) { this.$locals.nueva = this.isNew; next(); });
NotificacionSchema.post('save', function (doc) { if (doc.$locals?.nueva) push.alCrear([doc]); });
NotificacionSchema.post('insertMany', function (docs) { push.alCrear(Array.isArray(docs) ? docs : [docs]); });
const Notificacion = mongoose.model('Notificacion', NotificacionSchema);

/**
 * Helper unificado para crear notificaciones de forma segura (fire-and-forget).
 * Evita auto-notificarse y nunca lanza errores que rompan la petición principal.
 */
function crearNotif({ destinatario, tipo, emisor = '', itemId = '', itemTitle = '', itemImage = '', mensaje = '' }) {
    try {
        if (!destinatario || !tipo) return;
        if (emisor && destinatario.toLowerCase() === emisor.toLowerCase()) return; // no auto-notificar
        new Notificacion({
            destinatario: destinatario.toLowerCase(),
            tipo, emisor, itemId: itemId || '', itemTitle: itemTitle || '',
            itemImage: itemImage || '', mensaje: mensaje || '',
            leida: false, fecha: new Date()
        }).save().catch(err => logger.debug(`[crearNotif] ${err.message}`));
    } catch (err) {
        logger.debug(`[crearNotif] ${err.message}`);
    }
}

const MensajeSchema = new mongoose.Schema({
    de:     { type: String, required: true, index: true },
    para:   { type: String, required: true, index: true },
    texto:  { type: String, default: '', maxlength: 2000 },
    imagen: { type: String, default: '' },
    leido:  { type: Boolean, default: false, index: true },
    fecha:  { type: Date, default: Date.now, index: true, expires: 90 * 24 * 60 * 60 },
    // Chat v2
    actualizado: { type: Date, default: Date.now, index: true },   // cambia al leer/editar/reaccionar/borrar
    editado:     { type: Boolean, default: false },
    borrado:     { type: Boolean, default: false },                 // eliminado para todos
    ocultoPara:  { type: [String], default: [] },                   // eliminado/vaciado solo para esos usuarios
    replyTo:     { id: String, de: String, texto: String, imagen: Boolean },
    reacciones:  { type: [{ u: String, e: String, _id: false }], default: [] }
}, { collection: 'mensajes', timestamps: false });
MensajeSchema.index({ de: 1, para: 1, fecha: 1 });
MensajeSchema.index({ para: 1, leido: 1 });
const Mensaje = mongoose.model('Mensaje', MensajeSchema);

const StorySchema = new mongoose.Schema({
    usuario: { type: String, required: true, index: true },
    imagen:  { type: String, default: '' },
    texto:   { type: String, default: '', maxlength: 200 },
    vistos:  { type: [String], default: [] },
    fecha:   { type: Date, default: Date.now, index: true, expires: 24 * 60 * 60 }
}, { collection: 'stories', timestamps: false });
const Story = mongoose.model('Story', StorySchema);

// ========== MIDDLEWARE JWT ==========
const presenciaEscrita = new Map();   // usuario → ms de la última escritura de ultimoLogin
const verificarToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    // Detectar "Bearer null" o "Bearer undefined" que llegan del frontend
    if (!token || token === 'null' || token === 'undefined' || token.length < 20) {
        return res.status(401).json({ success: false, error: "Sesión no iniciada", code: "NO_TOKEN" });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (adminPanel.estaSuspendido(decoded.usuario))
            return res.status(403).json({ success: false, error: 'Tu cuenta está suspendida. Contacta a soporte.', code: 'SUSPENDIDO' });
        req.usuario = decoded.usuario;
        req.userTokenData = decoded;

        // Presencia: actualizar ultimoLogin como máximo una vez por minuto
        // (antes era una escritura en la BD en CADA petición autenticada)
        const ahoraMs = Date.now();
        if ((presenciaEscrita.get(decoded.usuario) || 0) < ahoraMs - 60000) {
            presenciaEscrita.set(decoded.usuario, ahoraMs);
            if (presenciaEscrita.size > 50000) presenciaEscrita.clear();
            Usuario.updateOne({ usuario: decoded.usuario }, { $set: { ultimoLogin: new Date() } }).catch(() => {});
        }

        next();
    } catch (error) {
        // Distinguir expirado vs firma inválida
        const code = error.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
        const msg  = code === 'TOKEN_EXPIRED'
            ? 'Tu sesión expiró, vuelve a iniciar sesión'
            : 'Sesión inválida, vuelve a iniciar sesión';
        return res.status(401).json({ success: false, error: msg, code });
    }
};

// Sesión opcional: devuelve el usuario si el token es válido, o null (invitado)
function usuarioOpcional(req) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token || token.length < 20) return null;
    try {
        const u = jwt.verify(token, JWT_SECRET).usuario;
        return u && !adminPanel.estaSuspendido(u) ? u : null;
    } catch (_) { return null; }
}

// ========== CONSTANTES DE ECONOMÍA ==========
const CPM_VALUE                = config.CPM_VALUE;
const AUTHOR_PERCENTAGE        = config.AUTHOR_PERCENTAGE;

const MIN_WITHDRAWAL           = config.MIN_WITHDRAWAL;
const MAX_DOWNLOADS_PER_IP_PER_DAY = config.MAX_DOWNLOADS_PER_IP_PER_DAY;

// ══════════════════════════════════════════════════════════════
//  EMAIL VERIFICACIÓN
// ══════════════════════════════════════════════════════════════

app.get('/auth/verify-email/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const usuario = await Usuario.findOne({
            emailVerifToken: token,
            emailVerifExpires: { $gt: new Date() }
        });
        if (!usuario) return res.redirect(`${APP_URL}?verif=error`);
        usuario.emailVerificado   = true;
        usuario.emailVerifToken   = null;
        usuario.emailVerifExpires = null;
        await usuario.save();
        logger.info(`Email verificado: @${usuario.usuario}`);
        res.redirect(`${APP_URL}?verif=ok&u=${encodeURIComponent(usuario.usuario)}`);
    } catch (err) {
        logger.error(`Error verificando email: ${err.message}`);
        res.redirect(`${APP_URL}?verif=error`);
    }
});

app.post('/auth/resend-verification', [body('email').isEmail().normalizeEmail(EMAIL_NORMALIZE_OPTS)], async (req, res) => {
    try {
        const { email } = req.body;
        const usuario = await Usuario.findOne({ email: email.toLowerCase() });
        if (!usuario || usuario.emailVerificado)
            return res.json({ success: true, mensaje: 'Si el email existe y no está verificado, recibirás el link.' });
        const verifToken = crypto.randomBytes(32).toString('hex');
        usuario.emailVerifToken   = verifToken;
        usuario.emailVerifExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await usuario.save();
        const verifLink = `${API_URL_SELF}/auth/verify-email/${verifToken}`;
        await sendEmail({ to: email, subject: '✅ Verifica tu email en UpGames', html: emailVerifTemplate(usuario.usuario, verifLink) });
        res.json({ success: true, mensaje: 'Si el email existe y no está verificado, recibirás el link.' });
    } catch (err) {
        logger.error(`Error reenviando verificación: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

// ══════════════════════════════════════════════════════════════
//  RECUPERACIÓN DE CONTRASEÑA
// ══════════════════════════════════════════════════════════════

app.post('/auth/forgot-password', [body('email').isEmail().normalizeEmail(EMAIL_NORMALIZE_OPTS)], async (req, res) => {
    try {
        const { email } = req.body;
        const usuario = await Usuario.findOne({ email: email.toLowerCase() });
        if (!usuario)
            return res.json({ success: true, mensaje: 'Si el email está registrado, recibirás un link para restablecer tu contraseña.' });
        const resetToken = crypto.randomBytes(32).toString('hex');
        usuario.resetPasswordToken   = resetToken;
        usuario.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
        await usuario.save();
        const resetLink = `${APP_URL}?reset_token=${resetToken}`;
        await sendEmail({ to: email, subject: '🔑 Restablece tu contraseña de UpGames', html: emailResetTemplate(usuario.usuario, resetLink) });
        logger.info(`Reset de contraseña solicitado: @${usuario.usuario}`);
        res.json({ success: true, mensaje: 'Si el email está registrado, recibirás un link para restablecer tu contraseña.' });
    } catch (err) {
        logger.error(`Error en forgot-password: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

app.post('/auth/reset-password', [body('token').notEmpty(), body('password').isLength({ min: 6 })], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Token o contraseña inválidos' });
        const { token, password } = req.body;
        const usuario = await Usuario.findOne({ resetPasswordToken: token, resetPasswordExpires: { $gt: new Date() } });
        if (!usuario) return res.status(400).json({ success: false, error: 'El link es inválido o ya expiró. Solicita uno nuevo.' });
        usuario.password             = await bcrypt.hash(password, 10);
        usuario.resetPasswordToken   = null;
        usuario.resetPasswordExpires = null;
        await usuario.save();
        logger.info(`Contraseña restablecida: @${usuario.usuario}`);
        res.json({ success: true, mensaje: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.' });
    } catch (err) {
        logger.error(`Error en reset-password: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

// ========== ADMIN AUTH ==========
// Roles (dueño + sub-admins), login con la cuenta, permisos, auditoría,
// anuncios y diagnóstico → rutas/adminPanel.js
const adminPanel = require('./rutas/adminPanel').registrar(app, {
    Usuario, Juego, Comentario, Notificacion, Pago, JWT_SECRET, logger, twoFactor, authLimiter,
});
const verificarAdmin = adminPanel.verificarAdmin;
// Nexus como asistente del panel: briefing priorizado + chat con los datos del admin
require('./rutas/adminNexus').registrar(app, { verificarAdmin, Juego, Usuario, Comentario, Pago, logger });

// ==========================================
// ⭐ RUTAS DE ECONOMÍA
// ==========================================

app.post('/economia/validar-descarga', [body('juegoId').isMongoId()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "ID de juego inválido", details: errors.array() });

        const { juegoId, tieneAdBlocker } = req.body;
        const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                   req.headers['x-real-ip'] ||
                   req.connection.remoteAddress ||
                   req.socket.remoteAddress;

        logger.info(`Validación de descarga - Juego: ${juegoId}, IP: ${ip}, AdBlocker: ${tieneAdBlocker ? '⚠️ SÍ' : '✅ NO'}`);

        const juego = await Juego.findById(juegoId);
        if (!juego) return res.status(404).json({ success: false, error: "Juego no encontrado" });
        if (juego.status !== 'aprobado') return res.status(403).json({ success: false, error: "El juego no está aprobado para descargas" });

        if (tieneAdBlocker === true) {
            logger.info(`Ad Blocker detectado — Juego: ${juegoId}, IP: ${ip}`);
            return res.json({ success: true, descargaContada: false, adBlockerDetectado: true, link: juego.link, mensaje: "Acceso permitido, pero el bloqueador de anuncios impide que la descarga cuente para el autor" });
        }

        let registroIP = await DescargaIP.findOne({ juegoId, ip });
        if (registroIP) {
            if (registroIP.contadorHoy >= MAX_DOWNLOADS_PER_IP_PER_DAY) {
                logger.warn(`Límite alcanzado - IP: ${ip}, Juego: ${juegoId}`);
                return res.json({ success: true, limiteAlcanzado: true, mensaje: "Has alcanzado el límite de descargas para hoy", link: juego.link });
            }
            registroIP.contadorHoy += 1;
            await registroIP.save();
        } else {
            await new DescargaIP({ juegoId, ip, contadorHoy: 1 }).save();
        }

        await Juego.findByIdAndUpdate(juegoId, { $inc: { descargasEfectivas: 1 } });
        juego.descargasEfectivas = (juego.descargasEfectivas || 0) + 1;

        // ⭐ Fire & forget — el like responde inmediatamente, score se actualiza en background
        calcularScoreRecomendacion(juegoId).catch(() => {});

        const autor = await Usuario.findOne({ usuario: juego.usuario });
        if (!autor) {
            logger.warn(`Autor no encontrado: ${juego.usuario}`);
            return res.json({ success: true, descargaContada: true, link: juego.link, mensaje: "Descarga válida" });
        }

        if (autor.listaNegraAdmin) {
            logger.warn(`Usuario en lista negra: @${autor.usuario}`);
            autor.descargasTotales = (autor.descargasTotales || 0) + 1;
            await autor.save();
            return res.json({ success: true, descargaContada: true, link: juego.link, descargasEfectivas: juego.descargasEfectivas, mensaje: "Descarga válida", warning: "Usuario bajo revisión - ganancia suspendida" });
        }

        autor.descargasTotales = (autor.descargasTotales || 0) + 1;

        const ADMIN_USERS = (process.env.ADMIN_USERS || '').split(',').map(u => u.trim()).filter(Boolean);

        let gananciaGenerada = 0;
        let shouldAnalyzeFraud = false;

        gananciaGenerada = (CPM_VALUE * AUTHOR_PERCENTAGE) / 1000;
        autor.saldo = (autor.saldo || 0) + gananciaGenerada;
        shouldAnalyzeFraud = !ADMIN_USERS.includes(autor.usuario);
        logger.info(`Ganancia generada - Autor: @${autor.usuario}, +$${gananciaGenerada.toFixed(4)} USD`);

        if (shouldAnalyzeFraud) {
            const fraudAnalysis = await fraudDetector.analyzeDownloadBehavior(autor.usuario, juegoId, ip, gananciaGenerada);
            if (fraudAnalysis.suspicious) {
                logger.warn(`COMPORTAMIENTO SOSPECHOSO - @${autor.usuario}:`);
                fraudAnalysis.reasons.forEach(reason => logger.warn(`  - ${reason}`));
                if (fraudAnalysis.autoFlag) {
                    const flagged = await fraudDetector.autoFlagUser(Usuario, autor.usuario, `Detección automática: ${fraudAnalysis.reasons.join(', ')}`);
                    if (flagged) {
                        autor.saldo -= gananciaGenerada;
                        gananciaGenerada = 0;
                        logger.warn(`Usuario auto-marcado y ganancia revertida: @${autor.usuario}`);
                    }
                }
            }
        }

        await autor.save();

        // ── Hooks gamificación & recomendaciones (fire & forget) ──
        gamification.onDescarga(juego.usuario).catch(() => {});
        recommendations.invalidateItemCache(juegoId);

        // Hitos de descargas: avisa al autor (gamificación + notificación)
        if ([10, 50, 100, 500, 1000, 5000].includes(juego.descargasEfectivas)) {
            crearNotif({
                destinatario: juego.usuario, tipo: 'logro', emisor: 'UpGames',
                itemId: juegoId, itemTitle: juego.title, itemImage: juego.image || '',
                mensaje: `🎉 ¡"${juego.title}" alcanzó ${juego.descargasEfectivas} descargas!`
            });
        }
        if (juego.descargasEfectivas === 100 || juego.descargasEfectivas === 1000) {
            gamification.onItemViral(juego.usuario, juego.descargasEfectivas).catch(() => {});
        }

        logger.info(`Descarga efectiva validada - Juego: ${juego.title}, Total: ${juego.descargasEfectivas}`);

        res.json({
            success: true, descargaContada: true, link: juego.link,
            descargasEfectivas: juego.descargasEfectivas, mensaje: "Descarga válida y contada",
            title: juego.title || '', category: juego.category || '', tags: juego.tags || [], usuario: juego.usuario || ''
        });
    } catch (error) {
        logger.error(`Error en validar-descarga: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al validar descarga" });
    }
});

app.post('/economia/solicitar-pago', verificarToken, async (req, res) => {
    try {
        const usuario = await Usuario.findOne({ usuario: req.usuario });
        if (!usuario) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        if (!usuario.isVerificado || usuario.verificadoNivel < 1) return res.status(403).json({ success: false, error: "Debes ser verificado (nivel 1+) para solicitar pagos" });
        if (usuario.saldo < MIN_WITHDRAWAL) return res.status(400).json({ success: false, error: `Saldo mínimo para retiro: $${MIN_WITHDRAWAL} USD. Tu saldo: $${usuario.saldo.toFixed(2)}` });
        if (!usuario.paypalEmail?.trim()) return res.status(400).json({ success: false, error: "Debes configurar tu email de PayPal primero" });
        if (usuario.solicitudPagoPendiente) return res.status(400).json({ success: false, error: "Ya tienes una solicitud de pago pendiente" });

        const juegoElegible = await Juego.findOne({ usuario: usuario.usuario, descargasEfectivas: { $gt: 0 } }).select('_id').lean();
        if (!juegoElegible && !(await live.tieneIngresosLive(usuario.usuario))) return res.status(403).json({ success: false, error: "Aún no tienes ingresos por descargas ni por regalos en tus lives" });

        // Reclamo atómico de la marca: un doble clic creaba dos solicitudes por el mismo saldo
        const marcado = await Usuario.updateOne({ _id: usuario._id, solicitudPagoPendiente: { $ne: true } }, { $set: { solicitudPagoPendiente: true } });
        if (!marcado.modifiedCount) return res.status(400).json({ success: false, error: "Ya tienes una solicitud de pago pendiente" });
        const nuevoPago = new Pago({ usuario: usuario.usuario, monto: usuario.saldo, paypalEmail: usuario.paypalEmail, estado: 'pendiente' });
        try { await nuevoPago.save(); }
        catch (e) { await Usuario.updateOne({ _id: usuario._id }, { $set: { solicitudPagoPendiente: false } }); throw e; }
        logger.info(`Solicitud de pago creada - @${usuario.usuario}, Monto: $${usuario.saldo.toFixed(2)}`);
        res.json({ success: true, mensaje: "Solicitud de pago enviada. El administrador la revisará pronto.", solicitud: { monto: usuario.saldo, paypalEmail: usuario.paypalEmail, fecha: nuevoPago.fecha } });
    } catch (error) {
        logger.error(`Error en solicitar-pago: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al procesar solicitud de pago" });
    }
});

app.get('/economia/mi-saldo', verificarToken, async (req, res) => {
    try {
        const usuario = await Usuario.findOne({ usuario: req.usuario })
            .select('saldo saldoRetenido monedas descargasTotales paypalEmail isVerificado solicitudPagoPendiente verificadoNivel');
        if (!usuario) return res.status(404).json({ success: false, error: "Usuario no encontrado" });

        const [juegosElegibles, ingresosLive] = await Promise.all([
            Juego.countDocuments({ usuario: req.usuario, descargasEfectivas: { $gt: 0 } }),
            live.tieneIngresosLive(req.usuario),
        ]);
        const puedeRetirar = usuario.saldo >= MIN_WITHDRAWAL && usuario.isVerificado && usuario.verificadoNivel >= 1 && usuario.paypalEmail && (juegosElegibles > 0 || ingresosLive) && !usuario.solicitudPagoPendiente;

        res.json({ success: true, saldo: usuario.saldo, saldoRetenido: usuario.saldoRetenido || 0, monedas: usuario.monedas || 0, descargasTotales: usuario.descargasTotales, paypalEmail: usuario.paypalEmail || '', isVerificado: usuario.isVerificado, verificadoNivel: usuario.verificadoNivel, solicitudPagoPendiente: usuario.solicitudPagoPendiente, juegosElegibles, puedeRetirar, minRetiro: MIN_WITHDRAWAL, requisitos: { saldoMinimo: MIN_WITHDRAWAL, verificacionNecesaria: 1 } });
    } catch (error) {
        logger.error(`Error en mi-saldo: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al obtener saldo" });
    }
});

app.put('/economia/actualizar-paypal', [verificarToken, body('paypalEmail').isEmail().normalizeEmail(EMAIL_NORMALIZE_OPTS)], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Email de PayPal inválido", details: errors.array() });
        const { paypalEmail } = req.body;
        await Usuario.updateOne({ usuario: req.usuario }, { $set: { paypalEmail: paypalEmail.toLowerCase() } });
        logger.info(`PayPal actualizado - @${req.usuario} → ${paypalEmail}`);
        res.json({ success: true, mensaje: "Email de PayPal actualizado correctamente", paypalEmail: paypalEmail.toLowerCase() });
    } catch (error) {
        logger.error(`Error en actualizar-paypal: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al actualizar PayPal" });
    }
});

// ── TARJETAS ──────────────────────────────────────────────────────────────────

// GET /economia/mis-tarjetas — listar tarjetas del usuario
app.get('/economia/mis-tarjetas', verificarToken, async (req, res) => {
    try {
        const usuario = await Usuario.findOne({ usuario: req.usuario }).select('tarjetas').lean();
        if (!usuario) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        res.json({ success: true, tarjetas: usuario.tarjetas || [] });
    } catch (error) {
        logger.error(`Error en mis-tarjetas: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al obtener tarjetas' });
    }
});

// POST /economia/agregar-tarjeta — registrar una nueva tarjeta (solo últimos 4 dígitos)
app.post('/economia/agregar-tarjeta', [
    verificarToken,
    body('ultimos4').isLength({ min: 4, max: 4 }).isNumeric(),
    body('titular').trim().isLength({ min: 2, max: 100 }),
    body('mesExp').isLength({ min: 1, max: 2 }).isNumeric(),
    body('anioExp').isLength({ min: 2, max: 2 }).isNumeric(),
    body('tipo').optional().isIn(['visa','mastercard','amex','otro']),
    body('proposito').optional().isIn(['cobros','pagos','ambos']),
    body('alias').optional().trim().isLength({ max: 40 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Datos de tarjeta inválidos', details: errors.array() });

        const { ultimos4, titular, mesExp, anioExp, tipo = 'otro', proposito = 'ambos', alias = '' } = req.body;

        const usuario = await Usuario.findOne({ usuario: req.usuario });
        if (!usuario) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        if ((usuario.tarjetas || []).length >= 5) return res.status(400).json({ success: false, error: 'Máximo 5 tarjetas permitidas' });

        const esPrimera = (usuario.tarjetas || []).length === 0;
        const nuevaTarjeta = { alias, titular, ultimos4, mesExp: mesExp.padStart(2,'0'), anioExp, tipo, proposito, esPrincipal: esPrimera, fechaAgregada: new Date() };

        await Usuario.updateOne({ usuario: req.usuario }, { $push: { tarjetas: nuevaTarjeta } });
        logger.info(`Tarjeta agregada - @${req.usuario} | ${tipo} ****${ultimos4}`);
        res.json({ success: true, mensaje: 'Tarjeta registrada correctamente' });
    } catch (error) {
        logger.error(`Error en agregar-tarjeta: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al agregar tarjeta' });
    }
});

// DELETE /economia/eliminar-tarjeta/:tarjetaId — eliminar una tarjeta
app.delete('/economia/eliminar-tarjeta/:tarjetaId', verificarToken, async (req, res) => {
    try {
        const { tarjetaId } = req.params;
        const result = await Usuario.updateOne(
            { usuario: req.usuario },
            { $pull: { tarjetas: { _id: new mongoose.Types.ObjectId(tarjetaId) } } }
        );
        if (result.modifiedCount === 0) return res.status(404).json({ success: false, error: 'Tarjeta no encontrada' });
        logger.info(`Tarjeta eliminada - @${req.usuario} | id: ${tarjetaId}`);
        res.json({ success: true, mensaje: 'Tarjeta eliminada' });
    } catch (error) {
        logger.error(`Error en eliminar-tarjeta: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al eliminar tarjeta' });
    }
});

// PUT /economia/tarjeta-principal/:tarjetaId — establecer tarjeta como principal
app.put('/economia/tarjeta-principal/:tarjetaId', verificarToken, async (req, res) => {
    try {
        const { tarjetaId } = req.params;
        const usuario = await Usuario.findOne({ usuario: req.usuario }).select('tarjetas');
        if (!usuario) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });

        const existe = (usuario.tarjetas || []).some(t => t._id.toString() === tarjetaId);
        if (!existe) return res.status(404).json({ success: false, error: 'Tarjeta no encontrada' });

        // Quitar principal de todas, poner en la seleccionada
        usuario.tarjetas.forEach(t => { t.esPrincipal = t._id.toString() === tarjetaId; });
        await usuario.save();
        res.json({ success: true, mensaje: 'Tarjeta principal actualizada' });
    } catch (error) {
        logger.error(`Error en tarjeta-principal: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al actualizar tarjeta principal' });
    }
});

// ── ADMIN TARJETAS ────────────────────────────────────────────────────────────

// GET /admin/finanzas/tarjetas — todas las tarjetas de todos los usuarios (admin)
app.get('/admin/finanzas/tarjetas', verificarAdmin, async (req, res) => {
    try {
        const usuarios = await Usuario.find({ 'tarjetas.0': { $exists: true } })
            .select('usuario tarjetas')
            .lean();
        // Aplanar: cada tarjeta lleva el campo usuario
        const tarjetas = [];
        for (const u of usuarios) {
            for (const t of u.tarjetas || []) {
                tarjetas.push({ ...t, usuario: u.usuario });
            }
        }
        tarjetas.sort((a, b) => new Date(b.fechaAgregada) - new Date(a.fechaAgregada));
        res.json({ success: true, tarjetas, total: tarjetas.length });
    } catch (error) {
        logger.error(`Error en admin/tarjetas: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al obtener tarjetas' });
    }
});

// DELETE /admin/finanzas/tarjetas/:tarjetaId — eliminar tarjeta de cualquier usuario (admin)
app.delete('/admin/finanzas/tarjetas/:tarjetaId', verificarAdmin, async (req, res) => {
    try {
        const { tarjetaId } = req.params;
        const result = await Usuario.updateOne(
            { 'tarjetas._id': new mongoose.Types.ObjectId(tarjetaId) },
            { $pull: { tarjetas: { _id: new mongoose.Types.ObjectId(tarjetaId) } } }
        );
        if (result.modifiedCount === 0) return res.status(404).json({ success: false, error: 'Tarjeta no encontrada' });
        logger.info(`Admin eliminó tarjeta id:${tarjetaId}`);
        res.json({ success: true, mensaje: 'Tarjeta eliminada por admin' });
    } catch (error) {
        logger.error(`Error en admin/eliminar-tarjeta: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al eliminar tarjeta' });
    }
});

// PUT /admin/finanzas/tarjetas/:tarjetaId/principal — cambiar tarjeta principal (admin)
app.put('/admin/finanzas/tarjetas/:tarjetaId/principal', verificarAdmin, async (req, res) => {
    try {
        const { tarjetaId } = req.params;
        const { usuario } = req.body;
        if (!usuario) return res.status(400).json({ success: false, error: 'Se requiere el campo usuario' });
        const u = await Usuario.findOne({ usuario });
        if (!u) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        const existe = (u.tarjetas || []).some(t => t._id.toString() === tarjetaId);
        if (!existe) return res.status(404).json({ success: false, error: 'Tarjeta no encontrada para este usuario' });
        u.tarjetas.forEach(t => { t.esPrincipal = t._id.toString() === tarjetaId; });
        await u.save();
        logger.info(`Admin cambió tarjeta principal de @${usuario} → ${tarjetaId}`);
        res.json({ success: true, mensaje: 'Tarjeta principal actualizada por admin' });
    } catch (error) {
        logger.error(`Error en admin/tarjeta-principal: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al actualizar tarjeta principal' });
    }
});

app.get('/admin/finanzas/solicitudes-pendientes', verificarAdmin, async (req, res) => {
    try {
        const solicitudes = await Pago.find({ estado: 'pendiente' }).sort({ fecha: -1 }).lean();
        const usernames = solicitudes.map(s => s.usuario);
        const [usuariosData, juegosAgg] = await Promise.all([
            Usuario.find({ usuario: { $in: usernames } }).select('usuario email verificadoNivel isVerificado descargasTotales').lean(),
            Juego.aggregate([{ $match: { usuario: { $in: usernames }, descargasEfectivas: { $gt: 0 } } }, { $group: { _id: '$usuario', count: { $sum: 1 } } }])
        ]);
        const usuarioMap = Object.fromEntries(usuariosData.map(u => [u.usuario, u]));
        const juegosMap  = Object.fromEntries(juegosAgg.map(j => [j._id, j.count]));
        const solicitudesEnriquecidas = solicitudes.map(s => ({ ...s, datosUsuario: { email: usuarioMap[s.usuario]?.email || '', verificadoNivel: usuarioMap[s.usuario]?.verificadoNivel || 0, isVerificado: usuarioMap[s.usuario]?.isVerificado || false, descargasTotales: usuarioMap[s.usuario]?.descargasTotales || 0, juegosElegibles: juegosMap[s.usuario] || 0 } }));
        res.json({ success: true, solicitudes: solicitudesEnriquecidas, total: solicitudesEnriquecidas.length });
    } catch (error) {
        logger.error(`Error en solicitudes-pendientes: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al cargar solicitudes" });
    }
});

app.post('/admin/finanzas/procesar-pago/:id', verificarAdmin, [param('id').isMongoId(), body('notas').optional().trim()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "ID inválido" });
        const { id } = req.params;
        const { notas } = req.body;
        // Reclamo atómico: dos clics o dos admins a la vez ya no pueden pagar dos veces
        const pago = await Pago.findOneAndUpdate({ _id: id, estado: 'pendiente' }, { $set: { estado: 'procesado' } }, { new: true });
        if (!pago) {
            const existe = await Pago.exists({ _id: id });
            return res.status(existe ? 409 : 404).json({ success: false, error: existe ? "Este pago ya fue procesado (o se está procesando)" : "Pago no encontrado" });
        }

        const pagoAutomatico = config.FEATURES.ENABLE_AUTO_PAYMENTS;
        let paypalBatchId = null;
        let metodoProcesamiento = 'manual';

        if (pagoAutomatico) {
            try {
                const resultado = await enviarPagoPayPal(pago.paypalEmail, pago.monto, id);
                paypalBatchId = resultado.batchId;
                metodoProcesamiento = `paypal_auto (batch: ${paypalBatchId})`;
                logger.info(`PayPal Payout enviado - @${pago.usuario} → ${pago.paypalEmail} | $${pago.monto.toFixed(2)} | Batch: ${paypalBatchId}`);
            } catch (paypalError) {
                logger.error(`PayPal Payout falló para @${pago.usuario}: ${paypalError.message}`);
                await Pago.updateOne({ _id: id, estado: 'procesado' }, { $set: { estado: 'pendiente' } });
                return res.status(502).json({ success: false, error: `El pago no se pudo enviar vía PayPal: ${paypalError.message}`, detalle: 'El saldo del usuario NO fue modificado. Revisa las credenciales de PayPal o procesa manualmente.', paypalEmail: pago.paypalEmail, monto: pago.monto });
            }
        }

        pago.estado = 'completado';
        pago.notas = notas || (pagoAutomatico ? `Pago automático vía PayPal Payouts el ${new Date().toLocaleString('es-ES')}. Batch ID: ${paypalBatchId}` : `Pago procesado manualmente el ${new Date().toLocaleString('es-ES')}`);
        await pago.save();

        // Descuento atómico (otra descarga podía sumar saldo entre leer y guardar)
        const r = await Usuario.updateOne({ usuario: pago.usuario }, [{ $set: { saldo: { $max: [0, { $subtract: ['$saldo', pago.monto] }] }, solicitudPagoPendiente: false } }]);
        if (r.matchedCount) gamification.onPagoRecibido(pago.usuario, pago.monto).catch(() => {});

        logger.info(`Pago procesado [${metodoProcesamiento}] - @${pago.usuario}, Monto: $${pago.monto.toFixed(2)}`);
        res.json({ success: true, mensaje: pagoAutomatico ? `Pago enviado automáticamente vía PayPal a ${pago.paypalEmail}` : "Pago marcado como procesado manualmente", metodo: pagoAutomatico ? 'paypal_automatico' : 'manual', paypalBatchId: paypalBatchId || null, pago: { usuario: pago.usuario, monto: pago.monto, paypalEmail: pago.paypalEmail, fecha: pago.fecha } });
    } catch (error) {
        logger.error(`Error en procesar-pago: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al procesar pago" });
    }
});

app.post('/admin/finanzas/rechazar-pago/:id', verificarAdmin, [param('id').isMongoId(), body('motivo').optional().trim()], async (req, res) => {
    try {
        const pago = await Pago.findOneAndUpdate({ _id: req.params.id, estado: 'pendiente' },
            { $set: { estado: 'rechazado', notas: req.body.motivo || 'Rechazado por el administrador' } }, { new: true });
        if (!pago) {
            const existe = await Pago.exists({ _id: req.params.id });
            return res.status(existe ? 409 : 404).json({ success: false, error: existe ? "El pago ya fue procesado" : "Pago no encontrado" });
        }
        await Usuario.updateOne({ usuario: pago.usuario }, { $set: { solicitudPagoPendiente: false } });
        logger.warn(`Pago rechazado - @${pago.usuario}`);
        res.json({ success: true, mensaje: "Pago rechazado", pago: { usuario: pago.usuario, monto: pago.monto, motivo: pago.notas } });
    } catch (error) {
        logger.error(`Error en rechazar-pago: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al rechazar pago" });
    }
});

app.get('/admin/finanzas/historial', verificarAdmin, async (req, res) => {
    try {
        const { estado, usuario, limite = 50 } = req.query;
        const filtro = {};
        if (estado) filtro.estado = estado;
        if (usuario) filtro.usuario = usuario.toLowerCase();
        const historial = await Pago.find(filtro).sort({ fecha: -1 }).limit(parseInt(limite)).lean();
        res.json({ success: true, historial, total: historial.length });
    } catch (error) {
        logger.error(`Error en historial: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al cargar historial" });
    }
});

// GET /economia/historial-pagos — historial de retiros del creador autenticado
app.get('/economia/historial-pagos', verificarToken, async (req, res) => {
    try {
        const historial = await Pago.find({ usuario: req.usuario })
            .sort({ fecha: -1 })
            .limit(50)
            .select('monto paypalEmail estado fecha notas')
            .lean();
        res.json({ success: true, historial, total: historial.length });
    } catch (error) {
        logger.error(`Error en historial-pagos: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al cargar historial' });
    }
});

app.get('/admin/finanzas/estadisticas', verificarAdmin, async (req, res) => {
    try {
        const [totalSolicitado, totalPagado, totalUsuariosConSaldo, totalUsuariosVerificados, solicitudesPendientes] = await Promise.all([
            Pago.aggregate([{ $match: { estado: 'pendiente' } }, { $group: { _id: null, total: { $sum: '$monto' } } }]),
            Pago.aggregate([{ $match: { estado: 'completado' } }, { $group: { _id: null, total: { $sum: '$monto' } } }]),
            Usuario.countDocuments({ saldo: { $gt: 0 } }),
            Usuario.countDocuments({ isVerificado: true }),
            Pago.countDocuments({ estado: 'pendiente' })
        ]);
        res.json({ success: true, estadisticas: { solicitudesPendientes, totalSolicitado: totalSolicitado[0]?.total || 0, totalPagado: totalPagado[0]?.total || 0, usuariosConSaldo: totalUsuariosConSaldo, usuariosVerificados: totalUsuariosVerificados } });
    } catch (error) {
        logger.error(`Error en estadísticas: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al cargar estadísticas" });
    }
});

app.get('/admin/links/en-revision', verificarAdmin, async (req, res) => {
    try {
        const juegosEnRevision = await Juego.find({ linkStatus: 'revision' }).sort({ reportes: -1, createdAt: -1 }).lean();
        res.json({ success: true, juegos: juegosEnRevision, total: juegosEnRevision.length });
    } catch (error) {
        logger.error(`Error en links en revisión: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al cargar links en revisión" });
    }
});

app.put('/admin/links/marcar-caido/:id', verificarAdmin, [param('id').isMongoId()], async (req, res) => {
    try {
        const juego = await Juego.findByIdAndUpdate(req.params.id, { $set: { linkStatus: 'caido' } }, { new: true });
        if (!juego) return res.status(404).json({ success: false, error: "Juego no encontrado" });
        logger.warn(`Link marcado como caído: ${juego.title}`);
        res.json({ success: true, mensaje: "Link marcado como caído.", juego: { _id: juego._id, title: juego.title, linkStatus: juego.linkStatus } });
    } catch (error) {
        logger.error(`Error: ${error?.message}`);
        res.status(500).json({ success: false, error: "Error al marcar link como caído" });
    }
});

app.post('/items/verify-download/:id', async (req, res) => {
    res.json({ success: true, mensaje: "Por favor usa /economia/validar-descarga con el ID en el body", deprecado: true });
});

// ==========================================
// ⭐ AUTENTICACIÓN
// ==========================================

// ── Identidad única: nombre de usuario y email ─────────────────────────
// El nombre se guarda en minúsculas, así "Pepe" y "pepe" son la MISMA cuenta.
// Solo a-z, 0-9 y _ (evita nombres casi idénticos con espacios, puntos o
// letras de otros alfabetos que se ven iguales, ej. "pеpe" con е cirílica).
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const NOMBRES_RESERVADOS = new Set(['admin', 'administrador', 'upgames', 'nexus', 'soporte', 'support',
    'moderador', 'mod', 'staff', 'sistema', 'system', 'root', 'oficial', 'official', 'coral', 'rouce', 'roucedev']);
function errorNombreUsuario(nombre) {
    const n = String(nombre || '').trim().toLowerCase();
    if (n.length < 3 || n.length > 20) return 'El nombre debe tener entre 3 y 20 caracteres';
    if (!USERNAME_RE.test(n)) return 'Solo se permiten letras (a-z), números y guion bajo (_), sin espacios ni tildes';
    if (NOMBRES_RESERVADOS.has(n)) return 'Ese nombre está reservado. Elige otro';
    return null;
}
/** Error E11000 de MongoDB (índice único) → mensaje claro según el campo */
function mensajeDuplicado(err) {
    if (!err || err.code !== 11000) return null;
    const campo = Object.keys(err.keyPattern || err.keyValue || {})[0] || '';
    return campo === 'email' ? 'Ese email ya está registrado en otra cuenta' : 'Ese nombre de usuario ya está en uso';
}
const _dispHits = new Map();
// GET /auth/disponibilidad?usuario=&email= — comprobación en vivo al escribir
app.get('/auth/disponibilidad', async (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || '';
    const now = Date.now(); const h = _dispHits.get(ip) || { t: now, n: 0 };
    if (now - h.t > 60000) { h.t = now; h.n = 0; }
    h.n++; _dispHits.set(ip, h);
    if (_dispHits.size > 5000) _dispHits.clear();
    if (h.n > 40) return res.status(429).json({ success: false, error: 'Demasiadas consultas, espera un momento' });
    try {
        const out = { success: true };
        if (typeof req.query.usuario === 'string' && req.query.usuario.trim()) {
            const n = req.query.usuario.trim().toLowerCase();
            const err = errorNombreUsuario(n);
            if (err) out.usuario = { disponible: false, motivo: err };
            else {
                const existe = await Usuario.exists({ usuario: n });
                out.usuario = existe ? { disponible: false, motivo: `@${n} ya existe. Prueba con otro nombre` } : { disponible: true };
            }
        }
        if (typeof req.query.email === 'string' && req.query.email.trim()) {
            const e = req.query.email.trim().toLowerCase();
            if (!/^\S+@\S+\.\S+$/.test(e)) out.email = { disponible: false, motivo: 'Email inválido' };
            else {
                const existe = await Usuario.exists({ email: e });
                out.email = existe ? { disponible: false, motivo: 'Ese email ya tiene una cuenta. ¿Quieres iniciar sesión?' } : { disponible: true };
            }
        }
        res.json(out);
    } catch (err) {
        logger.error(`[disponibilidad] ${err.message}`);
        res.status(500).json({ success: false, error: 'No se pudo comprobar' });
    }
});

app.post('/auth/register', [
    body('usuario').trim().isLength({ min: 3, max: 20 }).toLowerCase(),
    body('email').isEmail().normalizeEmail(EMAIL_NORMALIZE_OPTS),
    body('password').isLength({ min: 6 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Datos inválidos", details: errors.array() });

        const { usuario, email, password } = req.body;
        const errNombre = errorNombreUsuario(usuario);
        if (errNombre) return res.status(400).json({ success: false, error: errNombre, campo: 'usuario' });
        const registrationIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.headers['x-real-ip'] || req.connection?.remoteAddress || req.socket?.remoteAddress || '';

        const [existeUsuario, existeEmail] = await Promise.all([
            Usuario.findOne({ usuario: usuario.toLowerCase() }).select('_id').lean(),
            Usuario.findOne({ email: email.toLowerCase() }).select('_id').lean()
        ]);
        if (existeUsuario) return res.status(409).json({ success: false, error: `El nombre @${usuario.toLowerCase()} ya está en uso. Elige otro`, campo: 'usuario' });
        if (existeEmail) return res.status(409).json({ success: false, error: "Ese email ya tiene una cuenta. Inicia sesión o recupera tu contraseña", campo: 'email' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const verifToken = crypto.randomBytes(32).toString('hex');

        const nuevoUsuario = new Usuario({
            usuario: usuario.toLowerCase(), email: email.toLowerCase(), password: hashedPassword,
            registrationIP, emailVerifToken: verifToken, emailVerifExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), emailVerificado: false
        });
        await nuevoUsuario.save();
        logger.info(`Nuevo usuario registrado: @${usuario} (${email})`);

        // ── Hook referral (si viene codigoReferral en el body) ──
        if (req.body.codigoReferral) {
            const socialFeed = require('./modulos/socialFeed');
            socialFeed.registrarReferido(req.body.codigoReferral, nuevoUsuario.usuario).catch(() => {});
        }

        const verifLink = `${API_URL_SELF}/auth/verify-email/${verifToken}`;
        sendEmail({ to: email, subject: '✅ Verifica tu email en UpGames', html: emailVerifTemplate(usuario, verifLink) }).catch(() => {});

        const token = jwt.sign({ usuario: nuevoUsuario.usuario, email: nuevoUsuario.email }, JWT_SECRET, { expiresIn: '30d' });
        res.status(201).json({ success: true, ok: true, token, usuario: nuevoUsuario.usuario, email: nuevoUsuario.email, emailVerificado: false, mensaje: 'Cuenta creada. Revisa tu email para verificar tu cuenta.', datosUsuario: { usuario: nuevoUsuario.usuario, email: nuevoUsuario.email, verificadoNivel: nuevoUsuario.verificadoNivel, isVerificado: nuevoUsuario.isVerificado, emailVerificado: false } });
    } catch (error) {
        // Dos registros simultáneos con el mismo nombre/email: el índice único lo frena
        const dup = mensajeDuplicado(error);
        if (dup) return res.status(409).json({ success: false, error: dup, campo: /email/i.test(dup) ? 'email' : 'usuario' });
        logger.error(`Error en register: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al registrar usuario" });
    }
});

app.post('/auth/login', [body('usuario').notEmpty(), body('password').notEmpty()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Datos inválidos" });

        const { usuario: identificador, password } = req.body;
        const id = identificador.toLowerCase().trim();
        const orConds = [{ usuario: id }, { email: id }];
        // Fallback para cuentas antiguas de Gmail guardadas sin puntos por el
        // normalizeEmail anterior: permite entrar con el email real "con puntos".
        const legacyGmail = gmailLegacyEmail(id);
        if (legacyGmail) orConds.push({ email: legacyGmail });
        const usuario = await Usuario.findOne({ $or: orConds });
        if (!usuario) return res.status(401).json({ success: false, error: "Usuario o contraseña incorrectos" });

        const esValida = await bcrypt.compare(password, usuario.password);
        if (!esValida) return res.status(401).json({ success: false, error: "Usuario o contraseña incorrectos" });
        if (usuario.suspendido) return res.status(403).json({ success: false, error: 'Tu cuenta está suspendida' + (usuario.motivoSuspension ? `: ${usuario.motivoSuspension}` : '') + '. Contacta a soporte.', code: 'SUSPENDIDO' });

        // ── Verificación 2FA (si el usuario lo tiene activo) ──
        const tieneDFA = await twoFactor.tieneActivo(usuario.usuario);
        if (tieneDFA) {
            if (!req.body.token2fa) {
                return res.status(401).json({ error: 'Se requiere código 2FA', require2FA: true });
            }
            const check = await twoFactor.verificar(usuario.usuario, req.body.token2fa);
            if (!check.ok) {
                return res.status(401).json({ error: check.error || 'Código 2FA incorrecto' });
            }
        }

        const token = jwt.sign({ usuario: usuario.usuario, email: usuario.email }, JWT_SECRET, { expiresIn: '30d' });
        logger.info(`Login exitoso: @${usuario.usuario}`);

        // ── Hook gamificación: racha diaria (fire & forget) ──
        gamification.onLogin(usuario.usuario).catch(() => {});

        // Fire & forget — no bloquea la respuesta
        Usuario.updateOne({ usuario: usuario.usuario }, { $set: { ultimoLogin: new Date() } }).catch(() => {});

        res.json({ success: true, ok: true, token, usuario: usuario.usuario, email: usuario.email, datosUsuario: { usuario: usuario.usuario, email: usuario.email, verificadoNivel: usuario.verificadoNivel, isVerificado: usuario.isVerificado, saldo: usuario.saldo, socialLinks: usuario.socialLinks || [], lastUsernameChange: usuario.lastUsernameChange || null, lastEmailChange: usuario.lastEmailChange || null } });
    } catch (error) {
        logger.error(`Error en login: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al iniciar sesión" });
    }
});

// ==========================================
// ⭐ ADMIN DASHBOARD
// ==========================================

app.get('/admin/stats/dashboard', verificarAdmin, async (req, res) => {
    try {
        const ahora = new Date();
        const hoy   = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
        const semana = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);

        const [
            totalUsers, usersHoy, usersSemana,
            totalItems, itemsPendientes, itemsAprobados, itemsHoy,
            descargasAggregate, descargasHoy,
            saldoTotal, saldoPendientePago,
            totalComentarios, comentariosHoy,
            topUploaders, usuariosListaNegra,
            itemsMasDescargados
        ] = await Promise.all([
            Usuario.countDocuments(),
            Usuario.countDocuments({ createdAt: { $gte: hoy } }),
            Usuario.countDocuments({ createdAt: { $gte: semana } }),
            Juego.countDocuments(),
            Juego.countDocuments({ status: { $in: ['pendiente', 'pending'] } }),
            Juego.countDocuments({ status: 'aprobado' }),
            Juego.countDocuments({ createdAt: { $gte: hoy } }),
            Juego.aggregate([{ $group: { _id: null, total: { $sum: '$descargasEfectivas' } } }]),
            DescargaIP.countDocuments({ fecha: { $gte: hoy } }),
            Usuario.aggregate([{ $group: { _id: null, total: { $sum: '$saldo' } } }]),
            Pago.aggregate([{ $match: { estado: 'pendiente' } }, { $group: { _id: null, total: { $sum: '$monto' } } }]),
            Comentario.countDocuments(),
            Comentario.countDocuments({ fecha: { $gte: hoy } }),
            // ⭐ topUploaders — usa el índice compuesto (usuario, descargasEfectivas)
            Juego.aggregate([
                { $match: { status: 'aprobado' } },
                { $group: { _id: '$usuario', totalDescargas: { $sum: '$descargasEfectivas' }, totalItems: { $sum: 1 } } },
                { $sort: { totalDescargas: -1 } },
                { $limit: 5 }
            ]),
            Usuario.countDocuments({ listaNegraAdmin: true }),
            Juego.find({ status: 'aprobado' }).sort({ likesCount: -1 }).limit(5).select('title usuario likesCount descargasEfectivas').lean()
        ]);

        res.json({ success: true, dashboard: {
            usuarios: { total: totalUsers, hoy: usersHoy, semana: usersSemana, listaNegra: usuariosListaNegra },
            items:    { total: totalItems, pendientes: itemsPendientes, aprobados: itemsAprobados, hoy: itemsHoy },
            descargas:{ total: descargasAggregate[0]?.total || 0, hoy: descargasHoy },
            finanzas: { saldoEnCirculacion: parseFloat((saldoTotal[0]?.total || 0).toFixed(2)), pendienteDePago: parseFloat((saldoPendientePago[0]?.total || 0).toFixed(2)) },
            comentarios: { total: totalComentarios, hoy: comentariosHoy },
            topUploaders, itemsMasDescargados
        }});
    } catch (error) {
        logger.error(`Error en dashboard: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al cargar dashboard" });
    }
});

app.put('/admin/users/ajustar-saldo/:id', verificarAdmin, [param('id').isMongoId(), body('saldo').isFloat({ min: 0 }), body('motivo').optional().trim()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Datos inválidos" });
        const { saldo, motivo } = req.body;
        const user = await Usuario.findByIdAndUpdate(req.params.id, { $set: { saldo: parseFloat(saldo) } }, { new: true }).select('-password -resetPasswordToken -resetPasswordExpires -emailVerifToken -emailVerifExpires');
        if (!user) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        logger.info(`ADMIN: Saldo ajustado @${user.usuario} → $${saldo} (${motivo || 'Sin motivo'})`);
        res.json({ success: true, usuario: user.usuario, nuevoSaldo: user.saldo });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al ajustar saldo" });
    }
});

app.put('/admin/items/bulk-action', verificarAdmin, [body('ids').isArray({ min: 1, max: 500 }), body('ids.*').isMongoId(), body('action').isIn(['aprobar', 'rechazar', 'eliminar', 'online', 'caido'])], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Datos inválidos" });
        const { ids, action } = req.body;
        let resultado;
        if (action === 'aprobar')    resultado = await Juego.updateMany({ _id: { $in: ids } }, { $set: { status: 'aprobado' } });
        else if (action === 'rechazar') resultado = await Juego.updateMany({ _id: { $in: ids } }, { $set: { status: 'rechazado' } });
        else if (action === 'eliminar') resultado = await Juego.deleteMany({ _id: { $in: ids } });
        else if (action === 'online') resultado = await Juego.updateMany({ _id: { $in: ids } }, { $set: { linkStatus: 'online', reportes: 0 } });
        else if (action === 'caido')  resultado = await Juego.updateMany({ _id: { $in: ids } }, { $set: { linkStatus: 'caido' } });
        const afectados = resultado?.modifiedCount || resultado?.deletedCount || 0;
        logger.info(`ADMIN BULK: ${action} en ${afectados} items`);
        res.json({ success: true, afectados, action });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error en acción en lote" });
    }
});

app.post('/admin/finanzas/rechazar-pago-admin/:id', verificarAdmin, [param('id').isMongoId(), body('motivo').optional().trim()], async (req, res) => {
    try {
        const pago = await Pago.findOneAndUpdate({ _id: req.params.id, estado: 'pendiente' },
            { $set: { estado: 'rechazado', notas: req.body.motivo || 'Rechazado por el administrador' } }, { new: true });
        if (!pago) {
            const existe = await Pago.exists({ _id: req.params.id });
            return res.status(existe ? 409 : 404).json({ success: false, error: existe ? "El pago ya fue procesado" : "Pago no encontrado" });
        }
        await Usuario.updateOne({ usuario: pago.usuario }, { $set: { solicitudPagoPendiente: false } });
        logger.warn(`ADMIN: Pago rechazado @${pago.usuario}`);
        res.json({ success: true, mensaje: "Pago rechazado" });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al rechazar pago" });
    }
});

app.get('/admin/finanzas/historial-completo', verificarAdmin, async (req, res) => {
    try {
        const { estado, limite = 100 } = req.query;
        const filtro = estado ? { estado } : {};
        const historial = await Pago.find(filtro).sort({ fecha: -1 }).limit(parseInt(limite)).lean();
        res.json({ success: true, historial, total: historial.length });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al cargar historial" });
    }
});

app.get('/admin/stats/top-usuarios', verificarAdmin, async (req, res) => {
    try {
        const { por = 'saldo', limite = 10 } = req.query;
        const sortField = por === 'descargas' ? { descargasTotales: -1 } : { saldo: -1 };
        const users = await Usuario.find({ [por === 'descargas' ? 'descargasTotales' : 'saldo']: { $gt: 0 } }).sort(sortField).limit(parseInt(limite)).select('usuario email saldo descargasTotales verificadoNivel paypalEmail').lean();
        res.json({ success: true, users, criterio: por });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al cargar top usuarios" });
    }
});

app.delete('/admin/users/:id/items', verificarAdmin, [param('id').isMongoId()], async (req, res) => {
    try {
        const user = await Usuario.findById(req.params.id).select('usuario');
        if (!user) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        const resultado = await Juego.deleteMany({ usuario: user.usuario });
        logger.info(`ADMIN: ${resultado.deletedCount} items de @${user.usuario} eliminados`);
        res.json({ success: true, eliminados: resultado.deletedCount, usuario: user.usuario });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al eliminar items" });
    }
});

app.put('/admin/users/:id/reset-saldo', verificarAdmin, [param('id').isMongoId()], async (req, res) => {
    try {
        const user = await Usuario.findByIdAndUpdate(req.params.id, { $set: { saldo: 0, solicitudPagoPendiente: false } }, { new: true }).select('usuario saldo');
        if (!user) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        logger.info(`ADMIN: Saldo reseteado a 0 para @${user.usuario}`);
        res.json({ success: true, usuario: user.usuario });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al resetear saldo" });
    }
});

app.get('/admin/payments-pending', verificarAdmin, async (req, res) => {
    try {
        const usuariosParaPagar = await Usuario.find({ saldo: { $gte: 10 }, isVerificado: true, verificadoNivel: { $gte: 1 } }).select('usuario email paypalEmail saldo descargasTotales verificadoNivel');
        res.json(usuariosParaPagar);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener pagos" });
    }
});

// GET /admin/items/:id/analisis-ia — recomendación de Nexus para revisar (caché 6 h; ?forzar=1 rehace)
const revisionIA = require('./modulos/revisionIA');
app.get('/admin/items/:id/analisis-ia', verificarAdmin, [param('id').isMongoId()], async (req, res) => {
    try {
        if (!validationResult(req).isEmpty()) return res.status(400).json({ success: false, error: 'ID inválido' });
        const item = await Juego.findById(req.params.id).lean();
        if (!item) return res.status(404).json({ success: false, error: 'Publicación no encontrada' });
        const previo = item.analisisIA;
        if (previo && req.query.forzar !== '1' && Date.now() - new Date(previo.fecha) < 6 * 3600e3) return res.json({ success: true, analisis: previo, cache: true });
        const analisis = await revisionIA.analizar(item, { Juego, Usuario, errorLinkPublicacion, gameDetector, logger });
        // timestamps:false → no reinicia el plazo de revisión (JOB 4 usa updatedAt)
        await Juego.updateOne({ _id: item._id }, { $set: { analisisIA: analisis } }, { timestamps: false });
        logger.info(`[revisionIA] "${item.title}" → ${analisis.decision} (${analisis.puntos} pts, IA: ${analisis.ia?.fuente || 'no'})`);
        res.json({ success: true, analisis, cache: false });
    } catch (e) {
        logger.error(`[revisionIA] ${e.message}`);
        res.status(500).json({ success: false, error: 'No se pudo analizar la publicación' });
    }
});

app.put("/admin/items/:id", verificarAdmin, [
    param('id').isMongoId(), body('title').optional().trim().isLength({ max: 200 }),
    body('description').optional().trim().isLength({ max: 1000 }), body('link').optional().trim(),
    body('image').optional().trim(), body('images').optional().isArray({ max: 4 }),
    body('category').optional().trim(), body('status').optional().isIn(['pendiente', 'aprobado', 'rechazado', 'pending']),
    body('linkStatus').optional().isIn(['online', 'revision', 'caido']), body('reportes').optional().isInt({ min: 0 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Datos inválidos", details: errors.array() });
        const updates = {};
        ['title', 'description', 'link', 'image', 'images', 'category', 'status', 'linkStatus', 'reportes'].forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
        if (updates.status === 'rechazado') updates.motivoRechazo = String(req.body.motivo || '').trim().slice(0, 300);
        const antes = await Juego.findById(req.params.id).select('status usuario').lean();
        if (updates.title !== undefined && antes) updates.serie = series.serieDe(updates.title, antes.usuario);
        const item = await Juego.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true });
        if (!item) return res.status(404).json({ success: false, error: "Item no encontrado" });
        // Avisar al autor cuando su publicación se rechaza (antes desaparecía sin explicación)
        if (updates.status === 'rechazado' && antes?.status !== 'rechazado') {
            const motivo = updates.motivoRechazo ? `: ${updates.motivoRechazo}` : '. Revisa las normas de publicación y vuelve a intentarlo.';
            Notificacion.create({ destinatario: item.usuario, tipo: 'sistema', emisor: 'UpGames', itemId: item._id.toString(), itemTitle: 'Revisión',
                mensaje: `❌ Tu publicación “${String(item.title).replace(/[<>&"']/g, '')}” no fue aprobada${motivo.replace(/[<>&"']/g, '')}` }).catch(() => {});
        }
        logger.info(`ADMIN: Item ${item._id} actualizado`);
        res.json({ success: true, item });
    } catch (error) {
        logger.error(`Error: ${error?.message}`);
        res.status(500).json({ success: false, error: "Error al actualizar item" });
    }
});

app.get("/admin/items", verificarAdmin, async (req, res) => {
    try {
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100));
        const skip  = (page - 1) * limit;
        const filtro = {};
        if (req.query.status)     filtro.status     = req.query.status;
        if (req.query.linkStatus) filtro.linkStatus = req.query.linkStatus;
        const [total, items] = await Promise.all([
            Juego.countDocuments(filtro),
            Juego.find(filtro).sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
        ]);
        const now = Date.now();
        const itemsWithInfo = items.map(item => ({ ...item, diasDesdeCreacion: Math.floor((now - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24)), necesitaRevision: item.reportes >= 3 || item.linkStatus === 'revision' }));
        res.json({ success: true, total, page, limit, pages: Math.ceil(total / limit), count: items.length, items: itemsWithInfo });
    } catch (error) {
        logger.error(`Error: ${error?.message}`);
        res.status(500).json({ success: false, error: "Error al obtener items" });
    }
});

app.put("/admin/items/:id/reset-reports", verificarAdmin, [param('id').isMongoId()], async (req, res) => {
    try {
        const item = await Juego.findByIdAndUpdate(req.params.id, { $set: { reportes: 0, linkStatus: 'online' } }, { new: true });
        if (!item) return res.status(404).json({ success: false, error: "Item no encontrado" });
        logger.info(`ADMIN: Reportes reseteados para ${item.title}`);
        res.json({ success: true, item });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al resetear reportes" });
    }
});

app.put("/admin/items/:id/link-status", verificarAdmin, [param('id').isMongoId(), body('linkStatus').isIn(['online', 'revision', 'caido'])], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Estado inválido" });
        const item = await Juego.findByIdAndUpdate(req.params.id, { $set: { linkStatus: req.body.linkStatus } }, { new: true });
        if (!item) return res.status(404).json({ success: false, error: "Item no encontrado" });
        logger.info(`ADMIN: Link status → ${req.body.linkStatus} para ${item.title}`);
        res.json({ success: true, item });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al actualizar estado del link" });
    }
});


app.put("/items/report/:id", [param('id').isMongoId(), body('motivo').isIn(['caido', 'viejo', 'malware'])], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Datos inválidos" });
        const { motivo } = req.body;
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
        const usuarioReportante = req.body.usuario || 'Anónimo';
        const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const reporteExistente = await Reporte.findOne({ juegoId: req.params.id, ip, fecha: { $gte: hace24h } });
        if (reporteExistente) return res.status(429).json({ success: false, error: "Ya reportaste este contenido. Espera 24h." });
        await new Reporte({ juegoId: req.params.id, motivo, usuarioReportante, ip }).save();
        const juego = await Juego.findByIdAndUpdate(req.params.id, { $inc: { reportes: 1, [`reportesDesglose.${motivo}`]: 1 } }, { new: true });
        if (!juego) return res.status(404).json({ success: false, error: "Item no encontrado" });
        if (juego.reportes >= 5 && juego.linkStatus !== 'revision') { juego.linkStatus = 'revision'; await juego.save(); }
        logger.info(`Reporte #${juego.reportes} (${motivo}) para: ${juego.title}`);
        res.json({ success: true, ok: true, reportes: juego.reportes, linkStatus: juego.linkStatus, motivoReportado: motivo });
    } catch (error) {
        logger.error(`Error: ${error?.message}`);
        res.status(500).json({ success: false, error: "Error al reportar" });
    }
});

app.get("/items/reportes/:id", async (req, res) => {
    try {
        const juego = await Juego.findById(req.params.id).select('reportes reportesDesglose linkStatus usuario title');
        if (!juego) return res.status(404).json({ success: false, error: "Juego no encontrado" });
        const reportesDetallados = await Reporte.find({ juegoId: req.params.id }).sort({ fecha: -1 }).limit(100).select('motivo usuarioReportante fecha').lean();
        res.json({ success: true, juego: { id: juego._id, title: juego.title, autor: juego.usuario, reportesTotales: juego.reportes, linkStatus: juego.linkStatus, desglose: juego.reportesDesglose || { caido: 0, viejo: 0, malware: 0 } }, reportes: reportesDetallados });
    } catch (error) {
        logger.error(`Error: ${error?.message}`);
        res.status(500).json({ success: false, error: "Error al obtener reportes" });
    }
});

app.get("/items/mis-reportes/:usuario", async (req, res) => {
    try {
        const juegosConReportes = await Juego.find({ usuario: req.params.usuario, reportes: { $gt: 0 } }).select('_id title reportes reportesDesglose linkStatus image createdAt').sort({ reportes: -1 }).lean();
        res.json({ success: true, publicaciones: juegosConReportes });
    } catch (error) {
        logger.error(`Error: ${error?.message}`);
        res.status(500).json({ success: false, error: "Error" });
    }
});

app.put('/items/vistas/:id', [param('id').isMongoId()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'ID inválido' });
        const juegoId = req.params.id;
        const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.headers['x-real-ip'] || req.connection.remoteAddress || req.socket.remoteAddress;
        const juego = await Juego.findById(juegoId).select('title category descargasEfectivas');
        if (!juego) return res.status(404).json({ success: false, error: 'Item no encontrado' });
        const vistaExistente = await DescargaIP.findOne({ juegoId, ip });
        if (vistaExistente) return res.json({ success: true, duplicada: true, descargasEfectivas: juego.descargasEfectivas || 0 });
        await new DescargaIP({ juegoId, ip }).save();
        const updated = await Juego.findByIdAndUpdate(juegoId, { $inc: { descargasEfectivas: 1 } }, { new: true }).select('descargasEfectivas');
        logger.info(`Vista registrada — Video: ${juego.title} | IP: ${ip} | Total: ${updated.descargasEfectivas}`);
        res.json({ success: true, duplicada: false, descargasEfectivas: updated.descargasEfectivas });
    } catch (error) {
        logger.error(`Error en PUT /items/vistas: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al registrar vista' });
    }
});

app.get("/items", async (req, res) => {
    try {
        const categoria = typeof req.query.categoria === 'string' ? req.query.categoria.slice(0, 40) : '';
        const catalogo = await cacheado(`items:lista:${categoria}`, 30, async () => {
            const filtro = { status: 'aprobado', linkStatus: { $in: ['online', 'revision'] } };
            if (categoria && categoria !== 'Todo') filtro.category = categoria;
            const items = await Juego.find(filtro).select('_id title description image images link category usuario reportes linkStatus descargasEfectivas likesCount extraData videoType featuredItemId scoreRecomendacion serie createdAt').sort({ scoreRecomendacion: -1, createdAt: -1 }).limit(100).lean();
            // Series por partes: solo la primera parte aparece en el catálogo
            return series.colapsar(items, Juego, { status: 'aprobado', linkStatus: { $in: ['online', 'revision'] } });
        });
        res.json(catalogo);
    } catch (error) {
        res.status(500).json([]);
    }
});

app.get("/items/user/:usuario", async (req, res) => {
    try {
        // Los proyectos privados (status 'privado') no se listan en el perfil público: solo accesibles por link directo.
        // El autor ve todo lo suyo (pendiente/rechazado incluidos y cada parte por separado);
        // los demás solo lo aprobado, con las series agrupadas como en el catálogo.
        let yo = null;
        const t = req.headers.authorization?.split(' ')[1];
        if (t && t.length > 20) { try { yo = jwt.verify(t, JWT_SECRET).usuario; } catch (_) {} }
        const propio = yo && yo === String(req.params.usuario).toLowerCase();
        const filtro = propio ? { usuario: req.params.usuario, status: { $ne: 'privado' } } : { usuario: req.params.usuario, status: 'aprobado' };
        const aportes = await Juego.find(filtro).select('_id title description image images link category usuario reportes reportesDesglose linkStatus descargasEfectivas likesCount status createdAt scoreRecomendacion extraData videoType featuredItemId serie motivoRechazo nexusMentor').sort({ scoreRecomendacion: -1, createdAt: -1 }).lean();
        res.json(propio ? aportes : await series.colapsar(aportes, Juego, { usuario: req.params.usuario, status: 'aprobado' }));
    } catch (error) {
        res.status(500).json([]);
    }
});

// ── Enlaces permitidos para publicar (misma lista que PF_ALLOWED_LINKS del frontend) ──
const LINKS_PERMITIDOS = ['mediafire.com', 'mega.nz', 'mega.co.nz', 'drive.google.com',
    'gofile.io', 'onedrive.live.com', 'icloud.com', 'proton.me', 'pcloud.com',
    'pixeldrain.com', '1fichier.com', 'qiwi.gg', 'krakenfiles.com', 'dropbox.com',
    'github.com', 'github.io', 'sto.romsfast.com', 'clarodrive.com'];

// Devuelve null si el enlace es válido o un mensaje de error si no.
function errorLinkPublicacion(link, category) {
    let u;
    try { u = new URL(String(link || '').trim()); } catch (_) { return 'Formato de enlace inválido'; }
    if (!['https:', 'http:'].includes(u.protocol)) return 'El enlace debe empezar por https://';
    if (category === 'Video') return null;   // videos: Cloudinary, YouTube u otra URL directa
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!LINKS_PERMITIDOS.some(d => host === d || host.endsWith('.' + d)))
        return 'Plataforma no permitida. Usa MediaFire, MEGA, Drive, ClaroDrive, etc. (sin acortadores)';
    if (/\.(exe|msi)$/i.test(u.pathname)) return 'No se permiten enlaces directos a .exe/.msi; usa .zip o .rar';
    return null;
}

const CAMPOS_PUBLICACION = ['title', 'description', 'link', 'image', 'images', 'category', 'videoType', 'extraData', 'featuredItemId', 'tags'];

// POST /items/precheck — Nexus revisa la publicación ANTES de publicarla:
// enlace (si el archivo existe), portada, texto, derechos, duplicados y si es
// una parte de una serie. ia:false = solo comprobaciones rápidas (al pulsar Publicar).
const precheckUso = new Map();   // usuario → [timestamps] (máx. 12/min)
app.post('/items/precheck', verificarToken, async (req, res) => {
    try {
        const ahora = Date.now();
        const usos = (precheckUso.get(req.usuario) || []).filter(t => ahora - t < 60000);
        if (usos.length >= 12) return res.status(429).json({ success: false, error: 'Espera un momento antes de volver a revisar' });
        usos.push(ahora); precheckUso.set(req.usuario, usos);
        if (precheckUso.size > 20000) precheckUso.clear();

        const b = req.body || {};
        const item = {
            _id: new mongoose.Types.ObjectId(), usuario: req.usuario, createdAt: new Date(),
            title: String(b.title || '').trim().slice(0, 200), description: String(b.description || '').slice(0, 1000),
            link: String(b.link || '').trim(), image: String(b.image || '').trim(),
            images: Array.isArray(b.images) ? b.images.filter(x => typeof x === 'string').slice(0, 4) : [],
            category: String(b.category || 'General').slice(0, 40), extraData: {},
        };
        if (!item.title || !item.link) return res.status(400).json({ success: false, error: 'Escribe al menos el título y el enlace' });
        const a = await revisionIA.analizar(item, { Juego, Usuario, errorLinkPublicacion, gameDetector, logger, sinIA: b.ia === false });
        // Al creador solo le sirve lo que puede corregir (no su propio historial)
        const hechos = a.hechos.filter(h => ['enlace', 'medios', 'texto', 'derechos', 'duplicado'].includes(h.area));

        // ¿Es una parte de una serie?
        const s = series.serieDe(item.title, req.usuario);
        if (s) {
            const otras = await Juego.find({ 'serie.clave': s.clave }).select('serie.parte').lean();
            const nums = [...new Set(otras.map(o => o.serie?.parte).filter(Boolean))].sort((x, y) => x - y);
            if (nums.includes(s.parte)) hechos.push({ tipo: 'warn', area: 'serie', texto: `Ya publicaste la Parte ${s.parte} de "${s.base}": ¿no será la siguiente?`, peso: 0 });
            else if (nums.length) hechos.push({ tipo: 'ok', area: 'serie', texto: `Es la Parte ${s.parte} de "${s.base}": se agrupará en una carpeta con tus partes ${nums.join(', ')}. Cada parte suma sus propias descargas.`, peso: 0 });
            else if (s.parte > 1) hechos.push({ tipo: 'warn', area: 'serie', texto: `Detecté la Parte ${s.parte} de "${s.base}", pero aún no has publicado la Parte 1. Publícalas con el mismo título base para que se agrupen.`, peso: 0 });
            else hechos.push({ tipo: 'info', area: 'serie', texto: `Detecté la Parte ${s.parte} de "${s.base}". Publica las siguientes como "${s.base} parte 2", "parte 3"… y se agruparán en una carpeta.`, peso: 0 });
        }
        const problemas = hechos.filter(h => h.tipo === 'bad').length;
        res.json({
            success: true, listo: problemas === 0, problemas, avisos: hechos.filter(h => h.tipo === 'warn').length,
            puntos: a.puntos, resumen: problemas ? 'Nexus encontró problemas que harían que rechacen tu publicación.' : (a.ia?.resumen || 'Tu publicación se ve bien.'),
            hechos, sugerencias: a.ia?.sugerencias || [], razones: a.ia?.razones || [], fuente: a.ia?.fuente || null,
            enlace: a.enlace?.estado || null, serie: s ? { base: s.base, parte: s.parte } : null,
        });
    } catch (e) {
        logger.error(`[precheck] ${e.message}`);
        res.status(500).json({ success: false, error: 'Nexus no pudo revisar la publicación ahora' });
    }
});

app.post("/items/add", [verificarToken, body('title').notEmpty().trim().isLength({ max: 200 }), body('link').notEmpty().trim()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Datos inválidos" });

        const errLink = errorLinkPublicacion(req.body.link, req.body.category);
        if (errLink) return res.status(400).json({ success: false, error: errLink });

        // Solo campos editables por el autor: con strict:false, un ...req.body permitía
        // inyectar descargasEfectivas, likesCount, nexusMentor, etc.
        const datos = {};
        CAMPOS_PUBLICACION.forEach(f => { if (req.body[f] !== undefined) datos[f] = req.body[f]; });
        if (datos.extraData && (typeof datos.extraData !== 'object' || Array.isArray(datos.extraData))) datos.extraData = {};
        if (datos.tags !== undefined && !Array.isArray(datos.tags)) delete datos.tags;
        datos.serie = series.serieDe(datos.title, req.usuario);
        const nuevoJuego = new Juego({ ...datos, usuario: req.usuario, status: "aprobado", linkStatus: "revision" });

        // ── Detección automática de juego conocido ──────────────────
        const deteccion = gameDetector.detectGame(nuevoJuego.title, nuevoJuego.description);
        if(deteccion) {
            nuevoJuego.extraData = nuevoJuego.extraData || {};
            nuevoJuego.extraData.detectedGame = {
                gameName:     deteccion.gameName,
                gameKey:      deteccion.gameKey,
                platform:     deteccion.platform,
                purchaseLink: deteccion.purchaseLink
            };
            logger.info(`[GameDetector] "${nuevoJuego.title}" → ${deteccion.gameName}`);
        }
        // ────────────────────────────────────────────────────────────

        await nuevoJuego.save();

        // Fire & forget
        calcularScoreRecomendacion(nuevoJuego._id).catch(() => {});
        gamification.onUpload(nuevoJuego.usuario).catch(() => {});
        recommendations.invalidateTrending();

        try {
            const autorData = await Usuario.findOne({ usuario: nuevoJuego.usuario }).select('listaSeguidores').lean();
            const seguidores = autorData?.listaSeguidores || [];
            if (seguidores.length > 0) {
                const notifs = seguidores.map(seg => ({ destinatario: seg, tipo: 'nueva_publicacion', emisor: nuevoJuego.usuario, itemId: nuevoJuego._id.toString(), itemTitle: nuevoJuego.title, itemImage: nuevoJuego.image || '', leida: false, fecha: new Date() }));
                await Notificacion.insertMany(notifs, { ordered: false });
                logger.info(`Notificaciones enviadas a ${seguidores.length} seguidores de @${nuevoJuego.usuario}`);
            }
        } catch (notifErr) {
            logger.error(`Error enviando notificaciones: ${notifErr.message}`);
        }

        logger.info(`Nuevo item agregado: ${nuevoJuego.title} por @${nuevoJuego.usuario}`);
        res.status(201).json({ success: true, ok: true, item: nuevoJuego, id: nuevoJuego._id });

        // Fire & forget — Nexus revisa la publicación y deja consejos al autor
        nexusMentor.mentor(nuevoJuego.toObject()).then(m => {
            Juego.updateOne({ _id: nuevoJuego._id }, { $set: { nexusMentor: m } }, { timestamps: false }).catch(() => {});
            logger.info(`[nexus-mentor] "${nuevoJuego.title}" puntuación=${m.puntuacion} (${m.fuente})`);
        }).catch(() => {});
    } catch (error) {
        logger.error(`Error: ${error?.message}`);
        res.status(500).json({ success: false, error: "Error al guardar aporte" });
    }
});

app.put("/items/:id", verificarToken, [
    param('id').isMongoId(), body('title').optional().trim().isLength({ min: 1, max: 200 }),
    body('description').optional().trim().isLength({ max: 1000 }), body('link').optional().trim(),
    body('image').optional().trim(), body('images').optional().isArray({ max: 4 }), body('category').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Datos inválidos", details: errors.array() });
        const item = await Juego.findById(req.params.id);
        if (!item) return res.status(404).json({ success: false, error: "Publicación no encontrada" });
        if (item.usuario !== req.usuario) return res.status(403).json({ success: false, error: "No tienes permiso para editar esta publicación" });
        const updates = {};
        ['title', 'description', 'link', 'image', 'images', 'category', 'videoType', 'extraData', 'featuredItemId'].forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
        if (Object.keys(updates).length === 0) return res.status(400).json({ success: false, error: "No se enviaron campos para actualizar" });
        if (updates.title !== undefined) updates.serie = series.serieDe(updates.title, item.usuario);
        if (updates.link !== undefined) {
            const errLink = errorLinkPublicacion(updates.link, updates.category || item.category);
            if (errLink) return res.status(400).json({ success: false, error: errLink });
        }
        const updated = await Juego.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true });
        logger.info(`Usuario @${req.usuario} editó su publicación: ${updated.title}`);
        res.json({ success: true, item: updated });
    } catch (error) {
        logger.error(`Error: ${error?.message}`);
        res.status(500).json({ success: false, error: "Error al actualizar publicación" });
    }
});

app.put("/items/approve/:id", verificarAdmin, [param('id').isMongoId()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "ID inválido" });
        await Juego.findByIdAndUpdate(req.params.id, { $set: { status: "aprobado" } });
        res.json({ success: true, ok: true });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error de aprobación" });
    }
});

app.delete("/items/:id/video", verificarToken, [param('id').isMongoId()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "ID inválido" });
        const item = await Juego.findById(req.params.id);
        if (!item) return res.status(404).json({ success: false, error: "Video no encontrado" });
        if (item.usuario !== req.usuario) return res.status(403).json({ success: false, error: "Sin permiso" });
        if (item.link && item.link.includes("cloudinary.com")) {
            try {
                const parts = item.link.split("/");
                const idx = parts.indexOf("upload");
                if (idx !== -1) {
                    let pub = parts.slice(idx + 1).join("/");
                    pub = pub.replace(/^v\d+\//, "").replace(/\.[^.]+$/, "");
                    await cloudinary.uploader.destroy(pub, { resource_type: "video" });
                }
            } catch (cldErr) { logger.error("Cloudinary delete error: " + cldErr.message); }
        }
        await Juego.findByIdAndDelete(req.params.id);
        logger.info(`Video eliminado: "${item.title}" por @${req.usuario}`);
        res.json({ success: true, ok: true });
    } catch (error) {
        logger.error("Error al eliminar video: " + error.message);
        res.status(500).json({ success: false, error: "Error al eliminar video" });
    }
});

app.delete("/items/:id", async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "ID inválido" });
        const item = await Juego.findById(req.params.id);
        if (!item) return res.status(404).json({ success: false, error: "Publicación no encontrada" });
        const adminToken = req.headers['x-admin-token'];
        const bearerToken = req.headers.authorization?.split(' ')[1];
        if (adminToken) {
            return verificarAdmin(req, res, async () => {
                await Juego.findByIdAndDelete(req.params.id);
                logger.info(`ADMIN @${req.admin.usuario} eliminó publicación: ${item.title}`);
                res.json({ success: true, ok: true });
            });
        } else if (bearerToken) {
            try {
                const decoded = jwt.verify(bearerToken, JWT_SECRET);
                if (item.usuario !== decoded.usuario) return res.status(403).json({ success: false, error: "No tienes permiso para eliminar esta publicación" });
                await Juego.findByIdAndDelete(req.params.id);
                logger.info(`Usuario @${decoded.usuario} eliminó su publicación: ${item.title}`);
                return res.json({ success: true, ok: true });
            } catch { return res.status(401).json({ success: false, error: "Token inválido o expirado" }); }
        } else {
            return res.status(401).json({ success: false, error: "Se requiere autenticación para eliminar" });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al eliminar" });
    }
});

app.get('/items/recomendados/:usuario', async (req, res) => {
    try {
        const { usuario } = req.params;
        const { categorias = '', tags = '', excluir = '', limite = '12' } = req.query;
        const lim = Math.min(parseInt(limite) || 12, 30);
        const query = { status: 'aprobado', linkStatus: { $ne: 'caido' } };
        const excluirIds = excluir ? excluir.split(',').filter(id => id.match(/^[a-f\d]{24}$/i)) : [];
        if (excluirIds.length > 0) query._id = { $nin: excluirIds };
        const catPesos = categorias ? categorias.split(',').map(c => { const [cat, peso] = c.split(':'); return { cat: cat?.trim(), peso: parseInt(peso) || 1 }; }).filter(c => c.cat) : [];
        const tagList = tags ? tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];
        if (catPesos.length > 0 || tagList.length > 0) {
            const orClauses = [];
            if (catPesos.length > 0) orClauses.push({ category: { $in: catPesos.map(c => c.cat) } });
            if (tagList.length > 0) orClauses.push({ tags: { $in: tagList } });
            query.$or = orClauses;
        }
        let items = await Juego.find(query).sort({ scoreRecomendacion: -1, likesCount: -1 }).limit(lim * 3).lean();
        if (catPesos.length > 0) {
            const pesoMap = {};
            catPesos.forEach(({ cat, peso }) => { pesoMap[cat] = peso; });
            items = items.map(item => ({ ...item, _recoScore: (item.scoreRecomendacion || 0) + (pesoMap[item.category] || 0) * 10 + (tagList.some(t => item.tags?.includes(t)) ? 5 : 0) }));
            items.sort((a, b) => b._recoScore - a._recoScore);
        }
        const resultado = items.slice(0, lim).map(item => ({ _id: item._id, title: item.title, description: item.description, image: item.image, category: item.category, tags: item.tags || [], descargasEfectivas: item.descargasEfectivas || 0, scoreRecomendacion: item.scoreRecomendacion || 0, usuario: item.usuario, linkStatus: item.linkStatus }));
        res.json({ success: true, usuario, total: resultado.length, items: resultado });
    } catch (error) {
        logger.error(`Error: ${error?.message}`);
        res.status(500).json({ success: false, error: 'Error al obtener recomendaciones' });
    }
});

// GET /items/autoinfo?title=&cat= — reconoce el título y devuelve imagen + descripción breve
// Debe ir ANTES de /items/:id, si no Express interpreta "autoinfo" como un id.
app.get('/items/autoinfo', async (req, res) => {
    const title = String(req.query.title || '').trim().slice(0, 120);
    const cat   = String(req.query.cat || 'Juego').trim().slice(0, 30);
    if (title.length < 3) return res.json({ found: false });
    try {
        const info = await autoInfo.lookup(title, cat);
        if (!info) return res.json({ found: false });
        res.set('Cache-Control', 'public, max-age=3600');
        res.json({ found: true, ...info });
    } catch (err) {
        logger.error(`[autoinfo] ${err.message}`);
        res.status(500).json({ found: false });
    }
});

// GET /items/:id/serie — todas las partes de la serie de esta publicación, en orden
app.get('/items/:id/serie', async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, error: 'ID inválido' });
        const item = await Juego.findById(req.params.id).select('serie usuario').lean();
        if (!item) return res.status(404).json({ success: false, error: 'Publicación no encontrada' });
        if (!item.serie?.clave) return res.json({ success: true, serie: null });
        const partes = await Juego.find({ 'serie.clave': item.serie.clave, status: 'aprobado', linkStatus: { $in: ['online', 'revision', 'caido'] } })
            .select('_id title image images description category usuario linkStatus descargasEfectivas likesCount reportes serie createdAt')
            .sort({ 'serie.parte': 1, createdAt: 1 }).lean();
        if (partes.length < 2) return res.json({ success: true, serie: null });
        res.json({ success: true, serie: { clave: item.serie.clave, base: item.serie.base, total: partes.length, totalDeclarado: item.serie.total || null,
            descargas: partes.reduce((a, p) => a + (p.descargasEfectivas || 0), 0), partes } });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Error al cargar la serie' });
    }
});

app.get('/items/:id', async (req, res) => {
    try {
        const item = await Juego.findById(req.params.id).lean();
        if (!item) return res.status(404).json({ success: false, error: "Item no encontrado" });
        res.json(item);
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al cargar item" });
    }
});

// ==========================================
// ⭐ USUARIOS — con paginación en /auth/users/public
// ==========================================

// ⭐ OPTIMIZADO: paginación para evitar traer todos los usuarios
app.get('/auth/users/public', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
        const users = await cacheado(`usuarios:publicos:${page}:${limit}`, 60, () => Usuario.find()
            .select('usuario verificadoNivel avatar bio listaSeguidores siguiendo')
            .skip((page - 1) * limit)
            .limit(limit)
            .lean());
        res.json(users);
    } catch (error) {
        res.status(500).json([]);
    }
});

app.get('/auth/users', verificarAdmin, async (req, res) => {
    try {
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
        const skip  = (page - 1) * limit;
        const q     = req.query.q ? { usuario: { $regex: String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
        const [total, users] = await Promise.all([
            Usuario.countDocuments(q),
            // Nunca exponer hashes ni tokens de reset/verificación (un sub-admin podría secuestrar cuentas)
            Usuario.find(q).select('-password -resetPasswordToken -resetPasswordExpires -emailVerifToken -emailVerifExpires').sort({ fecha: -1 }).skip(skip).limit(limit).lean()
        ]);
        users.forEach(u => { u.esDueno = adminPanel.esOwnerEmail(u.email); });
        res.json({ users, total, page, limit, pages: Math.ceil(total / limit) });
    } catch (error) {
        res.status(500).json([]);
    }
});

app.get('/admin/users/detalle/:id', verificarAdmin, async (req, res) => {
    try {
        const user = await Usuario.findById(req.params.id).select('-password -resetPasswordToken -resetPasswordExpires -emailVerifToken -emailVerifExpires').lean();
        if (!user) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        const juegos = await Juego.find({ usuario: user.usuario }).select('title status descargasEfectivas likesCount linkStatus createdAt').lean();
        res.json({ success: true, user, juegos });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al obtener datos" });
    }
});

app.put('/admin/users/lista-negra/:id', verificarAdmin, [body('listaNegraAdmin').isBoolean(), body('notasAdmin').optional().trim().isLength({ max: 500 })], async (req, res) => {
    try {
        const { listaNegraAdmin, notasAdmin } = req.body;
        const updates = { listaNegraAdmin: !!listaNegraAdmin, fechaListaNegra: listaNegraAdmin ? new Date() : null };
        if (notasAdmin !== undefined) updates.notasAdmin = notasAdmin;
        const user = await Usuario.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true }).select('-password -resetPasswordToken -resetPasswordExpires -emailVerifToken -emailVerifExpires');
        if (!user) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        logger.warn(`Lista negra actualizada: @${user.usuario} → ${listaNegraAdmin}`);
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al actualizar lista negra" });
    }
});

app.put('/admin/users/notas/:id', verificarAdmin, [body('notasAdmin').trim().isLength({ max: 500 })], async (req, res) => {
    try {
        const user = await Usuario.findByIdAndUpdate(req.params.id, { $set: { notasAdmin: req.body.notasAdmin } }, { new: true }).select('-password -resetPasswordToken -resetPasswordExpires -emailVerifToken -emailVerifExpires');
        if (!user) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        res.json({ success: true, mensaje: "Notas actualizadas" });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al guardar notas" });
    }
});

app.get('/admin/users/lista-negra', verificarAdmin, async (req, res) => {
    try {
        const users = await Usuario.find({ listaNegraAdmin: true }).select('-password -resetPasswordToken -resetPasswordExpires -emailVerifToken -emailVerifExpires').sort({ fechaListaNegra: -1 }).lean();
        res.json({ success: true, users, total: users.length });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al obtener lista negra" });
    }
});

app.delete('/auth/users/:id', verificarAdmin, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, error: 'ID inválido' });
        const u = await Usuario.findById(req.params.id).select('email').lean();
        if (u && adminPanel.esOwnerEmail(u.email)) return res.status(400).json({ success: false, error: 'La cuenta del dueño no se puede eliminar' });
        await Usuario.findByIdAndDelete(req.params.id);
        res.json({ success: true, ok: true });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al eliminar" });
    }
});

app.put('/auth/admin/verificacion/:username', verificarAdmin, [body('nivel').isInt({ min: 0, max: 3 })], async (req, res) => {
    try {
        const { username } = req.params;
        const { nivel } = req.body;
        const user = await Usuario.findOneAndUpdate({ usuario: username.toLowerCase() }, { $set: { verificadoNivel: nivel } }, { new: true }).select('-password -resetPasswordToken -resetPasswordExpires -emailVerifToken -emailVerifExpires');
        if (!user) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        logger.info(`Verificación actualizada: @${username} → Nivel ${nivel}`);
        // ⭐ Recalcular scores al cambiar nivel
        recalcularScoresUsuario(username.toLowerCase()).catch(() => {});
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al actualizar verificación" });
    }
});

// ========== PERFIL ==========

// Endpoint dedicado para Nexus — devuelve solo las stats que necesita, sin bajar lista completa
app.get('/usuarios/nexus-stats/:usuario', async (req, res) => {
    try {
        const username = req.params.usuario.toLowerCase().trim();
        const user = await Usuario.findOne({ usuario: username })
            .select('usuario verificadoNivel isVerificado descargasTotales listaSeguidores siguiendo saldo')
            .lean();
        if (!user) return res.json({ success: true, stats: null });
        res.json({
            success: true,
            stats: {
                usuario: user.usuario,
                verificadoNivel: user.verificadoNivel || 0,
                isVerificado: user.isVerificado || false,
                seguidores: (user.listaSeguidores || []).length,
                siguiendo: (user.siguiendo || []).length,
                descargasTotales: user.descargasTotales || 0,
            }
        });
    } catch (err) {
        logger.error(`[nexus-stats] ${err.message}`);
        res.status(500).json({ success: false, error: 'Error' });
    }
});

app.get('/usuarios/perfil-publico/:usuario', async (req, res) => {
    try {
        const username = req.params.usuario.toLowerCase().trim();
        const [user, publicaciones] = await Promise.all([
            // LISTA BLANCA: antes se devolvía el documento entero (menos password y
            // paypalEmail) — incluía resetPasswordToken, email, IP, saldo y tarjetas.
            Usuario.findOne({ usuario: username })
                .select('usuario avatar banner bio verificadoNivel isVerificado socialLinks ultimoLogin createdAt fecha listaSeguidores siguiendo')
                .lean(),
            Juego.countDocuments({ usuario: username, status: 'aprobado' })
        ]);
        if (!user) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        const { listaSeguidores, siguiendo, _id, ...publico } = user;
        res.json({ success: true, usuario: { ...publico, publicaciones, seguidores: listaSeguidores?.length || 0, siguiendo: siguiendo?.length || 0 } });
    } catch (err) {
        res.status(500).json({ success: false, error: "Error al cargar perfil" });
    }
});

app.get('/usuarios/verifica-seguimiento/:actual/:viendo', async (req, res) => {
    try {
        const actual = req.params.actual.toLowerCase().trim();
        const viendo = req.params.viendo.toLowerCase().trim();
        const user = await Usuario.findOne({ usuario: actual }).select('siguiendo').lean();
        res.json({ estaSiguiendo: !!(user?.siguiendo?.includes(viendo)) });
    } catch (err) {
        res.json({ estaSiguiendo: false });
    }
});

app.put('/usuarios/toggle-seguir/:actual/:objetivo', verificarToken, async (req, res) => {
    try {
        const actual   = req.params.actual.toLowerCase();
        const objetivo = req.params.objetivo.toLowerCase();
        // Solo puedes seguir/dejar de seguir en tu nombre (antes cualquiera podía
        // inflar seguidores ajenos → verificación → requisito para cobrar)
        if (actual !== String(req.usuario || '').toLowerCase()) return res.status(403).json({ success: false, error: "Sin permiso" });
        if (actual === objetivo) return res.status(400).json({ success: false, error: "No puedes seguirte a ti mismo" });
        const [userActual, userObjetivo] = await Promise.all([
            Usuario.findOne({ usuario: actual }).select('siguiendo').lean(),
            Usuario.findOne({ usuario: objetivo }).select('_id').lean()
        ]);
        if (!userActual || !userObjetivo) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        const yaSigue = userActual.siguiendo?.includes(objetivo);
        if (yaSigue) {
            await Promise.all([
                Usuario.updateOne({ usuario: actual }, { $pull: { siguiendo: objetivo } }),
                Usuario.updateOne({ usuario: objetivo }, { $pull: { listaSeguidores: actual } })
            ]);
            res.json({ success: true, siguiendo: false });
        } else {
            await Promise.all([
                Usuario.updateOne({ usuario: actual }, { $addToSet: { siguiendo: objetivo } }),
                Usuario.updateOne({ usuario: objetivo }, { $addToSet: { listaSeguidores: actual } })
            ]);
            res.json({ success: true, siguiendo: true });
            // Notificar al usuario seguido + registrar evento en Nexus (fire & forget)
            crearNotif({
                destinatario: objetivo, tipo: 'seguidor', emisor: actual,
                mensaje: `@${actual} empezó a seguirte`
            });
            return;
        }
    } catch (err) {
        res.status(500).json({ success: false, error: "Error al actualizar" });
    }
});

// URL de imagen segura para avatar/portada: https, sin comillas, espacios ni < >
// (antes el avatar aceptaba cualquier texto y se insertaba con innerHTML → XSS).
function urlImagenSegura(u) {
    const v = String(u || '').trim();
    return v.length <= 600 && /^https:\/\/[^\s"'<>`\\]+$/i.test(v) ? v : null;
}
app.put('/usuarios/update-avatar', [verificarToken, body('avatarUrl').optional(), body('nuevaFoto').optional()], async (req, res) => {
    try {
        const raw = req.body.avatarUrl || req.body.nuevaFoto;
        if (!raw) return res.status(400).json({ success: false, error: 'URL de avatar requerida' });
        const avatarUrl = urlImagenSegura(raw);
        if (!avatarUrl) return res.status(400).json({ success: false, error: 'La URL debe empezar por https:// y no tener espacios ni comillas' });
        await Usuario.updateOne({ usuario: req.usuario.toLowerCase() }, { $set: { avatar: avatarUrl } });
        res.json({ success: true, avatar: avatarUrl });
    } catch (err) {
        logger.error(`Error en update-avatar: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al actualizar avatar' });
    }
});
// PUT /usuarios/update-banner — poner, cambiar o quitar ("") la portada del perfil
app.put('/usuarios/update-banner', verificarToken, async (req, res) => {
    try {
        const raw = req.body?.bannerUrl;
        if (typeof raw !== 'string') return res.status(400).json({ success: false, error: 'bannerUrl requerido ("" para quitar la portada)' });
        let banner = '';
        if (raw.trim()) {
            banner = urlImagenSegura(raw);
            if (!banner) return res.status(400).json({ success: false, error: 'La URL debe empezar por https:// y no tener espacios ni comillas' });
        }
        await Usuario.updateOne({ usuario: req.usuario.toLowerCase() }, { $set: { banner } });
        res.json({ success: true, banner });
    } catch (err) {
        logger.error(`Error en update-banner: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al actualizar la portada' });
    }
});

// ── Firma unificada: imágenes Y videos suben DIRECTO desde el navegador a Cloudinary ──
// Payload mínimo (solo JSON pequeño), sin límite de tamaño, sin multer, sin dependencias extra
app.get('/upload/sign', verificarToken, (req, res) => {
    try {
        const validFolders = ['avatars','banners','covers','thumbnails','videos'];
        const folder    = validFolders.includes(req.query.folder) ? req.query.folder : 'covers';
        const timestamp = Math.round(Date.now() / 1000);
        const params    = { timestamp, folder };
        const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);
        logger.info(`[upload/sign] @${req.usuario} firma para: ${folder}`);
        res.json({
            signature,
            timestamp,
            api_key:    process.env.CLOUDINARY_API_KEY,
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            folder
        });
    } catch (err) {
        logger.error(`Error en upload/sign: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error generando firma de subida' });
    }
});


app.put('/usuarios/update-bio', [verificarToken, body('bio').isLength({ max: 200 })], async (req, res) => {
    try {
        await Usuario.updateOne({ usuario: req.usuario.toLowerCase() }, { $set: { bio: req.body.bio || '' } });
        res.json({ success: true });
    } catch (err) {
        logger.error(`Error en update-bio: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al actualizar bio' });
    }
});

app.put('/usuarios/update-username', [verificarToken, body('nuevoUsuario').trim().isLength({ min: 3, max: 20 }).matches(/^[a-z0-9_]+$/), body('password').notEmpty()], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Nombre inválido (3-20 chars, solo letras minúsculas, números y _)' });
    try {
        const { nuevoUsuario, password } = req.body;
        const oldName = req.usuario.toLowerCase();
        const newName = nuevoUsuario.toLowerCase();
        if (newName === oldName) return res.status(400).json({ success: false, error: 'Ese ya es tu nombre de usuario' });
        const errNombre = errorNombreUsuario(newName);
        if (errNombre) return res.status(400).json({ success: false, error: errNombre });
        const usuario = await Usuario.findOne({ usuario: oldName });
        if (!usuario) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        const passOk = await bcrypt.compare(password, usuario.password);
        if (!passOk) return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
        if (usuario.lastUsernameChange) {
            const diffDays = (Date.now() - new Date(usuario.lastUsernameChange).getTime()) / (1000 * 60 * 60 * 24);
            if (diffDays < 30) { const restante = Math.ceil(30 - diffDays); return res.status(429).json({ success: false, error: `Debes esperar ${restante} día${restante !== 1 ? 's' : ''} más para cambiar tu nombre` }); }
        }
        const existe = await Usuario.findOne({ usuario: newName }).select('_id').lean();
        if (existe) return res.status(409).json({ success: false, error: `El nombre @${newName} ya está en uso. Elige otro` });
        // Primero el usuario (el índice único frena una carrera); luego la cascada
        await Usuario.updateOne({ usuario: oldName }, { $set: { usuario: newName, lastUsernameChange: new Date() } });
        await Promise.all([
            Juego.updateMany({ usuario: oldName }, { $set: { usuario: newName } }),
            Comentario.updateMany({ usuario: oldName }, { $set: { usuario: newName } }),
            Notificacion.updateMany({ destinatario: oldName }, { $set: { destinatario: newName } }),
            Notificacion.updateMany({ emisor: oldName }, { $set: { emisor: newName } }),
            Mensaje.updateMany({ de: oldName }, { $set: { de: newName } }),
            Mensaje.updateMany({ para: oldName }, { $set: { para: newName } }),
            Story.updateMany({ usuario: oldName }, { $set: { usuario: newName } }),
            Usuario.updateMany({ listaSeguidores: oldName }, { $set: { 'listaSeguidores.$': newName } }),
            Usuario.updateMany({ siguiendo: oldName }, { $set: { 'siguiendo.$': newName } })
        ]);
        const nuevoToken = jwt.sign({ usuario: newName, email: usuario.email }, JWT_SECRET, { expiresIn: '30d' });
        logger.info(`[update-username] ${oldName} → ${newName} | Cascada completada`);
        res.json({ success: true, nuevoToken, nuevoUsuario: newName });
    } catch (err) {
        const dup = mensajeDuplicado(err);
        if (dup) return res.status(409).json({ success: false, error: dup });
        logger.error(`Error en update-username: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al actualizar nombre' });
    }
});

app.put('/usuarios/update-email', [verificarToken, body('nuevoEmail').isEmail().normalizeEmail(EMAIL_NORMALIZE_OPTS), body('password').notEmpty()], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Email inválido' });
    try {
        const { nuevoEmail, password } = req.body;
        const usuario = await Usuario.findOne({ usuario: req.usuario.toLowerCase() });
        if (!usuario) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        const passOk = await bcrypt.compare(password, usuario.password);
        if (!passOk) return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
        if (usuario.lastEmailChange) {
            const diffDays = (Date.now() - new Date(usuario.lastEmailChange).getTime()) / (1000 * 60 * 60 * 24);
            if (diffDays < 30) { const restante = Math.ceil(30 - diffDays); return res.status(429).json({ success: false, error: `Debes esperar ${restante} día${restante !== 1 ? 's' : ''} más para cambiar tu email` }); }
        }
        if (nuevoEmail.toLowerCase() === String(usuario.email || '').toLowerCase()) return res.status(400).json({ success: false, error: 'Ese ya es tu email actual' });
        // El email del dueño es la llave del panel: si cambiara, otra persona podría registrarse con él y quedarse con el control
        if (adminPanel.esOwnerEmail(usuario.email)) return res.status(403).json({ success: false, error: 'Esta cuenta es la del dueño: su email está ligado al panel de administración. Para cambiarlo, actualiza primero OWNER_EMAIL en el servidor.' });
        const existe = await Usuario.findOne({ email: nuevoEmail.toLowerCase() }).select('_id').lean();
        if (existe) return res.status(409).json({ success: false, error: 'Ese email ya está registrado en otra cuenta' });
        const verifToken = crypto.randomBytes(32).toString('hex');
        await Usuario.updateOne({ usuario: req.usuario.toLowerCase() }, { $set: { email: nuevoEmail.toLowerCase(), lastEmailChange: new Date(), emailVerificado: false, emailVerifToken: verifToken, emailVerifExpires: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
        const nuevoToken = jwt.sign({ usuario: req.usuario.toLowerCase(), email: nuevoEmail.toLowerCase() }, JWT_SECRET, { expiresIn: '30d' });
        logger.info(`Usuario ${req.usuario} cambió su email a ${nuevoEmail}`);
        const verifLink = `${API_URL_SELF}/auth/verify-email/${verifToken}`;
        sendEmail({ to: nuevoEmail, subject: '✅ Verifica tu nuevo email en UpGames', html: emailVerifTemplate(req.usuario.toLowerCase(), verifLink) }).catch(() => {});
        res.json({ success: true, nuevoToken, mensaje: 'Email actualizado. Revisa tu bandeja para verificar el nuevo email.' });
    } catch (err) {
        const dup = mensajeDuplicado(err);
        if (dup) return res.status(409).json({ success: false, error: dup });
        logger.error(`Error en update-email: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al actualizar email' });
    }
});

app.put('/usuarios/update-password', [verificarToken, body('passwordActual').notEmpty(), body('nuevaPassword').isLength({ min: 8 })], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'La nueva contraseña debe tener al menos 8 caracteres' });
    try {
        const { passwordActual, nuevaPassword } = req.body;
        const usuario = await Usuario.findOne({ usuario: req.usuario.toLowerCase() });
        if (!usuario) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        const passOk = await bcrypt.compare(passwordActual, usuario.password);
        if (!passOk) return res.status(401).json({ success: false, error: 'La contraseña actual es incorrecta' });
        if (await bcrypt.compare(nuevaPassword, usuario.password)) return res.status(400).json({ success: false, error: 'La nueva contraseña no puede ser igual a la actual' });
        const hashed = await bcrypt.hash(nuevaPassword, 10);
        await Usuario.updateOne({ usuario: req.usuario.toLowerCase() }, { $set: { password: hashed } });
        logger.info(`Usuario ${req.usuario} cambió su contraseña`);
        res.json({ success: true });
    } catch (err) {
        logger.error(`Error en update-password: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al actualizar contraseña' });
    }
});

app.put('/usuarios/update-social-links', [verificarToken, body('socialLinks').isArray({ max: 4 })], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Máximo 4 links permitidos' });
    try {
        const cleaned = (req.body.socialLinks || []).filter(l => typeof l === 'string' && l.trim().length > 0).map(l => l.trim()).slice(0, 4);
        const urlRegex = /^https?:\/\/.+/i;
        const invalid = cleaned.find(l => !urlRegex.test(l));
        if (invalid) return res.status(400).json({ success: false, error: `URL inválida: ${invalid}` });
        await Usuario.updateOne({ usuario: req.usuario.toLowerCase() }, { $set: { socialLinks: cleaned } });
        res.json({ success: true });
    } catch (err) {
        logger.error(`Error en update-social-links: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al guardar links' });
    }
});

// ========== COMENTARIOS ==========

app.get('/comentarios', async (req, res) => {
    try {
        const comms = await Comentario.find().sort({ fecha: -1 }).lean();
        res.json(comms);
    } catch (error) { res.status(500).json([]); }
});

app.get('/comentarios/:itemId', async (req, res) => {
    try {
        const comms = await Comentario.find({ itemId: req.params.itemId }).sort({ fecha: -1 }).lean();
        res.json(comms);
    } catch (error) { res.status(500).json([]); }
});

app.post('/comentarios', [verificarToken, body('itemId').notEmpty(), body('texto').notEmpty().isLength({ max: 500 })], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Datos inválidos' });
        const textoLimpio = (req.body.texto || '').replace(/<[^>]*>/g, '').trim();
        const nuevo = new Comentario({ ...req.body, texto: textoLimpio, usuario: req.usuario });
        await nuevo.save();
        gamification.onComentario(req.usuario).catch(() => {});
        res.status(201).json({ success: true, comentario: nuevo });

        // Notificar al autor del contenido + registrar evento en Nexus (fire & forget)
        Juego.findById(req.body.itemId).select('usuario title image category tags').lean()
            .then(item => {
                if (!item) return;
                crearNotif({
                    destinatario: item.usuario, tipo: 'comentario', emisor: req.usuario,
                    itemId: req.body.itemId, itemTitle: item.title, itemImage: item.image || '',
                    mensaje: `@${req.usuario} comentó en "${item.title}"`
                });
            })
            .catch(() => {});
    } catch (error) {
        logger.error(`Error en POST /comentarios: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al guardar comentario' });
    }
});

app.delete('/comentarios/:id', verificarAdmin, async (req, res) => {
    try {
        await Comentario.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: "Error al eliminar" }); }
});

// ========== FAVORITOS ==========

app.post('/favoritos/add', [verificarToken, body('itemId').isMongoId()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Datos inválidos' });
        const { itemId } = req.body;
        const existe = await Favorito.findOne({ usuario: req.usuario, itemId }).select('_id').lean();
        if (existe) return res.status(400).json({ success: false, error: 'Ya está en favoritos' });
        await new Favorito({ usuario: req.usuario, itemId }).save();
        // ⭐ Incrementar + recalcular en paralelo
        await Juego.findByIdAndUpdate(itemId, { $inc: { likesCount: 1 } });
        calcularScoreRecomendacion(itemId).catch(() => {}); // fire & forget
        gamification.onFavorito(req.usuario).catch(() => {});
        recommendations.invalidateUserCache(req.usuario);
        res.json({ success: true, ok: true });

        // Notificar al autor + registrar evento en Nexus (fire & forget, server-side)
        Juego.findById(itemId).select('usuario title image category tags').lean()
            .then(item => {
                if (!item) return;
                crearNotif({
                    destinatario: item.usuario, tipo: 'favorito', emisor: req.usuario,
                    itemId, itemTitle: item.title, itemImage: item.image || '',
                    mensaje: `@${req.usuario} guardó "${item.title}" en favoritos`
                });
                nexusMemoria.aprender(req.usuario, 'favorite', { item }).catch(() => {});
            })
            .catch(() => {});
    } catch (error) {
        logger.error(`Error en favoritos/add: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al guardar favorito' });
    }
});

app.delete('/favoritos/remove', [verificarToken, body('itemId').isMongoId()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Datos inválidos' });
        const { itemId } = req.body;
        await Favorito.deleteOne({ usuario: req.usuario, itemId });
        await Juego.findByIdAndUpdate(itemId, { $inc: { likesCount: -1 } });
        await Juego.updateOne({ _id: itemId, likesCount: { $lt: 0 } }, { $set: { likesCount: 0 } });
        calcularScoreRecomendacion(itemId).catch(() => {}); // fire & forget
        res.json({ success: true, ok: true });
    } catch (error) {
        logger.error(`Error en favoritos/remove: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al eliminar favorito" });
    }
});

// ⭐ OPTIMIZADO: usa el índice de FavoritosSchema
app.get('/favoritos/:usuario', async (req, res) => {
    try {
        const favs = await Favorito.find({ usuario: req.params.usuario })
            .populate({ path: 'itemId', select: '_id title description image link category usuario status reportes linkStatus descargasEfectivas likesCount' })
            .lean();
        const items = favs.filter(f => f.itemId).map(fav => ({
            _id: fav.itemId._id, title: fav.itemId.title, description: fav.itemId.description,
            image: fav.itemId.image, link: fav.itemId.link, category: fav.itemId.category,
            usuario: fav.itemId.usuario, status: fav.itemId.status, reportes: fav.itemId.reportes,
            linkStatus: fav.itemId.linkStatus, descargasEfectivas: fav.itemId.descargasEfectivas,
            likesCount: fav.itemId.likesCount || 0
        }));
        res.json(items);
    } catch (error) { res.status(500).json([]); }
});

// ========== FRAUDE ==========

app.get('/admin/fraud/suspicious-activities', verificarAdmin, async (req, res) => {
    try {
        const stats = await fraudDetector.getSuspiciousStats();
        res.json({ success: true, ...stats });
    } catch (error) {
        logger.error(`Error: ${error?.message}`);
        res.status(500).json({ success: false, error: 'Error al obtener actividades sospechosas' });
    }
});

app.put('/admin/fraud/mark-reviewed/:activityId', verificarAdmin, [param('activityId').isMongoId(), body('notasAdmin').optional().isString()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'ID de actividad inválido' });
        const activity = await fraudDetector.SuspiciousActivity.findById(req.params.activityId);
        if (!activity) return res.status(404).json({ success: false, error: 'Actividad no encontrada' });
        activity.revisado = true;
        if (req.body.notasAdmin) activity.notasAdmin = req.body.notasAdmin;
        await activity.save();
        res.json({ success: true, mensaje: 'Actividad marcada como revisada' });
    } catch (error) {
        logger.error(`Error: ${error?.message}`);
        res.status(500).json({ success: false, error: 'Error al marcar actividad' });
    }
});

app.get('/admin/fraud/user-history/:usuario', verificarAdmin, async (req, res) => {
    try {
        const activities = await fraudDetector.SuspiciousActivity.find({ usuario: req.params.usuario }).sort({ fecha: -1 }).limit(50);
        res.json({ success: true, usuario: req.params.usuario, activities });
    } catch (error) {
        logger.error(`Error: ${error?.message}`);
        res.status(500).json({ success: false, error: 'Error al obtener historial' });
    }
});

// ========== NOTIFICACIONES ==========

app.get('/notificaciones/:usuario', verificarToken, async (req, res) => {
    try {
        const { usuario } = req.params;
        if (req.usuario !== usuario) return res.status(403).json({ success: false, error: 'Sin permiso' });
        const notifs = await Notificacion.find({ destinatario: usuario }).sort({ fecha: -1 }).limit(50).lean();
        const noLeidas = notifs.filter(n => !n.leida).length;
        res.json({ success: true, notificaciones: notifs, noLeidas });
    } catch (err) {
        logger.error(`Error obteniendo notificaciones: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al cargar notificaciones' });
    }
});

app.put('/notificaciones/leida/:id', verificarToken, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false });
    await Notificacion.updateOne({ _id: req.params.id, destinatario: req.usuario }, { $set: { leida: true } }).catch(() => {});
    res.json({ success: true });
});

app.put('/notificaciones/marcar-leidas/:usuario', verificarToken, async (req, res) => {
    try {
        const { usuario } = req.params;
        if (req.usuario !== usuario) return res.status(403).json({ success: false, error: 'Sin permiso' });
        await Notificacion.updateMany({ destinatario: usuario, leida: false }, { $set: { leida: true } });
        res.json({ success: true });
    } catch (err) {
        logger.error(`Error marcando notificaciones: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al actualizar notificaciones' });
    }
});

app.get('/notificaciones/count/:usuario', verificarToken, async (req, res) => {
    try {
        const { usuario } = req.params;
        if (req.usuario !== usuario) return res.status(403).json({ success: false, error: 'Sin permiso' });
        const noLeidas = await Notificacion.countDocuments({ destinatario: usuario, leida: false });
        res.json({ success: true, noLeidas });
    } catch (err) { res.status(500).json({ success: false, error: 'Error' }); }
});

// POST /notificaciones — solo "alguien descargó tu publicación" (lo llama la página puente).
// Antes aceptaba cualquier tipo, título e imagen para cualquier destinatario: con push real
// serviría para mandar spam o anuncios falsos al móvil de otros. Ahora todo sale de la BD.
app.post('/notificaciones', verificarToken, async (req, res) => {
    try {
        const { itemId } = req.body || {};
        if (!mongoose.isValidObjectId(itemId)) return res.status(400).json({ success: false, error: 'itemId inválido' });
        const item = await Juego.findById(itemId).select('usuario title image category tags').lean();
        if (item) nexusMemoria.aprender(req.usuario, 'download', { item }).catch(() => {});
        if (!item || item.usuario === req.usuario) return res.json({ success: true });
        const hoy = new Date(Date.now() - 24 * 3600e3);
        const ya = await Notificacion.exists({ destinatario: item.usuario, emisor: req.usuario, tipo: 'descarga', itemId, fecha: { $gte: hoy } });
        if (!ya) await new Notificacion({ destinatario: item.usuario, tipo: 'descarga', emisor: req.usuario, itemId, itemTitle: item.title, itemImage: item.image || '', leida: false, fecha: new Date() }).save();
        res.json({ success: true });
    } catch (err) {
        logger.error(`Error creando notificación: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

// ── PUSH: suscripción del dispositivo y preferencias ──
app.get('/push/clave', async (req, res) => {
    const ok = await push.iniciar({ logger });
    res.json({ success: ok, publicKey: push.clave() });
});
app.post('/push/suscribir', verificarToken, async (req, res) => {
    try {
        const sub = req.body?.subscription || {};
        if (!/^https:\/\//.test(sub.endpoint || '') || !sub.keys?.p256dh || !sub.keys?.auth) return res.status(400).json({ success: false, error: 'Suscripción inválida' });
        await push.PushSub.updateOne({ endpoint: sub.endpoint },
            { $set: { usuario: req.usuario, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, ua: String(req.headers['user-agent'] || '').slice(0, 200) }, $setOnInsert: { creado: new Date() } },
            { upsert: true });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: 'No se pudo activar' }); }
});
app.post('/push/desuscribir', verificarToken, async (req, res) => {
    await push.PushSub.deleteOne({ endpoint: String(req.body?.endpoint || ''), usuario: req.usuario }).catch(() => {});
    res.json({ success: true });
});
app.get('/push/prefs', verificarToken, async (req, res) => {
    const u = await Usuario.findOne({ usuario: req.usuario }).select('notifPrefs').lean();
    const dispositivos = await push.PushSub.countDocuments({ usuario: req.usuario });
    res.json({ success: true, prefs: { publicaciones: true, mensajes: true, social: true, anuncios: true, ...(u?.notifPrefs || {}) }, dispositivos });
});
app.put('/push/prefs', verificarToken, async (req, res) => {
    const set = {};
    ['publicaciones', 'mensajes', 'social', 'anuncios'].forEach(k => { if (typeof req.body?.[k] === 'boolean') set[`notifPrefs.${k}`] = req.body[k]; });
    if (Object.keys(set).length) await Usuario.updateOne({ usuario: req.usuario }, { $set: set });
    res.json({ success: true });
});
app.post('/push/prueba', verificarToken, async (req, res) => {
    const n = await push.enviarA([req.usuario], () => ({ title: '🔔 ¡Listo!', body: 'Así te llegarán los avisos de UpGames aunque no estés en la app.', url: (process.env.APP_URL || 'https://roucedevstudio.github.io/UpGames') + '/public/biblioteca.html', tag: 'prueba', icon: './icons/icon-192.png?v=2', badge: './icons/icon-96.png?v=2' }));
    res.json({ success: true, enviados: n });
});

app.delete('/notificaciones/:id', verificarToken, async (req, res) => {
    try {
        const notif = await Notificacion.findById(req.params.id).lean();
        if (!notif) return res.status(404).json({ success: false, error: 'No encontrada' });
        if (notif.destinatario !== req.usuario) return res.status(403).json({ success: false, error: 'Sin permiso' });
        await Notificacion.deleteOne({ _id: req.params.id });
        res.json({ success: true });
    } catch (err) {
        logger.error(`Error eliminando notificación: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

app.delete('/notificaciones/todas/:usuario', verificarToken, async (req, res) => {
    try {
        const { usuario } = req.params;
        if (req.usuario !== usuario) return res.status(403).json({ success: false, error: 'Sin permiso' });
        await Notificacion.deleteMany({ destinatario: usuario });
        res.json({ success: true });
    } catch (err) {
        logger.error(`Error vaciando notificaciones: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

app.get('/usuarios/stats-seguimiento/:usuario', async (req, res) => {
    try {
        const user = await Usuario.findOne({ usuario: req.params.usuario }).select('listaSeguidores siguiendo').lean();
        if (!user) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        res.json({ success: true, stats: { seguidores: user.listaSeguidores?.length || 0, siguiendo: user.siguiendo?.length || 0 } });
    } catch (err) {
        logger.error(`Error en stats-seguimiento: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

// ========== CHAT ==========

// ══════════════════════════════════════════════════════════════════
//  CHAT v2 — mensajes privados entre seguidores mutuos
//  · Últimos N mensajes + paginación hacia atrás (antes se devolvían los
//    200 MÁS ANTIGUOS: en chats largos los nuevos nunca aparecían).
//  · Cursor del SERVIDOR (no del reloj del móvil) y cambios incrementales:
//    leído, editado, reacciones y borrados llegan en el polling.
//  · Responder, reaccionar, editar (15 min), borrar para todos (24 h) o
//    solo para mí, "escribiendo…", bloqueo y vaciar chat solo para mí.
// ══════════════════════════════════════════════════════════════════
const CHAT_REACCIONES = ['❤️', '😂', '😮', '😢', '👍', '🔥'];
const CHAT_PAGINA = 40;
const chatEscribiendo = new Map();          // "de->para" → timestamp
const chatEsId = v => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
const chatConv = (yo, otro) => ({ $or: [{ de: yo, para: otro }, { de: otro, para: yo }], ocultoPara: { $ne: yo } });
const chatOnline = fecha => !!fecha && (Date.now() - new Date(fecha).getTime()) < 2 * 60 * 1000;
function chatSerializar(m) {
    return {
        id: m._id, de: m.de, para: m.para,
        texto: m.borrado ? '' : m.texto, imagen: m.borrado ? '' : (m.imagen || ''),
        leido: !!m.leido, fecha: m.fecha, editado: !!m.editado, borrado: !!m.borrado,
        replyTo: m.replyTo && m.replyTo.id ? m.replyTo : null,
        reacciones: m.borrado ? [] : (m.reacciones || []),
    };
}
async function chatRelacion(yo, otro) {
    const [a, b] = await Promise.all([
        Usuario.findOne({ usuario: yo }).select('siguiendo listaSeguidores bloqueados').lean(),
        Usuario.findOne({ usuario: otro }).select('usuario avatar verificadoNivel ultimoLogin siguiendo listaSeguidores bloqueados').lean(),
    ]);
    if (!a || !b) return { existe: !!b };
    const yoSigo = (a.siguiendo || []).includes(otro);
    const meSigue = (b.siguiendo || []).includes(yo) || (a.listaSeguidores || []).includes(otro);
    const yoBloqueo = (a.bloqueados || []).includes(otro);
    const meBloqueo = (b.bloqueados || []).includes(yo);
    return {
        existe: true, usuario: b.usuario, avatar: b.avatar || '', verificadoNivel: b.verificadoNivel || 0,
        online: !meBloqueo && chatOnline(b.ultimoLogin), ultimaVez: meBloqueo ? null : (b.ultimoLogin || null),
        yoSigo, meSigue, yoBloqueo, meBloqueo,
        puedeChatear: yoSigo && meSigue && !yoBloqueo && !meBloqueo,
    };
}

app.post('/chat/enviar', verificarToken, async (req, res) => {
    try {
        const de = req.usuario;
        const para = String(req.body.para || '').toLowerCase().trim();
        const texto = typeof req.body.texto === 'string' ? req.body.texto.trim() : '';
        const imagenRaw = typeof req.body.imagen === 'string' ? req.body.imagen.trim() : '';
        if (!para) return res.status(400).json({ success: false, error: 'Destinatario requerido' });
        if (!texto && !imagenRaw) return res.status(400).json({ success: false, error: 'Mensaje vacío' });
        if (de === para) return res.status(400).json({ success: false, error: 'No puedes enviarte mensajes a ti mismo' });
        if (texto.length > 2000) return res.status(400).json({ success: false, error: 'Mensaje demasiado largo (máx 2000 caracteres)' });
        const imagen = imagenRaw ? urlImagenSegura(imagenRaw) : '';
        if (imagenRaw && !imagen) return res.status(400).json({ success: false, error: 'Imagen inválida' });

        const rel = await chatRelacion(de, para);
        if (!rel.existe) return res.status(404).json({ success: false, error: 'Ese usuario no existe' });
        if (rel.yoBloqueo) return res.status(403).json({ success: false, error: `Bloqueaste a @${para}. Desbloquéalo para escribirle`, code: 'YO_BLOQUEO' });
        if (rel.meBloqueo) return res.status(403).json({ success: false, error: 'No puedes enviar mensajes a este usuario', code: 'BLOQUEADO' });
        if (!rel.puedeChatear) return res.status(403).json({ success: false, error: 'Solo puedes chatear con usuarios que se siguen mutuamente', code: 'NO_MUTUO' });

        let replyTo = undefined;
        if (chatEsId(req.body.replyTo)) {
            const orig = await Mensaje.findOne({ _id: req.body.replyTo, ...chatConv(de, para) }).select('de texto imagen borrado').lean();
            if (orig && !orig.borrado) replyTo = { id: String(orig._id), de: orig.de, texto: (orig.texto || '').slice(0, 140), imagen: !!orig.imagen };
        }
        const ahora = new Date();
        const msg = await new Mensaje({ de, para, texto, imagen, replyTo, actualizado: ahora, fecha: ahora }).save();
        chatEscribiendo.delete(`${de}->${para}`);

        // Una sola notificación por conversación sin leer (antes: una por mensaje)
        Notificacion.findOneAndUpdate(
            { destinatario: para, emisor: de, tipo: 'sistema', leida: false, itemTitle: `Mensaje de @${de}` },
            // (sin el texto del mensaje: el panel de notificaciones lo inserta como HTML)
            { $set: { fecha: ahora, itemId: msg._id.toString(), itemImage: imagen || '', mensaje: '' } },
            { upsert: true }
        ).catch(() => {});
        // Push al móvil con el texto (el sistema operativo lo muestra como texto plano, sin riesgo de HTML)
        if (!(await Usuario.exists({ usuario: para, bloqueados: de })))
            push.alCrear([{ destinatario: para, emisor: de, tipo: 'sistema', itemTitle: `Mensaje de @${de}`, mensaje: texto || (imagen ? '📷 Foto' : '') }]);

        res.json({ success: true, mensaje: chatSerializar(msg.toObject()), cursor: Date.now() });
    } catch (err) {
        logger.error(`Error enviando mensaje: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

// GET /chat/mensajes/:otro            → últimos 40
// GET /chat/mensajes/:otro?antes=ms   → 40 anteriores (scroll hacia arriba)
// GET /chat/mensajes/:otro?desde=ms   → nuevos + cambiados desde el cursor del servidor
app.get('/chat/mensajes/:otroUsuario', verificarToken, async (req, res) => {
    try {
        const yo = req.usuario;
        const otro = String(req.params.otroUsuario || '').toLowerCase();
        const base = chatConv(yo, otro);
        const cursor = Date.now();
        const desde = Number(req.query.desde) || 0;
        const antes = Number(req.query.antes) || 0;
        let mensajes, hayMas = false;
        if (desde) {
            const d = new Date(desde - 1500);   // margen por escrituras concurrentes (el cliente deduplica por id)
            mensajes = await Mensaje.find({ ...base, $and: [{ $or: [{ fecha: { $gt: d } }, { actualizado: { $gt: d } }] }] })
                .sort({ fecha: 1 }).limit(300).lean();
        } else {
            const f = antes ? { ...base, fecha: { $lt: new Date(antes) } } : base;
            const filas = await Mensaje.find(f).sort({ fecha: -1 }).limit(CHAT_PAGINA + 1).lean();
            hayMas = filas.length > CHAT_PAGINA;
            mensajes = filas.slice(0, CHAT_PAGINA).reverse();
        }
        // Marcar como leído TODO lo que me envió (y avisar al emisor vía "actualizado")
        const sinLeer = mensajes.some(m => m.para === yo && !m.leido) || !desde;
        if (sinLeer) {
            const r = await Mensaje.updateMany({ de: otro, para: yo, leido: false }, { $set: { leido: true, actualizado: new Date() } });
            if (r.modifiedCount) mensajes.forEach(m => { if (m.para === yo) m.leido = true; });
            if (r.modifiedCount) Notificacion.updateMany({ destinatario: yo, emisor: otro, tipo: 'sistema', leida: false, itemTitle: `Mensaje de @${otro}` }, { $set: { leida: true } }).catch(() => {});
        }
        const t = chatEscribiendo.get(`${otro}->${yo}`);
        res.json({ success: true, mensajes: mensajes.map(chatSerializar), hayMas, cursor, escribiendo: !!t && cursor - t < 6000 });
    } catch (err) {
        logger.error(`Error cargando mensajes: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

// GET /chat/conversaciones — una fila por contacto, con avatar y estado
app.get('/chat/conversaciones', verificarToken, async (req, res) => {
    try {
        const yo = req.usuario;
        const conversaciones = await Mensaje.aggregate([
            { $match: { $or: [{ de: yo }, { para: yo }], ocultoPara: { $ne: yo } } },
            { $addFields: {
                contacto:  { $cond: { if: { $eq: ['$de', yo] }, then: '$para', else: '$de' } },
                esNoLeido: { $and: [{ $eq: ['$para', yo] }, { $eq: ['$leido', false] }] }
            } },
            { $sort: { fecha: -1 } },
            { $group: {
                _id: '$contacto',
                ultimoTexto:  { $first: '$texto' },
                ultimaImagen: { $first: '$imagen' },
                ultimoDe:     { $first: '$de' },
                ultimaFecha:  { $first: '$fecha' },
                ultimoLeido:  { $first: '$leido' },
                ultimoBorrado:{ $first: '$borrado' },
                noLeidos:     { $sum: { $cond: ['$esNoLeido', 1, 0] } }
            } },
            { $sort: { ultimaFecha: -1 } },
            { $limit: 60 }
        ]);
        const nombres = conversaciones.map(c => c._id);
        const [usuarios, yoDoc] = await Promise.all([
            Usuario.find({ usuario: { $in: nombres } }).select('usuario avatar verificadoNivel ultimoLogin bloqueados').lean(),
            Usuario.findOne({ usuario: yo }).select('bloqueados').lean(),
        ]);
        const porNombre = new Map(usuarios.map(u => [u.usuario, u]));
        const misBloq = new Set(yoDoc?.bloqueados || []);
        res.json({ success: true, conversaciones: conversaciones.map(c => {
            const u = porNombre.get(c._id) || {};
            const meBloq = (u.bloqueados || []).includes(yo);
            return {
                contacto: c._id,
                avatar: u.avatar || '', verificadoNivel: u.verificadoNivel || 0,
                online: !meBloq && chatOnline(u.ultimoLogin),
                bloqueado: misBloq.has(c._id),
                existe: !!u.usuario,
                noLeidos: c.noLeidos,
                ultimoMensaje: {
                    texto: c.ultimoBorrado ? '' : c.ultimoTexto, imagen: c.ultimoBorrado ? '' : c.ultimaImagen,
                    de: c.ultimoDe, fecha: c.ultimaFecha, leido: c.ultimoLeido, borrado: !!c.ultimoBorrado
                }
            };
        }) });
    } catch (err) {
        logger.error(`Error cargando conversaciones: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

// GET /chat/contacto/:otro — perfil breve + relación (seguir, bloqueo, en línea)
app.get('/chat/contacto/:otroUsuario', verificarToken, async (req, res) => {
    try {
        const otro = String(req.params.otroUsuario || '').toLowerCase();
        const rel = await chatRelacion(req.usuario, otro);
        if (!rel.existe) return res.status(404).json({ success: false, error: 'Ese usuario no existe' });
        res.json({ success: true, contacto: rel });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

// GET /chat/contactos — seguidores mutuos (con quienes puedes chatear)
app.get('/chat/contactos', verificarToken, async (req, res) => {
    try {
        const yo = await Usuario.findOne({ usuario: req.usuario }).select('siguiendo listaSeguidores bloqueados').lean();
        if (!yo) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        const seg = new Set(yo.listaSeguidores || []);
        const bloq = new Set(yo.bloqueados || []);
        const mutuos = (yo.siguiendo || []).filter(u => seg.has(u) && !bloq.has(u));
        const usuarios = await Usuario.find({ usuario: { $in: mutuos } })
            .select('usuario avatar verificadoNivel ultimoLogin').limit(200).lean();
        res.json({ success: true, contactos: usuarios
            .map(u => ({ usuario: u.usuario, avatar: u.avatar || '', verificadoNivel: u.verificadoNivel || 0, online: chatOnline(u.ultimoLogin) }))
            .sort((a, b) => (b.online - a.online) || a.usuario.localeCompare(b.usuario)) });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

// POST /chat/escribiendo/:otro — indicador "escribiendo…" (vive 6 s en memoria)
app.post('/chat/escribiendo/:otroUsuario', verificarToken, (req, res) => {
    const otro = String(req.params.otroUsuario || '').toLowerCase().slice(0, 40);
    if (chatEscribiendo.size > 20000) chatEscribiendo.clear();
    chatEscribiendo.set(`${req.usuario}->${otro}`, Date.now());
    res.json({ success: true });
});

// PATCH /chat/mensaje/:id — editar mi mensaje (hasta 15 min)
app.patch('/chat/mensaje/:id', verificarToken, async (req, res) => {
    try {
        if (!chatEsId(req.params.id)) return res.status(400).json({ success: false, error: 'ID inválido' });
        const texto = typeof req.body.texto === 'string' ? req.body.texto.trim() : '';
        if (!texto || texto.length > 2000) return res.status(400).json({ success: false, error: 'Texto inválido (1-2000 caracteres)' });
        const m = await Mensaje.findById(req.params.id);
        if (!m || m.de !== req.usuario) return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });
        if (m.borrado) return res.status(400).json({ success: false, error: 'El mensaje fue eliminado' });
        if (Date.now() - m.fecha.getTime() > 15 * 60 * 1000) return res.status(400).json({ success: false, error: 'Solo puedes editar durante 15 minutos' });
        m.texto = texto; m.editado = true; m.actualizado = new Date();
        await m.save();
        res.json({ success: true, mensaje: chatSerializar(m.toObject()) });
    } catch (err) { res.status(500).json({ success: false, error: 'Error interno' }); }
});

// DELETE /chat/mensaje/:id?modo=todos|mi
app.delete('/chat/mensaje/:id', verificarToken, async (req, res) => {
    try {
        if (!chatEsId(req.params.id)) return res.status(400).json({ success: false, error: 'ID inválido' });
        const yo = req.usuario;
        const m = await Mensaje.findById(req.params.id);
        if (!m || (m.de !== yo && m.para !== yo)) return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });
        if (req.query.modo === 'todos') {
            if (m.de !== yo) return res.status(403).json({ success: false, error: 'Solo puedes eliminar para todos tus propios mensajes' });
            if (Date.now() - m.fecha.getTime() > 24 * 60 * 60 * 1000) return res.status(400).json({ success: false, error: 'Solo puedes eliminar para todos durante 24 horas' });
            m.borrado = true; m.texto = ''; m.imagen = ''; m.reacciones = []; m.replyTo = undefined; m.actualizado = new Date();
            await m.save();
            return res.json({ success: true, mensaje: chatSerializar(m.toObject()) });
        }
        await Mensaje.updateOne({ _id: m._id }, { $addToSet: { ocultoPara: yo } });
        await Mensaje.deleteOne({ _id: m._id, ocultoPara: { $all: [m.de, m.para] } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: 'Error interno' }); }
});

// POST /chat/mensaje/:id/reaccion { emoji } — una reacción por persona; repetirla la quita
app.post('/chat/mensaje/:id/reaccion', verificarToken, async (req, res) => {
    try {
        if (!chatEsId(req.params.id)) return res.status(400).json({ success: false, error: 'ID inválido' });
        const e = String(req.body.emoji || '');
        if (!CHAT_REACCIONES.includes(e)) return res.status(400).json({ success: false, error: 'Reacción no permitida' });
        const yo = req.usuario;
        const m = await Mensaje.findById(req.params.id);
        if (!m || (m.de !== yo && m.para !== yo) || (m.ocultoPara || []).includes(yo)) return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });
        if (m.borrado) return res.status(400).json({ success: false, error: 'El mensaje fue eliminado' });
        const previa = (m.reacciones || []).find(r => r.u === yo);
        m.reacciones = (m.reacciones || []).filter(r => r.u !== yo);
        if (!previa || previa.e !== e) m.reacciones.push({ u: yo, e });
        m.actualizado = new Date();
        await m.save();
        res.json({ success: true, mensaje: chatSerializar(m.toObject()) });
    } catch (err) { res.status(500).json({ success: false, error: 'Error interno' }); }
});

// DELETE /chat/conversacion/:otro — vaciar el chat SOLO para mí
// (antes borraba los mensajes también para la otra persona)
app.delete('/chat/conversacion/:otroUsuario', verificarToken, async (req, res) => {
    try {
        const yo = req.usuario, otro = String(req.params.otroUsuario || '').toLowerCase();
        const conv = { $or: [{ de: yo, para: otro }, { de: otro, para: yo }] };
        await Mensaje.updateMany(conv, { $addToSet: { ocultoPara: yo } });
        await Mensaje.deleteMany({ ...conv, ocultoPara: { $all: [yo, otro] } });
        res.json({ success: true });
    } catch (err) {
        logger.error(`Error borrando conversación: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

// POST / DELETE /chat/bloqueo/:otro — bloquear o desbloquear a un usuario
app.post('/chat/bloqueo/:otroUsuario', verificarToken, async (req, res) => {
    try {
        const otro = String(req.params.otroUsuario || '').toLowerCase();
        if (otro === req.usuario) return res.status(400).json({ success: false, error: 'No puedes bloquearte a ti mismo' });
        if (!(await Usuario.exists({ usuario: otro }))) return res.status(404).json({ success: false, error: 'Ese usuario no existe' });
        await Usuario.updateOne({ usuario: req.usuario }, { $addToSet: { bloqueados: otro } });
        res.json({ success: true, bloqueado: true });
    } catch (err) { res.status(500).json({ success: false, error: 'Error interno' }); }
});
app.delete('/chat/bloqueo/:otroUsuario', verificarToken, async (req, res) => {
    try {
        await Usuario.updateOne({ usuario: req.usuario }, { $pull: { bloqueados: String(req.params.otroUsuario || '').toLowerCase() } });
        res.json({ success: true, bloqueado: false });
    } catch (err) { res.status(500).json({ success: false, error: 'Error interno' }); }
});

app.get('/chat/no-leidos', verificarToken, async (req, res) => {
    try {
        const total = await Mensaje.countDocuments({ para: req.usuario, leido: false, ocultoPara: { $ne: req.usuario } });
        res.json({ success: true, noLeidos: total });
    } catch (err) { res.status(500).json({ success: false, error: 'Error interno' }); }
});

app.get('/usuarios/descubrir', verificarToken, async (req, res) => {
    try {
        const me = req.usuario;
        const limite = Math.min(parseInt(req.query.limite) || 10, 30);
        const usuario = await Usuario.findOne({ usuario: me }).select('siguiendo listaSeguidores').lean();
        if (!usuario) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        const siguiendo = usuario.siguiendo || [];
        const seguidores = usuario.listaSeguidores || [];
        const mutuos = siguiendo.filter(u => seguidores.includes(u));
        let extras = [];
        if (mutuos.length < limite) {
            extras = await Usuario.find({ usuario: { $ne: me, $nin: siguiendo } }).select('usuario avatar listaSeguidores isVerificado verificadoNivel').sort({ 'listaSeguidores.length': -1 }).limit(limite - mutuos.length).lean();
        }
        const mutuosData = await Usuario.find({ usuario: { $in: mutuos } }).select('usuario avatar listaSeguidores isVerificado verificadoNivel').limit(limite).lean();
        const todos = [
            ...mutuosData.map(u => ({ usuario: u.usuario, foto: u.avatar || '', avatar: u.avatar || '', verificadoNivel: u.verificadoNivel || 0, mutuo: true, seguidores: u.listaSeguidores?.length || 0 })),
            ...extras.map(u => ({ usuario: u.usuario, foto: u.avatar || '', avatar: u.avatar || '', verificadoNivel: u.verificadoNivel || 0, mutuo: false, seguidores: u.listaSeguidores?.length || 0 }))
        ].slice(0, limite);
        res.json({ success: true, usuarios: todos });
    } catch (err) {
        logger.error(`Error en descubrir: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

// ── FIX: Búsqueda de usuarios para el chat ──────────────────────────────────
app.get('/usuarios/buscar', verificarToken, async (req, res) => {
    try {
        const q  = String(req.query.q || '').trim().slice(0, 40);
        const me = req.usuario;
        if (!q || q.length < 2) return res.json({ success: true, usuarios: [] });
        // Escapar: el texto del usuario iba directo a $regex (patrones costosos / inyección)
        const qSafe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const usuarios = await Usuario
            .find({ usuario: { $regex: qSafe, $options: 'i', $ne: me } })
            .select('usuario avatar isVerificado verificadoNivel listaSeguidores siguiendo ultimoLogin')
            .limit(15)
            .lean();
        res.json({
            success: true,
            usuarios: usuarios.map(u => ({
                usuario:         u.usuario,
                foto:            u.avatar || '',   // (antes leía "foto", campo que no existe)
                avatar:          u.avatar || '',
                // Relación conmigo: para mostrar "Mensaje" solo si se siguen mutuamente
                yoSigo:          (u.listaSeguidores || []).includes(me),
                meSigue:         (u.siguiendo || []).includes(me),
                isVerificado:    u.isVerificado,
                verificadoNivel: u.verificadoNivel,
                seguidores:      (u.listaSeguidores || []).length,
                ultimoLogin:     u.ultimoLogin || null
            }))
        });
    } catch (err) {
        logger.error(`Error buscando usuarios: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al buscar usuarios' });
    }
});

app.post('/chat/imagen', verificarToken, async (req, res) => {
    try {
        const { imagen } = req.body;
        if (!imagen) return res.status(400).json({ success: false, error: 'Imagen requerida' });
        if (imagen.length > 5 * 1024 * 1024) return res.status(400).json({ success: false, error: 'Imagen demasiado grande (máx 5MB)' });
        const result = await cloudinary.uploader.upload(imagen, { folder: 'chat_images', transformation: [{ width: 1080, height: 1080, crop: 'limit', quality: 'auto:good' }] });
        res.json({ success: true, url: result.secure_url });
    } catch (err) {
        logger.error(`Error subiendo imagen de chat: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al subir imagen' });
    }
});

// ========== STORIES ==========

app.post('/stories/crear', verificarToken, async (req, res) => {
    try {
        const { imagen, texto } = req.body;
        if (!imagen && !texto?.trim()) return res.status(400).json({ success: false, error: 'Imagen o texto requerido' });
        let imgUrl = '';
        if (imagen) {
            const result = await cloudinary.uploader.upload(imagen, { folder: 'stories', transformation: [{ width: 1080, height: 1920, crop: 'limit', quality: 'auto:good' }] });
            imgUrl = result.secure_url;
        }
        const story = new Story({ usuario: req.usuario, imagen: imgUrl, texto: texto?.trim() || '' });
        await story.save();
        res.json({ success: true, story: { id: story._id, usuario: story.usuario, imagen: story.imagen, texto: story.texto, fecha: story.fecha } });
    } catch (err) {
        logger.error(`Error creando story: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

app.get('/stories/seguidos', verificarToken, async (req, res) => {
    try {
        const me = req.usuario;
        const usuario = await Usuario.findOne({ usuario: me }).select('siguiendo').lean();
        const seguidos = [...(usuario?.siguiendo || []), me];
        const stories = await Story.find({ usuario: { $in: seguidos } }).sort({ fecha: -1 }).limit(100).lean();
        const byUser = {};
        for (const s of stories) {
            if (!byUser[s.usuario]) { byUser[s.usuario] = { usuario: s.usuario, imagen: s.imagen, texto: s.texto, fecha: s.fecha, id: s._id, visto: s.vistos.includes(me), total: 0 }; }
            byUser[s.usuario].total++;
        }
        let result = Object.values(byUser);
        result.sort((a, b) => { if (a.usuario === me) return -1; if (b.usuario === me) return 1; if (a.visto !== b.visto) return a.visto ? 1 : -1; return new Date(b.fecha) - new Date(a.fecha); });
        const usernames = result.map(r => r.usuario);
        const perfiles = await Usuario.find({ usuario: { $in: usernames } }).select('usuario foto').lean();
        const fotoMap = Object.fromEntries(perfiles.map(p => [p.usuario, p.foto || '']));
        result = result.map(r => ({ ...r, foto: fotoMap[r.usuario] || '' }));
        res.json({ success: true, stories: result });
    } catch (err) {
        logger.error(`Error obteniendo stories: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

app.post('/stories/:id/ver', verificarToken, async (req, res) => {
    try {
        await Story.updateOne({ _id: req.params.id }, { $addToSet: { vistos: req.usuario } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: 'Error interno' }); }
});

// ========== HEALTHCHECK ==========
app.get('/', (req, res) => {
    res.json({
        status: 'UP',
        version: '4.0 - OPTIMIZADO',
        timestamp: new Date().toISOString(),
        features: [
            'Sistema de economía CPM ($2.00/1000 descargas)',
            'Control de IPs anti-bots (TTL 24h)',
            'Login dual (usuario/email)',
            'Pagos PayPal automatizados',
            'Panel Admin de Finanzas completo',
            'Sistema de links caídos',
            'Verificación de usuarios multi-nivel',
            'Detección automática de fraude',
            'Auto-marcación en lista negra',
            '⚡ Score calculado con 1 aggregation + $lookup',
            '⚡ Chat/conversaciones via aggregate (no carga en RAM)',
            '⚡ Favoritos con índice COLLSCAN eliminado',
            '⚡ JOB 7 usa bulkWrite (2 ops sin importar n° juegos)',
            '⚡ Score es fire & forget en likes/descargas',
        ]
    });
});

// ============================================================
// ⚙️ JOBS AUTOMÁTICOS
// ============================================================

function iniciarJobsAutomaticos() {

    // JOB 2: Limpiar comentarios vacíos y duplicados (cada 24h)
    async function limpiarComentarios() {
        try {
            const vacios = await Comentario.deleteMany({ $or: [{ texto: { $exists: false } }, { texto: null }, { texto: '' }, { texto: /^\s+$/ }] });
            const duplicados = await Comentario.aggregate([{ $group: { _id: { usuario: '$usuario', itemId: '$itemId', texto: '$texto' }, ids: { $push: '$_id' }, count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }]);
            let eliminadosDuplicados = 0;
            for (const grupo of duplicados) {
                await Comentario.deleteMany({ _id: { $in: grupo.ids.slice(1) } });
                eliminadosDuplicados += grupo.ids.length - 1;
            }
            if (vacios.deletedCount > 0 || eliminadosDuplicados > 0) logger.info(`JOB 2 Comentarios: ${vacios.deletedCount} vacíos + ${eliminadosDuplicados} duplicados eliminados`);
            else logger.info(`JOB 2 Comentarios: sin basura encontrada`);
        } catch (err) { logger.error(`JOB 2 Error: ${err.message}`); }
    }
    limpiarComentarios();
    setInterval(limpiarComentarios, 24 * 60 * 60 * 1000);
    logger.info('JOB 2: Limpieza de comentarios activa (cada 24h)');

    // JOB 3: Resetear reportes online +48h (cada 12h)
    async function resetearReportesOnline() {
        try {
            const hace48h = new Date(Date.now() - 48 * 60 * 60 * 1000);
            const resultado = await Juego.updateMany({ linkStatus: 'online', reportes: { $gt: 0 }, updatedAt: { $lte: hace48h } }, { $set: { reportes: 0 } });
            if (resultado.modifiedCount > 0) logger.info(`JOB 3 Reportes: ${resultado.modifiedCount} juegos reseteados`);
        } catch (err) { logger.error(`JOB 3 Error: ${err.message}`); }
    }
    setInterval(resetearReportesOnline, 12 * 60 * 60 * 1000);
    logger.info('JOB 3: Reset de reportes activo (cada 12h)');

    // JOB 4: Auto-marcar revisión→caído +2 días (cada 12h)
    async function autoMarcarRevisionCaido() {
        try {
            const hace2dias = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
            const resultado = await Juego.updateMany({ status: 'aprobado', linkStatus: 'revision', updatedAt: { $lte: hace2dias } }, { $set: { linkStatus: 'caido' } });
            if (resultado.modifiedCount > 0) logger.info(`JOB 4: ${resultado.modifiedCount} items marcados caídos`);
        } catch (err) { logger.error(`JOB 4 Error: ${err.message}`); }
    }
    autoMarcarRevisionCaido();
    setInterval(autoMarcarRevisionCaido, 12 * 60 * 60 * 1000);
    logger.info('JOB 4: Auto-marcado revisión→caído activo (cada 12h)');

    // JOB 5: Auto-marcar caídos por reportes (cada 6h)
    async function autoMarcarCaidos() {
        try {
            const hace72h = new Date(Date.now() - 72 * 60 * 60 * 1000);
            const resultado = await Juego.updateMany({ linkStatus: 'revision', reportes: { $gte: 10 }, updatedAt: { $lte: hace72h } }, { $set: { linkStatus: 'caido' } });
            if (resultado.modifiedCount > 0) logger.info(`JOB 5 Links: ${resultado.modifiedCount} links auto-marcados caídos`);
        } catch (err) { logger.error(`JOB 5 Error: ${err.message}`); }
    }
    setInterval(autoMarcarCaidos, 6 * 60 * 60 * 1000);
    logger.info('JOB 5: Auto-marcado de links caídos activo (cada 6h)');

    // JOB: agrupar en series las publicaciones existentes ("… parte 1", "… parte 2")
    async function backfillSeries() {
        try {
            const pendientes = await Juego.find({ serie: { $exists: false } }).select('_id title usuario').lean();
            if (!pendientes.length) return;
            const ops = pendientes.map(j => ({ updateOne: { filter: { _id: j._id }, update: { $set: { serie: series.serieDe(j.title, j.usuario) } }, timestamps: false } }));
            for (let i = 0; i < ops.length; i += 500) await Juego.bulkWrite(ops.slice(i, i + 500), { ordered: false });
            logger.info(`Series: ${pendientes.length} publicaciones revisadas, ${ops.filter(o => o.updateOne.update.$set.serie).length} son partes de una serie`);
        } catch (err) { logger.error(`Series backfill: ${err.message}`); }
    }
    backfillSeries();

    // JOB 6: Auto-verificación por seguidores (cada 6h)
    async function autoVerificarUsuarios() {
        try {
            const usuarios = await Usuario.find({}).select('usuario listaSeguidores verificadoNivel').lean();
            const ops = [];
            const subieron = [];

            for (const user of usuarios) {
                const seg = (user.listaSeguidores || []).length;
                let nivelMerecido = 0;
                if (seg >= 1000) nivelMerecido = 3;
                else if (seg >= 500)  nivelMerecido = 2;
                else if (seg >= 100)  nivelMerecido = 1;
                if (nivelMerecido > (user.verificadoNivel || 0)) {
                    ops.push({ updateOne: { filter: { usuario: user.usuario }, update: { $set: { verificadoNivel: nivelMerecido, isVerificado: nivelMerecido >= 1 } } } });
                    subieron.push(user.usuario);
                }
            }

            if (ops.length > 0) {
                await Usuario.bulkWrite(ops);
                // ⭐ Recalcular scores de los que subieron (bulkWrite en scoreHelpers)
                for (const nombreUsuario of subieron) {
                    await recalcularScoresUsuario(nombreUsuario);
                }
                logger.info(`JOB 6 Verificación: ${subieron.length} usuarios subieron de nivel`);
            } else {
                logger.info(`JOB 6 Verificación: todos los niveles al día`);
            }
        } catch (err) { logger.error(`JOB 6 Error: ${err.message}`); }
    }
    autoVerificarUsuarios();
    setInterval(autoVerificarUsuarios, 6 * 60 * 60 * 1000);
    logger.info('JOB 6: Auto-verificación por seguidores activa (cada 6h)');

    // JOB 7: Recalcular TODOS los scores (cada 12h)
    // ⭐ OPTIMIZADO: 2 queries + 1 bulkWrite sin importar cuántos juegos (era N*2 queries)
    async function recalcularTodosLosScoresJob() {
        try {
            await recalcularTodosLosScores();
        } catch (err) { logger.error(`JOB 7 Error: ${err.message}`); }
    }
    // ⭐ NO correr al arrancar — solo cada 12h (evita 2000+ queries en boot)
    setInterval(recalcularTodosLosScoresJob, 12 * 60 * 60 * 1000);
    logger.info('JOB 7: Recalculación masiva de scores activa (cada 12h, NO al arrancar)');

    // JOB 8: Purgar usuarios inactivos por 2 años (cada 7 días)
    async function purgarUsuariosInactivos() {
        try {
            const hace2Anos = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
            const usuariosInactivos = await Usuario.find({
                verificadoNivel: { $lt: 3 }, saldo: { $lte: 0 }, solicitudPagoPendiente: { $ne: true }, listaNegraAdmin: { $ne: true },
                $or: [{ ultimoLogin: { $lte: hace2Anos } }, { ultimoLogin: { $exists: false }, fecha: { $lte: hace2Anos } }, { ultimoLogin: null, fecha: { $lte: hace2Anos } }]
            }).select('usuario').lean();
            if (usuariosInactivos.length === 0) { logger.info('JOB 8 Inactividad: sin usuarios que purgar'); return; }
            const nombres = usuariosInactivos.map(u => u.usuario);
            const [juegosEliminados, usuariosEliminados] = await Promise.all([
                Juego.deleteMany({ usuario: { $in: nombres } }),
                Usuario.deleteMany({ usuario: { $in: nombres } })
            ]);
            logger.info(`JOB 8 Inactividad: ${usuariosEliminados.deletedCount} cuentas y ${juegosEliminados.deletedCount} juegos eliminados`);
        } catch (err) { logger.error(`JOB 8 Error: ${err.message}`); }
    }
    setInterval(purgarUsuariosInactivos, 7 * 24 * 60 * 60 * 1000);
    logger.info('JOB 8: Purga de usuarios inactivos activa (cada 7 días)');

    logger.info('TODOS LOS JOBS AUTOMÁTICOS INICIADOS');
}

// ========== 🎮 DETECCIÓN DE JUEGOS ==========

// POST /items/detect-game — detecta juego a partir de título (usado en frontend al escribir)
app.post('/items/detect-game', [body('title').notEmpty().trim()], async (req, res) => {
    const errors = validationResult(req);
    if(!errors.isEmpty()) return res.status(400).json({ detected: false });
    try {
        const { title = '', description = '' } = req.body;
        const det = gameDetector.detectGame(title, description);
        if(det) {
            return res.json({
                detected:     true,
                gameName:     det.gameName,
                gameKey:      det.gameKey,
                platform:     det.platform,
                purchaseLink: det.purchaseLink
            });
        }
        res.json({ detected: false });
    } catch(err) {
        logger.error(`[detect-game] ${err.message}`);
        res.status(500).json({ detected: false });
    }
});

// POST /items/buy-intent/:id — registra intención de compra (analytics, no bloqueante)
app.post('/items/buy-intent/:id', [param('id').isMongoId()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if(!errors.isEmpty()) return res.status(400).json({ ok: false });
        const { usuario, gameName, purchaseLink } = req.body;
        logger.info(`[BuyIntent] item=${req.params.id} | game="${gameName}" | user=${usuario||'anon'} | link=${purchaseLink}`);
        // Guardar en extraData del juego para analytics futuros
        await Juego.findByIdAndUpdate(req.params.id, {
            $inc: { 'extraData.buyIntentCount': 1 }
        }).catch(()=>{});
        res.json({ ok: true });
    } catch(err) {
        res.status(500).json({ ok: false });
    }
});

// GET /items/detected — lista todos los juegos con detección activa
app.get('/items/detected', async (req, res) => {
    try {
        const juegos = await Juego.find({
            status: 'aprobado',
            'extraData.detectedGame': { $exists: true }
        })
        .sort({ descargasEfectivas: -1 })
        .limit(100)
        .select('title usuario category extraData.detectedGame descargasEfectivas likesCount createdAt');
        res.json({ success: true, count: juegos.length, data: juegos });
    } catch(err) {
        logger.error(`[items/detected] ${err.message}`);
        res.status(500).json({ success: false });
    }
});

// =============================================

// ─── Búsqueda avanzada ───────────────────────────────────────────────────────

app.get('/search/autocomplete', async (req, res) => {
    try {
        const q     = (req.query.q || '').trim();
        const limit = Math.min(10, Math.max(1, parseInt(req.query.limit) || 6));
        if (q.length < 2) return res.json({ success: true, items: [], creadores: [], categorias: [] });
        const resultado = await searchModule.autocomplete(q, limit);
        res.json({ success: true, ...resultado });
    } catch (err) {
        logger.error(`[search/autocomplete] ${err.message}`);
        res.status(500).json({ success: false, error: 'Error en autocomplete' });
    }
});

app.get('/search/query', async (req, res) => {
    try {
        const q          = (req.query.q || '').trim();
        const categoria  = req.query.categoria  || null;
        const usuario    = req.query.usuario    || null;
        const orden      = req.query.orden      || 'relevancia';
        const page       = Math.max(1, parseInt(req.query.page)  || 1);
        const limit      = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const minLikes   = parseInt(req.query.minLikes)   || 0;
        const minDescargas = parseInt(req.query.minDescargas) || 0;
        const desde      = req.query.desde || null;
        const hasta      = req.query.hasta || null;

        const resultado = await searchModule.buscar({ q, categoria, usuario, orden, page, limit, minLikes, minDescargas, desde, hasta, incluirFacets: req.query.facets === '1' });

        if (q.length >= 2) {
            searchModule.registrarBusqueda(q);
            const userId = usuarioOpcional(req);
            if (userId && categoria) nexusMemoria.aprender(userId, 'search', { categoria }).catch(() => {});
        }

        res.json({ success: true, ...resultado });
    } catch (err) {
        logger.error(`[search/query] ${err.message}`);
        res.status(500).json({ success: false, error: 'Error en búsqueda' });
    }
});

app.get('/search/populares', async (req, res) => {
    try {
        const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));
        res.json({ success: true, busquedas: searchModule.busquedasPopulares(limit) });
    } catch (err) {
        logger.error(`[search/populares] ${err.message}`);
        res.status(500).json({ success: false, error: 'Error' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────

// ========== NEXUS: publicación de proyectos (zona de Proyectos → categoría software) ==========
// Debe registrarse ANTES del handler 404 para que sus rutas y el hosting /u sean alcanzables.
const nexusPublish = require('./modulos/nexusPublish');
nexusPublish.registrar(app, { Juego, logger, soloHosting: true });   // la Nexus externa ya no publica: solo se sirven los proyectos existentes

// ========== NEXUS: la IA nativa de UpGames (Groq, misma BD y servidor) ==========
require('./rutas/nexus').registrar(app, {
    verificarToken, usuarioOpcional, logger, config, LINKS_PERMITIDOS,
    Juego, Usuario, Favorito, series, search: searchModule, recommendations,
});
// ================================================================================================

// ========== MEJORAS v2 ==========
// Búsqueda, recomendaciones, gamificación, 2FA, analíticas, social y referidos.
// Antes se registraba DESPUÉS del handler 404 → sus 37 rutas respondían "Endpoint no encontrado".
const rutasMejoras = require('./rutas/rutasMejoras');
rutasMejoras.registrar(app, { verificarToken, verificarAdmin });
// ================================

// ========== LIVE: transmisiones, chat en tiempo real, monedas y regalos ==========
const server = require('http').createServer(app);
const live = require('./rutas/live').registrar(app, server, {
    verificarToken, verificarAdmin, Usuario, Notificacion, logger, config, JWT_SECRET,
    estaSuspendido: u => adminPanel.estaSuspendido(u), getPayPalAccessToken,
});
// Acceso directo: US$1 o 100 monedas para saltarse la página puente
require('./rutas/accesoDirecto').registrar(app, { verificarToken, Juego, Usuario, LiveTx: live.LiveTx, paypal: live.paypal, logger });
// =================================================================================

// ========== MANEJO DE ERRORES ==========
app.use((req, res) => {
    res.status(404).json({ error: "Endpoint no encontrado" });
});

app.use((err, req, res, next) => {
    logger.error(`Error: ${err?.message || "unknown"}`);
    res.status(500).json({ error: "Error interno del servidor" });
});

// ========== INICIAR SERVIDOR ==========
const PORT = config.PORT;
server.listen(PORT, () => {
    logger.info(`SERVIDOR CORRIENDO EN PUERTO ${PORT}`);
    logger.info(`Endpoint: http://localhost:${PORT}`);
    logger.info(`Sistema de Economía: ACTIVO | CPM: $${CPM_VALUE} | Autor: ${AUTHOR_PERCENTAGE * 100}%`);
    logger.info(`Anti-bots: Máx ${MAX_DOWNLOADS_PER_IP_PER_DAY} descargas/IP/día`);
    logger.info(`Detección de fraude: ACTIVA | Auto-lista negra: HABILITADA`);

    const alConectar = () => {
        // Crear índices faltantes al arrancar (idempotente)
        crearIndices().catch(err => logger.warn(`crearIndices: ${err.message}`));
        auditarIdentidades().catch(err => logger.warn(`auditarIdentidades: ${err.message}`));
        // Iniciar jobs automáticos
        iniciarJobsAutomaticos();
        push.iniciar({ logger });   // claves VAPID (generadas y guardadas en Mongo si no hay variables)
    };
    // Si Mongo conectó ANTES de que el servidor escuchara, 'open' ya ocurrió y
    // nunca se dispararía: índices y jobs (verificación, links caídos…) no correrían.
    if (mongoose.connection.readyState === 1) alConectar();
    else mongoose.connection.once('open', alConectar);
});

/**
 * Garantiza nombres y emails únicos a nivel de base de datos. Si ya existen
 * duplicados (cuentas creadas antes de las validaciones), el índice único no
 * puede crearse: se registran en el log para que el admin los resuelva.
 */
async function auditarIdentidades() {
    try {
        await Usuario.createIndexes();
    } catch (err) {
        logger.error(`[identidad] No se pudo asegurar el índice único de usuarios: ${err.message}`);
    }
    for (const campo of ['usuario', 'email']) {
        const dups = await Usuario.aggregate([
            { $group: { _id: { $toLower: `$${campo}` }, n: { $sum: 1 }, cuentas: { $push: '$usuario' } } },
            { $match: { n: { $gt: 1 } } },
            { $limit: 50 }
        ]);
        if (dups.length) logger.warn(`[identidad] ${dups.length} ${campo}(s) duplicado(s): ` + dups.map(d => campo === 'email' ? `[${d.cuentas.join(', ')}]` : `${d._id} → [${d.cuentas.join(', ')}]`).join(' | '));
        else logger.info(`[identidad] Sin ${campo}s duplicados ✓`);
    }
}
