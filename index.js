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
const config = require('./modulos/config');
const logger = require('./modulos/logger');
const fraudDetector = require('./modulos/fraudDetector.js');

const https = require('https');

// ========================================
// 💳 PAYPAL PAYOUTS API - PAGOS AUTOMÁTICOS
// ========================================

/**
 * Obtiene un access token de PayPal usando Client Credentials
 */
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

/**
 * Envía un pago real vía PayPal Payouts API
 * @param {string} paypalEmail - Email del destinatario
 * @param {number} monto       - Monto en USD
 * @param {string} pagoId      - ID del pago en la BD (trazabilidad)
 * @returns {{ batchId, batchStatus }}
 */
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

// CORS - DOMINIOS PERMITIDOS (desde config centralizado)
const allowedOrigins = config.ALLOWED_ORIGINS;

// Preflight CORS: responder OPTIONS en todas las rutas
app.options('*', cors());

app.use(cors({
    origin: (origin, callback) => {
        // Permitir requests sin origin siempre (GitHub Pages, apps móviles, Postman)
        if (!origin) return callback(null, true);
        if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
            callback(null, true);
        } else {
            callback(new Error(`CORS: Origen no permitido → ${origin}`));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    // x-admin-token es requerido por el panel de administración
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token']
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ========== RATE LIMITING (valores desde config centralizado) ==========
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

// Rate limiter específico para validación de descargas (anti-bots)
const downloadValidationLimiter = rateLimit({
    windowMs: config.RATE_LIMIT.DOWNLOAD_VALIDATION.windowMs,
    max: config.RATE_LIMIT.DOWNLOAD_VALIDATION.max,
    message: { error: "Demasiadas validaciones de descarga. Espera un minuto." },
    skip: () => config.NODE_ENV === 'development'
});

// Aplicar limitadores
app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);
app.use('/items/add', createLimiter);
app.use('/economia/validar-descarga', downloadValidationLimiter);
app.use(generalLimiter);

// ========== SISTEMA DE LOGS (via logger centralizado) ==========
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const isError = res.statusCode >= 400;
        const msg = `[${req.method}] ${req.path} - ${res.statusCode} (${duration}ms)`;
        if (isError) {
            logger.warn(msg);
        } else {
            logger.info(msg);
        }
    });
    next();
});

// ========== CONEXIÓN MONGODB (variables desde config centralizado) ==========
const MONGODB_URI = config.MONGODB_URI;
const JWT_SECRET  = config.JWT_SECRET;

// ── Cloudinary ──
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

// La validación de estas variables ya ocurre en config.js al arrancar.
// Si falta alguna, config.js hace process.exit(1) antes de llegar aquí.

// ── VALIDAR JWT_REFRESH_SECRET independiente en producción ──
if (process.env.NODE_ENV === 'production' && (!JWT_REFRESH_SECRET || JWT_REFRESH_SECRET === JWT_SECRET)) {
    logger.error('❌ JWT_REFRESH_SECRET debe ser un secreto INDEPENDIENTE en producción');
    process.exit(1);
}

// ── APP URL (para links en emails) ──────────────────────────────────
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

// ⭐ SCHEMA: Control de IPs por descarga (TTL de 24 horas) - ANTI-BOTS
const DescargaIPSchema = new mongoose.Schema({
    juegoId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Juego',
        required: true
    },
    ip: { 
        type: String, 
        required: true
    },
    contadorHoy: { 
        type: Number, 
        default: 1 
    },
    fecha: { 
        type: Date, 
        default: Date.now,
        expires: 86400 // TTL: Se auto-elimina después de 24 horas (86400 segundos)
    }
});

// Índice compuesto — cubre búsquedas por juegoId, por ip, y por ambos juntos
DescargaIPSchema.index({ juegoId: 1, ip: 1 });

const DescargaIP = mongoose.model('DescargaIP', DescargaIPSchema);

// ⭐ SCHEMA: Reportes Detallados (NUEVO)
const ReporteSchema = new mongoose.Schema({
    juegoId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Juego',
        required: true,
        index: true
    },
    motivo: {
        type: String,
        enum: ['caido', 'viejo', 'malware'],
        required: true
    },
    usuarioReportante: {
        type: String,
        default: 'Anónimo'
    },
    ip: {
        type: String,
        required: true
    },
    fecha: {
        type: Date,
        default: Date.now,
        index: true
    }
});

// Índice compuesto para prevenir spam
ReporteSchema.index({ juegoId: 1, ip: 1, fecha: -1 });

const Reporte = mongoose.model('Reporte', ReporteSchema);

// ⭐ SCHEMA: Juegos (CON ECONOMÍA COMPLETA)
const JuegoSchema = new mongoose.Schema({
    usuario: { 
        type: String, 
        required: true,
        trim: true,
        default: "Cloud User"
    },
    title: { 
        type: String, 
        required: true,
        maxlength: 200,
        trim: true
    },
    description: { 
        type: String, 
        maxlength: 1000,
        default: ''
    },
    image: { 
        type: String,
        default: ''
    },
    // ⭐ NUEVO: Array de hasta 4 medias adicionales (imágenes o videos de YouTube/MP4)
    images: {
        type: [String],
        default: [],
        validate: {
            validator: function(arr) { return arr.length <= 4; },
            message: 'Máximo 4 medias adicionales permitidas'
        }
    },
    link: { 
        type: String, 
        required: true
    },
    status: { 
        type: String, 
        enum: ["pendiente", "aprobado", "rechazado", "pending"],
        default: "pendiente"
    },
    linkStatus: {
        type: String,
        enum: ["online", "revision", "caido"],
        default: "online"
    },
    reportes: { 
        type: Number, 
        default: 0, 
        min: 0 
    },
    // ⭐ NUEVO: Desglose de motivos de reportes
    reportesDesglose: {
        caido: { type: Number, default: 0 },
        viejo: { type: Number, default: 0 },
        malware: { type: Number, default: 0 }
    },
    category: { 
        type: String, 
        default: "General",
        trim: true
    },
    tags: [String],
    
    // ⭐ CAMPOS ECONÓMICOS
    descargasEfectivas: { 
        type: Number, 
        default: 0,
        min: 0
    },

    // ⭐ LIKES: Cantidad de usuarios que han guardado este item como favorito
    likesCount: {
        type: Number,
        default: 0,
        min: 0
    },
    
    // ⭐ NUEVO: Score de recomendación (calculado automáticamente)
    scoreRecomendacion: {
        type: Number,
        default: 0
    },

    // ⭐ VIDEO: Tipo de video (Tutorial, Gameplay, Review, Showcase, Otro)
    videoType: {
        type: String,
        default: ''
    },

    // ⭐ EXTRA: Campos adicionales por categoría (plataforma, SO, licencia, etc.)
    extraData: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, { 
    timestamps: true,
    strict: false
});

// Todos los índices declarados en un solo lugar (evita duplicados)
JuegoSchema.index({ usuario: 1, status: 1 });
JuegoSchema.index({ createdAt: -1 });
JuegoSchema.index({ linkStatus: 1 });
JuegoSchema.index({ descargasEfectivas: -1 });
JuegoSchema.index({ likesCount: -1 });
JuegoSchema.index({ status: 1 });
JuegoSchema.index({ scoreRecomendacion: -1 }); // ⭐ Índice para ordenamiento rápido

// Middleware para actualizar linkStatus automáticamente
JuegoSchema.pre('save', function(next) {
    if (this.reportes >= 3) {
        this.linkStatus = 'revision';
    }
    next();
});

const Juego = mongoose.model('Juego', JuegoSchema);

// ⭐ SCHEMA: Usuarios (CON ECONOMÍA COMPLETA)
const UsuarioSchema = new mongoose.Schema({
    usuario: { 
        type: String, 
        required: true,
        unique: true,
        index: true,
        minlength: 3,
        maxlength: 20,
        trim: true,
        lowercase: true
    },
    // ⭐ Email (obligatorio para registro y login alternativo)
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true,
        match: [/^\S+@\S+\.\S+$/, 'Email inválido']
    },
    password: { 
        type: String, 
        required: true,
        minlength: 6
    },
    // ⭐ Email de PayPal para pagos
    paypalEmail: {
        type: String,
        default: '',
        lowercase: true,
        trim: true,
        match: [/^(\S+@\S+\.\S+)?$/, 'Email de PayPal inválido']
    },
    // ⭐ Saldo en USD
    saldo: {
        type: Number,
        default: 0,
        min: 0
    },
    // ⭐ Historial de descargas totales de TODOS sus juegos
    descargasTotales: {
        type: Number,
        default: 0,
        min: 0
    },
    // ⭐ Verificación obligatoria para cobrar
    isVerificado: {
        type: Boolean,
        default: false,
        index: true
    },
    // ⭐ Solicitudes de pago pendientes
    solicitudPagoPendiente: {
        type: Boolean,
        default: false
    },
    reputacion: { 
        type: Number, 
        default: 0
    },
    listaSeguidores: [String],
    siguiendo: [String],
    verificadoNivel: { 
        type: Number, 
        default: 0, 
        min: 0, 
        max: 3,
        index: true
    },
    avatar: { 
        type: String, 
        default: ""
    },
    bio: {
        type: String,
        maxlength: 200,
        default: ''
    },
    fecha: { 
        type: Date, 
        default: Date.now 
    },
    // ⭐ IP de registro (capturada al hacer register)
    registrationIP: {
        type: String,
        default: ''
    },
    // ⭐ LISTA NEGRA ADMIN (solo visible en panel de admin)
    listaNegraAdmin: {
        type: Boolean,
        default: false,
        index: true
    },
    // ⭐ Notas privadas de admin sobre el usuario
    notasAdmin: {
        type: String,
        default: '',
        maxlength: 500
    },
    // ⭐ Fecha en que fue agregado a lista negra
    fechaListaNegra: {
        type: Date,
        default: null
    },
    // ⭐ Última vez que el usuario inició sesión (para purga por inactividad)
    ultimoLogin: {
        type: Date,
        default: Date.now,
        index: true
    },
    // ── EMAIL VERIFICACIÓN ──────────────────────────────
    emailVerificado: {
        type: Boolean,
        default: false,
        index: true
    },
    emailVerifToken: {
        type: String,
        default: null
    },
    emailVerifExpires: {
        type: Date,
        default: null
    },
    // ── RECUPERACIÓN DE CONTRASEÑA ──────────────────────
    resetPasswordToken: {
        type: String,
        default: null
    },
    resetPasswordExpires: {
        type: Date,
        default: null
    }
}, { 
    collection: 'usuarios',
    timestamps: true
});

// ⭐ Middleware: Auto-verificar si tiene nivel 1+ (solo si no está verificado)
UsuarioSchema.pre('save', function(next) {
    if (this.verificadoNivel >= 1 && !this.isVerificado) {
        this.isVerificado = true;
    }
    next();
});

const Usuario = mongoose.model('Usuario', UsuarioSchema);

// ⭐ SCHEMA: Historial de Pagos (para admin y transparencia)
const PagoSchema = new mongoose.Schema({
    usuario: {
        type: String,
        required: true,
        index: true
    },
    monto: {
        type: Number,
        required: true,
        min: 0
    },
    paypalEmail: {
        type: String,
        required: true
    },
    estado: {
        type: String,
        enum: ['pendiente', 'procesado', 'completado', 'rechazado'],
        default: 'pendiente',
        index: true
    },
    fecha: {
        type: Date,
        default: Date.now
    },
    notas: {
        type: String,
        default: ''
    }
}, { timestamps: true });

const Pago = mongoose.model('Pago', PagoSchema);

// SCHEMA: Comentarios
const CommentSchema = new mongoose.Schema({
    usuario: String,
    texto: String,
    itemId: String,
    fecha: { type: Date, default: Date.now }
});

const Comentario = mongoose.model('Comentario', CommentSchema);

// SCHEMA: Favoritos
const FavoritosSchema = new mongoose.Schema({
    usuario: String,
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Juego' }
});

const Favorito = mongoose.model('Favoritos', FavoritosSchema);

// ⭐ SCHEMA: Notificaciones de actividad social
const NotificacionSchema = new mongoose.Schema({
    destinatario: { type: String, required: true, index: true }, // usuario que recibe
    tipo: {
        type: String,
        enum: ['nueva_publicacion', 'favorito', 'descarga', 'sistema', 'comentario'],
        required: true
    },
    emisor: { type: String, required: true },         // usuario que publicó
    itemId: { type: String, default: '' },            // _id del item publicado
    itemTitle: { type: String, default: '' },         // título para mostrar
    itemImage: { type: String, default: '' },         // imagen para preview
    leida: { type: Boolean, default: false, index: true },
    fecha: { type: Date, default: Date.now, index: true, expires: 30 * 24 * 60 * 60 } // TTL 30 días
}, { collection: 'notificaciones', timestamps: false });

NotificacionSchema.index({ destinatario: 1, leida: 1, fecha: -1 });
const Notificacion = mongoose.model('Notificacion', NotificacionSchema);

// ========== MIDDLEWARE DE AUTENTICACIÓN JWT ==========
const verificarToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ success: false, error: "Token no proporcionado" });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.usuario = decoded.usuario;
        req.userTokenData = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: "Token inválido o expirado" });
    }
};

// ==========================================
// 🔐 SISTEMA DE AUTENTICACIÓN DEL PANEL ADMIN
// ==========================================

// Sesiones admin en memoria (se limpian al reiniciar el servidor — correcto por diseño)
const adminSessions = new Map(); // adminToken → { createdAt, ip }
const ADMIN_SESSION_DURATION = 8 * 60 * 60 * 1000; // 8 horas en ms

