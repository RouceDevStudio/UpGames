/**
 * Imágenes en Cloudinary, con o sin credenciales de servidor.
 *
 * - Con CLOUDINARY_API_KEY/SECRET: subida firmada (cloudinary.uploader).
 * - Sin ellas: subida SIN FIRMA con el preset público que ya usa el frontend.
 *   Antes el chat y las historias exigían las credenciales y fallaban sin ellas.
 *
 * Además copia las portadas enlazadas desde otros sitios (miniaturas de Google que
 * caducan, imágenes de Steam de 1 MB…) para servirlas desde Cloudinary con tamaño
 * y formato justos.
 */
'use strict';

const https = require('https');

const NUBE   = process.env.CLOUDINARY_CLOUD_NAME || 'dd4w2plxn';
const PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || 'upgames_videos';
const esCloudinary = u => /^https:\/\/res\.cloudinary\.com\//i.test(String(u || ''));
const conTransformacion = (url, t) => esCloudinary(url) && t ? url.replace('/image/upload/', `/image/upload/${t}/`) : url;

function subidaSinFirma(file) {
    const limite = '----ug' + Date.now().toString(16);
    const cuerpo = Buffer.from(
        `--${limite}\r\nContent-Disposition: form-data; name="file"\r\n\r\n${file}\r\n` +
        `--${limite}\r\nContent-Disposition: form-data; name="upload_preset"\r\n\r\n${PRESET}\r\n--${limite}--\r\n`);
    return new Promise((ok, ko) => {
        const r = https.request({
            hostname: 'api.cloudinary.com', path: `/v1_1/${NUBE}/image/upload`, method: 'POST', timeout: 45000,
            headers: { 'Content-Type': `multipart/form-data; boundary=${limite}`, 'Content-Length': cuerpo.length },
        }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => {
                let j = {}; try { j = JSON.parse(d); } catch (_) {}
                if (res.statusCode === 200 && j.secure_url) ok(j);
                else ko(new Error(j.error?.message || `Cloudinary respondió ${res.statusCode}`));
            });
        });
        r.on('timeout', () => r.destroy(new Error('Cloudinary no respondió a tiempo')));
        r.on('error', ko);
        r.end(cuerpo);
    });
}

function crear({ cloudinary, logger }) {
    const firmado = () => !!(process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

    /** Sube una imagen (data URI o URL remota). Devuelve la URL segura, ya optimizada. */
    async function subir(file, { carpeta, ancho = 1080, alto = 1080, crudo = false } = {}) {
        const t = `c_limit,w_${ancho},h_${alto},q_auto,f_auto`;
        if (firmado() && crudo) return (await cloudinary.uploader.upload(file, { folder: carpeta })).secure_url;
        if (firmado()) {
            const r = await cloudinary.uploader.upload(file, { folder: carpeta, transformation: [{ width: ancho, height: alto, crop: 'limit', quality: 'auto:good' }] });
            return r.secure_url;
        }
        const r = await subidaSinFirma(file);   // el preset sin firma no admite transformaciones: van en la URL
        return crudo ? r.secure_url : conTransformacion(r.secure_url, t);
    }

    /** Copia a Cloudinary una portada externa. Si falla, devuelve null (se conserva la original). */
    async function copiarPortada(url) {
        if (!/^https?:\/\//i.test(String(url || '')) || esCloudinary(url)) return null;
        // Sin transformación fija: el frontend (cld) pide el tamaño justo para cada lugar
        try { return await subir(url, { carpeta: 'portadas', crudo: true }); }
        catch (e) { logger.warn(`[imagenes] No se pudo copiar ${String(url).slice(0, 80)}: ${e.message}`); return null; }
    }

    /**
     * Migra poco a poco las portadas externas del catálogo (y de la galería).
     * Guarda la original en imageOrigen para poder rastrearla.
     */
    async function migrarPortadas(Juego, lote = 15) {
        const pendientes = await Juego.find({
            image: { $regex: '^https?://', $not: /res\.cloudinary\.com/ },
            portadaMigrada: { $ne: true },
        }).select('_id image images').limit(lote).lean();
        let ok = 0;
        for (const j of pendientes) {
            const nueva = await copiarPortada(j.image);
            const galeria = [];
            for (const g of (j.images || []).slice(0, 6)) galeria.push((await copiarPortada(g)) || g);
            // portadaMigrada también si falló: no reintentar para siempre una imagen caída
            const set = { portadaMigrada: true };
            if (nueva) { set.image = nueva; set.imageOrigen = j.image; ok++; }
            if ((j.images || []).length) set.images = galeria.concat((j.images || []).slice(6));
            await Juego.updateOne({ _id: j._id, image: j.image }, { $set: set });
        }
        if (pendientes.length) logger.info(`[imagenes] Portadas migradas a Cloudinary: ${ok}/${pendientes.length}`);
        return { revisadas: pendientes.length, migradas: ok };
    }

    return { subir, copiarPortada, migrarPortadas, firmado, esCloudinary };
}

module.exports = { crear, esCloudinary, conTransformacion };
