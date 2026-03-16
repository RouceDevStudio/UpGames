// ========================================
// 📋 CONFIGURACIÓN CENTRALIZADA - UPGAMES
// ========================================

require('dotenv').config();

// Validar variables de entorno críticas
if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
    console.error("❌ FALTAN VARIABLES DE ENTORNO CRÍTICAS");
    console.error("   → MONGODB_URI y JWT_SECRET son obligatorias");
    process.exit(1);
}

const config = {
    // ========== SERVIDOR ==========
    PORT: process.env.PORT || 10000,
    NODE_ENV: process.env.NODE_ENV || 'development',
    
    // ========== BASE DE DATOS ==========
    MONGODB_URI: process.env.MONGODB_URI,
    MONGODB_OPTIONS: {
        maxPoolSize: process.env.NODE_ENV === 'production' ? 50 : 10,
        minPoolSize: process.env.NODE_ENV === 'production' ? 10 : 1,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
    },
    
    // ========== SEGURIDAD ==========
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_ACCESS_EXPIRATION: '15m',  // Access token corto
    JWT_REFRESH_EXPIRATION: '7d',  // Refresh token largo
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + '_refresh',
    
    // ========== CORS ==========
    ALLOWED_ORIGINS: [
        'https://roucedevstudio.github.io',
        'http://localhost:3000',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        'http://localhost:7700'
    ],
    
    // ========== ECONOMÍA CPM ==========
    CPM_VALUE: 2.00,                      // $2.00 por 1,000 descargas
    AUTHOR_PERCENTAGE: 0.50,              // 50% para el creador
    MIN_DOWNLOADS_TO_EARN: 2000,          // Umbral mínimo de descargas
    MIN_WITHDRAWAL: 10,                   // Mínimo $10 USD para retiro
    MAX_DOWNLOADS_PER_IP_PER_DAY: 2,      // Límite anti-bots
    
    // ========== RATE LIMITING ==========
    RATE_LIMIT: {
        GENERAL: {
            windowMs: 15 * 60 * 1000,     // 15 minutos
            max: 200,                      // 200 peticiones
        },
        AUTH: {
            windowMs: 15 * 60 * 1000,     // 15 minutos
            max: 5,                        // Solo 5 intentos de login
        },
        CREATE: {
            windowMs: 60 * 60 * 1000,     // 1 hora
            max: 50,                       // 50 creaciones
        },
        DOWNLOAD_VALIDATION: {
            windowMs: 60 * 1000,           // 1 minuto
            max: 10,                       // 10 validaciones
        }
    },
    
    // ========== PAYPAL ==========
    PAYPAL_CLIENT_ID:     process.env.PAYPAL_CLIENT_ID     || null,
    PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET || null,
    PAYPAL_MODE:          process.env.PAYPAL_MODE          || 'sandbox', // 'sandbox' | 'live'

    // ========== CARACTERÍSTICAS ==========
    FEATURES: {
        ENABLE_FRAUD_DETECTION: true,
        ENABLE_AUTO_PAYMENTS: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
        ENABLE_EMAIL_NOTIFICATIONS: false,  // Requiere configurar servicio de email
    },
    
    // ========== LOGS ==========
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};

// Validación adicional
if (config.NODE_ENV === 'production') {
    if (!config.JWT_REFRESH_SECRET || config.JWT_REFRESH_SECRET === config.JWT_SECRET) {
        console.warn("⚠️ ADVERTENCIA: JWT_REFRESH_SECRET no está configurado. Usando derivado del JWT_SECRET.");
    }
}

module.exports = config;