// Limpiar sesiones expiradas cada hora automáticamente
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of adminSessions.entries()) {
        if (now - session.createdAt > ADMIN_SESSION_DURATION) {
            adminSessions.delete(token);
        }
    }
}, 60 * 60 * 1000);

// ══════════════════════════════════════════════════════════════
//  EMAIL VERIFICACIÓN
// ══════════════════════════════════════════════════════════════

/**
 * GET /auth/verify-email/:token
 * El usuario hace clic en el link del email → se activa la cuenta
 * Redirige al frontend con mensaje de éxito o error
 */
app.get('/auth/verify-email/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const usuario = await Usuario.findOne({
            emailVerifToken: token,
            emailVerifExpires: { $gt: new Date() }
        });

        if (!usuario) {
            // Link inválido o expirado — redirigir al frontend con error
            return res.redirect(`${APP_URL}?verif=error`);
        }

        usuario.emailVerificado   = true;
        usuario.emailVerifToken   = null;
        usuario.emailVerifExpires = null;
        await usuario.save();

        logger.info(`Email verificado: @${usuario.usuario}`);
        // Redirigir al frontend con éxito — el frontend muestra mensaje y permite login
        res.redirect(`${APP_URL}?verif=ok&u=${encodeURIComponent(usuario.usuario)}`);
    } catch (err) {
        logger.error(`Error verificando email: ${err.message}`);
        res.redirect(`${APP_URL}?verif=error`);
    }
});

/**
 * POST /auth/resend-verification
 * Reenviar email de verificación si el token expiró
 */
app.post('/auth/resend-verification', [
    body('email').isEmail().normalizeEmail()
], async (req, res) => {
    try {
        const { email } = req.body;
        const usuario = await Usuario.findOne({ email: email.toLowerCase() });

        // Responder siempre OK para no revelar si el email existe
        if (!usuario || usuario.emailVerificado) {
            return res.json({ success: true, mensaje: 'Si el email existe y no está verificado, recibirás el link.' });
        }

        const verifToken = crypto.randomBytes(32).toString('hex');
        usuario.emailVerifToken   = verifToken;
        usuario.emailVerifExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await usuario.save();

        const verifLink = `${API_URL_SELF}/auth/verify-email/${verifToken}`;
        await sendEmail({
            to: email,
            subject: '✅ Verifica tu email en UpGames',
            html: emailVerifTemplate(usuario.usuario, verifLink),
        });

        res.json({ success: true, mensaje: 'Si el email existe y no está verificado, recibirás el link.' });
    } catch (err) {
        logger.error(`Error reenviando verificación: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

// ══════════════════════════════════════════════════════════════
//  RECUPERACIÓN DE CONTRASEÑA
// ══════════════════════════════════════════════════════════════

/**
 * POST /auth/forgot-password
 * El usuario ingresa su email → recibe link de restablecimiento
 */
app.post('/auth/forgot-password', [
    body('email').isEmail().normalizeEmail()
], async (req, res) => {
    try {
        const { email } = req.body;
        const usuario = await Usuario.findOne({ email: email.toLowerCase() });

        // Siempre responder OK (no revelar si el email existe)
        if (!usuario) {
            return res.json({ success: true, mensaje: 'Si el email está registrado, recibirás un link para restablecer tu contraseña.' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        usuario.resetPasswordToken   = resetToken;
        usuario.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h
        await usuario.save();

        const resetLink = `${APP_URL}?reset_token=${resetToken}`;
        await sendEmail({
            to: email,
            subject: '🔑 Restablece tu contraseña de UpGames',
            html: emailResetTemplate(usuario.usuario, resetLink),
        });

        logger.info(`Reset de contraseña solicitado: @${usuario.usuario}`);
        res.json({ success: true, mensaje: 'Si el email está registrado, recibirás un link para restablecer tu contraseña.' });
    } catch (err) {
        logger.error(`Error en forgot-password: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

/**
 * POST /auth/reset-password
 * El usuario abre el link, ingresa nueva contraseña → se actualiza
 */
app.post('/auth/reset-password', [
    body('token').notEmpty(),
    body('password').isLength({ min: 6 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, error: 'Token o contraseña inválidos' });
        }

        const { token, password } = req.body;
        const usuario = await Usuario.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: new Date() }
        });

        if (!usuario) {
            return res.status(400).json({ success: false, error: 'El link es inválido o ya expiró. Solicita uno nuevo.' });
        }

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

// POST /admin/auth/login — El panel envía el JWT_SECRET como PIN
app.post('/admin/auth/login', (req, res) => {
    const { pin } = req.body;
    if (!pin || pin !== JWT_SECRET) {
        logger.warn(`Intento de acceso admin fallido - IP: ${req.ip}`);
        return res.status(401).json({ success: false, error: 'PIN incorrecto' });
    }
    // Token de sesión admin con clave diferente a la de usuarios normales
    const adminToken = jwt.sign(
        { role: 'admin', createdAt: Date.now() },
        JWT_SECRET + '_ADMIN',
        { expiresIn: '8h' }
    );
    adminSessions.set(adminToken, { createdAt: Date.now(), ip: req.ip });
    logger.info(`Sesión admin iniciada - IP: ${req.ip}`);
    res.json({ success: true, adminToken, expiresIn: '8h' });
});

// GET /admin/auth/verify — Ping de keepalive para mantener la sesión activa
app.get('/admin/auth/verify', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (!token || !adminSessions.has(token)) {
        return res.status(401).json({ success: false, error: 'Sesión admin inválida o expirada' });
    }
    const session = adminSessions.get(token);
    if (Date.now() - session.createdAt > ADMIN_SESSION_DURATION) {
        adminSessions.delete(token);
        return res.status(401).json({ success: false, error: 'Sesión expirada' });
    }
    res.json({ success: true, message: 'Sesión activa' });
});

// POST /admin/auth/logout — Cerrar sesión admin explícitamente
app.post('/admin/auth/logout', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token) {
        adminSessions.delete(token);
        logger.info(`Sesión admin cerrada - IP: ${req.ip}`);
    }
    res.json({ success: true, message: 'Sesión cerrada' });
});

// Middleware que protege TODAS las rutas /admin/* (excepto /admin/auth/*)
const verificarAdmin = (req, res, next) => {
    const adminToken = req.headers['x-admin-token'];
    if (!adminToken) {
        return res.status(401).json({ success: false, error: 'Panel admin: token requerido' });
    }
    if (!adminSessions.has(adminToken)) {
        return res.status(401).json({ success: false, error: 'Sesión admin inválida o expirada. Ingresa el PIN.' });
    }
    const session = adminSessions.get(adminToken);
    if (Date.now() - session.createdAt > ADMIN_SESSION_DURATION) {
        adminSessions.delete(adminToken);
        return res.status(401).json({ success: false, error: 'Sesión admin expirada. Ingresa el PIN nuevamente.' });
    }
    next();
};

// ==========================================
// ⭐⭐⭐ RUTAS DE ECONOMÍA (CORAZÓN DEL SISTEMA)
// ==========================================

// ⭐ CONSTANTES DE ECONOMÍA (desde config centralizado)
const CPM_VALUE = config.CPM_VALUE;
const AUTHOR_PERCENTAGE = config.AUTHOR_PERCENTAGE;
const MIN_DOWNLOADS_TO_EARN = config.MIN_DOWNLOADS_TO_EARN;
const MIN_WITHDRAWAL = config.MIN_WITHDRAWAL;
const MAX_DOWNLOADS_PER_IP_PER_DAY = config.MAX_DOWNLOADS_PER_IP_PER_DAY;

// ========== FUNCIONES DE SISTEMA DE RECOMENDACIÓN ==========

/**
 * ⭐ NUEVA FUNCIÓN: Calcular score de recomendación para una publicación
 * Sistema de puntaje:
 * - Nivel 3: 1,000,000 puntos base
 * - Nivel 2: 100,000 puntos base
 * - Nivel 1: 10,000 puntos base
 * - Nivel 0: 0 puntos base
 * + Descargas efectivas
 */
async function calcularScoreRecomendacion(juegoId) {
    try {
        const juego = await Juego.findById(juegoId);
        if (!juego) return;

        const usuario = await Usuario.findOne({ usuario: juego.usuario });
        
        let scoreBase = 0;
        const nivelVerificacion = usuario?.verificadoNivel || 0;
        
        if (nivelVerificacion === 3) scoreBase = 1000000;
        else if (nivelVerificacion === 2) scoreBase = 100000;
        else if (nivelVerificacion === 1) scoreBase = 10000;
        
        const scoreLikes = juego.likesCount || 0;
        const scoreFinal = scoreBase + scoreLikes;
        
        await Juego.findByIdAndUpdate(juegoId, {
            scoreRecomendacion: scoreFinal
        });
        
        logger.info(`Score actualizado - Item: ${juego.title} | Nivel: ${nivelVerificacion} | Likes: ${scoreLikes} | Score: ${scoreFinal}`);
        
    } catch (err) {
        logger.error(`Error calculando score: ${err.message}`);
    }
}

/**
 * ⭐ NUEVA FUNCIÓN: Recalcular scores de todas las publicaciones de un usuario
 * Se usa cuando el nivel de verificación del usuario cambia
 */
async function recalcularScoresUsuario(nombreUsuario) {
    try {
        const juegos = await Juego.find({ usuario: nombreUsuario });
        
        for (const juego of juegos) {
            await calcularScoreRecomendacion(juego._id);
        }
        
        logger.info(`Recalculados ${juegos.length} scores para usuario: ${nombreUsuario}`);
    } catch (err) {
        logger.error(`Error recalculando scores de usuario: ${err.message}`);
    }
}


/**
 * ⭐ ENDPOINT CRÍTICO: Validar descarga efectiva
 * ⚠️ ACTUALIZADO: Ahora incluye detección automática de fraude
 * Este endpoint se llama desde puente.html después de que el usuario espera 30s
 */
app.post('/economia/validar-descarga', [
    body('juegoId').isMongoId(),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                success: false, 
                error: "ID de juego inválido",
                details: errors.array()
            });
        }

        const { juegoId, tieneAdBlocker } = req.body;
        
        // Obtener la IP real del usuario
        const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                    req.headers['x-real-ip'] || 
                    req.connection.remoteAddress || 
                    req.socket.remoteAddress;

        logger.info(`Validación de descarga - Juego: ${juegoId}, IP: ${ip}, AdBlocker: ${tieneAdBlocker ? '⚠️ SÍ' : '✅ NO'}`);

        // Paso 1: Verificar si el juego existe y está aprobado
        const juego = await Juego.findById(juegoId);
        if (!juego) {
            return res.status(404).json({ 
                success: false, 
                error: "Juego no encontrado" 
            });
        }

        if (juego.status !== 'aprobado') {
            return res.status(403).json({ 
                success: false, 
                error: "El juego no está aprobado para descargas" 
            });
        }

        // ⭐ AD BLOCKER: El usuario tiene acceso al link pero NO cuenta como descarga efectiva
        if (tieneAdBlocker === true) {
            logger.info(`Ad Blocker detectado — Juego: ${juegoId}, IP: ${ip} — Descarga NO contabilizada`);
            return res.json({
                success: true,
                descargaContada: false,
                adBlockerDetectado: true,
                link: juego.link,
                mensaje: "Acceso permitido, pero el bloqueador de anuncios impide que la descarga cuente para el autor"
            });
        }

        // Paso 2: Verificar límite de descargas por IP (2 por día)
        let registroIP = await DescargaIP.findOne({ juegoId, ip });
        
        if (registroIP) {
            if (registroIP.contadorHoy >= MAX_DOWNLOADS_PER_IP_PER_DAY) {
                logger.warn(`Límite alcanzado - IP: ${ip}, Juego: ${juegoId}`);
                return res.json({
                    success: true,
                    limiteAlcanzado: true,
                    mensaje: "Has alcanzado el límite de descargas para hoy",
                    link: juego.link
                });
            }
            registroIP.contadorHoy += 1;
            await registroIP.save();
        } else {
            registroIP = new DescargaIP({
                juegoId,
                ip,
                contadorHoy: 1
            });
            await registroIP.save();
        }

        // Paso 3: Incrementar descargas efectivas del juego (atómico, sin cargar middleware pre-save)
        await Juego.findByIdAndUpdate(juegoId, { $inc: { descargasEfectivas: 1 } });
        juego.descargasEfectivas += 1; // Actualizar en memoria
        
        // ⭐ NUEVO: Recalcular score después de incrementar descargas
        await calcularScoreRecomendacion(juegoId);

        // Paso 4: Obtener el autor del juego
        const autor = await Usuario.findOne({ usuario: juego.usuario });
        if (!autor) {
            logger.warn(`Autor no encontrado: ${juego.usuario}`);
            return res.json({
                success: true,
                descargaContada: true,
                link: juego.link,
                mensaje: "Descarga válida"
            });
        }

        // ⚠️ NUEVO: Verificar si el usuario está en lista negra
        if (autor.listaNegraAdmin) {
            logger.warn(`Usuario en lista negra detectado: @${autor.usuario} - Descarga NO contabilizada para ganancia`);
            
            // Incrementar contador de descargas pero NO sumar saldo
            autor.descargasTotales += 1;
            await autor.save();
            
            return res.json({
                success: true,
                descargaContada: true,
                link: juego.link,
                descargasEfectivas: juego.descargasEfectivas,
                mensaje: "Descarga válida",
                warning: "Usuario bajo revisión - ganancia suspendida"
            });
        }

        // Paso 5: Actualizar descargas totales del autor
        autor.descargasTotales += 1;

        // Calcular ganancia potencial
        let gananciaGenerada = 0;
        let shouldAnalyzeFraud = false;

        // Paso 6: Verificar si el juego ya pasó el umbral de 2,000 descargas
        if (juego.descargasEfectivas > MIN_DOWNLOADS_TO_EARN) {
            // Paso 7: Verificar si el autor está verificado (nivel 1+)
            if (autor.isVerificado && autor.verificadoNivel >= 1) {
                // Calcular ganancia
                gananciaGenerada = (CPM_VALUE * AUTHOR_PERCENTAGE) / 1000;
                autor.saldo += gananciaGenerada;
                shouldAnalyzeFraud = true; // Solo analizar fraude si genera ganancia
                
                logger.info(`Ganancia generada - Autor: @${autor.usuario}, +$${gananciaGenerada.toFixed(4)} USD`);
            } else {
                logger.info(`Autor no verificado - @${autor.usuario} - No se suma saldo`);
            }
        } else {
            logger.info(`Juego aún no alcanza 2,000 descargas - Actual: ${juego.descargasEfectivas}`);
        }

        // ⚠️ ANÁLISIS DE FRAUDE: Solo se ejecuta si el juego superó el umbral Y el autor está verificado
        // (cuando shouldAnalyzeFraud = true). En otros casos no tiene sentido registrar en download_tracking.
        if (shouldAnalyzeFraud) {
            const fraudAnalysis = await fraudDetector.analyzeDownloadBehavior(
                autor.usuario,
                juegoId,
                ip,
                gananciaGenerada
            );

            if (fraudAnalysis.suspicious) {
                logger.warn(`COMPORTAMIENTO SOSPECHOSO - @${autor.usuario}:`);
                fraudAnalysis.reasons.forEach(reason => logger.warn(`  - ${reason}`));

                // Si la severidad es crítica o alta, marcar automáticamente
                if (fraudAnalysis.autoFlag) {
                    const flagged = await fraudDetector.autoFlagUser(
                        Usuario,
                        autor.usuario,
                        `Detección automática: ${fraudAnalysis.reasons.join(', ')}`
                    );

                    if (flagged) {
                        // ⚠️ REVERTIR LA GANANCIA DE ESTA DESCARGA
                        autor.saldo -= gananciaGenerada;
                        gananciaGenerada = 0;
                        
                        logger.warn(`Usuario auto-marcado y ganancia revertida: @${autor.usuario}`);
                    }
                }
            }
        }

        await autor.save();

        logger.info(`Descarga efectiva validada - Juego: ${juego.title}, Total: ${juego.descargasEfectivas}`);

        res.json({
            success: true,
            descargaContada: true,
            link: juego.link,
            descargasEfectivas: juego.descargasEfectivas,
            mensaje: "Descarga válida y contada",
            // Metadata del juego para que puente.html notifique a NEXUS con datos completos
            title:    juego.title    || '',
            category: juego.category || '',
            tags:     juego.tags     || [],
            usuario:  juego.usuario  || ''
        });

    } catch (error) {
        logger.error(`Error en validar-descarga: ${error.message}`);
        res.status(500).json({ 
            success: false, 
            error: "Error al validar descarga" 
        });
    }
});

