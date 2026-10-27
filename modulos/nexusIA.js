/**
 * nexusIA.js — Razonamiento de Nexus para el servidor de UpGames.
 * Orden: Nexus (/api/nexus/asistente, con NEXUS_INTERNAL_SECRET) → Groq directo
 * (GROQ_API_KEY) → null. Quien llama decide qué hacer sin IA.
 */
'use strict';

const NEXUS_API = (process.env.NEXUS_API_URL || process.env.NEXUS_URL || 'https://nexus-production-781b.up.railway.app').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

async function conTimeout(url, opts, ms) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}

/**
 * @param {string} sistema   instrucciones
 * @param {Array<{role:'user'|'assistant', content:string}>} mensajes
 * @returns {Promise<{texto:string, fuente:string}|null>}
 */
async function chatIA(sistema, mensajes, { maxTokens = 900, temperatura = 0.4, json = false } = {}) {
    const secreto = (process.env.NEXUS_INTERNAL_SECRET || '').trim();
    if (secreto) {
        try {
            const r = await conTimeout(`${NEXUS_API}/api/nexus/asistente`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nexus-secret': secreto },
                body: JSON.stringify({ sistema, mensajes, maxTokens, temperatura, json }),
            }, 35000);
            const d = await r.json().catch(() => ({}));
            if (r.ok && d.ok && d.texto) return { texto: d.texto, fuente: `Nexus IA${d.modelo ? ' · ' + d.modelo.replace(/^Groq\//, '') : ''}` };
        } catch (_) {}
    }
    const key = (process.env.GROQ_API_KEY || '').trim();
    if (!key) return null;
    for (const model of ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant']) {
        try {
            const body = { model, temperature: temperatura, max_tokens: maxTokens, messages: [{ role: 'system', content: sistema }, ...mensajes] };
            if (json) body.response_format = { type: 'json_object' };
            if (/gpt-oss/.test(model)) body.reasoning_effort = 'low';
            const r = await conTimeout('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(body),
            }, 25000);
            if (!r.ok) continue;
            const j = await r.json();
            const texto = (j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            if (texto) return { texto, fuente: `Groq · ${model}` };
        } catch (_) {}
    }
    return null;
}

module.exports = { chatIA };
