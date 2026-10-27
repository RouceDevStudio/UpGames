/**
 * ══════════════════════════════════════════════════════════════════
 *  nexus/llm.js — Cerebro de Nexus: cliente Groq nativo de UpGames
 *
 *  Nexus vive dentro de este servidor: usa GROQ_API_KEY directamente,
 *  sin ningún servicio intermedio. Si un modelo está saturado (429) o
 *  falla, prueba el siguiente de la cadena.
 *
 *  • completar()  → una vuelta del modelo (admite herramientas)
 *  • texto()      → respuesta de texto simple    → { texto, fuente } | null
 *  • json()       → respuesta JSON ya parseada   → objeto | null
 *  • estado()     → para el diagnóstico del panel admin
 *
 *  GROQ_API_URL permite apuntar a otro endpoint compatible (pruebas).
 * ══════════════════════════════════════════════════════════════════
 */
'use strict';

const MODELOS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
const MODELOS_RAPIDOS = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];

const url = () => (process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '') + '/chat/completions';
const clave = () => (process.env.GROQ_API_KEY || '').trim();
const disponible = () => !!clave();

// Salud reciente (se muestra en el panel admin)
const salud = { ok: 0, fallos: 0, ultimoOk: null, ultimoError: null, ultimoModelo: null, ms: null };
// Modelo saturado → se salta durante unos segundos
const enfriando = new Map();

const limpiar = s => String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();

/**
 * Una llamada al modelo. Devuelve { mensaje, modelo } o null si ningún modelo respondió.
 * @param {object} o { mensajes, herramientas, maxTokens, temperatura, json, rapido, timeout }
 */
async function completar({ mensajes, herramientas, maxTokens = 900, temperatura = 0.4, json = false, rapido = false, timeout = 25000 }) {
    const key = clave();
    if (!key) return null;
    const cadena = rapido ? MODELOS_RAPIDOS : MODELOS;
    for (const model of cadena) {
        if ((enfriando.get(model) || 0) > Date.now()) continue;
        const body = { model, temperature: temperatura, max_tokens: maxTokens, messages: mensajes };
        if (json) body.response_format = { type: 'json_object' };
        if (herramientas?.length) { body.tools = herramientas; body.tool_choice = 'auto'; }
        if (/gpt-oss/.test(model)) body.reasoning_effort = 'low';
        const t0 = Date.now();
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeout);
        try {
            const r = await fetch(url(), {
                method: 'POST', signal: ctl.signal,
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!r.ok) {
                const det = (await r.text().catch(() => '')).slice(0, 160);
                if (r.status === 429 || r.status >= 500) enfriando.set(model, Date.now() + (r.status === 429 ? 20000 : 8000));
                salud.fallos++; salud.ultimoError = `${model}: HTTP ${r.status} ${det}`;
                continue;
            }
            const j = await r.json();
            const mensaje = j.choices?.[0]?.message;
            if (!mensaje) continue;
            salud.ok++; salud.ultimoOk = new Date(); salud.ultimoModelo = model; salud.ms = Date.now() - t0;
            return { mensaje: { ...mensaje, content: limpiar(mensaje.content) }, modelo: model };
        } catch (e) {
            salud.fallos++; salud.ultimoError = `${model}: ${e.name === 'AbortError' ? 'tiempo agotado' : e.message}`;
        } finally { clearTimeout(to); }
    }
    return null;
}

/** Texto simple. mensajes: [{role:'user'|'assistant', content}] */
async function texto(sistema, mensajes, opts = {}) {
    const r = await completar({ ...opts, mensajes: [{ role: 'system', content: sistema }, ...mensajes] });
    const t = r?.mensaje?.content;
    return t ? { texto: t, fuente: `Nexus · ${r.modelo}` } : null;
}

/** Extrae el primer objeto JSON de un texto (los modelos a veces lo envuelven en ```). */
function parsearJSON(t) {
    const s = String(t || ''); const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
}

/** Respuesta JSON parseada (con la fuente en _fuente) o null. */
async function json(sistema, usuario, opts = {}) {
    const r = await completar({ temperatura: 0.2, maxTokens: 700, ...opts, json: true, mensajes: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }] });
    const o = parsearJSON(r?.mensaje?.content);
    return o ? { ...o, _fuente: `Nexus · ${r.modelo}` } : null;
}

/** Comprueba la clave con Groq sin gastar tokens (lista de modelos). */
let ultimoPing = null;
async function ping() {
    if (ultimoPing && ultimoPing.t > Date.now() - 60000) return ultimoPing.r;
    const r = await pingReal();
    ultimoPing = { t: Date.now(), r };
    return r;
}
async function pingReal() {
    const key = clave();
    if (!key) return { ok: false, error: 'Falta GROQ_API_KEY' };
    const t0 = Date.now(); const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
    try {
        const r = await fetch(url().replace(/\/chat\/completions$/, '/models'), { headers: { Authorization: `Bearer ${key}` }, signal: ctl.signal });
        const j = await r.json().catch(() => ({}));
        const ids = (j.data || []).map(m => m.id);
        return { ok: r.ok, status: r.status, ms: Date.now() - t0, modelosDisponibles: MODELOS.filter(m => ids.includes(m)), error: r.ok ? undefined : (j.error?.message || `HTTP ${r.status}`) };
    } catch (e) { return { ok: false, error: e.name === 'AbortError' ? 'tiempo agotado' : e.message, ms: Date.now() - t0 }; }
    finally { clearTimeout(to); }
}

const estado = () => ({ configurado: disponible(), modelos: MODELOS, ...salud });

module.exports = { completar, texto, json, parsearJSON, disponible, estado, ping, MODELOS };