/**
 * ⭐ Solicitar pago (usuario)
 * Requisitos: saldo >= $10, verificado, PayPal configurado
 */
app.post('/economia/solicitar-pago', verificarToken, async (req, res) => {
    try {
        const usuario = await Usuario.findOne({ usuario: req.usuario });
        
        if (!usuario) {
            return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        }

        // Verificar requisitos
        if (!usuario.isVerificado || usuario.verificadoNivel < 1) {
            return res.status(403).json({ 
                success: false, 
                error: "Debes ser verificado (nivel 1+) para solicitar pagos" 
            });
        }

        if (usuario.saldo < MIN_WITHDRAWAL) {
            return res.status(400).json({ 
                success: false, 
                error: `Saldo mínimo para retiro: $${MIN_WITHDRAWAL} USD. Tu saldo: $${usuario.saldo.toFixed(2)}` 
            });
        }

        if (!usuario.paypalEmail || usuario.paypalEmail.trim() === '') {
            return res.status(400).json({ 
                success: false, 
                error: "Debes configurar tu email de PayPal primero" 
            });
        }

        if (usuario.solicitudPagoPendiente) {
            return res.status(400).json({ 
                success: false, 
                error: "Ya tienes una solicitud de pago pendiente" 
            });
        }

        // Verificar que tenga al menos 1 juego con más de 2,000 descargas
        const juegoElegible = await Juego.findOne({
            usuario: usuario.usuario,
            descargasEfectivas: { $gt: MIN_DOWNLOADS_TO_EARN }
        });

        if (!juegoElegible) {
            return res.status(403).json({ 
                success: false, 
                error: `Ninguno de tus juegos ha alcanzado las ${MIN_DOWNLOADS_TO_EARN} descargas necesarias` 
            });
        }

        // Crear solicitud de pago
        const nuevoPago = new Pago({
            usuario: usuario.usuario,
            monto: usuario.saldo,
            paypalEmail: usuario.paypalEmail,
            estado: 'pendiente'
        });
        await nuevoPago.save();

        // Marcar solicitud como pendiente
        usuario.solicitudPagoPendiente = true;
        await usuario.save();

        logger.info(`Solicitud de pago creada - @${usuario.usuario}, Monto: $${usuario.saldo.toFixed(2)}`);

        res.json({
            success: true,
            mensaje: "Solicitud de pago enviada. El administrador la revisará pronto.",
            solicitud: {
                monto: usuario.saldo,
                paypalEmail: usuario.paypalEmail,
                fecha: nuevoPago.fecha
            }
        });

    } catch (error) {
        logger.error(`Error en solicitar-pago: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al procesar solicitud de pago" });
    }
});

/**
 * ⭐ Obtener datos económicos del usuario (para perfil)
 */
app.get('/economia/mi-saldo', verificarToken, async (req, res) => {
    try {
        const usuario = await Usuario.findOne({ usuario: req.usuario })
            .select('saldo descargasTotales paypalEmail isVerificado solicitudPagoPendiente verificadoNivel');

        if (!usuario) {
            return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        }

        // Contar juegos con más de 2,000 descargas
        const juegosElegibles = await Juego.countDocuments({
            usuario: req.usuario,
            descargasEfectivas: { $gt: MIN_DOWNLOADS_TO_EARN }
        });

        const puedeRetirar = usuario.saldo >= MIN_WITHDRAWAL && 
                             usuario.isVerificado && 
                             usuario.verificadoNivel >= 1 &&
                             usuario.paypalEmail &&
                             juegosElegibles > 0 &&
                             !usuario.solicitudPagoPendiente;

        res.json({
            success: true,
            saldo: usuario.saldo,
            descargasTotales: usuario.descargasTotales,
            paypalEmail: usuario.paypalEmail || '',
            isVerificado: usuario.isVerificado,
            verificadoNivel: usuario.verificadoNivel,
            solicitudPagoPendiente: usuario.solicitudPagoPendiente,
            juegosElegibles,
            puedeRetirar,
            minRetiro: MIN_WITHDRAWAL,
            requisitos: {
                saldoMinimo: MIN_WITHDRAWAL,
                verificacionNecesaria: 1,
                descargasMinimas: MIN_DOWNLOADS_TO_EARN
            }
        });

    } catch (error) {
        logger.error(`Error en mi-saldo: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al obtener saldo" });
    }
});

/**
 * ⭐ Actualizar email de PayPal (usuario logueado)
 */
app.put('/economia/actualizar-paypal', [
    verificarToken,
    body('paypalEmail').isEmail().normalizeEmail()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                success: false, 
                error: "Email de PayPal inválido",
                details: errors.array()
            });
        }

        const { paypalEmail } = req.body;

        await Usuario.updateOne(
            { usuario: req.usuario },
            { $set: { paypalEmail: paypalEmail.toLowerCase() } }
        );

        logger.info(`PayPal actualizado - @${req.usuario} → ${paypalEmail}`);

        res.json({ 
            success: true, 
            mensaje: "Email de PayPal actualizado correctamente",
            paypalEmail: paypalEmail.toLowerCase()
        });

    } catch (error) {
        logger.error(`Error en actualizar-paypal: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al actualizar PayPal" });
    }
});

// ⭐ RUTA LEGACY: Mantener compatibilidad con tu código anterior

app.get('/admin/finanzas/solicitudes-pendientes', verificarAdmin, async (req, res) => {
    try {
        const solicitudes = await Pago.find({ estado: 'pendiente' })
            .sort({ fecha: -1 })
            .lean();

        // Enriquecer con datos del usuario
        const solicitudesEnriquecidas = await Promise.all(
            solicitudes.map(async (s) => {
                const usuario = await Usuario.findOne({ usuario: s.usuario })
                    .select('email verificadoNivel isVerificado descargasTotales');
                
                const juegosElegibles = await Juego.countDocuments({
                    usuario: s.usuario,
                    descargasEfectivas: { $gt: MIN_DOWNLOADS_TO_EARN }
                });

                return {
                    ...s,
                    datosUsuario: {
                        email: usuario?.email || '',
                        verificadoNivel: usuario?.verificadoNivel || 0,
                        isVerificado: usuario?.isVerificado || false,
                        descargasTotales: usuario?.descargasTotales || 0,
                        juegosElegibles
                    }
                };
            })
        );

        res.json({
            success: true,
            solicitudes: solicitudesEnriquecidas,
            total: solicitudesEnriquecidas.length
        });

    } catch (error) {
        logger.error(`Error en solicitudes-pendientes: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al cargar solicitudes" });
    }
});

/**
 * ⭐ Procesar pago - ADMIN
 *
 * Si PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET están configurados,
 * el pago se envía automáticamente vía PayPal Payouts API.
 * Si no están configurados, se marca como procesado manualmente.
 */
app.post('/admin/finanzas/procesar-pago/:id', verificarAdmin, [
    param('id').isMongoId(),
    body('notas').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, error: "ID inválido" });
        }

        const { id } = req.params;
        const { notas } = req.body;

        const pago = await Pago.findById(id);
        if (!pago) {
            return res.status(404).json({ success: false, error: "Pago no encontrado" });
        }

        if (pago.estado !== 'pendiente') {
            return res.status(400).json({
                success: false,
                error: "Este pago ya fue procesado"
            });
        }

        const pagoAutomatico = config.FEATURES.ENABLE_AUTO_PAYMENTS;
        let paypalBatchId = null;
        let metodoProcesamiento = 'manual';

        // ── PAGO AUTOMÁTICO VÍA PAYPAL PAYOUTS ──
        if (pagoAutomatico) {
            try {
                const resultado = await enviarPagoPayPal(pago.paypalEmail, pago.monto, id);
                paypalBatchId = resultado.batchId;
                metodoProcesamiento = `paypal_auto (batch: ${paypalBatchId})`;
                logger.info(`PayPal Payout enviado - @${pago.usuario} → ${pago.paypalEmail} | $${pago.monto.toFixed(2)} | Batch: ${paypalBatchId}`);
            } catch (paypalError) {
                // Si PayPal falla, NO procesamos el pago — devolvemos el error al admin
                logger.error(`PayPal Payout falló para @${pago.usuario}: ${paypalError.message}`);
                return res.status(502).json({
                    success: false,
                    error: `El pago no se pudo enviar vía PayPal: ${paypalError.message}`,
                    detalle: 'El saldo del usuario NO fue modificado. Revisa las credenciales de PayPal o procesa manualmente.',
                    paypalEmail: pago.paypalEmail,
                    monto: pago.monto
                });
            }
        }

        // ── ACTUALIZAR BD (solo después de confirmar PayPal o si es manual) ──
        pago.estado = 'completado';
        pago.notas = notas
            || (pagoAutomatico
                ? `Pago automático vía PayPal Payouts el ${new Date().toLocaleString('es-ES')}. Batch ID: ${paypalBatchId}`
                : `Pago procesado manualmente el ${new Date().toLocaleString('es-ES')}`);
        await pago.save();

        const usuario = await Usuario.findOne({ usuario: pago.usuario });
        if (usuario) {
            usuario.saldo = Math.max(0, usuario.saldo - pago.monto);
            usuario.solicitudPagoPendiente = false;
            await usuario.save();
        }

        logger.info(`Pago procesado [${metodoProcesamiento}] - @${pago.usuario}, Monto: $${pago.monto.toFixed(2)}`);

        res.json({
            success: true,
            mensaje: pagoAutomatico
                ? `Pago enviado automáticamente vía PayPal a ${pago.paypalEmail}`
                : "Pago marcado como procesado manualmente",
            metodo: pagoAutomatico ? 'paypal_automatico' : 'manual',
            paypalBatchId: paypalBatchId || null,
            pago: {
                usuario: pago.usuario,
                monto: pago.monto,
                paypalEmail: pago.paypalEmail,
                fecha: pago.fecha
            }
        });

    } catch (error) {
        logger.error(`Error en procesar-pago: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al procesar pago" });
    }
});

/**
 * ⭐ Rechazar pago - ADMIN
 */
app.post('/admin/finanzas/rechazar-pago/:id', verificarAdmin, [
    param('id').isMongoId(),
    body('motivo').optional().trim()
], async (req, res) => {
    try {
        const { id } = req.params;
        const { motivo } = req.body;

        const pago = await Pago.findById(id);
        if (!pago) {
            return res.status(404).json({ success: false, error: "Pago no encontrado" });
        }

        pago.estado = 'rechazado';
        pago.notas = motivo || 'Rechazado por el administrador';
        await pago.save();

        // Quitar flag de solicitud pendiente
        await Usuario.updateOne(
            { usuario: pago.usuario },
            { $set: { solicitudPagoPendiente: false } }
        );

        logger.warn(`Pago rechazado - @${pago.usuario}, Motivo: ${motivo || "Sin motivo"}`);

        res.json({
            success: true,
            mensaje: "Pago rechazado",
            pago: {
                usuario: pago.usuario,
                monto: pago.monto,
                motivo: pago.notas
            }
        });

    } catch (error) {
        logger.error(`Error en rechazar-pago: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al rechazar pago" });
    }
});

