// ========================================
// 🔐 AUTENTICACIÓN DE 2 FACTORES (2FA) - UPGAMES
// ========================================
//
// Implementación TOTP (Time-based One-Time Password) compatible con:
//   - Google Authenticator
//   - Authy
//   - Microsoft Authenticator
//   - 1Password
//
// Sin dependencias externas (solo crypto nativo de Node).
// Compatible con RFC 6238 (TOTP) y RFC 4648 (Base32).
//
// Uso:
//   const tfa = require('./modulos/twoFactor');
//
//   // 1. Al activar 2FA:
//   const { secret, qrUrl, backupCodes } = tfa.generarSecret('usuario@email.com');
//   // Mostrar qrUrl al user, que lo escanee con Google Auth
//
//   // 2. Para verificar tras login:
//   const valido = tfa.verificarToken(secretGuardado, tokenUsuario);
// ========================================

const crypto = require('crypto');
const mongoose = require('mongoose');
const logger = require('./logger');

// ======================================================================
// SCHEMA - Almacenar secrets y backup codes
// ======================================================================

const TwoFactorSchema = new mongoose.Schema({
    usuario:     { type: String, required: true, unique: true, index: true, lowercase: true },
    secret:      { type: String, required: true }, // Base32 encoded
    activado:    { type: Boolean, default: false, index: true },
    backupCodes: { type: [{ code: String, usado: Boolean }], default: [] },
    ultimoUso:   { type: Date, default: null },
    activadoEn:  { type: Date, default: null },
    intentosFallidos: { type: Number, default: 0 },
    bloqueadoHasta:   { type: Date, default: null }
}, { collection: 'two_factor', timestamps: true });

const TwoFactor = mongoose.model('TwoFactor', TwoFactorSchema);

// ======================================================================
// BASE32 (RFC 4648) - Para compatibilidad con apps autenticadoras
// ======================================================================

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
    let bits = 0;
    let value = 0;
    let output = '';

    for (let i = 0; i < buffer.length; i++) {
        value = (value << 8) | buffer[i];
        bits += 8;
        while (bits >= 5) {
            output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += BASE32_CHARS[(value << (5 - bits)) & 31];
    return output;
}

function base32Decode(str) {
    str = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
    let bits = 0;
    let value = 0;
    const output = [];

    for (let i = 0; i < str.length; i++) {
        const idx = BASE32_CHARS.indexOf(str[i]);
        if (idx === -1) throw new Error('Invalid base32 character');
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            output.push((value >>> (bits - 8)) & 0xFF);
            bits -= 8;
        }
    }
    return Buffer.from(output);
}

// ======================================================================
// HOTP / TOTP (RFC 6238)
// ======================================================================

/**
 * Genera un código HOTP para un contador específico.
 */
function hotp(secret, counter) {
    const key = typeof secret === 'string' ? base32Decode(secret) : secret;
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter), 0);

    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = (
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff)
    ) % 1000000;

    return String(code).padStart(6, '0');
}

/**
 * Genera el código TOTP actual.
 * period: 30 segundos (estándar de Google Authenticator)
 */
function generarTOTP(secret, window = 0) {
    const period = 30;
    const counter = Math.floor(Date.now() / 1000 / period) + window;
    return hotp(secret, counter);
}

/**
 * Verifica un token TOTP con ventana de ±1 período (60 segundos de tolerancia).
 */
function verificarTOTP(secret, token, windowSize = 1) {
    if (!token || !secret) return false;
    const clean = String(token).replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) return false;

    for (let w = -windowSize; w <= windowSize; w++) {
        if (generarTOTP(secret, w) === clean) return true;
    }
    return false;
}

// ======================================================================
// API PÚBLICO
// ======================================================================

/**
 * Genera un secret aleatorio + URL otpauth para QR.
 * NO lo activa todavía: hay que verificarlo primero con un token.
 */
