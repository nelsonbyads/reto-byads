// Runtime configuration. Every value comes from the environment; secrets have
// no defaults so a misconfigured deployment fails at startup.
//
// Any variable can instead be read from a file by setting <NAME>_FILE (Docker /
// ECS secrets, AWS Secrets Manager or SSM Parameter Store mounted as files), so
// secrets need not appear in the process environment.

import { readFileSync } from 'node:fs';

function env(name) {
  const file = process.env[`${name}_FILE`];
  if (file && file.trim()) {
    if (process.env[name]) throw new Error(`Set either ${name} or ${name}_FILE, not both`);
    return readFileSync(file.trim(), 'utf8');
  }
  return process.env[name];
}

function required(name) {
  const value = env(name);
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function optional(name, fallback) {
  const value = env(name);
  return value && value.trim() ? value.trim() : fallback;
}

function oneOf(name, allowed, fallback) {
  const value = optional(name, fallback);
  if (!allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

function bool(name, fallback) {
  const value = env(name);
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes'].includes(value.toLowerCase());
}

function int(name, fallback) {
  const value = Number.parseInt(env(name) ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

export function loadConfig() {
  const jwtSecret = required('API_JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('API_JWT_SECRET must have at least 32 characters');

  const appPublicUrl = required('APP_PUBLIC_URL').replace(/\/+$/, '');
  const storageDriver = oneOf('STORAGE_DRIVER', ['disk', 's3'], 'disk');
  const databaseSsl = oneOf('DATABASE_SSL', ['disable', 'require', 'verify-full'], 'disable');

  return {
    port: int('API_PORT', 8782),
    host: optional('API_HOST', '0.0.0.0'),
    production: optional('NODE_ENV', 'development') === 'production',
    appPublicUrl,
    // Number of reverse proxies in front of the API (web nginx = 1; nginx behind
    // an edge TLS proxy = 2). The client IP used for rate limiting is taken
    // from X-Forwarded-For skipping exactly that many trusted hops, so a client
    // cannot spoof it.
    trustProxy: int('API_TRUST_PROXY_HOPS', 1),
    // Managed platforms (e.g. Vercel → Render) put proxies with PUBLIC
    // addresses in front of the API; set this to trust the first
    // API_TRUST_PROXY_HOPS peers regardless of their address.
    trustPublicProxies: bool('API_TRUST_PUBLIC_PROXIES', false),
    database: {
      connectionString: required('DATABASE_URL'),
      max: int('DATABASE_POOL_MAX', 10),
      statementTimeoutMs: int('DATABASE_STATEMENT_TIMEOUT_MS', 15000),
      // TLS to the database (RDS): "verify-full" checks the server certificate
      // against DATABASE_SSL_CA_FILE (the RDS CA bundle); "require" only encrypts.
      ssl: databaseSsl === 'disable'
        ? false
        : {
          rejectUnauthorized: databaseSsl === 'verify-full',
          // Without a CA file the system trust store is used (Neon, managed
          // providers with public certificates); RDS needs its CA bundle.
          ...(databaseSsl === 'verify-full' && optional('DATABASE_SSL_CA_FILE', '')
            ? { ca: readFileSync(required('DATABASE_SSL_CA_FILE'), 'utf8') }
            : {}),
        },
    },
    auth: {
      jwtSecret,
      accessTokenTtlSeconds: int('AUTH_ACCESS_TOKEN_TTL_SECONDS', 900),
      refreshTokenTtlDays: int('AUTH_REFRESH_TOKEN_TTL_DAYS', 30),
      requireEmailConfirmation: bool('AUTH_REQUIRE_EMAIL_CONFIRMATION', true),
      passwordMinLength: int('AUTH_PASSWORD_MIN_LENGTH', 10),
      // Failed logins allowed per account and source IP within the lockout window.
      maxFailedLogins: int('AUTH_MAX_FAILED_LOGINS', 5),
      // Failed logins allowed per account from all IPs together (distributed guessing).
      maxFailedLoginsPerAccount: int('AUTH_MAX_FAILED_LOGINS_PER_ACCOUNT', 50),
      lockoutMinutes: int('AUTH_LOCKOUT_MINUTES', 15),
      // A refresh token rotated less than this many seconds ago is accepted once
      // more (concurrent refreshes from several tabs) instead of being treated as
      // stolen.
      refreshReuseGraceSeconds: int('AUTH_REFRESH_REUSE_GRACE_SECONDS', 10),
      // Minimum response time (+ random jitter) of register / forgot-password /
      // resend-confirmation, so timing does not reveal whether an account exists.
      uniformResponseMs: int('AUTH_UNIFORM_RESPONSE_MS', 400),
      uniformResponseJitterMs: Math.max(1, int('AUTH_UNIFORM_RESPONSE_JITTER_MS', 100)),
      secureCookies: bool('AUTH_SECURE_COOKIES', appPublicUrl.startsWith('https://')),
    },
    storage: {
      driver: storageDriver,
      dir: optional('STORAGE_DIR', '/data/storage'),
      s3: storageDriver === 's3'
        ? {
          bucket: required('S3_BUCKET'),
          region: optional('S3_REGION', optional('AWS_REGION', 'us-east-1')),
          // Only for S3-compatible services (local tests); empty on AWS.
          endpoint: optional('S3_ENDPOINT', ''),
          forcePathStyle: bool('S3_FORCE_PATH_STYLE', false),
          prefix: optional('S3_PREFIX', ''),
          serverSideEncryption: optional('S3_SERVER_SIDE_ENCRYPTION', ''),
        }
        : null,
      // Separate key for file URLs, derived from the JWT secret when not set.
      signingSecret: optional('STORAGE_SIGNING_SECRET', `${jwtSecret}:storage`),
      maxUploadBytes: int('STORAGE_MAX_UPLOAD_BYTES', 52428800),
    },
    smtp: {
      host: required('SMTP_HOST'),
      port: int('SMTP_PORT', 587),
      secure: bool('SMTP_SECURE', false),
      user: optional('SMTP_USER', ''),
      password: optional('SMTP_PASSWORD', ''),
      from: required('SMTP_FROM'),
    },
    maintenance: {
      intervalMinutes: int('AUTH_PURGE_INTERVAL_MINUTES', 60),
      retention: {
        loginAttemptsDays: int('AUTH_LOGIN_ATTEMPTS_RETENTION_DAYS', 30),
        expiredTokensDays: int('AUTH_EXPIRED_TOKENS_RETENTION_DAYS', 7),
      },
    },
    rateLimit: {
      globalPerMinute: int('RATE_LIMIT_GLOBAL_PER_MINUTE', 300),
      authPerMinute: int('RATE_LIMIT_AUTH_PER_MINUTE', 10),
      publicRpcPerMinute: int('RATE_LIMIT_PUBLIC_RPC_PER_MINUTE', 60),
      uploadsPerMinute: int('RATE_LIMIT_UPLOADS_PER_MINUTE', 30),
    },
  };
}