/**
 * ⭐ Obtener historial completo de pagos - ADMIN
 */
app.get('/admin/finanzas/historial', verificarAdmin, async (req, res) => {
    try {
        const { estado, usuario, limite = 50 } = req.query;

        const filtro = {};
        if (estado) filtro.estado = estado;
        if (usuario) filtro.usuario = usuario.toLowerCase();

        const historial = await Pago.find(filtro)
            .sort({ fecha: -1 })
            .limit(parseInt(limite))
            .lean();

        res.json({
            success: true,
            historial,
            total: historial.length
        });

    } catch (error) {
        logger.error(`Error en historial: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al cargar historial" });
    }
});

/**
 * ⭐ Estadísticas generales de finanzas - ADMIN
 */
app.get('/admin/finanzas/estadisticas', verificarAdmin, async (req, res) => {
    try {
        const totalSolicitado = await Pago.aggregate([
            { $match: { estado: 'pendiente' } },
            { $group: { _id: null, total: { $sum: '$monto' } } }
        ]);

        const totalPagado = await Pago.aggregate([
            { $match: { estado: 'completado' } },
            { $group: { _id: null, total: { $sum: '$monto' } } }
        ]);

        const totalUsuariosConSaldo = await Usuario.countDocuments({ saldo: { $gt: 0 } });
        const totalUsuariosVerificados = await Usuario.countDocuments({ isVerificado: true });

        res.json({
            success: true,
            estadisticas: {
                solicitudesPendientes: await Pago.countDocuments({ estado: 'pendiente' }),
                totalSolicitado: totalSolicitado[0]?.total || 0,
                totalPagado: totalPagado[0]?.total || 0,
                usuariosConSaldo: totalUsuariosConSaldo,
                usuariosVerificados: totalUsuariosVerificados
            }
        });

    } catch (error) {
        logger.error(`Error en estadísticas: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al cargar estadísticas" });
    }
});

/**
 * ⭐ Obtener juegos en estado "revisión" (linkStatus = "revision") - ADMIN
 */
app.get('/admin/links/en-revision', verificarAdmin, async (req, res) => {
    try {
        const juegosEnRevision = await Juego.find({ linkStatus: 'revision' })
            .sort({ reportes: -1, createdAt: -1 })
            .lean();

        res.json({
            success: true,
            juegos: juegosEnRevision,
            total: juegosEnRevision.length
        });

    } catch (error) {
        logger.error(`Error en links en revisión: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al cargar links en revisión" });
    }
});

/**
 * ⭐ Marcar link como caído - ADMIN
 */
app.put('/admin/links/marcar-caido/:id', verificarAdmin, [
    param('id').isMongoId()
], async (req, res) => {
    try {
        const { id } = req.params;

        const juego = await Juego.findByIdAndUpdate(
            id,
            { $set: { linkStatus: 'caido' } },
            { new: true }
        );

        if (!juego) {
            return res.status(404).json({ success: false, error: "Juego no encontrado" });
        }

        logger.warn(`Link marcado como caído: ${juego.title}`);

        res.json({
            success: true,
            mensaje: "Link marcado como caído. No se mostrará en biblioteca.",
            juego: {
                _id: juego._id,
                title: juego.title,
                linkStatus: juego.linkStatus
            }
        });

    } catch (error) {
        logger.error(`Error: ${error?.message || err?.message || "unknown"}`);
        res.status(500).json({ success: false, error: "Error al marcar link como caído" });
    }
});

// ⭐ RUTA LEGACY: Mantener compatibilidad con verificación de descarga anterior
app.post('/items/verify-download/:id', async (req, res) => {
    try {
        const itemId = req.params.id;
        const userIP = req.ip || req.headers['x-forwarded-for'];

        // Redirigir a la nueva lógica
        return res.json({ 
            success: true, 
            mensaje: "Por favor usa /economia/validar-descarga con el ID en el body",
            deprecado: true
        });

    } catch (error) {
        res.status(500).json({ error: "Error en validación" });
    }
});

// ==========================================
// ⭐ RUTAS DE AUTENTICACIÓN (ACTUALIZADAS CON EMAIL)
// ==========================================

/**
 * ⭐ REGISTRO (AHORA REQUIERE: NOMBRE, EMAIL, CONTRASEÑA)
 */
app.post('/auth/register', [
    body('usuario').trim().isLength({ min: 3, max: 20 }).toLowerCase(),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                success: false, 
                error: "Datos inválidos",
                details: errors.array()
            });
        }

        const { usuario, email, password } = req.body;

        // Capturar IP de registro
        const registrationIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                                req.headers['x-real-ip'] || 
                                req.connection?.remoteAddress || 
                                req.socket?.remoteAddress || '';

        // Verificar si el usuario ya existe
        const existeUsuario = await Usuario.findOne({ usuario: usuario.toLowerCase() });
        if (existeUsuario) {
            return res.status(400).json({ 
                success: false, 
                error: "El nombre de usuario ya está en uso" 
            });
        }

        // Verificar si el email ya existe
        const existeEmail = await Usuario.findOne({ email: email.toLowerCase() });
        if (existeEmail) {
            return res.status(400).json({ 
                success: false, 
                error: "El email ya está registrado" 
            });
        }

        // Hash de contraseña
        const hashedPassword = await bcrypt.hash(password, 10);

        // Crear usuario
        const nuevoUsuario = new Usuario({
            usuario: usuario.toLowerCase(),
            email: email.toLowerCase(),
            password: hashedPassword,
            registrationIP: registrationIP
        });

        // Generar token de verificación de email
        const verifToken = crypto.randomBytes(32).toString('hex');
        nuevoUsuario.emailVerifToken   = verifToken;
        nuevoUsuario.emailVerifExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
        nuevoUsuario.emailVerificado   = false;

        await nuevoUsuario.save();
        logger.info(`Nuevo usuario registrado: @${usuario} (${email})`);

        // Enviar email de verificación (fire & forget — no bloquea el registro)
        const verifLink = `${API_URL_SELF}/auth/verify-email/${verifToken}`;
        sendEmail({
            to: email,
            subject: '✅ Verifica tu email en UpGames',
            html: emailVerifTemplate(usuario, verifLink),
        }).catch(() => {});

        // Generar token de sesión (puede usar la app, pero con emailVerificado=false)
        const token = jwt.sign({ usuario: nuevoUsuario.usuario, email: nuevoUsuario.email }, JWT_SECRET, { expiresIn: '30d' });

        res.status(201).json({
            success: true,
            ok: true,
            token,
            usuario: nuevoUsuario.usuario,
            email: nuevoUsuario.email,
            emailVerificado: false,
            mensaje: 'Cuenta creada. Revisa tu email para verificar tu cuenta.',
            datosUsuario: {
                usuario: nuevoUsuario.usuario,
                email: nuevoUsuario.email,
                verificadoNivel: nuevoUsuario.verificadoNivel,
                isVerificado: nuevoUsuario.isVerificado,
                emailVerificado: false
            }
        });

    } catch (error) {
        logger.error(`Error: ${error?.message || err?.message || "unknown"}`);
        res.status(500).json({ success: false, error: "Error al registrar usuario" });
    }
});

/**
 * ⭐ LOGIN (AHORA ACEPTA NOMBRE DE USUARIO O EMAIL)
 */
app.post('/auth/login', [
    body('usuario').notEmpty(), // Puede ser usuario o email (manteniendo compatibilidad)
    body('password').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                success: false, 
                error: "Datos inválidos" 
            });
        }

        const { usuario: identificador, password } = req.body;

        // Buscar por nombre de usuario O por email
        const usuario = await Usuario.findOne({
            $or: [
                { usuario: identificador.toLowerCase() },
                { email: identificador.toLowerCase() }
            ]
        });

        if (!usuario) {
            return res.status(401).json({ 
                success: false, 
                error: "Usuario o contraseña incorrectos" 
            });
        }

        // Verificar contraseña
        const esValida = await bcrypt.compare(password, usuario.password);
        if (!esValida) {
            return res.status(401).json({ 
                success: false, 
                error: "Usuario o contraseña incorrectos" 
            });
        }

        // Generar token
        const token = jwt.sign({ usuario: usuario.usuario, email: usuario.email }, JWT_SECRET, { expiresIn: '30d' });

        logger.info(`Login exitoso: @${usuario.usuario}`);
        // Registrar fecha de último login (para control de inactividad)
        await Usuario.updateOne(
            { usuario: usuario.usuario },
            { $set: { ultimoLogin: new Date() } }
        );


        res.json({
            success: true,
            ok: true,
            token,
            usuario: usuario.usuario,
            email: usuario.email,
            datosUsuario: {
                usuario: usuario.usuario,
                email: usuario.email,
                verificadoNivel: usuario.verificadoNivel,
                isVerificado: usuario.isVerificado,
                saldo: usuario.saldo
            }
        });

    } catch (error) {
        logger.error(`Error: ${error?.message || err?.message || "unknown"}`);
        res.status(500).json({ success: false, error: "Error al iniciar sesión" });
    }
});

// ==========================================
// ⭐⭐⭐ RUTAS ADMIN DE PODER - DASHBOARD & CONTROL TOTAL
// ==========================================

/**
 * ⭐ DASHBOARD: Métricas globales en tiempo real
 */
app.get('/admin/stats/dashboard', verificarAdmin, async (req, res) => {
    try {
        const ahora = new Date();
        const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
        const semana = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);
        const mes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);

        const [
            totalUsers, usersHoy, usersSemana,
            totalItems, itemsPendientes, itemsAprobados, itemsHoy,
            totalDescargas, descargasHoy,
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
            Juego.aggregate([
                { $match: { status: 'aprobado' } },
                { $group: { _id: '$usuario', totalDescargas: { $sum: '$descargasEfectivas' }, totalItems: { $sum: 1 } } },
                { $sort: { totalDescargas: -1 } },
                { $limit: 5 }
            ]),
            Usuario.countDocuments({ listaNegraAdmin: true }),
            Juego.find({ status: 'aprobado' }).sort({ likesCount: -1 }).limit(5).select('title usuario likesCount descargasEfectivas').lean()
        ]);

        res.json({
            success: true,
            dashboard: {
                usuarios: {
                    total: totalUsers,
                    hoy: usersHoy,
                    semana: usersSemana,
                    listaNegra: usuariosListaNegra
                },
                items: {
                    total: totalItems,
                    pendientes: itemsPendientes,
                    aprobados: itemsAprobados,
                    hoy: itemsHoy
                },
                descargas: {
                    total: totalDescargas[0]?.total || 0,
                    hoy: descargasHoy
                },
                finanzas: {
                    saldoEnCirculacion: parseFloat((saldoTotal[0]?.total || 0).toFixed(2)),
                    pendienteDePago: parseFloat((saldoPendientePago[0]?.total || 0).toFixed(2))
                },
                comentarios: {
                    total: totalComentarios,
                    hoy: comentariosHoy
                },
                topUploaders,
                itemsMasDescargados
            }
        });
    } catch (error) {
        logger.error(`Error: ${error?.message || err?.message || "unknown"}`);
        res.status(500).json({ success: false, error: "Error al cargar dashboard" });
    }
});

/**
 * ⭐ ADMIN: Ajustar saldo de usuario manualmente
 */
app.put('/admin/users/ajustar-saldo/:id', verificarAdmin, [
    param('id').isMongoId(),
    body('saldo').isFloat({ min: 0 }),
    body('motivo').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Datos inválidos" });

        const { saldo, motivo } = req.body;
        const user = await Usuario.findByIdAndUpdate(
            req.params.id,
            { $set: { saldo: parseFloat(saldo) } },
            { new: true }
        ).select('-password');

        if (!user) return res.status(404).json({ success: false, error: "Usuario no encontrado" });

        logger.info(`ADMIN: Saldo ajustado @${user.usuario} → $${saldo} (${motivo || 'Sin motivo'})`);
        res.json({ success: true, usuario: user.usuario, nuevoSaldo: user.saldo });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al ajustar saldo" });
    }
});

/**
 * ⭐ ADMIN: Aprobar/Rechazar items en lote
 */
app.put('/admin/items/bulk-action', verificarAdmin, [
    body('ids').isArray({ min: 1 }),
    body('action').isIn(['aprobar', 'rechazar', 'eliminar', 'online', 'caido'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: "Datos inválidos" });

        const { ids, action } = req.body;
        let resultado;

        if (action === 'aprobar') {
            resultado = await Juego.updateMany(
                { _id: { $in: ids } },
                { $set: { status: 'aprobado' } }
            );
        } else if (action === 'rechazar') {
            resultado = await Juego.updateMany(
                { _id: { $in: ids } },
                { $set: { status: 'rechazado' } }
            );
        } else if (action === 'eliminar') {
            resultado = await Juego.deleteMany({ _id: { $in: ids } });
        } else if (action === 'online') {
            resultado = await Juego.updateMany(
                { _id: { $in: ids } },
                { $set: { linkStatus: 'online', reportes: 0 } }
            );
        } else if (action === 'caido') {
            resultado = await Juego.updateMany(
                { _id: { $in: ids } },
                { $set: { linkStatus: 'caido' } }
            );
        }

        const afectados = resultado?.modifiedCount || resultado?.deletedCount || 0;
        logger.info(`ADMIN BULK: ${action} en ${afectados} items`);
        res.json({ success: true, afectados, action });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error en acción en lote" });
    }
});

/**
 * ⭐ ADMIN: Rechazar pago desde panel
 */
app.post('/admin/finanzas/rechazar-pago-admin/:id', verificarAdmin, [
    param('id').isMongoId(),
    body('motivo').optional().trim()
], async (req, res) => {
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

/**
 * ⭐ ADMIN: Historial completo de pagos (pendientes + completados + rechazados)
 */
app.get('/admin/finanzas/historial-completo', verificarAdmin, async (req, res) => {
    try {
        const { estado, limite = 100 } = req.query;
        const filtro = estado ? { estado } : {};
        const historial = await Pago.find(filtro)
            .sort({ fecha: -1 })
            .limit(parseInt(limite))
            .lean();
        res.json({ success: true, historial, total: historial.length });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al cargar historial" });
    }
});

/**
 * ⭐ ADMIN: Top usuarios por saldo / descargas
 */
app.get('/admin/stats/top-usuarios', verificarAdmin, async (req, res) => {
    try {
        const { por = 'saldo', limite = 10 } = req.query;
        const sortField = por === 'descargas' ? { descargasTotales: -1 } : { saldo: -1 };
        
        const users = await Usuario.find({ [por === 'descargas' ? 'descargasTotales' : 'saldo']: { $gt: 0 } })
            .sort(sortField)
            .limit(parseInt(limite))
            .select('usuario email saldo descargasTotales verificadoNivel paypalEmail')
            .lean();

        res.json({ success: true, users, criterio: por });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al cargar top usuarios" });
    }
});

/**
 * ⭐ ADMIN: Eliminar TODOS los items de un usuario
 */
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

/**
 * ⭐ ADMIN: Resetear saldo a 0 (sanción financiera)
 */
app.put('/admin/users/:id/reset-saldo', verificarAdmin, [param('id').isMongoId()], async (req, res) => {
    try {
        const user = await Usuario.findByIdAndUpdate(
            req.params.id,
            { $set: { saldo: 0, solicitudPagoPendiente: false } },
            { new: true }
        ).select('usuario saldo');

        if (!user) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        logger.info(`ADMIN: Saldo reseteado a 0 para @${user.usuario}`);
        res.json({ success: true, usuario: user.usuario });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al resetear saldo" });
    }
});

// ==========================================
// RUTAS ORIGINALES DE ADMIN (MANTENER)
// ==========================================

app.get('/admin/payments-pending', verificarAdmin, async (req, res) => {
    try {
        const usuariosParaPagar = await Usuario.find({
            saldo: { $gte: 10 },
            isVerificado: true,
            verificadoNivel: { $gte: 1 }
        }).select('usuario email paypalEmail saldo descargasTotales verificadoNivel');
        
        res.json(usuariosParaPagar);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener pagos" });
    }
});

app.put("/admin/items/:id", verificarAdmin, [
    param('id').isMongoId(),
    body('title').optional().trim().isLength({ max: 200 }),
    body('description').optional().trim().isLength({ max: 1000 }),
    body('link').optional().trim(),
    body('image').optional().trim(),
    body('images').optional().isArray({ max: 4 }),
    body('category').optional().trim(),
    body('status').optional().isIn(['pendiente', 'aprobado', 'rechazado', 'pending']),
    body('linkStatus').optional().isIn(['online', 'revision', 'caido']),
    body('reportes').optional().isInt({ min: 0 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                success: false, 
                error: "Datos inválidos",
                details: errors.array()
            });
        }

        const updates = {};
        const allowedFields = ['title', 'description', 'link', 'image', 'images', 'category', 'status', 'linkStatus', 'reportes'];
        
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        });

        const item = await Juego.findByIdAndUpdate(
            req.params.id,
            { $set: updates },
            { new: true, runValidators: true }
        );

        if (!item) {
            return res.status(404).json({ success: false, error: "Item no encontrado" });
        }

        logger.info(`ADMIN: Item ${item._id} actualizado`);
        res.json({ success: true, item });
    } catch (error) {
        logger.error(`Error: ${error?.message || err?.message || "unknown"}`);
        res.status(500).json({ success: false, error: "Error al actualizar item" });
    }
});

app.get("/admin/items", verificarAdmin, async (req, res) => {
    try {
        const items = await Juego.find()
            .sort({ createdAt: -1 })
            .lean();
        
        const itemsWithInfo = items.map(item => ({
            ...item,
            diasDesdeCreacion: Math.floor((Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
            necesitaRevision: item.reportes >= 3 || item.linkStatus === 'revision'
        }));

        res.json({
            success: true,
            count: items.length,
            items: itemsWithInfo
        });
    } catch (error) {
        logger.error(`Error: ${error?.message || err?.message || "unknown"}`);
        res.status(500).json({ success: false, error: "Error al obtener items" });
    }
});

app.put("/admin/items/:id/reset-reports", verificarAdmin, [
    param('id').isMongoId()
], async (req, res) => {
    try {
        const item = await Juego.findByIdAndUpdate(
            req.params.id,
            { 
                $set: { 
                    reportes: 0,
                    linkStatus: 'online'
                }
            },
            { new: true }
        );

        if (!item) {
            return res.status(404).json({ success: false, error: "Item no encontrado" });
        }

        logger.info(`ADMIN: Reportes reseteados para ${item.title}`);
        res.json({ success: true, item });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al resetear reportes" });
    }
});

app.put("/admin/items/:id/link-status", verificarAdmin, [
    param('id').isMongoId(),
    body('linkStatus').isIn(['online', 'revision', 'caido'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, error: "Estado inválido" });
        }

        const item = await Juego.findByIdAndUpdate(
            req.params.id,
            { $set: { linkStatus: req.body.linkStatus } },
            { new: true }
        );

        if (!item) {
            return res.status(404).json({ success: false, error: "Item no encontrado" });
        }

        logger.info(`ADMIN: Link status cambiado a ${req.body.linkStatus} para ${item.title}`);
        res.json({ success: true, item });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al actualizar estado del link" });
    }
});

// ── REGISTRAR VISTA DE VIDEO ─────────────────────────────
// Llamado desde el frontend tras 60 seg de permanencia en un video.
// Incrementa descargasEfectivas SIN generar earnings al autor.
app.put('/items/download/:id', [param('id').isMongoId()], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'ID inválido' });

        const { tipo } = req.body;
        if (tipo !== 'vista') return res.status(400).json({ success: false, error: 'Tipo inválido' });

        const juego = await Juego.findByIdAndUpdate(
            req.params.id,
            { $inc: { descargasEfectivas: 1 } },
            { new: true, select: 'descargasEfectivas likesCount' }
        );
        if (!juego) return res.status(404).json({ success: false, error: 'Item no encontrado' });

        logger.info(`Vista registrada — ID: ${req.params.id}, Total: ${juego.descargasEfectivas}`);
        res.json({ success: true, descargasEfectivas: juego.descargasEfectivas });
    } catch (error) {
        logger.error(`Error registrando vista: ${error.message}`);
        res.status(500).json({ success: false });
    }
});

app.put("/items/report/:id", [
    param('id').isMongoId(),
    body('motivo').isIn(['caido', 'viejo', 'malware'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                success: false, 
                error: "Datos inválidos" 
            });
        }

        const { motivo } = req.body;
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
        const usuarioReportante = req.body.usuario || 'Anónimo';

        // Verificar si esta IP ya reportó en las últimas 24h
        const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const reporteExistente = await Reporte.findOne({
            juegoId: req.params.id,
            ip: ip,
            fecha: { $gte: hace24h }
        });

        if (reporteExistente) {
            return res.status(429).json({ 
                success: false, 
                error: "Ya reportaste este contenido. Espera 24h." 
            });
        }

        // Crear reporte detallado
        const nuevoReporte = new Reporte({
            juegoId: req.params.id,
            motivo: motivo,
            usuarioReportante: usuarioReportante,
            ip: ip
        });
        await nuevoReporte.save();

        // Actualizar contador y desglose
        const juego = await Juego.findByIdAndUpdate(
            req.params.id, 
            { 
                $inc: { 
                    reportes: 1,
                    [`reportesDesglose.${motivo}`]: 1
                }
            },
            { new: true }
        );

        if (!juego) {
            return res.status(404).json({ success: false, error: "Item no encontrado" });
        }

        // Auto-cambiar a revisión con 5 reportes
        if (juego.reportes >= 5 && juego.linkStatus !== 'revision') {
            juego.linkStatus = 'revision';
            await juego.save();
        }
        
        logger.info(`Reporte #${juego.reportes} (${motivo}) para: ${juego.title}`);
        
        res.json({ 
            success: true,
            ok: true, 
            reportes: juego.reportes,
            linkStatus: juego.linkStatus,
            motivoReportado: motivo
        });
    } catch (error) { 
        logger.error(`Error: ${error?.message || err?.message || "unknown"}`);
        res.status(500).json({ 
            success: false,
            error: "Error al reportar" 
        }); 
    }
});

// ⭐ NUEVA RUTA: Obtener reportes detallados de un juego (Admin y Autor)
app.get("/items/reportes/:id", async (req, res) => {
    try {
        const juego = await Juego.findById(req.params.id)
            .select('reportes reportesDesglose linkStatus usuario title');
        
        if (!juego) {
            return res.status(404).json({ success: false, error: "Juego no encontrado" });
        }

        const reportesDetallados = await Reporte.find({ juegoId: req.params.id })
            .sort({ fecha: -1 })
            .limit(100)
            .select('motivo usuarioReportante fecha')
            .lean();

        res.json({
            success: true,
            juego: {
                id: juego._id,
                title: juego.title,
                autor: juego.usuario,
                reportesTotales: juego.reportes,
                linkStatus: juego.linkStatus,
                desglose: juego.reportesDesglose || { caido: 0, viejo: 0, malware: 0 }
            },
            reportes: reportesDetallados
        });
    } catch (error) {
        logger.error(`Error: ${error?.message || err?.message || "unknown"}`);
        res.status(500).json({ success: false, error: "Error al obtener reportes" });
    }
});

// ⭐ NUEVA RUTA: Publicaciones con reportes de un autor
app.get("/items/mis-reportes/:usuario", async (req, res) => {
    try {
        const juegosConReportes = await Juego.find({
            usuario: req.params.usuario,
            reportes: { $gt: 0 }
        })
        .select('_id title reportes reportesDesglose linkStatus image createdAt')
        .sort({ reportes: -1 })
        .lean();

        res.json({
            success: true,
            publicaciones: juegosConReportes
        });
    } catch (error) {
        logger.error(`Error: ${error?.message || err?.message || "unknown"}`);
        res.status(500).json({ success: false, error: "Error" });
    }
});


// ==========================================
// RUTAS DE JUEGOS (CON FILTRO DE LINKS CAÍDOS)
// ==========================================

app.get("/items", async (req, res) => {
    try {
        const { categoria } = req.query;
        const filtro = { 
            status: 'aprobado',
            // ⭐ CORREGIDO: Solo ocultar links caídos, permitir "en revisión" y "online"
            linkStatus: { $in: ['online', 'revision'] }
        };
        
        if (categoria && categoria !== 'Todo') {
            filtro.category = categoria;
        }

        const items = await Juego.find(filtro)
            .select('_id title description image images link category usuario reportes linkStatus descargasEfectivas likesCount extraData videoType scoreRecomendacion')
            .sort({ scoreRecomendacion: -1, createdAt: -1 }) // Ordenar por score (verificación+likes) luego fecha
            .limit(100)
            .lean();

        res.json(items);
    } catch (error) {
        res.status(500).json([]);
    }
});

app.get("/items/user/:usuario", async (req, res) => {
    try {
        const aportes = await Juego.find({ 
            usuario: req.params.usuario 
        })
            .select('_id title description image images link category usuario reportes reportesDesglose linkStatus descargasEfectivas likesCount status createdAt scoreRecomendacion extraData videoType')
            .sort({ scoreRecomendacion: -1, createdAt: -1 })
            .lean();
        res.json(aportes);
    } catch (error) { 
        res.status(500).json([]); 
    }
});

app.post("/items/add", [
    verificarToken,
    body('title').notEmpty().trim().isLength({ max: 200 }),
    body('link').notEmpty().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                success: false, 
                error: "Datos inválidos" 
            });
        }

        // Usar el usuario del token — no confiar en el body
        const nuevoJuego = new Juego({ 
            ...req.body,
            usuario: req.usuario,  // sobreescribir con el token
            status: "aprobado",    // Auto-aprobado — visible de inmediato
            linkStatus: "revision" // En revisión hasta confirmar que el link funciona
        });
        
        await nuevoJuego.save();
        
        // ⭐ Calcular score inicial
        await calcularScoreRecomendacion(nuevoJuego._id);

        // ⭐ NOTIFICACIONES: avisar a todos los seguidores del autor
        try {
            const autorData = await Usuario.findOne({ usuario: nuevoJuego.usuario })
                .select('listaSeguidores').lean();
            const seguidores = autorData?.listaSeguidores || [];
            if (seguidores.length > 0) {
                const notifs = seguidores.map(seg => ({
                    destinatario: seg,
                    tipo: 'nueva_publicacion',
                    emisor: nuevoJuego.usuario,
                    itemId: nuevoJuego._id.toString(),
                    itemTitle: nuevoJuego.title,
                    itemImage: nuevoJuego.image || '',
                    leida: false,
                    fecha: new Date()
                }));
                await Notificacion.insertMany(notifs, { ordered: false });
                logger.info(`Notificaciones enviadas a ${seguidores.length} seguidores de @${nuevoJuego.usuario}`);
            }
        } catch (notifErr) {
            logger.error(`Error enviando notificaciones: ${notifErr.message}`);
        }
        
        logger.info(`Nuevo item agregado: ${nuevoJuego.title} por @${nuevoJuego.usuario}`);
        
        res.status(201).json({ 
            success: true,
            ok: true,
            item: nuevoJuego,
            id: nuevoJuego._id
        });
    } catch (error) { 
        logger.error(`Error: ${error?.message || err?.message || "unknown"}`);
        res.status(500).json({ 
            success: false,
            error: "Error al guardar aporte" 
        }); 
    }
});

