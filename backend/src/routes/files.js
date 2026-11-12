import { withIdentity } from '../db.js';
import { BUCKETS } from '../storage.js';
import { QueryError } from '../sqlBuilder.js';
import { isKnownType } from '../fileSignature.js';

// File access is authorised by the existing storage.objects RLS policies
// (the same rules Supabase Storage enforced): the API performs the metadata
// operation as the user and only touches the bytes when RLS allowed it.

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

function checkTarget(bucket, name) {
  if (!Object.hasOwn(BUCKETS, bucket)) throw new QueryError('bucket not found', 404);
  if (typeof name !== 'string' || name.length > 500 || !NAME_RE.test(name) || name.includes('..')) {
    throw new QueryError('invalid object name');
  }
}

/** Authenticated JSON endpoints: upload-url, sign, remove. */
export default async function fileRoutes(app, { pool, storage }) {
  app.addHook('preHandler', async (request, reply) => {
    if (!request.userId) return reply.code(401).send({ message: 'Sesión no iniciada.', code: 'no_session' });
  });

  app.post('/upload-url', async (request) => {
    const { bucket, path, content_type: contentType, size } = request.body ?? {};
    checkTarget(bucket, path);
    if (typeof contentType !== 'string' || !Number.isInteger(size) || size <= 0) throw new QueryError('content_type and size are required');
    // Only types whose content the API can verify on upload (S6).
    if (!isKnownType(contentType)) throw new QueryError('Tipo de archivo no permitido.', 415);

    const maxSize = await withIdentity(pool, request.userId, async (client) => {
      const { rows } = await client.query('select file_size_limit, allowed_mime_types from storage.buckets where id = $1', [bucket]);
      const config = rows[0];
      if (!config) throw new QueryError('bucket not found', 404);
      const limit = Number(config.file_size_limit ?? 0) || storage.maxUploadBytes;
      if (size > limit) throw new QueryError('El archivo supera el tamaño permitido.', 413);
      if (config.allowed_mime_types?.length && !config.allowed_mime_types.includes(contentType)) {
        throw new QueryError('Tipo de archivo no permitido.', 415);
      }
      if (await storage.exists(bucket, path)) throw new QueryError('The resource already exists', 409);
      // The INSERT policy decides whether this user may write this path. A
      // previous attempt that never uploaded its bytes is replaced.
      await client.query('delete from storage.objects where bucket_id = $1 and name = $2', [bucket, path]);
      try {
        await client.query(
          'insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4)',
          [bucket, path, request.userId, JSON.stringify({ mimetype: contentType, size })],
        );
      } catch (error) {
        if (error.code === '23505') throw new QueryError('The resource already exists', 409);
        if (error.code === '42501') throw new QueryError('No tienes permiso para subir este archivo.', 403);
        throw error;
      }
      return Math.min(size, limit);
    });

    return { data: { signedUrl: storage.signedUploadUrl(bucket, path, contentType, maxSize, 600), path } };
  });

  app.post('/sign', async (request) => {
    const { bucket, path } = request.body ?? {};
    checkTarget(bucket, path);
    const expiresIn = Math.min(Math.max(Number.parseInt(request.body?.expires_in, 10) || 3600, 60), 3600);
    const object = await withIdentity(pool, request.userId, async (client) => {
      const { rows } = await client.query('select metadata from storage.objects where bucket_id = $1 and name = $2', [bucket, path]);
      return rows[0] ?? null;
    });
    if (!object) throw new QueryError('Object not found', 404);
    return { data: { signedUrl: storage.signedDownloadUrl(bucket, path, object.metadata?.mimetype, expiresIn) } };
  });

  app.post('/remove', async (request) => {
    const { bucket, paths } = request.body ?? {};
    if (!Array.isArray(paths) || !paths.length || paths.length > 50) throw new QueryError('paths must be a non-empty array');
    paths.forEach((name) => checkTarget(bucket, name));
    const removed = await withIdentity(pool, request.userId, async (client) => {
      // The DELETE policy filters out anything the user may not remove.
      const { rows } = await client.query(
        'delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name',
        [bucket, paths],
      );
      return rows.map((row) => row.name);
    });
    for (const name of removed) await storage.remove(bucket, name);
    return { data: removed.map((name) => ({ name })) };
  });
}

/** Signed byte transfer: PUT (upload) and GET (download, with Range). */
export async function objectRoutes(app, { storage, maxUploadBytes, uploadsPerMinute = 30 }) {
  // Raw request bodies of any content type are streamed to disk.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', (_request, payload, done) => done(null, payload));

  app.put('/object', { bodyLimit: maxUploadBytes, config: { rateLimit: { max: uploadsPerMinute, timeWindow: '1 minute' } } }, async (request, reply) => {
    const claims = storage.verify(request.query?.token, 'put');
    if (!claims) return reply.code(403).send({ message: 'El enlace de subida no es válido o expiró.', code: 'invalid_signature' });
    const contentType = String(request.headers['content-type'] ?? '').split(';')[0].trim();
    const size = await storage.write(claims, request.body, contentType);
    return reply.code(200).send({ data: { path: claims.n, size } });
  });

  app.get('/object', { config: { rateLimit: false } }, async (request, reply) => {
    const claims = storage.verify(request.query?.token, 'get');
    if (!claims) return reply.code(403).send({ message: 'El enlace no es válido o expiró.', code: 'invalid_signature' });
    const file = await storage.open(claims, request.headers.range);
    reply.header('accept-ranges', 'bytes');
    reply.header('cache-control', 'private, max-age=300');
    reply.header('content-disposition', 'inline');
    if (file.status === 416) {
      reply.header('content-range', `bytes */${file.size}`);
      return reply.code(416).send();
    }
    reply.header('content-type', file.contentType);
    reply.header('content-length', String(file.length));
    if (file.status === 206) reply.header('content-range', `bytes ${file.start}-${file.end}/${file.size}`);
    return reply.code(file.status).send(file.stream);
  });
}
