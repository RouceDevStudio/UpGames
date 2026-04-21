// ========================================
// 🚀 CACHE LRU EN MEMORIA - PERFORMANCE BOOSTER
// ========================================
//
// Cache en memoria tipo LRU (Least Recently Used) con TTL.
// Sin dependencias externas. Ideal para:
//   - Listados de /items (top populares)
//   - Datos de usuarios públicos
//   - Resultados de búsqueda frecuentes
//   - Leaderboards
//
// Uso:
//   const cache = require('./modulos/cache');
//   const data = cache.get('mi_key') ?? await cargarYGuardar();
//   cache.set('mi_key', data, 60); // TTL 60 segundos
// ========================================

const logger = require('./logger');

class LRUCache {
    constructor(maxSize = 500) {
        this.maxSize = maxSize;
        this.cache = new Map();
        this.hits = 0;
        this.misses = 0;
        this.evictions = 0;
    }

    /**
     * Obtener valor. Devuelve null si no existe o si expiró.
     */
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return null;
        }
        if (entry.expiresAt && entry.expiresAt < Date.now()) {
            this.cache.delete(key);
            this.misses++;
            return null;
        }
        // Re-insertar para marcar como "usado recientemente"
        this.cache.delete(key);
        this.cache.set(key, entry);
        this.hits++;
        return entry.value;
    }

    /**
     * Guardar valor con TTL opcional (segundos).
     */
    set(key, value, ttlSeconds = 60) {
        if (this.cache.has(key)) this.cache.delete(key);

        if (this.cache.size >= this.maxSize) {
            // Evict el más viejo (primero en el Map)
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
            this.evictions++;
        }

        this.cache.set(key, {
            value,
            expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
            createdAt: Date.now()
        });
    }

    /**
     * Invalidar por key exacto o por prefijo.
     * cache.invalidate('items:*') → borra todas las keys que empiezan con 'items:'
     */
    invalidate(keyOrPattern) {
        if (keyOrPattern.endsWith('*')) {
            const prefix = keyOrPattern.slice(0, -1);
            let count = 0;
            for (const key of this.cache.keys()) {
                if (key.startsWith(prefix)) {
                    this.cache.delete(key);
                    count++;
                }
            }
            return count;
        }
        return this.cache.delete(keyOrPattern) ? 1 : 0;
    }

    clear() {
        const size = this.cache.size;
        this.cache.clear();
        return size;
    }

    stats() {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? (this.hits / total * 100).toFixed(1) + '%' : '0%',
            evictions: this.evictions
        };
    }

    /**
     * Wrapper: si existe devuelve cacheado; si no ejecuta fetcher y guarda.
     */
    async remember(key, ttlSeconds, fetcher) {
        const cached = this.get(key);
        if (cached !== null) return cached;
        try {
            const fresh = await fetcher();
            if (fresh !== null && fresh !== undefined) {
                this.set(key, fresh, ttlSeconds);
            }
            return fresh;
        } catch (err) {
            logger.error(`Cache remember() fetcher error para key="${key}": ${err.message}`);
            throw err;
        }
    }
}

// Instancia global compartida
const cacheGlobal = new LRUCache(1000);

// Log de stats cada 10 minutos en producción
if (process.env.NODE_ENV === 'production') {
    setInterval(() => {
        const s = cacheGlobal.stats();
        logger.info(`[CACHE] size=${s.size}/${s.maxSize} hitRate=${s.hitRate} hits=${s.hits} misses=${s.misses}`);
    }, 10 * 60 * 1000);
}

module.exports = cacheGlobal;
module.exports.LRUCache = LRUCache;