// ⭐ Editar publicación propia (solo el dueño, con token de usuario)
app.put("/items/:id", verificarToken, [
    param('id').isMongoId(),
    body('title').optional().trim().isLength({ min: 1, max: 200 }),
    body('description').optional().trim().isLength({ max: 1000 }),
    body('link').optional().trim(),
    body('image').optional().trim(),
    body('images').optional().isArray({ max: 4 }),
    body('category').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, error: "Datos inválidos", details: errors.array() });
        }

        // Verificar que el item existe y que pertenece al usuario que hace la petición
        const item = await Juego.findById(req.params.id);
        if (!item) {
            return res.status(404).json({ success: false, error: "Publicación no encontrada" });
        }
        if (item.usuario !== req.usuario) {
            return res.status(403).json({ success: false, error: "No tienes permiso para editar esta publicación" });
        }

        // Solo se permiten editar estos campos — nunca status, linkStatus ni reportes
        const allowedFields = ['title', 'description', 'link', 'image', 'images', 'category', 'videoType'];
        const updates = {};
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) updates[field] = req.body[field];
        });

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, error: "No se enviaron campos para actualizar" });
        }

        const updated = await Juego.findByIdAndUpdate(
            req.params.id,
            { $set: updates },
            { new: true, runValidators: true }
        );

        logger.info(`Usuario @${req.usuario} editó su publicación: ${updated.title}`);
        res.json({ success: true, item: updated });

    } catch (error) {
        logger.error(`Error: ${error?.message || err?.message || "unknown"}`);
        res.status(500).json({ success: false, error: "Error al actualizar publicación" });
    }
});

