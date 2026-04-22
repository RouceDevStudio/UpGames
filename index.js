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
const nexusClient     = require('./modulos/nexusClient');
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
        if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
            callback(null, true);
        } else {
            callback(new Error(`CORS: Origen no permitido → ${origin}`));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token']
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

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
    status:     { type: String, enum: ["pendiente", "aprobado", "rechazado", "pending"], default: "pendiente" },
    linkStatus: { type: String, enum: ["online", "revision", "caido"], default: "online" },
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
    extraData:          { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, strict: false });

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
const Juego = mongoose.model('Juego', JuegoSchema);

const UsuarioSchema = new mongoose.Schema({
    usuario:    { type: String, required: true, unique: true, index: true, minlength: 3, maxlength: 20, trim: true, lowercase: true },
    email:      { type: String, required: true, unique: true, lowercase: true, trim: true, index: true, match: [/^\S+@\S+\.\S+$/, 'Email inválido'] },
    password:   { type: String, required: true, minlength: 6 },
    paypalEmail:{ type: String, default: '', lowercase: true, trim: true, match: [/^(\S+@\S+\.\S+)?$/, 'Email de PayPal inválido'] },
    saldo:      { type: Number, default: 0, min: 0 },
    descargasTotales:      { type: Number, default: 0, min: 0 },
    isVerificado:          { type: Boolean, default: false, index: true },
    solicitudPagoPendiente:{ type: Boolean, default: false },
    reputacion: { type: Number, default: 0 },
    listaSeguidores: [String],
    siguiendo:       [String],
    verificadoNivel: { type: Number, default: 0, min: 0, max: 3, index: true },
    avatar:   { type: String, default: "" },
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
    socialLinks: { type: [String], default: [], validate: { validator: v => v.length <= 4, message: 'Máximo 4 links sociales' } },
    lastUsernameChange: { type: Date, default: null },
    lastEmailChange:    { type: Date, default: null }
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
    tipo:     { type: String, enum: ['nueva_publicacion', 'favorito', 'descarga', 'sistema', 'comentario'], required: true },
    emisor:   { type: String, required: true },
    itemId:   { type: String, default: '' },
    itemTitle:{ type: String, default: '' },
    itemImage:{ type: String, default: '' },
    leida:    { type: Boolean, default: false, index: true },
    fecha:    { type: Date, default: Date.now, index: true, expires: 30 * 24 * 60 * 60 }
}, { collection: 'notificaciones', timestamps: false });
NotificacionSchema.index({ destinatario: 1, leida: 1, fecha: -1 });
const Notificacion = mongoose.model('Notificacion', NotificacionSchema);

const MensajeSchema = new mongoose.Schema({
    de:     { type: String, required: true, index: true },
    para:   { type: String, required: true, index: true },
    texto:  { type: String, default: '', maxlength: 2000 },
    imagen: { type: String, default: '' },
    leido:  { type: Boolean, default: false, index: true },
    fecha:  { type: Date, default: Date.now, index: true, expires: 90 * 24 * 60 * 60 }
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
const verificarToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, error: "Token no proporcionado" });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.usuario = decoded.usuario;
        req.userTokenData = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: "Token inválido o expirado" });
    }
};

// ========== ADMIN SESSION ==========
const adminSessions = new Map();
const ADMIN_SESSION_DURATION = 8 * 60 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [token, session] of adminSessions.entries()) {
        if (now - session.createdAt > ADMIN_SESSION_DURATION) adminSessions.delete(token);
    }
}, 60 * 60 * 1000);

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

