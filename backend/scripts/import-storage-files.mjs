// Copies file bytes from Supabase Storage into the API's storage backend (the
// local volume, or S3 when STORAGE_DRIVER=s3),
// for every object already imported into storage.objects (see
// infra/scripts/import-from-supabase.sh). Idempotent: existing files are kept.
//
// Environment:
//   DATABASE_ADMIN_URL      stack database (owner) — lists the objects to copy
//   STORAGE_DRIVER          disk (default) or s3
//   STORAGE_DIR             target directory when disk (the API's storage volume)
//   S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_FORCE_PATH_STYLE, S3_PREFIX   when s3
//   SOURCE_STORAGE_URL      e.g. https://<project>.supabase.co/storage/v1  or  http://host:54321/storage/v1
//   SOURCE_SERVICE_KEY      Supabase service role key (read access to private buckets)
//
// Run inside the API image so the volume is mounted:
//   docker compose -f infra/docker-compose.yml --env-file infra/.env run --rm \
//     -e DATABASE_ADMIN_URL=… -e SOURCE_STORAGE_URL=… -e SOURCE_SERVICE_KEY=… \
//     api node scripts/import-storage-files.mjs

import { Readable } from 'node:stream';
import pg from 'pg';
import { createDiskBackend } from '../src/storageDisk.js';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

async function createBackend() {
  if ((process.env.STORAGE_DRIVER ?? 'disk') !== 's3') return createDiskBackend(required('STORAGE_DIR'));
  const { createS3Backend } = await import('../src/storageS3.js');
  return createS3Backend({
    bucket: required('S3_BUCKET'),
    region: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || '',
    forcePathStyle: ['1', 'true', 'yes'].includes(String(process.env.S3_FORCE_PATH_STYLE).toLowerCase()),
    prefix: process.env.S3_PREFIX || '',
    serverSideEncryption: process.env.S3_SERVER_SIDE_ENCRYPTION || '',
  });
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const backend = await createBackend();
const sourceUrl = required('SOURCE_STORAGE_URL').replace(/\/+$/, '');
const serviceKey = required('SOURCE_SERVICE_KEY');
const pool = new pg.Pool({ connectionString: required('DATABASE_ADMIN_URL'), max: 2 });

const { rows } = await pool.query('select bucket_id, name, metadata from storage.objects order by bucket_id, name');
let copied = 0;
let skipped = 0;
const failed = [];

for (const { bucket_id: bucket, name, metadata } of rows) {
  if (!NAME_RE.test(name) || name.includes('..')) {
    failed.push(`${bucket}/${name}: unsafe path`);
    continue;
  }
  try {
    if (await backend.exists(bucket, name)) {
      skipped += 1;
      continue;
    }
    const encoded = name.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${sourceUrl}/object/authenticated/${encodeURIComponent(bucket)}/${encoded}`, {
      headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    });
    if (!response.ok || !response.body) {
      failed.push(`${bucket}/${name}: HTTP ${response.status}`);
      continue;
    }
    const contentType = metadata?.mimetype || response.headers.get('content-type') || 'application/octet-stream';
    await backend.put(bucket, name, Readable.fromWeb(response.body), contentType);
    copied += 1;
  } catch (error) {
    failed.push(`${bucket}/${name}: ${error.message}`);
  }
}

await pool.end();
console.log(JSON.stringify({ driver: backend.driver, objects: rows.length, copied, already_present: skipped, failed: failed.length }));
if (failed.length) {
  console.error(failed.join('\n'));
  process.exit(1);
}