app.put("/items/approve/:id", verificarAdmin, [
    param('id').isMongoId()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                success: false, 
                error: "ID inválido" 
            });
        }

        await Juego.findByIdAndUpdate(
            req.params.id, 
            { $set: { status: "aprobado" } }
        );
        
        res.json({ success: true, ok: true });
    } catch (error) { 
        res.status(500).json({ 
            success: false,
            error: "Error de aprobación" 
        }); 
    }
});

// ── DELETE /items/:id/video — elimina video + Cloudinary ──
app.delete("/items/:id/video", verificarToken, [
    param('id').isMongoId()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success:false, error:"ID inválido" });
        const item = await Juego.findById(req.params.id);
        if (!item) return res.status(404).json({ success:false, error:"Video no encontrado" });
        if (item.usuario !== req.usuario) return res.status(403).json({ success:false, error:"Sin permiso" });
        if (item.link && item.link.includes("cloudinary.com")) {
            try {
                const parts = item.link.split("/");
                const idx = parts.indexOf("upload");
                if (idx !== -1) {
                    let pub = parts.slice(idx + 1).join("/");
                    pub = pub.replace(/^v\d+\//, "");
                    pub = pub.replace(/\.[^.]+$/, "");
                    await cloudinary.uploader.destroy(pub, { resource_type: "video" });
                    logger.info("Cloudinary video eliminado: " + pub);
                }
            } catch(cldErr) {
                logger.error("Cloudinary delete error: " + cldErr.message);
            }
        }
        await Juego.findByIdAndDelete(req.params.id);
        logger.info("Video eliminado: \"" + item.title + "\" por @" + req.usuario);
        res.json({ success:true, ok:true });
    } catch (error) {
        logger.error("Error al eliminar video: " + error.message);
        res.status(500).json({ success:false, error:"Error al eliminar video" });
    }
});

app.delete("/items/:id", [
    param('id').isMongoId()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, error: "ID inválido" });
        }

        const item = await Juego.findById(req.params.id);
        if (!item) {
            return res.status(404).json({ success: false, error: "Publicación no encontrada" });
        }

        const adminToken = req.headers['x-admin-token'];
        const bearerToken = req.headers.authorization?.split(' ')[1];

        if (adminToken) {
            if (!adminSessions.has(adminToken)) {
                return res.status(401).json({ success: false, error: "Sesión admin inválida" });
            }
            const session = adminSessions.get(adminToken);
            if (Date.now() - session.createdAt > ADMIN_SESSION_DURATION) {
                adminSessions.delete(adminToken);
                return res.status(401).json({ success: false, error: "Sesión admin expirada" });
            }
            await Juego.findByIdAndDelete(req.params.id);
            logger.info(`ADMIN eliminó publicación: ${item.title}`);
            return res.json({ success: true, ok: true });

        } else if (bearerToken) {
            try {
                const decoded = jwt.verify(bearerToken, JWT_SECRET);
                if (item.usuario !== decoded.usuario) {
                    return res.status(403).json({ success: false, error: "No tienes permiso para eliminar esta publicación" });
                }
                await Juego.findByIdAndDelete(req.params.id);
                logger.info(`Usuario @${decoded.usuario} eliminó su publicación: ${item.title}`);
                return res.json({ success: true, ok: true });
            } catch {
                return res.status(401).json({ success: false, error: "Token inválido o expirado" });
            }

        } else {
            return res.status(401).json({ success: false, error: "Se requiere autenticación para eliminar" });
        }

    } catch (error) {
        res.status(500).json({ success: false, error: "Error al eliminar" });
    }
});

/**
 * ⭐ GET /items/recomendados/:usuario
 * Devuelve juegos recomendados para un usuario basándose en su perfil de gustos.
 * NEXUS llama a este endpoint para obtener recomendaciones reales de la BD.
 *
 * Query params:
 *   - categorias  : CSV de categorías con peso  "action:3,survival:2"
 *   - tags        : CSV de tags de interés        "zombies,rpg,pixel"
 *   - excluir     : CSV de IDs ya vistos/descargados
 *   - limite      : número de resultados (default 12, max 30)
 */
app.get('/items/recomendados/:usuario', async (req, res) => {
    try {
        const { usuario } = req.params;
        const { categorias = '', tags = '', excluir = '', limite = '12' } = req.query;

        const lim = Math.min(parseInt(limite) || 12, 30);

        // Construir query base: solo juegos aprobados y con link activo
        const query = {
            status: 'aprobado',
            linkStatus: { $ne: 'caido' }
        };

        // Excluir items que el usuario ya descargó o vio
        const excluirIds = excluir
            ? excluir.split(',').filter(id => id.match(/^[a-f\d]{24}$/i))
            : [];
        if (excluirIds.length > 0) {
            query._id = { $nin: excluirIds };
        }

        // Parsear categorías con peso: "action:3,survival:2" → [{ cat, peso }]
        const catPesos = categorias
            ? categorias.split(',').map(c => {
                const [cat, peso] = c.split(':');
                return { cat: cat?.trim(), peso: parseInt(peso) || 1 };
              }).filter(c => c.cat)
            : [];

        // Parsear tags de interés
        const tagList = tags
            ? tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
            : [];

        // Si hay preferencias, filtrar por categorías o tags de interés
        if (catPesos.length > 0 || tagList.length > 0) {
            const orClauses = [];
            if (catPesos.length > 0) {
                orClauses.push({ category: { $in: catPesos.map(c => c.cat) } });
            }
            if (tagList.length > 0) {
                orClauses.push({ tags: { $in: tagList } });
            }
            query.$or = orClauses;
        }

        // Obtener candidatos ordenados por score de recomendación
        let items = await Juego.find(query)
            .sort({ scoreRecomendacion: -1, likesCount: -1 })
            .limit(lim * 3) // traer más para poder ponderar
            .lean();

        // Ponderar por categoría si hay pesos definidos
        if (catPesos.length > 0) {
            const pesoMap = {};
            catPesos.forEach(({ cat, peso }) => { pesoMap[cat] = peso; });

            items = items.map(item => ({
                ...item,
                _recoScore: (item.scoreRecomendacion || 0) +
                            (pesoMap[item.category] || 0) * 10 +
                            (tagList.some(t => item.tags?.includes(t)) ? 5 : 0)
            }));
            items.sort((a, b) => b._recoScore - a._recoScore);
        }

        const resultado = items.slice(0, lim).map(item => ({
            _id:                 item._id,
            title:               item.title,
            description:         item.description,
            image:               item.image,
            category:            item.category,
            tags:                item.tags || [],
            descargasEfectivas:  item.descargasEfectivas || 0,
            scoreRecomendacion:  item.scoreRecomendacion || 0,
            usuario:             item.usuario,
            linkStatus:          item.linkStatus
        }));

        res.json({
            success: true,
            usuario,
            total: resultado.length,
            items: resultado
        });

    } catch (error) {
        logger.error(`Error: ${error?.message || err?.message || "unknown"}`);
        res.status(500).json({ success: false, error: 'Error al obtener recomendaciones' });
    }
});

app.get('/items/:id', async (req, res) => {
    try {
        const item = await Juego.findById(req.params.id).lean();
        if (!item) {
            return res.status(404).json({ success: false, error: "Item no encontrado" });
        }
        res.json(item);
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al cargar item" });
    }
});



// ==========================================
// RUTAS DE USUARIOS
// ==========================================

// Ruta pública acotada — solo los campos que el frontend necesita para badges y perfiles
// Nunca expone emails, PayPal, notas admin, lista negra ni datos sensibles
app.get('/auth/users/public', async (req, res) => {
    try {
        const users = await Usuario.find()
            .select('usuario verificadoNivel avatar bio listaSeguidores siguiendo')
            .lean();
        res.json(users);
    } catch (error) {
        res.status(500).json([]);
    }
});

// Ruta completa — solo para el panel admin
app.get('/auth/users', verificarAdmin, async (req, res) => {
    try {
        const users = await Usuario.find()
            .select('-password')
            .sort({ fecha: -1 })
            .lean();
        res.json(users);
    } catch (error) {
        res.status(500).json([]);
    }
});

// ⭐ ADMIN: Obtener datos completos de un usuario (para panel admin)
app.get('/admin/users/detalle/:id', verificarAdmin, async (req, res) => {
    try {
        const user = await Usuario.findById(req.params.id)
            .select('-password')
            .lean();
        
        if (!user) {
            return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        }

        // Obtener juegos del usuario
        const juegos = await Juego.find({ usuario: user.usuario })
            .select('title status descargasEfectivas likesCount linkStatus createdAt')
            .lean();

        res.json({ success: true, user, juegos });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al obtener datos" });
    }
});