app.post('/auth/resend-verification', [body('email').isEmail().normalizeEmail()], async (req, res) => {
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

app.post('/auth/forgot-password', [body('email').isEmail().normalizeEmail()], async (req, res) => {
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
app.post('/admin/auth/login', (req, res) => {
    const { pin } = req.body;
    if (!pin || pin !== JWT_SECRET) {
        logger.warn(`Intento de acceso admin fallido - IP: ${req.ip}`);
        return res.status(401).json({ success: false, error: 'PIN incorrecto' });
    }
    const adminToken = jwt.sign({ role: 'admin', createdAt: Date.now() }, JWT_SECRET + '_ADMIN', { expiresIn: '8h' });
    adminSessions.set(adminToken, { createdAt: Date.now(), ip: req.ip });
    logger.info(`Sesión admin iniciada - IP: ${req.ip}`);
    res.json({ success: true, adminToken, expiresIn: '8h' });
});

app.get('/admin/auth/verify', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (!token || !adminSessions.has(token)) return res.status(401).json({ success: false, error: 'Sesión admin inválida o expirada' });
    const session = adminSessions.get(token);
    if (Date.now() - session.createdAt > ADMIN_SESSION_DURATION) {
        adminSessions.delete(token);
        return res.status(401).json({ success: false, error: 'Sesión expirada' });
    }
    res.json({ success: true, message: 'Sesión activa' });
});

app.post('/admin/auth/logout', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token) { adminSessions.delete(token); logger.info(`Sesión admin cerrada - IP: ${req.ip}`); }
    res.json({ success: true, message: 'Sesión cerrada' });
});

const verificarAdmin = (req, res, next) => {
    const adminToken = req.headers['x-admin-token'];
    if (!adminToken) return res.status(401).json({ success: false, error: 'Panel admin: token requerido' });
    if (!adminSessions.has(adminToken)) return res.status(401).json({ success: false, error: 'Sesión admin inválida o expirada. Ingresa el PIN.' });
    const session = adminSessions.get(adminToken);
    if (Date.now() - session.createdAt > ADMIN_SESSION_DURATION) {
        adminSessions.delete(adminToken);
        return res.status(401).json({ success: false, error: 'Sesión admin expirada. Ingresa el PIN nuevamente.' });
    }
    next();
};

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
        if (!juegoElegible) return res.status(403).json({ success: false, error: "Ninguno de tus juegos tiene descargas registradas aún" });

        const nuevoPago = new Pago({ usuario: usuario.usuario, monto: usuario.saldo, paypalEmail: usuario.paypalEmail, estado: 'pendiente' });
        await nuevoPago.save();
        usuario.solicitudPagoPendiente = true;
        await usuario.save();
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
            .select('saldo descargasTotales paypalEmail isVerificado solicitudPagoPendiente verificadoNivel');
        if (!usuario) return res.status(404).json({ success: false, error: "Usuario no encontrado" });

        const juegosElegibles = await Juego.countDocuments({ usuario: req.usuario, descargasEfectivas: { $gt: 0 } });
        const puedeRetirar = usuario.saldo >= MIN_WITHDRAWAL && usuario.isVerificado && usuario.verificadoNivel >= 1 && usuario.paypalEmail && juegosElegibles > 0 && !usuario.solicitudPagoPendiente;

        res.json({ success: true, saldo: usuario.saldo, descargasTotales: usuario.descargasTotales, paypalEmail: usuario.paypalEmail || '', isVerificado: usuario.isVerificado, verificadoNivel: usuario.verificadoNivel, solicitudPagoPendiente: usuario.solicitudPagoPendiente, juegosElegibles, puedeRetirar, minRetiro: MIN_WITHDRAWAL, requisitos: { saldoMinimo: MIN_WITHDRAWAL, verificacionNecesaria: 1 } });
    } catch (error) {
        logger.error(`Error en mi-saldo: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al obtener saldo" });
    }
});

app.put('/economia/actualizar-paypal', [verificarToken, body('paypalEmail').isEmail().normalizeEmail()], async (req, res) => {
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

app.get('/admin/finanzas/solicitudes-pendientes', verificarAdmin, async (req, res) => {
    try {
        const solicitudes = await Pago.find({ estado: 'pendiente' }).sort({ fecha: -1 }).lean();
        const solicitudesEnriquecidas = await Promise.all(solicitudes.map(async (s) => {
            const [usuario, juegosElegibles] = await Promise.all([
                Usuario.findOne({ usuario: s.usuario }).select('email verificadoNivel isVerificado descargasTotales').lean(),
                Juego.countDocuments({ usuario: s.usuario, descargasEfectivas: { $gt: 0 } })
            ]);
            return { ...s, datosUsuario: { email: usuario?.email || '', verificadoNivel: usuario?.verificadoNivel || 0, isVerificado: usuario?.isVerificado || false, descargasTotales: usuario?.descargasTotales || 0, juegosElegibles } };
        }));
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
        const pago = await Pago.findById(id);
        if (!pago) return res.status(404).json({ success: false, error: "Pago no encontrado" });
        if (pago.estado !== 'pendiente') return res.status(400).json({ success: false, error: "Este pago ya fue procesado" });

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
                return res.status(502).json({ success: false, error: `El pago no se pudo enviar vía PayPal: ${paypalError.message}`, detalle: 'El saldo del usuario NO fue modificado. Revisa las credenciales de PayPal o procesa manualmente.', paypalEmail: pago.paypalEmail, monto: pago.monto });
            }
        }

        pago.estado = 'completado';
        pago.notas = notas || (pagoAutomatico ? `Pago automático vía PayPal Payouts el ${new Date().toLocaleString('es-ES')}. Batch ID: ${paypalBatchId}` : `Pago procesado manualmente el ${new Date().toLocaleString('es-ES')}`);
        await pago.save();

        const usuario = await Usuario.findOne({ usuario: pago.usuario });
        if (usuario) {
            usuario.saldo = Math.max(0, usuario.saldo - pago.monto);
            usuario.solicitudPagoPendiente = false;
            await usuario.save();
            gamification.onPagoRecibido(pago.usuario, pago.monto).catch(() => {});
        }

        logger.info(`Pago procesado [${metodoProcesamiento}] - @${pago.usuario}, Monto: $${pago.monto.toFixed(2)}`);
        res.json({ success: true, mensaje: pagoAutomatico ? `Pago enviado automáticamente vía PayPal a ${pago.paypalEmail}` : "Pago marcado como procesado manualmente", metodo: pagoAutomatico ? 'paypal_automatico' : 'manual', paypalBatchId: paypalBatchId || null, pago: { usuario: pago.usuario, monto: pago.monto, paypalEmail: pago.paypalEmail, fecha: pago.fecha } });
    } catch (error) {
        logger.error(`Error en procesar-pago: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al procesar pago" });
    }
});

