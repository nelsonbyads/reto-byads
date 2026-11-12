import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

const BASE = {
  API_JWT_SECRET: 'j'.repeat(40),
  APP_PUBLIC_URL: 'https://app.example.com/',
  DATABASE_URL: 'postgres://u:p@db/x',
  SMTP_HOST: 'smtp.example.com',
  SMTP_FROM: 'DadoFit <no-reply@example.com>',
};
const touched = new Set();
function setEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    touched.add(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('loadConfig', () => {
  afterEach(() => {
    for (const key of touched) delete process.env[key];
    touched.clear();
  });

  it('uses safe defaults: disk storage, no database TLS', () => {
    setEnv(BASE);
    const config = loadConfig();
    assert.equal(config.appPublicUrl, 'https://app.example.com');
    assert.equal(config.storage.driver, 'disk');
    assert.equal(config.storage.s3, null);
    assert.equal(config.database.ssl, false);
    assert.equal(config.auth.secureCookies, true);
  });

  it('reads secrets from <NAME>_FILE and refuses both forms at once', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dadofit-config-'));
    const file = path.join(dir, 'jwt');
    writeFileSync(file, `${'s'.repeat(48)}\n`);
    setEnv({ ...BASE, API_JWT_SECRET: undefined, API_JWT_SECRET_FILE: file });
    assert.equal(loadConfig().auth.jwtSecret, 's'.repeat(48));
    setEnv({ API_JWT_SECRET: 'j'.repeat(40) });
    assert.throws(() => loadConfig(), /either API_JWT_SECRET or API_JWT_SECRET_FILE/);
  });

  it('configures S3 storage and requires its bucket', () => {
    setEnv({ ...BASE, STORAGE_DRIVER: 's3' });
    assert.throws(() => loadConfig(), /S3_BUCKET is required/);
    setEnv({ S3_BUCKET: 'files', AWS_REGION: 'us-east-1', S3_PREFIX: 'prod/' });
    const { s3 } = loadConfig().storage;
    assert.deepEqual({ bucket: s3.bucket, region: s3.region, endpoint: s3.endpoint, prefix: s3.prefix }, { bucket: 'files', region: 'us-east-1', endpoint: '', prefix: 'prod/' });
    setEnv({ STORAGE_DRIVER: 'ftp' });
    assert.throws(() => loadConfig(), /STORAGE_DRIVER must be one of/);
  });

  it('enables verified database TLS with a CA bundle', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dadofit-config-'));
    const ca = path.join(dir, 'ca.pem');
    writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n');
    setEnv({ ...BASE, DATABASE_SSL: 'require' });
    assert.deepEqual(loadConfig().database.ssl, { rejectUnauthorized: false });
    setEnv({ DATABASE_SSL: 'verify-full' });
    assert.throws(() => loadConfig(), /DATABASE_SSL_CA_FILE is required/);
    setEnv({ DATABASE_SSL_CA_FILE: ca });
    const { ssl } = loadConfig().database;
    assert.equal(ssl.rejectUnauthorized, true);
    assert.match(ssl.ca, /BEGIN CERTIFICATE/);
  });
});