// ⭐ ADMIN: Toggle lista negra
app.put('/admin/users/lista-negra/:id', verificarAdmin, [
    body('listaNegraAdmin').isBoolean(),
    body('notasAdmin').optional().trim().isLength({ max: 500 })
], async (req, res) => {
    try {
        const { listaNegraAdmin, notasAdmin } = req.body;

        const updates = { 
            listaNegraAdmin: !!listaNegraAdmin,
            fechaListaNegra: listaNegraAdmin ? new Date() : null
        };
        if (notasAdmin !== undefined) updates.notasAdmin = notasAdmin;

        const user = await Usuario.findByIdAndUpdate(
            req.params.id,
            { $set: updates },
            { new: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        }

        logger.warn(`Lista negra actualizada: @${user.usuario} → ${listaNegraAdmin}`);
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al actualizar lista negra" });
    }
});

// ⭐ ADMIN: Actualizar notas del admin sobre un usuario
app.put('/admin/users/notas/:id', verificarAdmin, [
    body('notasAdmin').trim().isLength({ max: 500 })
], async (req, res) => {
    try {
        const { notasAdmin } = req.body;
        const user = await Usuario.findByIdAndUpdate(
            req.params.id,
            { $set: { notasAdmin } },
            { new: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        }

        res.json({ success: true, mensaje: "Notas actualizadas" });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al guardar notas" });
    }
});

// ⭐ ADMIN: Obtener solo usuarios en lista negra
app.get('/admin/users/lista-negra', verificarAdmin, async (req, res) => {
    try {
        const users = await Usuario.find({ listaNegraAdmin: true })
            .select('-password')
            .sort({ fechaListaNegra: -1 })
            .lean();
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

app.put('/auth/admin/verificacion/:username', verificarAdmin, [
    body('nivel').isInt({ min: 0, max: 3 })
], async (req, res) => {
    try {
        const { username } = req.params;
        const { nivel } = req.body;

        const user = await Usuario.findOneAndUpdate(
            { usuario: username.toLowerCase() },
            { $set: { verificadoNivel: nivel } },
            { new: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        }

        logger.info(`Verificación actualizada: @${username} → Nivel ${nivel}`);
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al actualizar verificación" });
    }
});

// ========== RUTAS DE PERFIL ==========
app.get('/usuarios/perfil-publico/:usuario', async (req, res) => {
    try {
        const username = req.params.usuario.toLowerCase().trim();
        const user = await Usuario.findOne({ usuario: username }).select('-password -paypalEmail').lean();

        if (!user) {
            return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        }

        const publicaciones = await Juego.countDocuments({ 
            usuario: user.usuario, 
            status: 'aprobado' 
        });

        res.json({
            success: true,
            usuario: {
                ...user,
                publicaciones,
                seguidores: user.listaSeguidores ? user.listaSeguidores.length : 0,
                siguiendo: user.siguiendo ? user.siguiendo.length : 0
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "Error al cargar perfil" });
    }
});

app.get('/usuarios/verifica-seguimiento/:actual/:viendo', async (req, res) => {
    try {
        const actual = req.params.actual.toLowerCase().trim();
        const viendo = req.params.viendo.toLowerCase().trim();
        const user = await Usuario.findOne({ usuario: actual });
        const loSigo = user?.siguiendo?.includes(viendo);
        res.json({ estaSiguiendo: !!loSigo });
    } catch (err) {
        res.json({ estaSiguiendo: false });
    }
});

app.put('/usuarios/toggle-seguir/:actual/:objetivo', verificarToken, async (req, res) => {
    try {
        const actual = req.params.actual.toLowerCase();
        const objetivo = req.params.objetivo.toLowerCase();
        
        const userActual = await Usuario.findOne({ usuario: actual });
        const userObjetivo = await Usuario.findOne({ usuario: objetivo });
        
        if (!userActual || !userObjetivo) {
            return res.status(404).json({ success: false, error: "Usuario no encontrado" });
        }

        const yaSigue = userActual.siguiendo.includes(objetivo);
        
        if (yaSigue) {
            await Usuario.updateOne(
                { usuario: actual },
                { $pull: { siguiendo: objetivo } }
            );
            await Usuario.updateOne(
                { usuario: objetivo },
                { $pull: { listaSeguidores: actual } }
            );
            res.json({ success: true, siguiendo: false });
        } else {
            await Usuario.updateOne(
                { usuario: actual },
                { $addToSet: { siguiendo: objetivo } }
            );
            await Usuario.updateOne(
                { usuario: objetivo },
                { $addToSet: { listaSeguidores: actual } }
            );
            res.json({ success: true, siguiendo: true });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: "Error al actualizar" });
    }
});

app.put('/usuarios/update-avatar', [
    verificarToken,
    body('avatarUrl').optional(),
    body('nuevaFoto').optional()
], async (req, res) => {
    try {
        // Acepta tanto 'avatarUrl' como 'nuevaFoto' para compatibilidad
        const avatarUrl = req.body.avatarUrl || req.body.nuevaFoto;
        if (!avatarUrl) return res.status(400).json({ success: false, error: 'URL de avatar requerida' });
        await Usuario.updateOne(
            { usuario: req.usuario.toLowerCase() },
            { $set: { avatar: avatarUrl } }
        );
        res.json({ success: true });
    } catch (err) {
        logger.error(`Error en update-avatar: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al actualizar avatar' });
    }
});

app.put('/usuarios/update-bio', [
    verificarToken,
    body('bio').isLength({ max: 200 })
], async (req, res) => {
    try {
        const { bio } = req.body;
        await Usuario.updateOne(
            { usuario: req.usuario.toLowerCase() },
            { $set: { bio: bio || '' } }
        );
        res.json({ success: true });
    } catch (err) {
        logger.error(`Error en update-bio: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al actualizar bio' });
    }
});

// ========== RUTAS DE COMENTARIOS ==========
app.get('/comentarios', async (req, res) => {
    try {
        const comms = await Comentario.find().sort({ fecha: -1 }).lean();
        res.json(comms);
    } catch (error) {
        res.status(500).json([]);
    }
});

app.get('/comentarios/:itemId', async (req, res) => {
    try {
        const comms = await Comentario.find({ itemId: req.params.itemId })
            .sort({ fecha: -1 })
            .lean();
        res.json(comms);
    } catch (error) {
        res.status(500).json([]);
    }
});

app.post('/comentarios', [
    verificarToken,
    body('itemId').notEmpty(),
    body('texto').notEmpty().isLength({ max: 500 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, error: 'Datos inválidos' });
        }
        const nuevo = new Comentario({
            ...req.body,
            usuario: req.usuario  // usuario desde token, no desde body
        });
        await nuevo.save();
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
    } catch (error) {
        res.status(500).json({ success: false, error: "Error al eliminar" });
    }
});

// ========== RUTAS DE FAVORITOS ==========
app.post('/favoritos/add', [
    verificarToken,
    body('itemId').isMongoId()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Datos inválidos' });
        const usuario = req.usuario;
        const { itemId } = req.body;
        const existe = await Favorito.findOne({ usuario, itemId });
        if (existe) return res.status(400).json({ success: false, error: 'Ya está en favoritos' });
        const fav = new Favorito({ usuario, itemId });
        await fav.save();
        // Incrementar likesCount del item y recalcular score
        await Juego.findByIdAndUpdate(itemId, { $inc: { likesCount: 1 } });
        await calcularScoreRecomendacion(itemId);
        res.json({ success: true, ok: true });
    } catch (error) {
        logger.error(`Error en favoritos/add: ${error.message}`);
        res.status(500).json({ success: false, error: 'Error al guardar favorito' });
    }
});

app.delete('/favoritos/remove', [
    verificarToken,
    body('itemId').isMongoId()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'Datos inválidos' });
        const usuario = req.usuario;          // ← viene del token JWT, no del body
        const { itemId } = req.body;
        await Favorito.deleteOne({ usuario, itemId });
        // Decrementar likesCount (sin bajar de 0) y recalcular score
        await Juego.findByIdAndUpdate(itemId, { $inc: { likesCount: -1 } });
        await Juego.updateOne({ _id: itemId, likesCount: { $lt: 0 } }, { $set: { likesCount: 0 } });
        await calcularScoreRecomendacion(itemId);
        res.json({ success: true, ok: true });
    } catch (error) {
        logger.error(`Error en favoritos/remove: ${error.message}`);
        res.status(500).json({ success: false, error: "Error al eliminar favorito" });
    }
});

app.get('/favoritos/:usuario', async (req, res) => {
    try {
        const favs = await Favorito.find({ usuario: req.params.usuario })
            .populate({
                path: 'itemId',
                select: '_id title description image link category usuario status reportes linkStatus descargasEfectivas likesCount'
            })
            .lean();

        const items = favs
            .filter(f => f.itemId)
            .map(fav => ({
                _id: fav.itemId._id,
                title: fav.itemId.title,
                description: fav.itemId.description,
                image: fav.itemId.image,
                link: fav.itemId.link,
                category: fav.itemId.category,
                usuario: fav.itemId.usuario,
                status: fav.itemId.status,
                reportes: fav.itemId.reportes,
                linkStatus: fav.itemId.linkStatus,
                descargasEfectivas: fav.itemId.descargasEfectivas,
                likesCount: fav.itemId.likesCount || 0
            }));

        res.json(items);
    } catch (error) {
        res.status(500).json([]);
    }
});

// ========== ⚠️ NUEVOS ENDPOINTS: DETECCIÓN DE FRAUDE (ADMIN) ==========

/**
 * Obtener estadísticas y actividades sospechosas
 */
app.get('/admin/fraud/suspicious-activities', verificarAdmin, async (req, res) => {
    try {
        const stats = await fraudDetector.getSuspiciousStats();
        res.json({
            success: true,
            ...stats
        });
    } catch (error) {
        logger.error(`Error: ${error?.message || err?.message || "unknown"}`);
        res.status(500).json({
            success: false,
            error: 'Error al obtener actividades sospechosas'
        });
    }
});

/**
 * Marcar actividad como revisada
 */
app.put('/admin/fraud/mark-reviewed/:activityId', verificarAdmin, [
    param('activityId').isMongoId(),
    body('notasAdmin').optional().isString()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: 'ID de actividad inválido'
            });
        }

        const { activityId } = req.params;
        const { notasAdmin } = req.body;

        const activity = await fraudDetector.SuspiciousActivity.findById(activityId);
        if (!activity) {
            return res.status(404).json({
                success: false,
                error: 'Actividad no encontrada'
            });
        }

        activity.revisado = true;
        if (notasAdmin) {
            activity.notasAdmin = notasAdmin;
        }
        await activity.save();

        res.json({
            success: true,
            mensaje: 'Actividad marcada como revisada'
        });
    } catch (error) {
        logger.error(`Error: ${error?.message || err?.message || "unknown"}`);
        res.status(500).json({
            success: false,
            error: 'Error al marcar actividad'
        });
    }
});

/**
 * Obtener historial de fraude de un usuario específico
 */
app.get('/admin/fraud/user-history/:usuario', verificarAdmin, async (req, res) => {
    try {
        const { usuario } = req.params;
        
        const activities = await fraudDetector.SuspiciousActivity.find({ usuario })
            .sort({ fecha: -1 })
            .limit(50);

        res.json({
            success: true,
            usuario,
            activities
        });
    } catch (error) {
        logger.error(`Error: ${error?.message || err?.message || "unknown"}`);
        res.status(500).json({
            success: false,
            error: 'Error al obtener historial'
        });
    }
});

// ========== NOTIFICACIONES ==========

/**
 * GET /notificaciones/:usuario
 * Devuelve notificaciones no leídas del usuario (máx 50, ordenadas por fecha desc)
 */