app.post('/admin/finanzas/rechazar-pago/:id', verificarAdmin, [param('id').isMongoId(), body('motivo').optional().trim()], async (req, res) => {
    try {
        const pago = await Pago.findById(req.params.id);
        if (!pago) return res.status(404).json({ success: false, error: "Pago no encontrado" });
        if (pago.estado !== 'pendiente') return res.status(400).json({ success: false, error: "El pago ya fue procesado" });
        pago.estado = 'rechazado';
        pago.notas = req.body.motivo || 'Rechazado por el administrador';
        await pago.save();
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

app.post('/auth/register', [
    body('usuario').trim().isLength({ min: 3, max: 20 }).toLowerCase(),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Datos inválidos", details: errors.array() });

        const { usuario, email, password } = req.body;
        const registrationIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.headers['x-real-ip'] || req.connection?.remoteAddress || req.socket?.remoteAddress || '';

        const [existeUsuario, existeEmail] = await Promise.all([
            Usuario.findOne({ usuario: usuario.toLowerCase() }).select('_id').lean(),
            Usuario.findOne({ email: email.toLowerCase() }).select('_id').lean()
        ]);
        if (existeUsuario) return res.status(400).json({ success: false, error: "El nombre de usuario ya está en uso" });
        if (existeEmail) return res.status(400).json({ success: false, error: "El email ya está registrado" });

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
        logger.error(`Error en register: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al registrar usuario" });
    }
});

app.post('/auth/login', [body('usuario').notEmpty(), body('password').notEmpty()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Datos inválidos" });

        const { usuario: identificador, password } = req.body;
        const usuario = await Usuario.findOne({ $or: [{ usuario: identificador.toLowerCase() }, { email: identificador.toLowerCase() }] });
        if (!usuario) return res.status(401).json({ success: false, error: "Usuario o contraseña incorrectos" });

        const esValida = await bcrypt.compare(password, usuario.password);
        if (!esValida) return res.status(401).json({ success: false, error: "Usuario o contraseña incorrectos" });

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
        const user = await Usuario.findByIdAndUpdate(req.params.id, { $set: { saldo: parseFloat(saldo) } }, { new: true }).select('-password');
        if (!user) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        logger.info(`ADMIN: Saldo ajustado @${user.usuario} → $${saldo} (${motivo || 'Sin motivo'})`);
        res.json({ success: true, usuario: user.usuario, nuevoSaldo: user.saldo });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al ajustar saldo" });
    }
});

app.put('/admin/items/bulk-action', verificarAdmin, [body('ids').isArray({ min: 1 }), body('action').isIn(['aprobar', 'rechazar', 'eliminar', 'online', 'caido'])], async (req, res) => {
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
        const pago = await Pago.findById(req.params.id);
        if (!pago) return res.status(404).json({ success: false, error: "Pago no encontrado" });
        if (pago.estado !== 'pendiente') return res.status(400).json({ success: false, error: "El pago ya fue procesado" });
        pago.estado = 'rechazado';
        pago.notas = req.body.motivo || 'Rechazado por el administrador';
        await pago.save();
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
        const item = await Juego.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true });
        if (!item) return res.status(404).json({ success: false, error: "Item no encontrado" });
        logger.info(`ADMIN: Item ${item._id} actualizado`);
        res.json({ success: true, item });
    } catch (error) {
        logger.error(`Error: ${error?.message}`);
        res.status(500).json({ success: false, error: "Error al actualizar item" });
    }
});

app.get("/admin/items", verificarAdmin, async (req, res) => {
    try {
        const items = await Juego.find().sort({ createdAt: -1 }).lean();
        const itemsWithInfo = items.map(item => ({ ...item, diasDesdeCreacion: Math.floor((Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24)), necesitaRevision: item.reportes >= 3 || item.linkStatus === 'revision' }));
        res.json({ success: true, count: items.length, items: itemsWithInfo });
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

app.put('/items/download/:id', [param('id').isMongoId()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'ID inválido' });
        const { tipo } = req.body;
        if (tipo !== 'vista') return res.status(400).json({ success: false, error: 'Tipo inválido' });
        const juego = await Juego.findByIdAndUpdate(req.params.id, { $inc: { descargasEfectivas: 1 } }, { new: true, select: 'descargasEfectivas' });
        if (!juego) return res.status(404).json({ success: false, error: 'Item no encontrado' });
        logger.info(`Vista registrada — ID: ${req.params.id}, Total: ${juego.descargasEfectivas}`);
        res.json({ success: true, descargasEfectivas: juego.descargasEfectivas });
    } catch (error) {
        logger.error(`Error registrando vista: ${error.message}`);
        res.status(500).json({ success: false });
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
        const { categoria } = req.query;
        const filtro = { status: 'aprobado', linkStatus: { $in: ['online', 'revision'] } };
        if (categoria && categoria !== 'Todo') filtro.category = categoria;
        const items = await Juego.find(filtro).select('_id title description image images link category usuario reportes linkStatus descargasEfectivas likesCount extraData videoType featuredItemId scoreRecomendacion').sort({ scoreRecomendacion: -1, createdAt: -1 }).limit(100).lean();
        res.json(items);
    } catch (error) {
        res.status(500).json([]);
    }
});

app.get("/items/user/:usuario", async (req, res) => {
    try {
        const aportes = await Juego.find({ usuario: req.params.usuario }).select('_id title description image images link category usuario reportes reportesDesglose linkStatus descargasEfectivas likesCount status createdAt scoreRecomendacion extraData videoType featuredItemId').sort({ scoreRecomendacion: -1, createdAt: -1 }).lean();
        res.json(aportes);
    } catch (error) {
        res.status(500).json([]);
    }
});

app.post("/items/add", [verificarToken, body('title').notEmpty().trim().isLength({ max: 200 }), body('link').notEmpty().trim()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Datos inválidos" });

        const nuevoJuego = new Juego({ ...req.body, usuario: req.usuario, status: "aprobado", linkStatus: "revision" });
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

        // Fire & forget — Nexus analiza el juego recién publicado y guarda el feedback
        nexusClient.mentorGame(nuevoJuego.usuario, {
            titulo:      nuevoJuego.title,
            descripcion: nuevoJuego.description,
            tags:        nuevoJuego.tags,
            categoria:   nuevoJuego.category,
            precio:      nuevoJuego.precio,
            imagenes:    nuevoJuego.images?.length || 0,
        }, req.headers.authorization?.split(' ')[1])
        .then(m => {
            if (m?.ok && m.mentor) {
                Juego.findByIdAndUpdate(nuevoJuego._id, { $set: { nexusMentor: m.mentor } }).catch(() => {});
                logger.info(`[nexus-mentor] "${nuevoJuego.title}" puntuación=${m.mentor.puntuacion}`);
            }
        })
        .catch(() => {});
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
            if (!adminSessions.has(adminToken)) return res.status(401).json({ success: false, error: "Sesión admin inválida" });
            const session = adminSessions.get(adminToken);
            if (Date.now() - session.createdAt > ADMIN_SESSION_DURATION) { adminSessions.delete(adminToken); return res.status(401).json({ success: false, error: "Sesión admin expirada" }); }
            await Juego.findByIdAndDelete(req.params.id);
            logger.info(`ADMIN eliminó publicación: ${item.title}`);
            return res.json({ success: true, ok: true });
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
        const { page = 1, limit = 200 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const users = await Usuario.find()
            .select('usuario verificadoNivel avatar bio listaSeguidores siguiendo')
            .skip(skip)
            .limit(parseInt(limit))
            .lean();
        res.json(users);
    } catch (error) {
        res.status(500).json([]);
    }
});

app.get('/auth/users', verificarAdmin, async (req, res) => {
    try {
        const users = await Usuario.find().select('-password').sort({ fecha: -1 }).lean();
        res.json(users);
    } catch (error) {
        res.status(500).json([]);
    }
});

app.get('/admin/users/detalle/:id', verificarAdmin, async (req, res) => {
    try {
        const user = await Usuario.findById(req.params.id).select('-password').lean();
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
        const user = await Usuario.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true }).select('-password');
        if (!user) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        logger.warn(`Lista negra actualizada: @${user.usuario} → ${listaNegraAdmin}`);
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al actualizar lista negra" });
    }
});

app.put('/admin/users/notas/:id', verificarAdmin, [body('notasAdmin').trim().isLength({ max: 500 })], async (req, res) => {
    try {
        const user = await Usuario.findByIdAndUpdate(req.params.id, { $set: { notasAdmin: req.body.notasAdmin } }, { new: true }).select('-password');
        if (!user) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        res.json({ success: true, mensaje: "Notas actualizadas" });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al guardar notas" });
    }
});

app.get('/admin/users/lista-negra', verificarAdmin, async (req, res) => {
    try {
        const users = await Usuario.find({ listaNegraAdmin: true }).select('-password').sort({ fechaListaNegra: -1 }).lean();
        res.json({ success: true, users, total: users.length });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al obtener lista negra" });
    }
});

app.delete('/auth/users/:id', verificarAdmin, async (req, res) => {
    try {
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
        const user = await Usuario.findOneAndUpdate({ usuario: username.toLowerCase() }, { $set: { verificadoNivel: nivel } }, { new: true }).select('-password');
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

app.get('/usuarios/perfil-publico/:usuario', async (req, res) => {
    try {
        const username = req.params.usuario.toLowerCase().trim();
        const [user, publicaciones] = await Promise.all([
            Usuario.findOne({ usuario: username }).select('-password -paypalEmail').lean(),
            Juego.countDocuments({ usuario: username, status: 'aprobado' })
        ]);
        if (!user) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        res.json({ success: true, usuario: { ...user, publicaciones, seguidores: user.listaSeguidores?.length || 0, siguiendo: user.siguiendo?.length || 0 } });
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
        }
    } catch (err) {
        res.status(500).json({ success: false, error: "Error al actualizar" });
    }
});

app.put('/usuarios/update-avatar', [verificarToken, body('avatarUrl').optional(), body('nuevaFoto').optional()], async (req, res) => {
    try {
        const avatarUrl = req.body.avatarUrl || req.body.nuevaFoto;
        if (!avatarUrl) return res.status(400).json({ success: false, error: 'URL de avatar requerida' });
        await Usuario.updateOne({ usuario: req.usuario.toLowerCase() }, { $set: { avatar: avatarUrl } });
        res.json({ success: true });
    } catch (err) {
        logger.error(`Error en update-avatar: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al actualizar avatar' });
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
        const usuario = await Usuario.findOne({ usuario: oldName });
        if (!usuario) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        const passOk = await bcrypt.compare(password, usuario.password);
        if (!passOk) return res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
        if (usuario.lastUsernameChange) {
            const diffDays = (Date.now() - new Date(usuario.lastUsernameChange).getTime()) / (1000 * 60 * 60 * 24);
            if (diffDays < 30) { const restante = Math.ceil(30 - diffDays); return res.status(429).json({ success: false, error: `Debes esperar ${restante} día${restante !== 1 ? 's' : ''} más para cambiar tu nombre` }); }
        }
        const existe = await Usuario.findOne({ usuario: newName }).select('_id').lean();
        if (existe) return res.status(409).json({ success: false, error: 'Ese nombre de usuario ya está en uso' });
        await Promise.all([
            Usuario.updateOne({ usuario: oldName }, { $set: { usuario: newName, lastUsernameChange: new Date() } }),
            Juego.updateMany({ usuario: oldName }, { $set: { usuario: newName } }),
            Comentario.updateMany({ usuario: oldName }, { $set: { usuario: newName } }),
            Notificacion.updateMany({ destinatario: oldName }, { $set: { destinatario: newName } }),
            Notificacion.updateMany({ emisor: oldName }, { $set: { emisor: newName } }),
            Usuario.updateMany({ listaSeguidores: oldName }, { $set: { 'listaSeguidores.$': newName } }),
            Usuario.updateMany({ siguiendo: oldName }, { $set: { 'siguiendo.$': newName } })
        ]);
        const nuevoToken = jwt.sign({ usuario: newName, email: usuario.email }, JWT_SECRET, { expiresIn: '30d' });
        logger.info(`[update-username] ${oldName} → ${newName} | Cascada completada`);
        res.json({ success: true, nuevoToken, nuevoUsuario: newName });
    } catch (err) {
        logger.error(`Error en update-username: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al actualizar nombre' });
    }
});

app.put('/usuarios/update-email', [verificarToken, body('nuevoEmail').isEmail().normalizeEmail(), body('password').notEmpty()], async (req, res) => {
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
        const existe = await Usuario.findOne({ email: nuevoEmail.toLowerCase() }).select('_id').lean();
        if (existe) return res.status(409).json({ success: false, error: 'Ese email ya está en uso' });
        await Usuario.updateOne({ usuario: req.usuario.toLowerCase() }, { $set: { email: nuevoEmail.toLowerCase(), lastEmailChange: new Date(), emailVerificado: false } });
        const nuevoToken = jwt.sign({ usuario: req.usuario.toLowerCase(), email: nuevoEmail.toLowerCase() }, JWT_SECRET, { expiresIn: '30d' });
        logger.info(`Usuario ${req.usuario} cambió su email a ${nuevoEmail}`);
        res.json({ success: true, nuevoToken });
    } catch (err) {
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
        const nuevo = new Comentario({ ...req.body, usuario: req.usuario });
        await nuevo.save();
        gamification.onComentario(req.usuario).catch(() => {});
        res.status(201).json({ success: true, comentario: nuevo });
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

app.post('/notificaciones', async (req, res) => {
    try {
        const { usuario, tipo, emisor, itemId, itemTitle, itemImage } = req.body;
        if (!usuario || !tipo) return res.status(400).json({ success: false, error: 'usuario y tipo requeridos' });
        await new Notificacion({ destinatario: usuario, tipo: tipo || 'sistema', emisor: emisor || '', itemId: itemId || '', itemTitle: itemTitle || '', itemImage: itemImage || '', leida: false, fecha: new Date() }).save();
        res.json({ success: true });
    } catch (err) {
        logger.error(`Error creando notificación: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
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

app.post('/chat/enviar', verificarToken, async (req, res) => {
    try {
        const { para, texto, imagen } = req.body;
        const de = req.usuario;
        if (!para) return res.status(400).json({ success: false, error: 'Destinatario requerido' });
        if (!texto?.trim() && !imagen?.trim()) return res.status(400).json({ success: false, error: 'Mensaje vacío' });
        if (de === para) return res.status(400).json({ success: false, error: 'No puedes enviarte mensajes a ti mismo' });
        if (texto && texto.trim().length > 2000) return res.status(400).json({ success: false, error: 'Mensaje demasiado largo (máx 2000 caracteres)' });

        const [emisor, receptor] = await Promise.all([
            Usuario.findOne({ usuario: de }).select('siguiendo').lean(),
            Usuario.findOne({ usuario: para }).select('listaSeguidores').lean()
        ]);
        if (!receptor) return res.status(404).json({ success: false, error: 'Usuario destinatario no existe' });
        const emisorSigueReceptor = (emisor?.siguiendo || []).includes(para);
        const receptorSigueEmisor = (receptor?.listaSeguidores || []).includes(de);
        if (!emisorSigueReceptor || !receptorSigueEmisor) return res.status(403).json({ success: false, error: 'Solo puedes chatear con usuarios que se siguen mutuamente' });

        const msg = new Mensaje({ de, para, texto: texto?.trim() || '', imagen: imagen?.trim() || '' });
        await msg.save();

        new Notificacion({ destinatario: para, tipo: 'sistema', emisor: de, itemId: msg._id.toString(), itemTitle: `Mensaje de @${de}`, itemImage: imagen || '', leida: false, fecha: new Date() }).save().catch(() => {});

        res.json({ success: true, mensaje: { id: msg._id, de, para, texto: msg.texto, imagen: msg.imagen, leido: false, fecha: msg.fecha } });
    } catch (err) {
        logger.error(`Error enviando mensaje: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

app.get('/chat/mensajes/:otroUsuario', verificarToken, async (req, res) => {
    try {
        const yo    = req.usuario;
        const otro  = req.params.otroUsuario;
        const desde = req.query.desde ? new Date(Number(req.query.desde)) : null;
        const filtro = { $or: [{ de: yo, para: otro }, { de: otro, para: yo }] };
        if (desde) filtro.fecha = { $gt: desde };
        const mensajes = await Mensaje.find(filtro).sort({ fecha: 1 }).limit(200).lean();
        const idsNoLeidos = mensajes.filter(m => m.para === yo && !m.leido).map(m => m._id);
        if (idsNoLeidos.length) await Mensaje.updateMany({ _id: { $in: idsNoLeidos } }, { $set: { leido: true } });
        res.json({ success: true, mensajes: mensajes.map(m => ({ id: m._id, de: m.de, para: m.para, texto: m.texto, leido: m.leido, fecha: m.fecha })) });
    } catch (err) {
        logger.error(`Error cargando mensajes: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

/**
 * ⭐ GET /chat/conversaciones — OPTIMIZADO
 *
 * Versión original: cargaba TODOS los mensajes del usuario en memoria
 * para agruparlos en JS → O(n) en RAM.
 *
 * Versión nueva: aggregate en MongoDB que devuelve solo ~50 conversaciones
 * (1 doc por contacto) sin importar cuántos mensajes haya.
 */
app.get('/chat/conversaciones', verificarToken, async (req, res) => {
    try {
        const yo = req.usuario;

        const conversaciones = await Mensaje.aggregate([
            // Solo mensajes donde participo yo
            { $match: { $or: [{ de: yo }, { para: yo }] } },
            // Calcular el campo "contacto"
            {
                $addFields: {
                    contacto: {
                        $cond: { if: { $eq: ['$de', yo] }, then: '$para', else: '$de' }
                    },
                    esMio:    { $eq: ['$de', yo] },
                    esNoLeido:{ $and: [{ $eq: ['$para', yo] }, { $eq: ['$leido', false] }] }
                }
            },
            // Ordenar por fecha desc antes de agrupar
            { $sort: { fecha: -1 } },
            // Agrupar por contacto, tomando el primer mensaje (el más reciente)
            {
                $group: {
                    _id: '$contacto',
                    ultimoTexto: { $first: '$texto' },
                    ultimoDe:    { $first: '$de' },
                    ultimaFecha: { $first: '$fecha' },
                    noLeidos:    { $sum: { $cond: ['$esNoLeido', 1, 0] } }
                }
            },
            { $sort: { ultimaFecha: -1 } },
            { $limit: 50 },
            {
                $project: {
                    _id: 0,
                    contacto:    '$_id',
                    ultimoMensaje: { texto: '$ultimoTexto', de: '$ultimoDe', fecha: '$ultimaFecha' },
                    noLeidos: 1
                }
            }
        ]);

        res.json({ success: true, conversaciones });
    } catch (err) {
        logger.error(`Error cargando conversaciones: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

app.delete('/chat/conversacion/:otroUsuario', verificarToken, async (req, res) => {
    try {
        const yo = req.usuario, otro = req.params.otroUsuario;
        await Mensaje.deleteMany({ $or: [{ de: yo, para: otro }, { de: otro, para: yo }] });
        res.json({ success: true });
    } catch (err) {
        logger.error(`Error borrando conversación: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

app.get('/chat/no-leidos', verificarToken, async (req, res) => {
    try {
        const total = await Mensaje.countDocuments({ para: req.usuario, leido: false });
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
            extras = await Usuario.find({ usuario: { $ne: me, $nin: siguiendo } }).select('usuario foto listaSeguidores isVerificado verificadoNivel').sort({ 'listaSeguidores.length': -1 }).limit(limite - mutuos.length).lean();
        }
        const mutuosData = await Usuario.find({ usuario: { $in: mutuos } }).select('usuario foto listaSeguidores isVerificado verificadoNivel').limit(limite).lean();
        const todos = [
            ...mutuosData.map(u => ({ ...u, mutuo: true, seguidores: u.listaSeguidores?.length || 0 })),
            ...extras.map(u => ({ ...u, mutuo: false, seguidores: u.listaSeguidores?.length || 0 }))
        ].slice(0, limite);
        res.json({ success: true, usuarios: todos });
    } catch (err) {
        logger.error(`Error en descubrir: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
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

// ══════════════════════════════════════════════════════════════════
//  RUTAS NEXUS ↔ UPGAMES
// ══════════════════════════════════════════════════════════════════

// GET /nexus/mis-analytics — insights predictivos del creador (usuario autenticado)
app.get('/nexus/mis-analytics', verificarToken, async (req, res) => {
    try {
        const data = await nexusClient.getCreatorAnalytics(
            req.usuario,
            req.headers.authorization?.split(' ')[1]
        );
        if (!data) return res.json({ ok: false, error: 'Nexus no disponible temporalmente' });
        res.json(data);
    } catch (err) {
        logger.error(`[nexus/mis-analytics] ${err.message}`);
        res.status(500).json({ ok: false, error: 'Error obteniendo analytics' });
    }
});

// GET /nexus/mentor/:id — lee el feedback de Nexus guardado en un item
app.get('/nexus/mentor/:id', verificarToken, async (req, res) => {
    try {
        const item = await Juego.findById(req.params.id).select('nexusMentor usuario title').lean();
        if (!item) return res.status(404).json({ ok: false, error: 'Item no encontrado' });
        if (item.usuario !== req.usuario) return res.status(403).json({ ok: false, error: 'Sin permiso' });
        res.json({ ok: true, mentor: item.nexusMentor || null, title: item.title });
    } catch (err) {
        res.status(500).json({ ok: false, error: 'Error obteniendo mentor' });
    }
});

// POST /admin/nexus/fraud-analyze — análisis de fraude con IA (solo admin)
app.post('/admin/nexus/fraud-analyze', verificarAdmin, async (req, res) => {
    try {
        const { usuario, patrones } = req.body;
        if (!usuario) return res.status(400).json({ ok: false, error: 'usuario requerido' });
        const result = await nexusClient.analyzeFraud(
            usuario,
            patrones || {},
            req.headers['x-admin-token']
        );
        if (!result) return res.json({ ok: false, error: 'Nexus no disponible temporalmente' });
        res.json(result);
    } catch (err) {
        logger.error(`[admin/nexus/fraud-analyze] ${err.message}`);
        res.status(500).json({ ok: false, error: 'Error en análisis de fraude' });
    }
});

// ========== MANEJO DE ERRORES ==========
app.use((req, res) => {
    res.status(404).json({ error: "Endpoint no encontrado" });
});

app.use((err, req, res, next) => {
    logger.error(`Error: ${err?.message || "unknown"}`);
    res.status(500).json({ error: "Error interno del servidor" });
});

// ========== MEJORAS v2 ==========
const rutasMejoras = require('./rutas/rutasMejoras');
rutasMejoras.registrar(app, { verificarToken, verificarAdmin });
// ================================

// ========== INICIAR SERVIDOR ==========
const PORT = config.PORT;
app.listen(PORT, () => {
    logger.info(`SERVIDOR CORRIENDO EN PUERTO ${PORT}`);
    logger.info(`Endpoint: http://localhost:${PORT}`);
    logger.info(`Sistema de Economía: ACTIVO | CPM: $${CPM_VALUE} | Autor: ${AUTHOR_PERCENTAGE * 100}%`);
    logger.info(`Anti-bots: Máx ${MAX_DOWNLOADS_PER_IP_PER_DAY} descargas/IP/día`);
    logger.info(`Detección de fraude: ACTIVA | Auto-lista negra: HABILITADA`);

    mongoose.connection.once('open', () => {
        // Crear índices faltantes al arrancar (idempotente)
        crearIndices().catch(err => logger.warn(`crearIndices: ${err.message}`));
        // Iniciar jobs automáticos
        iniciarJobsAutomaticos();
    });
});
