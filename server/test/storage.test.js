import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createStorage } from '../src/storage.js';

// Storage core (signing, size limit, content check, ranges) over an in-memory
// backend; the disk and S3 backends are exercised by the integration suite.
function memoryBackend() {
  const objects = new Map();
  const id = (bucket, name) => `${bucket}/${name}`;
  return {
    driver: 'memory',
    objects,
    async ensureBuckets() {},
    async ping() {},
    async exists(bucket, name) { return objects.has(id(bucket, name)); },
    async size(bucket, name) { return objects.get(id(bucket, name))?.length ?? null; },
    async put(bucket, name, source) {
      const chunks = [];
      for await (const chunk of source) chunks.push(chunk);
      objects.set(id(bucket, name), Buffer.concat(chunks));
    },
    async read(bucket, name, range) {
      const data = objects.get(id(bucket, name));
      return Readable.from([range ? data.subarray(range.start, range.end + 1) : data]);
    },
    async remove(bucket, name) { objects.delete(id(bucket, name)); },
  };
}

const config = { storage: { signingSecret: 'x'.repeat(40), maxUploadBytes: 1024 } };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake-jpeg-body-bytes')]);
const claimsFor = (storage, name, contentType = 'image/jpeg', maxSize = 1024) => {
  const url = storage.signedUploadUrl('challenge-evidence', name, contentType, maxSize, 60);
  return storage.verify(decodeURIComponent(url.split('token=')[1]), 'put');
};
const chunked = (buffer, size = 3) => Readable.from(Array.from({ length: Math.ceil(buffer.length / size) }, (_, i) => buffer.subarray(i * size, (i + 1) * size)));
const readAll = async (stream) => { const parts = []; for await (const part of stream) parts.push(part); return Buffer.concat(parts); };

describe('storage core', () => {
  it('stores a valid upload delivered in small chunks', async () => {
    const backend = memoryBackend();
    const storage = await createStorage(config, { backend });
    const claims = claimsFor(storage, 'u1/a.jpg');
    assert.equal(await storage.write(claims, chunked(JPEG), 'image/jpeg'), JPEG.length);
    assert.deepEqual(backend.objects.get('challenge-evidence/u1/a.jpg'), JPEG);
  });

  it('rejects content that does not match the declared type, without storing it', async () => {
    const backend = memoryBackend();
    const storage = await createStorage(config, { backend });
    const claims = claimsFor(storage, 'u1/evil.jpg');
    await assert.rejects(storage.write(claims, chunked(Buffer.from('<html><script>alert(1)</script></html>')), 'image/jpeg'), { statusCode: 415 });
    assert.equal(backend.objects.size, 0);
  });

  it('checks the signature of files shorter than the sniff window', async () => {
    const storage = await createStorage(config, { backend: memoryBackend() });
    await assert.rejects(storage.write(claimsFor(storage, 'u1/short.jpg'), Readable.from([Buffer.from('<h')]), 'image/jpeg'), { statusCode: 415 });
    await storage.write(claimsFor(storage, 'u1/tiny.jpg'), Readable.from([Buffer.from([0xff, 0xd8, 0xff])]), 'image/jpeg');
  });

  it('enforces the signed size, the declared type, emptiness and no overwrite', async () => {
    const storage = await createStorage(config, { backend: memoryBackend() });
    await assert.rejects(storage.write(claimsFor(storage, 'u1/big.jpg', 'image/jpeg', 10), chunked(JPEG), 'image/jpeg'), { statusCode: 413 });
    await assert.rejects(storage.write(claimsFor(storage, 'u1/t.jpg'), chunked(JPEG), 'image/png'), { statusCode: 400 });
    await assert.rejects(storage.write(claimsFor(storage, 'u1/e.jpg'), Readable.from([]), 'image/jpeg'), { statusCode: 400 });
    await storage.write(claimsFor(storage, 'u1/once.jpg'), chunked(JPEG), 'image/jpeg');
    await assert.rejects(storage.write(claimsFor(storage, 'u1/once.jpg'), chunked(JPEG), 'image/jpeg'), { statusCode: 409 });
  });

  it('serves full reads, ranges and 416', async () => {
    const storage = await createStorage(config, { backend: memoryBackend() });
    await storage.write(claimsFor(storage, 'u1/r.jpg'), chunked(JPEG), 'image/jpeg');
    const getClaims = { a: 'get', b: 'challenge-evidence', n: 'u1/r.jpg', ct: 'image/jpeg' };
    const full = await storage.open(getClaims);
    assert.equal(full.status, 200);
    assert.deepEqual(await readAll(full.stream), JPEG);
    const part = await storage.open(getClaims, 'bytes=4-7');
    assert.equal(part.status, 206);
    assert.equal((await readAll(part.stream)).toString(), 'fake');
    const suffix = await storage.open(getClaims, 'bytes=-5');
    assert.equal((await readAll(suffix.stream)).toString(), 'bytes');
    assert.equal((await storage.open(getClaims, `bytes=${JPEG.length}-`)).status, 416);
    await assert.rejects(storage.open({ ...getClaims, n: 'u1/missing.jpg' }), { statusCode: 404 });
  });

  it('rejects tampered or wrong-action tokens and unsafe names', async () => {
    const storage = await createStorage(config, { backend: memoryBackend() });
    const token = decodeURIComponent(storage.signedUploadUrl('avatars', 'u1/a.png', 'image/png', 10, 60).split('token=')[1]);
    assert.ok(storage.verify(token, 'put'));
    assert.equal(storage.verify(token, 'get'), null);
    assert.equal(storage.verify(`${token}x`, 'put'), null);
    assert.throws(() => storage.signedUploadUrl('avatars', '../etc/passwd', 'image/png', 10), { statusCode: 400 });
    assert.throws(() => storage.signedUploadUrl('nope', 'a.png', 'image/png', 10), { statusCode: 404 });
  });
});