app.get('/notificaciones/:usuario', verificarToken, async (req, res) => {
    try {
        const { usuario } = req.params;
        if (req.usuario !== usuario) {
            return res.status(403).json({ success: false, error: 'Sin permiso' });
        }
        const notifs = await Notificacion.find({ destinatario: usuario })
            .sort({ fecha: -1 })
            .limit(50)
            .lean();
        const noLeidas = notifs.filter(n => !n.leida).length;
        res.json({ success: true, notificaciones: notifs, noLeidas });
    } catch (err) {
        logger.error(`Error obteniendo notificaciones: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al cargar notificaciones' });
    }
});

/**
 * PUT /notificaciones/marcar-leidas/:usuario
 * Marca todas las notificaciones del usuario como leídas
 */
app.put('/notificaciones/marcar-leidas/:usuario', verificarToken, async (req, res) => {
    try {
        const { usuario } = req.params;
        if (req.usuario !== usuario) {
            return res.status(403).json({ success: false, error: 'Sin permiso' });
        }
        await Notificacion.updateMany(
            { destinatario: usuario, leida: false },
            { $set: { leida: true } }
        );
        res.json({ success: true });
    } catch (err) {
        logger.error(`Error marcando notificaciones: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error al actualizar notificaciones' });
    }
});

/**
 * GET /notificaciones/count/:usuario
 * Devuelve solo el número de notificaciones no leídas (para el badge)
 */
app.get('/notificaciones/count/:usuario', verificarToken, async (req, res) => {
    try {
        const { usuario } = req.params;
        if (req.usuario !== usuario) {
            return res.status(403).json({ success: false, error: 'Sin permiso' });
        }
        const noLeidas = await Notificacion.countDocuments({ destinatario: usuario, leida: false });
        res.json({ success: true, noLeidas });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Error' });
    }
});

// ========== POST /notificaciones — Crear notificación social ==========
/**
 * POST /notificaciones
 * Crea una notificación para un usuario (favorito, comentario, etc.)
 * No requiere auth — fire & forget desde el frontend
 */
app.post('/notificaciones', async (req, res) => {
    try {
        const { usuario, tipo, emisor, itemId, itemTitle, itemImage, mensaje } = req.body;
        if (!usuario || !tipo) {
            return res.status(400).json({ success: false, error: 'usuario y tipo requeridos' });
        }
        const notif = new Notificacion({
            destinatario: usuario,
            tipo:         tipo || 'sistema',
            emisor:       emisor || '',
            itemId:       itemId || '',
            itemTitle:    itemTitle || '',
            itemImage:    itemImage || '',
            leida:        false,
            fecha:        new Date()
        });
        await notif.save();
        res.json({ success: true });
    } catch (err) {
        logger.error(`Error creando notificación: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

// ========== GET /usuarios/stats-seguimiento ==========
/**
 * GET /usuarios/stats-seguimiento/:usuario
 * Devuelve conteo de seguidores y siguiendo de forma eficiente
 */
app.get('/usuarios/stats-seguimiento/:usuario', async (req, res) => {
    try {
        const { usuario } = req.params;
        const user = await Usuario.findOne({ usuario })
            .select('listaSeguidores siguiendo').lean();
        if (!user) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        res.json({
            success: true,
            stats: {
                seguidores: user.listaSeguidores ? user.listaSeguidores.length : 0,
                siguiendo:  user.siguiendo       ? user.siguiendo.length       : 0
            }
        });
    } catch (err) {
        logger.error(`Error en stats-seguimiento: ${err.message}`);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

// ========== HEALTHCHECK ==========
app.get('/', (req, res) => {
    res.json({ 
        status: 'UP', 
        version: '3.2 - JOBS AUTOMÁTICOS + VERIFICACIÓN INTELIGENTE',
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
            'Análisis de comportamiento en tiempo real',
            '⚙️ NUEVO: Limpieza de comentarios (cada 24h)',
            '⚙️ NUEVO: Reset de reportes confirmados (cada 12h)',
            '⚙️ NUEVO: Auto-rechazo de pendientes +7 días (cada 24h)',
            '⚙️ NUEVO: Auto-marcado de links caídos +72h (cada 6h)',
            '⚙️ NUEVO: Auto-verificación por seguidores (cada 6h)'
        ]
    });
});

// ========== MANEJO DE ERRORES ==========
app.use((req, res) => {
    res.status(404).json({ error: "Endpoint no encontrado" });
});

app.use((err, req, res, next) => {
    logger.error(`Error: ${error?.message || err?.message || "unknown"}`);
    res.status(500).json({ error: "Error interno del servidor" });
});

// ============================================================
// ⚙️ JOBS AUTOMÁTICOS
// Se inician después de que el servidor arranca.
// Cada job corre de forma independiente y con manejo de errores
// para que si uno falla no afecte a los demás ni al servidor.
// ============================================================

function iniciarJobsAutomaticos() {

    // ----------------------------------------------------------
    // JOB 2: LIMPIAR COMENTARIOS VACÍOS Y DUPLICADOS (cada 24h)
    // - Elimina comentarios con texto vacío o solo espacios
    // - Elimina duplicados: mismo usuario, mismo item, mismo texto
    //   en menos de 60 segundos (spam de botones)
    // ----------------------------------------------------------
    async function limpiarComentarios() {
        try {
            // 2A: Borrar comentarios vacíos
            const vacios = await Comentario.deleteMany({
                $or: [
                    { texto: { $exists: false } },
                    { texto: null },
                    { texto: '' },
                    { texto: /^\s+$/ }
                ]
            });

            // 2B: Detectar y eliminar duplicados (mismo usuario + item + texto en <60s)
            const duplicados = await Comentario.aggregate([
                {
                    $group: {
                        _id: { usuario: '$usuario', itemId: '$itemId', texto: '$texto' },
                        ids: { $push: '$_id' },
                        count: { $sum: 1 }
                    }
                },
                { $match: { count: { $gt: 1 } } }
            ]);

            let eliminadosDuplicados = 0;
            for (const grupo of duplicados) {
                // Conservar el primero (ids[0]), eliminar el resto
                const aEliminar = grupo.ids.slice(1);
                await Comentario.deleteMany({ _id: { $in: aEliminar } });
                eliminadosDuplicados += aEliminar.length;
            }

            if (vacios.deletedCount > 0 || eliminadosDuplicados > 0) {
                logger.info(`JOB 2 Comentarios: ${vacios.deletedCount} vacíos + ${eliminadosDuplicados} duplicados eliminados`);
            } else {
                logger.info(`JOB 2 Comentarios: sin basura encontrada`);
            }
        } catch (err) {
            logger.error(`JOB 2 Error limpiando comentarios: ${err.message}`);
        }
    }

    limpiarComentarios(); // Correr al arrancar
    setInterval(limpiarComentarios, 24 * 60 * 60 * 1000); // Cada 24h
    logger.info('JOB 2: Limpieza de comentarios activa (cada 24h)');

    // ----------------------------------------------------------
    // JOB 3: RESETEAR REPORTES DE JUEGOS EN ESTADO 'online' (cada 12h)
    // Si un juego lleva más de 48h con linkStatus='online' y tiene
    // reportes > 0, significa que el admin lo revisó y lo confirmó.
    // Los reportes viejos ya no tienen relevancia → resetear a 0.
    // ----------------------------------------------------------
    async function resetearReportesOnline() {
        try {
            const hace48h = new Date(Date.now() - 48 * 60 * 60 * 1000);

            const resultado = await Juego.updateMany(
                {
                    linkStatus: 'online',
                    reportes: { $gt: 0 },
                    updatedAt: { $lte: hace48h }
                },
                { $set: { reportes: 0 } }
            );

            if (resultado.modifiedCount > 0) {
                logger.info(`JOB 3 Reportes: ${resultado.modifiedCount} juegos reseteados`);
            } else {
                logger.info('JOB 3 Reportes: ningún juego necesitaba reset');
            }
        } catch (err) {
            logger.error(`JOB 3 Error reseteando reportes: ${err.message}`);
        }
    }

    setInterval(resetearReportesOnline, 12 * 60 * 60 * 1000); // Cada 12h
    logger.info('JOB 3: Reset de reportes activo (cada 12h)');

    // ----------------------------------------------------------
    // JOB 4: AUTO-MARCAR CAÍDO links en revisión +2 días (cada 12h)
    // Si un item aprobado lleva más de 2 días con linkStatus='revision'
    // se marca como 'caido' automáticamente.
    // ----------------------------------------------------------
    async function autoMarcarRevisionCaido() {
        try {
            const hace2dias = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
            const resultado = await Juego.updateMany(
                {
                    status: 'aprobado',
                    linkStatus: 'revision',
                    updatedAt: { $lte: hace2dias }
                },
                { $set: { linkStatus: 'caido' } }
            );
            if (resultado.modifiedCount > 0) {
                logger.info(`JOB 4: ${resultado.modifiedCount} items marcados como caídos (2+ días en revisión)`);
            } else {
                logger.info('JOB 4: ningún item en revisión expirado');
            }
        } catch (err) {
            logger.error(`JOB 4 Error marcando caídos: ${err.message}`);
        }
    }

    autoMarcarRevisionCaido();
    setInterval(autoMarcarRevisionCaido, 12 * 60 * 60 * 1000);
    logger.info('JOB 4: Auto-marcado revisión→caído activo (cada 12h)');

    // ----------------------------------------------------------
    // JOB 5: AUTO-MARCAR LINKS CAÍDOS POR REPORTES (cada 6h)
    // Si un juego lleva más de 72h en 'revision' y tiene 10+
    // reportes sin que el admin lo toque, se marca como 'caido'.
    // ----------------------------------------------------------
    async function autoMarcarCaidos() {
        try {
            const hace72h = new Date(Date.now() - 72 * 60 * 60 * 1000);

            const resultado = await Juego.updateMany(
                {
                    linkStatus: 'revision',
                    reportes: { $gte: 10 },
                    updatedAt: { $lte: hace72h }
                },
                { $set: { linkStatus: 'caido' } }
            );

            if (resultado.modifiedCount > 0) {
                logger.info(`JOB 5 Links: ${resultado.modifiedCount} links auto-marcados como caídos (10+ reportes, 72h sin revisión)`);
            } else {
                logger.info(`JOB 5 Links: ningún link requirió auto-marcar`);
            }
        } catch (err) {
            logger.error(`JOB 5 Error marcando links caídos: ${err.message}`);
        }
    }

    setInterval(autoMarcarCaidos, 6 * 60 * 60 * 1000); // Cada 6h
    logger.info('JOB 5: Auto-marcado de links caídos activo (cada 6h)');

    // ----------------------------------------------------------
    // JOB 6: AUTO-VERIFICACIÓN POR SEGUIDORES (cada 6h)
    // Revisa todos los usuarios y asigna nivel de verificación
    // basado en su cantidad de seguidores:
    //   100+  seguidores → nivel 1
    //   500+  seguidores → nivel 2
    //   1000+ seguidores → nivel 3
    // El admin siempre puede sobreescribir manualmente desde el panel.
    // IMPORTANTE: Solo SUBE el nivel automáticamente, nunca lo baja.
    // Si el admin asignó nivel 3 manualmente con 50 seguidores, se respeta.
    // ----------------------------------------------------------
    async function autoVerificarUsuarios() {
        try {
            // Obtener todos los usuarios con sus seguidores (solo lo necesario)
            const usuarios = await Usuario.find({})
                .select('usuario listaSeguidores verificadoNivel')
                .lean();

            let subieron = 0;

            const operaciones = usuarios.map(user => {
                const seguidores = (user.listaSeguidores || []).length;

                let nivelMerecido = 0;
                if (seguidores >= 1000) nivelMerecido = 3;
                else if (seguidores >= 500)  nivelMerecido = 2;
                else if (seguidores >= 100)  nivelMerecido = 1;

                // Solo actualizar si el nivel merecido es MAYOR al que tiene
                // (nunca bajar por automatismo)
                if (nivelMerecido > (user.verificadoNivel || 0)) {
                    subieron++;
                    return {
                        updateOne: {
                            filter: { usuario: user.usuario },
                            update: { $set: { verificadoNivel: nivelMerecido, isVerificado: nivelMerecido >= 1 } }
                        }
                    };
                }
                return null;
            }).filter(Boolean);

            if (operaciones.length > 0) {
                await Usuario.bulkWrite(operaciones);
                
                // ⭐ NUEVO: Recalcular scores de todos los usuarios que subieron de nivel
                for (const user of usuarios) {
                    const seguidores = (user.listaSeguidores || []).length;
                    let nivelMerecido = 0;
                    if (seguidores >= 1000) nivelMerecido = 3;
                    else if (seguidores >= 500)  nivelMerecido = 2;
                    else if (seguidores >= 100)  nivelMerecido = 1;
                    
                    if (nivelMerecido > (user.verificadoNivel || 0)) {
                        await recalcularScoresUsuario(user.usuario);
                    }
                }
                
                logger.info(`JOB 6 Verificación: ${subieron} usuarios subieron de nivel automáticamente (scores recalculados)`);
            } else {
                logger.info(`JOB 6 Verificación: todos los niveles están al día`);
            }
        } catch (err) {
            logger.error(`JOB 6 Error en auto-verificación: ${err.message}`);
        }
    }

    autoVerificarUsuarios(); // Correr al arrancar
    setInterval(autoVerificarUsuarios, 6 * 60 * 60 * 1000); // Cada 6h
    logger.info('JOB 6: Auto-verificación por seguidores activa (cada 6h)');

    // ----------------------------------------------------------
    // JOB 7: RECALCULAR SCORES DE TODAS LAS PUBLICACIONES (cada 12h)
    // Mantiene la integridad del sistema de recomendación
    // recalculando periódicamente todos los scores
    // ----------------------------------------------------------
    async function recalcularTodosLosScores() {
        try {
            const juegos = await Juego.find({ status: 'aprobado' }).select('_id');
            
            let procesados = 0;
            for (const juego of juegos) {
                await calcularScoreRecomendacion(juego._id);
                procesados++;
            }
            
            logger.info(`JOB 7 Scores: ${procesados} publicaciones recalculadas`);
        } catch (err) {
            logger.error(`JOB 7 Error recalculando scores: ${err.message}`);
        }
    }

    recalcularTodosLosScores(); // Correr al arrancar
    setInterval(recalcularTodosLosScores, 12 * 60 * 60 * 1000); // Cada 12h
    logger.info('JOB 7: Recalculación masiva de scores activa (cada 12h)');

    // ----------------------------------------------------------
    // JOB 8: PURGAR USUARIOS INACTIVOS POR 2 AÑOS (cada 7 días)
    // Si un usuario no ha iniciado sesión en 2 años, se elimina
    // automáticamente su cuenta junto con todos sus juegos.
    // PROTECCIONES:
    //   - Nunca elimina admins (verificadoNivel === 3)
    //   - Nunca elimina usuarios con saldo pendiente (saldo > 0)
    //   - Nunca elimina usuarios con solicitud de pago pendiente
    //   - Nunca elimina usuarios en lista negra (se gestionan aparte)
    // ----------------------------------------------------------
    async function purgarUsuariosInactivos() {
        try {
            const hace2Anos = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);

            // Buscar usuarios inactivos (sin entrar en 2 años)
            // ultimoLogin puede ser null en cuentas viejas → se usa fecha de creación (fecha/createdAt)
            const usuariosInactivos = await Usuario.find({
                verificadoNivel: { $lt: 3 },         // Excluir admins (nivel 3)
                saldo: { $lte: 0 },                   // Excluir con saldo pendiente
                solicitudPagoPendiente: { $ne: true }, // Excluir con pago pendiente
                listaNegraAdmin: { $ne: true },        // Excluir lista negra (gestión aparte)
                $or: [
                    { ultimoLogin: { $lte: hace2Anos } },          // Llevan 2+ años sin entrar
                    { ultimoLogin: { $exists: false }, fecha: { $lte: hace2Anos } }, // Cuentas viejas sin ultimoLogin
                    { ultimoLogin: null, fecha: { $lte: hace2Anos } }
                ]
            }).select('usuario email').lean();

            if (usuariosInactivos.length === 0) {
                logger.info('JOB 8 Inactividad: sin usuarios que purgar');
                return;
            }

            const nombresUsuarios = usuariosInactivos.map(u => u.usuario);

            // Eliminar juegos de esos usuarios primero (integridad referencial)
            const juegosEliminados = await Juego.deleteMany({
                usuario: { $in: nombresUsuarios }
            });

            // Eliminar las cuentas
            const usuariosEliminados = await Usuario.deleteMany({
                usuario: { $in: nombresUsuarios }
            });

            logger.info(`JOB 8 Inactividad: ${usuariosEliminados.deletedCount} cuentas y ${juegosEliminados.deletedCount} juegos eliminados por 2 años de inactividad`);

        } catch (err) {
            logger.error(`JOB 8 Error purgando usuarios inactivos: ${err.message}`);
        }
    }

    setInterval(purgarUsuariosInactivos, 7 * 24 * 60 * 60 * 1000); // Cada 7 días
    logger.info('JOB 8: Purga de usuarios inactivos activa (cada 7 días, umbral: 2 años)');

    
    logger.info('TODOS LOS JOBS AUTOMÁTICOS INICIADOS');
    
}

// ========== INICIAR SERVIDOR ==========
const PORT = config.PORT;
app.listen(PORT, () => {
    logger.info(`SERVIDOR CORRIENDO EN PUERTO ${PORT}`);
    logger.info(`Endpoint: http://localhost:${PORT}`);
    logger.info(`Sistema de Economía: ACTIVO | CPM: $${CPM_VALUE} | Autor: ${AUTHOR_PERCENTAGE * 100}%`);
    logger.info(`Umbral ganancias: ${MIN_DOWNLOADS_TO_EARN} descargas | Retiro mínimo: $${MIN_WITHDRAWAL} USD`);
    logger.info(`Anti-bots: Máx ${MAX_DOWNLOADS_PER_IP_PER_DAY} descargas/IP/día`);
    logger.info(`Detección de fraude: ACTIVA | Auto-lista negra: HABILITADA`);
    logger.info(`Sistema de recomendación: ACTIVO`);

    // Iniciar jobs después de que el servidor esté listo y Mongo conectado
    mongoose.connection.once('open', () => {
        iniciarJobsAutomaticos();
    });
});
