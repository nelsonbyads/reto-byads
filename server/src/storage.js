import { createHmac } from 'node:crypto';
import { Transform, pipeline } from 'node:stream';
import { safeEqual } from './tokens.js';
import { SNIFF_BYTES, matchesSignature } from './fileSignature.js';
import { createDiskBackend } from './storageDisk.js';

export const BUCKETS = {
  'challenge-evidence': { public: false },
  avatars: { public: true },
};

const OBJECT_NAME_MAX = 500;

export class StorageError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.expose = true;
  }
}

/** Rejects unknown buckets and names that could escape the bucket. */
export function checkObjectName(bucket, name) {
  if (!Object.hasOwn(BUCKETS, bucket)) throw new StorageError('bucket not found', 404);
  if (typeof name !== 'string' || !name || name.length > OBJECT_NAME_MAX || name.startsWith('/')
    || name.split('/').some((part) => part === '' || part === '.' || part === '..') || name.includes('\\')) {
    throw new StorageError('invalid object name', 400);
  }
}

/**
 * File storage behind signed, short-lived URLs (like S3 presigned URLs): the
 * API authorises the operation against the storage.objects RLS policies and
 * returns an HMAC-signed URL; the browser then PUTs/GETs the bytes through
 * /api/files/object. The bytes live in a pluggable backend:
 *   STORAGE_DRIVER=disk  local volume (development, single server)
 *   STORAGE_DRIVER=s3    Amazon S3 or an S3-compatible service (AWS target)
 * Streaming every byte through the API keeps the size limit and the content
 * check (S6) in one place for both backends.
 */
export async function createStorage(config, { backend } = {}) {
  const secret = config.storage.signingSecret;
  const store = backend ?? (config.storage.driver === 's3'
    ? (await import('./storageS3.js')).createS3Backend(config.storage.s3)
    : createDiskBackend(config.storage.dir));

  function sign(claims) {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  function verify(token, action) {
    if (typeof token !== 'string') return null;
    const [body, signature] = token.split('.');
    if (!body || !signature) return null;
    const expected = createHmac('sha256', secret).update(body).digest('base64url');
    if (!safeEqual(signature, expected)) return null;
    try {
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (claims.a !== action || typeof claims.e !== 'number' || claims.e < Date.now() / 1000) return null;
      return claims;
    } catch {
      return null;
    }
  }

  const objectUrl = (token) => `/api/files/object?token=${encodeURIComponent(token)}`;
  const expiry = (seconds) => Math.floor(Date.now() / 1000) + seconds;

  /** Counts bytes, enforces the signed size and checks the file signature. */
  function createGuard(claims) {
    let written = 0;
    let header = Buffer.alloc(0);
    let checked = false;
    const checkHeader = () => {
      checked = true;
      return matchesSignature(claims.ct, header)
        ? null
        : new StorageError('El contenido del archivo no coincide con su tipo.', 415);
    };
    const guard = new Transform({
      transform(chunk, _encoding, callback) {
        written += chunk.length;
        if (written > claims.ms) return callback(new StorageError('El archivo supera el tamaño permitido.', 413));
        if (!checked) {
          header = Buffer.concat([header, chunk.subarray(0, SNIFF_BYTES - header.length)]);
          if (header.length >= SNIFF_BYTES) {
            const error = checkHeader();
            if (error) return callback(error);
          }
        }
        return callback(null, chunk);
      },
      flush(callback) {
        if (written === 0) return callback(new StorageError('Empty upload', 400));
        return callback(checked ? null : checkHeader());
      },
    });
    return { guard, size: () => written };
  }

  return {
    driver: store.driver,
    maxUploadBytes: config.storage.maxUploadBytes,
    ensureBuckets: () => store.ensureBuckets(Object.keys(BUCKETS)),
    ping: () => store.ping(),
    signedUploadUrl(bucket, name, contentType, maxSize, expirySeconds = 600) {
      checkObjectName(bucket, name);
      return objectUrl(sign({ a: 'put', b: bucket, n: name, ct: contentType, ms: maxSize, e: expiry(expirySeconds) }));
    },
    signedDownloadUrl(bucket, name, contentType, expirySeconds = 3600) {
      checkObjectName(bucket, name);
      return objectUrl(sign({ a: 'get', b: bucket, n: name, ct: contentType || 'application/octet-stream', e: expiry(expirySeconds) }));
    },
    verify,

    /** Streams an upload to the backend; never overwrites; enforces size and content type. */
    async write(claims, stream, declaredType) {
      if (declaredType !== claims.ct) throw new StorageError('Content-Type does not match the signed upload', 400);
      checkObjectName(claims.b, claims.n);
      if (await store.exists(claims.b, claims.n)) throw new StorageError('The resource already exists', 409);
      const { guard, size } = createGuard(claims);
      // Remember the first rejection so it wins over any backend error it caused.
      let rejection = null;
      guard.on('error', (error) => { rejection ??= error; });
      // pipeline() tears both streams down on the first error, as before.
      const body = pipeline(stream, guard, () => {});
      try {
        await store.put(claims.b, claims.n, body, claims.ct);
      } catch (error) {
        throw rejection ?? error;
      }
      if (rejection) throw rejection;
      return size();
    },

    async open(claims, rangeHeader) {
      checkObjectName(claims.b, claims.n);
      const size = await store.size(claims.b, claims.n);
      if (size === null) throw new StorageError('Object not found', 404);
      const match = typeof rangeHeader === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
      if (!match || (match[1] === '' && match[2] === '') || size === 0) {
        return { status: 200, size, length: size, stream: await store.read(claims.b, claims.n), contentType: claims.ct };
      }
      let start;
      let end;
      if (match[1] === '') {
        start = Math.max(size - Number(match[2]), 0);
        end = size - 1;
      } else {
        start = Number(match[1]);
        end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
      }
      if (start > end || start >= size) return { status: 416, size };
      return {
        status: 206, size, start, end, length: end - start + 1,
        stream: await store.read(claims.b, claims.n, { start, end }), contentType: claims.ct,
      };
    },

    async exists(bucket, name) {
      checkObjectName(bucket, name);
      return store.exists(bucket, name);
    },
    async remove(bucket, name) {
      checkObjectName(bucket, name);
      await store.remove(bucket, name);
    },
  };
}
