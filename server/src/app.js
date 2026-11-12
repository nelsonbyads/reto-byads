import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { loadCatalog } from './catalog.js';
import { createPool } from './db.js';
import { createMailer } from './mailer.js';
import { createStorage } from './storage.js';
import { verifyAccessToken } from './tokens.js';
import { QueryError } from './sqlBuilder.js';
import { createTrustProxy } from './trustProxy.js';
import authRoutes from './routes/auth.js';
import dataRoutes from './routes/data.js';
import fileRoutes, { objectRoutes } from './routes/files.js';

// Postgres errors raised on purpose by the SQL layer (RAISE EXCEPTION, RLS,
// constraints) carry user-facing messages, as they did through PostgREST.
const EXPOSED_PG_CLASSES = ['P0', '23', '22', '42501', '40001', '40P01'];

export async function buildApp(config, overrides = {}) {
  const app = Fastify({
    trustProxy: createTrustProxy(config.trustProxy),
    bodyLimit: 1024 * 1024,
    logger: overrides.logger ?? {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]'],
      serializers: {
        // Query strings can carry signed file tokens: log the path only.
        req: (request) => ({
          method: request.method,
          url: String(request.url ?? '').split('?')[0],
          remoteAddress: request.ip,
        }),
      },
    },
  });

  const pool = overrides.pool ?? createPool(config);
  const storage = overrides.storage ?? await createStorage(config);
  const mailer = overrides.mailer ?? createMailer(config, app.log);
  const catalog = await loadCatalog(pool);
  if (catalog.missing.length) app.log.warn({ missing: catalog.missing }, 'allowlisted functions not found in the database');

  // Short in-memory cache of account bans so suspended users are cut off within
  // seconds even if their access token is still valid (SEC-01).
  const banCache = new Map();
  async function isBanned(userId) {
    const cached = banCache.get(userId);
    if (cached && cached.until > Date.now()) return cached.banned;
    const { rows } = await pool.query(
      `select (u.banned_until is not null and u.banned_until > now()) or coalesce(p.platform_status = 'suspended', false) as banned
         from auth.users u left join public.profiles p on p.id = u.id where u.id = $1`,
      [userId],
    );
    const banned = !rows[0] || rows[0].banned;
    banCache.set(userId, { banned, until: Date.now() + 15000 });
    if (banCache.size > 10000) banCache.clear();
    return banned;
  }

  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.globalPerMinute,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ statusCode: 429, message: 'Demasiadas solicitudes. Espera un momento.', code: 'rate_limited' }),
  });

  app.decorateRequest('userId', null);
  app.addHook('onRequest', async (request, reply) => {
    const header = request.headers.authorization;
    if (!header) return;
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const payload = match ? verifyAccessToken(config.auth.jwtSecret, match[1]) : null;
    if (!payload?.sub) return reply.code(401).send({ message: 'La sesión expiró.', code: 'invalid_token' });
    if (await isBanned(payload.sub)) return reply.code(403).send({ message: 'Tu cuenta está suspendida.', code: 'user_banned' });
    request.userId = payload.sub;
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    // Generic rate-limit answer, except for our own 429s (e.g. login lockout),
    // whose message tells the user how long to wait.
    if (error.statusCode === 429 && !error.expose) return reply.code(429).send({ message: 'Demasiadas solicitudes. Espera un momento.', code: 'rate_limited' });
    if (error.validation || error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || error.code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
      return reply.code(400).send({ message: 'Solicitud no válida.', code: 'bad_request' });
    }
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ message: 'El archivo supera el tamaño permitido.', code: 'payload_too_large' });
    if (error.expose || error instanceof QueryError) {
      return reply.code(error.statusCode ?? 400).send({ message: error.message, code: error.code ?? 'bad_request' });
    }
    if (typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
      const exposed = EXPOSED_PG_CLASSES.some((prefix) => error.code.startsWith(prefix));
      if (exposed) {
        const status = error.code === '42501' ? 403 : error.code.startsWith('40') ? 409 : 400;
        return reply.code(status).send({ message: error.message, code: error.code, details: error.detail ?? null, hint: error.hint ?? null });
      }
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ message: 'Error interno. Intenta de nuevo.', code: 'internal_error' });
  });

  app.get('/api/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  app.get('/api/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await pool.query('select 1');
      await storage.ping();
      return { status: 'ready' };
    } catch (error) {
      app.log.error({ err: error.message }, 'readiness check failed');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  await app.register(authRoutes, { prefix: '/api/auth', config, pool, mailer });
  await app.register(dataRoutes, { prefix: '/api', config, pool, catalog, storage });
  await app.register(fileRoutes, { prefix: '/api/files', pool, storage });
  await app.register(objectRoutes, {
    prefix: '/api/files',
    storage,
    maxUploadBytes: config.storage.maxUploadBytes,
    uploadsPerMinute: config.rateLimit.uploadsPerMinute,
  });

  app.addHook('onClose', async () => {
    if (!overrides.pool) await pool.end();
  });

  app.decorate('deps', { pool, storage, catalog });
  return app;
}