async function iniciarSetup(usuario, emailOrLabel, appName = 'UpGames') {
    // Generar secret aleatorio de 20 bytes (160 bits, RFC recomienda ≥128)
    const secretBuffer = crypto.randomBytes(20);
    const secretBase32 = base32Encode(secretBuffer);

    // URL otpauth compatible con Google Authenticator
    const label  = encodeURIComponent(`${appName}:${emailOrLabel}`);
    const issuer = encodeURIComponent(appName);
    const qrUrl  = `otpauth://totp/${label}?secret=${secretBase32}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

    // Backup codes (10 códigos de 8 chars)
    const backupCodes = [];
    for (let i = 0; i < 10; i++) {
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        backupCodes.push({ code, usado: false });
    }

    // Guardar (pero sin activar)
    await TwoFactor.findOneAndUpdate(
        { usuario },
        {
            secret: secretBase32,
            activado: false,
            backupCodes,
            intentosFallidos: 0,
            bloqueadoHasta: null
        },
        { upsert: true, new: true }
    );

    logger.info(`2FA setup iniciado para @${usuario}`);

    return {
        secret: secretBase32,
        qrUrl,
        backupCodes: backupCodes.map(b => b.code), // Solo los códigos, no el estado
        instrucciones: [
            '1. Escanea el código QR con Google Authenticator o similar.',
            '2. Introduce el código de 6 dígitos que te muestre la app.',
            '3. Guarda los códigos de respaldo en un lugar seguro.',
            '4. Si pierdes tu dispositivo, podrás usar un código de respaldo.'
        ]
    };
}

/**
 * Activa 2FA tras verificar que el usuario tiene bien configurado su authenticator.
 */
async function confirmarActivacion(usuario, token) {
    const record = await TwoFactor.findOne({ usuario });
    if (!record) return { ok: false, error: 'Debes iniciar el setup primero' };

    if (!verificarTOTP(record.secret, token)) {
        return { ok: false, error: 'Código incorrecto. Verifica que la hora de tu dispositivo sea correcta.' };
    }

    record.activado   = true;
    record.activadoEn = new Date();
    record.ultimoUso  = new Date();
    await record.save();

    logger.info(`✅ 2FA ACTIVADO para @${usuario}`);
    return { ok: true, mensaje: '2FA activado correctamente' };
}

/**
 * Verifica un token durante login. Maneja rate limiting.
 */
async function verificar(usuario, token) {
    const record = await TwoFactor.findOne({ usuario });
    if (!record) return { ok: true, sinConfig: true }; // No tiene 2FA, OK
    if (!record.activado) return { ok: true, sinConfig: true };

    // ¿Está bloqueado por demasiados intentos?
    if (record.bloqueadoHasta && record.bloqueadoHasta > new Date()) {
        const minutos = Math.ceil((record.bloqueadoHasta - new Date()) / 60000);
        return { ok: false, bloqueado: true, error: `Demasiados intentos. Espera ${minutos} minuto(s).` };
    }

    const clean = String(token || '').replace(/\s/g, '').toUpperCase();

    // ¿Es un backup code?
    if (clean.length === 8 && /^[0-9A-F]+$/.test(clean)) {
        const backup = record.backupCodes.find(b => b.code === clean && !b.usado);
        if (backup) {
            backup.usado = true;
            record.ultimoUso = new Date();
            record.intentosFallidos = 0;
            await record.save();
            logger.info(`🔓 2FA: @${usuario} usó un backup code`);
            return { ok: true, backupUsado: true };
        }
    }

    // Es un TOTP normal
    if (verificarTOTP(record.secret, clean)) {
        record.ultimoUso = new Date();
        record.intentosFallidos = 0;
        await record.save();
        return { ok: true };
    }

    // Falló
    record.intentosFallidos++;
    if (record.intentosFallidos >= 5) {
        record.bloqueadoHasta = new Date(Date.now() + 15 * 60 * 1000); // 15 min bloqueado
        record.intentosFallidos = 0;
        logger.warn(`⚠️ 2FA BLOQUEO: @${usuario} 5 intentos fallidos, bloqueado 15 min`);
    }
    await record.save();

    return { ok: false, error: 'Código incorrecto' };
}

/**
 * Desactivar 2FA (requiere que el usuario verifique con token primero).
 */
async function desactivar(usuario, tokenConfirmacion) {
    const verify = await verificar(usuario, tokenConfirmacion);
    if (!verify.ok) return verify;

    await TwoFactor.deleteOne({ usuario });
    logger.info(`🔓 2FA DESACTIVADO para @${usuario}`);
    return { ok: true, mensaje: '2FA desactivado' };
}

/**
 * ¿El usuario tiene 2FA activo?
 */
async function tieneActivo(usuario) {
    const r = await TwoFactor.findOne({ usuario }).select('activado').lean();
    return !!(r && r.activado);
}

/**
 * Info pública del estado de 2FA.
 */
async function estado(usuario) {
    const r = await TwoFactor.findOne({ usuario }).select('activado activadoEn backupCodes ultimoUso').lean();
    if (!r || !r.activado) return { activo: false };

    const backupsDisponibles = (r.backupCodes || []).filter(b => !b.usado).length;
    return {
        activo: true,
        activadoEn: r.activadoEn,
        ultimoUso: r.ultimoUso,
        backupCodesDisponibles: backupsDisponibles,
        backupCodesTotales: (r.backupCodes || []).length
    };
}

/**
 * Regenerar backup codes (requiere token verificado).
 */
async function regenerarBackupCodes(usuario, token) {
    const verify = await verificar(usuario, token);
    if (!verify.ok) return verify;

    const nuevosCodes = [];
    for (let i = 0; i < 10; i++) {
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        nuevosCodes.push({ code, usado: false });
    }

    await TwoFactor.updateOne({ usuario }, { $set: { backupCodes: nuevosCodes } });
    return { ok: true, backupCodes: nuevosCodes.map(b => b.code) };
}

module.exports = {
    iniciarSetup,
    confirmarActivacion,
    verificar,
    desactivar,
    tieneActivo,
    estado,
    regenerarBackupCodes,
    // Helpers exportados para testing
    generarTOTP,
    verificarTOTP,
    base32Encode,
    base32Decode,
    TwoFactor
};
