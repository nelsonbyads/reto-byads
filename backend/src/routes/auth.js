import { randomUUID } from 'node:crypto';
import { withSystem } from '../db.js';
import { burnPasswordCheck, hashPassword, isLegacyHash, validatePasswordPolicy, verifyPassword } from '../passwords.js';
import { createOpaqueToken, hashOpaqueToken, safeEqual, signAccessToken } from '../tokens.js';

const REFRESH_COOKIE = 'dadofit_rt';
const CSRF_COOKIE = 'dadofit_csrf';
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

const normalizeEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

function authError(statusCode, message, code) {
  return Object.assign(new Error(message), { statusCode, code, expose: true });
}

export default async function authRoutes(app, { config, pool, mailer }) {
  const auth = config.auth;

  const cookieBase = {
    secure: auth.secureCookies,
    sameSite: 'strict',
    path: '/api/auth',
  };

  async function loadUser(client, userId) {
    const { rows } = await client.query(
      `select u.id, u.email, u.raw_user_meta_data, u.raw_app_meta_data, u.banned_until, u.email_confirmed_at,
              p.display_name, p.username, p.avatar_url, p.signup_intent, p.platform_status
         from auth.users u
         left join public.profiles p on p.id = u.id
        where u.id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  function userDto(row) {
    return {
      id: row.id,
      email: row.email,
      user_metadata: row.raw_user_meta_data ?? {},
      app_metadata: row.raw_app_meta_data ?? {},
      profile: {
        display_name: row.display_name ?? null,
        username: row.username ?? null,
        avatar_url: row.avatar_url ?? null,
        signup_intent: row.signup_intent ?? null,
      },
    };
  }

  const isBanned = (row) =>
    row.platform_status === 'suspended' || (row.banned_until && new Date(row.banned_until) > new Date());

  async function issueSession(client, reply, request, userRow, familyId = randomUUID()) {
    const { token, hash } = createOpaqueToken();
    const expiresAt = new Date(Date.now() + auth.refreshTokenTtlDays * 86400000);
    const { rows } = await client.query(
      `insert into auth.refresh_tokens (user_id, family_id, token_hash, user_agent, ip, expires_at)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [userRow.id, familyId, hash, String(request.headers['user-agent'] ?? '').slice(0, 300), request.ip, expiresAt],
    );
    const csrf = createOpaqueToken().token;
    reply.setCookie(REFRESH_COOKIE, token, { ...cookieBase, httpOnly: true, expires: expiresAt });
    reply.setCookie(CSRF_COOKIE, csrf, { ...cookieBase, path: '/', httpOnly: false, expires: expiresAt });
    const accessToken = signAccessToken(auth.jwtSecret, { sub: userRow.id, role: 'authenticated' }, auth.accessTokenTtlSeconds);
    return { refreshId: rows[0].id, session: { access_token: accessToken, expires_in: auth.accessTokenTtlSeconds, user: userDto(userRow) } };
  }

  function clearSession(reply) {
    reply.clearCookie(REFRESH_COOKIE, cookieBase);
    reply.clearCookie(CSRF_COOKIE, { ...cookieBase, path: '/' });
  }

  function requireCsrf(request) {
    const header = request.headers['x-csrf-token'];
    const cookie = request.cookies?.[CSRF_COOKIE];
    if (!safeEqual(header, cookie)) throw authError(403, 'Solicitud no válida. Recarga la página.', 'csrf_failed');
  }

  async function createOneTimeToken(client, userId, purpose, ttlMinutes) {
    await client.query(
      'update auth.one_time_tokens set used_at = now() where user_id = $1 and purpose = $2 and used_at is null',
      [userId, purpose],
    );
    const { token, hash } = createOpaqueToken();
    await client.query(
      `insert into auth.one_time_tokens (user_id, purpose, token_hash, expires_at)
       values ($1, $2, $3, now() + make_interval(mins => $4))`,
      [userId, purpose, hash, ttlMinutes],
    );
    return token;
  }

  async function consumeOneTimeToken(client, token, purpose) {
    const { rows } = await client.query(
      `update auth.one_time_tokens set used_at = now()
        where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
        returning user_id`,
      [hashOpaqueToken(token), purpose],
    );
    return rows[0]?.user_id ?? null;
  }

  const authRate = { config: { rateLimit: { max: config.rateLimit.authPerMinute, timeWindow: '1 minute' } } };
  const noStore = (reply) => reply.header('cache-control', 'no-store');

  // --- Account enumeration by timing (S5) ---------------------------------
  // Register, forgot-password and resend-confirmation give the same answer
  // whether or not the e-mail has an account. To keep the *response time* from
  // telling them apart too: e-mails are sent after the reply (never awaited by
  // the request), and these endpoints never answer faster than a fixed floor
  // plus jitter, which hides the remaining database differences.
  function sendLater(task) {
    setImmediate(() => {
      task().catch((error) => app.log.error({ err: error.message }, 'deferred mail failed'));
    });
  }

  async function withUniformTiming(fn) {
    const started = Date.now();
    const floor = auth.uniformResponseMs + Math.floor(Math.random() * auth.uniformResponseJitterMs);
    try {
      return await fn();
    } finally {
      const remaining = floor - (Date.now() - started);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }

  // "Someone tried to register with your e-mail" notices, at most one per hour
  // per address so the form cannot be used to flood someone's inbox.
  const accountExistsNotified = new Map();
  function shouldNotifyAccountExists(email) {
    const now = Date.now();
    if ((accountExistsNotified.get(email) ?? 0) > now) return false;
    if (accountExistsNotified.size > 10000) accountExistsNotified.clear();
    accountExistsNotified.set(email, now + 60 * 60 * 1000);
    return true;
  }

  app.post('/register', authRate, async (request, reply) => {
    noStore(reply);
    const email = normalizeEmail(request.body?.email);
    const password = request.body?.password;
    const displayName = String(request.body?.display_name ?? '').trim().slice(0, 80);
    const accountType = ['gym', 'brand'].includes(request.body?.account_type) ? request.body.account_type : 'personal';
    if (!EMAIL_RE.test(email)) throw authError(400, 'Correo no válido.', 'invalid_email');
    const policyError = validatePasswordPolicy(password, auth.passwordMinLength);
    if (policyError) throw authError(400, policyError, 'weak_password');

    if (!auth.requireEmailConfirmation) return registerAndSignIn(request, reply, email, password, displayName, accountType);

    return withUniformTiming(async () => {
      const passwordHash = await hashPassword(password);
      const mail = await withSystem(pool, async (client) => {
        const existing = await client.query('select id from auth.users where lower(email) = $1', [email]);
        if (existing.rowCount) {
          // Same answer as a new account; the owner gets a notice instead.
          return shouldNotifyAccountExists(email)
            ? () => mailer.sendAccountExists(email, `${config.appPublicUrl}/login`, `${config.appPublicUrl}/forgot-password`)
            : null;
        }
        const { rows } = await client.query(
          `insert into auth.users (email, encrypted_password, raw_user_meta_data, email_confirmed_at)
           values ($1, $2, $3, null) returning id`,
          [email, passwordHash, { display_name: displayName, account_type: accountType }],
        );
        const token = await createOneTimeToken(client, rows[0].id, 'email_confirmation', 24 * 60);
        return () => mailer.sendEmailConfirmation(email, `${config.appPublicUrl}/login#confirm=${encodeURIComponent(token)}`);
      });
      if (mail) sendLater(mail);
      return { requiresEmailConfirmation: true };
    });
  });

  // Development mode without e-mail confirmation: the account is usable at once,
  // so a duplicate e-mail is reported plainly.
  async function registerAndSignIn(request, reply, email, password, displayName, accountType) {
    const passwordHash = await hashPassword(password);
    return withSystem(pool, async (client) => {
      const existing = await client.query('select id from auth.users where lower(email) = $1', [email]);
      if (existing.rowCount) throw authError(409, 'Ya existe una cuenta con ese correo.', 'user_exists');
      const { rows } = await client.query(
        `insert into auth.users (email, encrypted_password, raw_user_meta_data, email_confirmed_at)
         values ($1, $2, $3, $4) returning id`,
        [email, passwordHash, { display_name: displayName, account_type: accountType }, new Date()],
      );
      const user = await loadUser(client, rows[0].id);
      const { session } = await issueSession(client, reply, request, user);
      return { requiresEmailConfirmation: false, session };
    });
  }

  app.post('/login', authRate, async (request, reply) => {
    noStore(reply);
    const email = normalizeEmail(request.body?.email);
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    const invalid = authError(400, 'Correo o contraseña incorrectos.', 'invalid_credentials');

    return withSystem(pool, async (client) => {
      // Lockout is counted per account *and source IP*, so a third party cannot
      // lock someone out by failing on purpose; a much higher per-account limit
      // across all IPs still stops distributed guessing.
      const { rows: failures } = await client.query(
        `select count(*) filter (where ip = $3)::int as from_ip, count(*)::int as total
           from auth.login_attempts
          where lower(email) = $1 and not succeeded and created_at > now() - make_interval(mins => $2)`,
        [email, auth.lockoutMinutes, request.ip],
      );
      if (failures[0].from_ip >= auth.maxFailedLogins || failures[0].total >= auth.maxFailedLoginsPerAccount) {
        throw authError(429, `Demasiados intentos. Espera ${auth.lockoutMinutes} minutos e inténtalo de nuevo.`, 'locked');
      }

      const { rows } = await client.query('select id, encrypted_password from auth.users where lower(email) = $1', [email]);
      const found = rows[0];
      const ok = found ? await verifyPassword(password, found.encrypted_password) : (await burnPasswordCheck(password), false);
      await client.query('insert into auth.login_attempts (email, ip, succeeded) values ($1, $2, $3)', [email, request.ip, ok]);
      if (!ok) return { __error: invalid };

      const user = await loadUser(client, found.id);
      if (isBanned(user)) return { __error: authError(403, 'Tu cuenta está suspendida. Contacta a soporte.', 'user_banned') };
      if (!user.email_confirmed_at) return { __error: authError(403, 'Debes confirmar tu correo antes de iniciar sesión.', 'email_not_confirmed') };

      if (isLegacyHash(found.encrypted_password)) {
        await client.query('update auth.users set encrypted_password = $2 where id = $1', [found.id, await hashPassword(password)]);
      }
      await client.query('update auth.users set last_sign_in_at = now() where id = $1', [found.id]);
      const { session } = await issueSession(client, reply, request, user);
      return { session };
    }).then((result) => {
      // Failed attempts are committed (so lockout counts them) before replying.
      if (result.__error) throw result.__error;
      return result;
    });
  });

  app.post('/refresh', authRate, async (request, reply) => {
    noStore(reply);
    requireCsrf(request);
    const token = request.cookies?.[REFRESH_COOKIE];
    if (!token) {
      clearSession(reply);
      return reply.code(401).send({ message: 'Sesión no iniciada.', code: 'no_session' });
    }
    const result = await withSystem(pool, async (client) => {
      const { rows } = await client.query(
        `select id, user_id, family_id, expires_at, revoked_at, replaced_by,
                revoked_at > now() - make_interval(secs => $2) as rotated_recently
           from auth.refresh_tokens where token_hash = $1 for update`,
        [hashOpaqueToken(token), auth.refreshReuseGraceSeconds],
      );
      const current = rows[0];
      if (!current) return null;
      if (current.revoked_at) {
        // Two tabs (or a retried request) can refresh with the same cookie at
        // the same time: the second one finds the token just rotated by the
        // first. Within a short grace window that is not theft, as long as the
        // session family is still alive (not logged out or revoked).
        const benignRace = current.replaced_by && current.rotated_recently
          && (await client.query(
            'select 1 from auth.refresh_tokens where family_id = $1 and revoked_at is null and expires_at > now() limit 1',
            [current.family_id],
          )).rowCount > 0;
        if (!benignRace) {
          // Reuse of a rotated token: assume theft and end the whole family.
          await client.query('update auth.refresh_tokens set revoked_at = now() where family_id = $1 and revoked_at is null', [current.family_id]);
          return null;
        }
      }
      if (new Date(current.expires_at) <= new Date()) return null;
      const user = await loadUser(client, current.user_id);
      if (!user || isBanned(user)) {
        await client.query('update auth.refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [current.user_id]);
        return null;
      }
      const issued = await issueSession(client, reply, request, user, current.family_id);
      if (!current.revoked_at) {
        await client.query('update auth.refresh_tokens set revoked_at = now(), replaced_by = $2 where id = $1', [current.id, issued.refreshId]);
      }
      return issued.session;
    });
    if (!result) {
      clearSession(reply);
      return reply.code(401).send({ message: 'La sesión expiró. Inicia sesión de nuevo.', code: 'session_expired' });
    }
    return { session: result };
  });

  app.post('/logout', async (request, reply) => {
    noStore(reply);
    requireCsrf(request);
    const token = request.cookies?.[REFRESH_COOKIE];
    if (token) {
      await pool.query('update auth.refresh_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null', [hashOpaqueToken(token)]);
    }
    clearSession(reply);
    return reply.code(204).send();
  });

  app.get('/me', async (request, reply) => {
    noStore(reply);
    if (!request.userId) throw authError(401, 'Sesión no iniciada.', 'no_session');
    const user = await withSystem(pool, (client) => loadUser(client, request.userId));
    if (!user) throw authError(401, 'Sesión no iniciada.', 'no_session');
    return { user: userDto(user) };
  });

  app.post('/password/forgot', authRate, async (request, reply) => {
    noStore(reply);
    const email = normalizeEmail(request.body?.email);
    // Always the same answer and timing (no account enumeration, S5).
    await withUniformTiming(async () => {
      if (!EMAIL_RE.test(email)) return;
      const mail = await withSystem(pool, async (client) => {
        const { rows } = await client.query('select id from auth.users where lower(email) = $1', [email]);
        if (!rows[0]) return null;
        const token = await createOneTimeToken(client, rows[0].id, 'password_recovery', 30);
        return () => mailer.sendPasswordRecovery(email, `${config.appPublicUrl}/reset-password#token=${encodeURIComponent(token)}`);
      });
      if (mail) sendLater(mail);
    });
    return reply.code(204).send();
  });

  app.post('/password/reset', authRate, async (request, reply) => {
    noStore(reply);
    const token = String(request.body?.token ?? '');
    const policyError = validatePasswordPolicy(request.body?.password, auth.passwordMinLength);
    if (policyError) throw authError(400, policyError, 'weak_password');
    const passwordHash = await hashPassword(request.body.password);
    const done = await withSystem(pool, async (client) => {
      const userId = await consumeOneTimeToken(client, token, 'password_recovery');
      if (!userId) return false;
      await client.query('update auth.users set encrypted_password = $2, updated_at = now() where id = $1', [userId, passwordHash]);
      // A recovery link proves control of the mailbox: confirm the e-mail too.
      await client.query('update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1', [userId]);
      await client.query('update auth.refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [userId]);
      return true;
    });
    if (!done) throw authError(400, 'El enlace de recuperación no es válido o ya expiró.', 'invalid_token');
    clearSession(reply);
    return reply.code(204).send();
  });

  app.post('/password/change', authRate, async (request, reply) => {
    noStore(reply);
    if (!request.userId) throw authError(401, 'Sesión no iniciada.', 'no_session');
    const policyError = validatePasswordPolicy(request.body?.new_password, auth.passwordMinLength);
    if (policyError) throw authError(400, policyError, 'weak_password');
    const ok = await withSystem(pool, async (client) => {
      const { rows } = await client.query('select encrypted_password from auth.users where id = $1 for update', [request.userId]);
      if (!rows[0] || !(await verifyPassword(String(request.body?.current_password ?? ''), rows[0].encrypted_password))) return false;
      await client.query('update auth.users set encrypted_password = $2, updated_at = now() where id = $1', [request.userId, await hashPassword(request.body.new_password)]);
      // Other devices are signed out; the current one keeps its session.
      const current = request.cookies?.[REFRESH_COOKIE];
      await client.query(
        'update auth.refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null and token_hash <> $2',
        [request.userId, current ? hashOpaqueToken(current) : ''],
      );
      return true;
    });
    if (!ok) throw authError(400, 'La contraseña actual no es correcta.', 'invalid_credentials');
    return reply.code(204).send();
  });

  app.post('/email/confirm', authRate, async (request, reply) => {
    noStore(reply);
    const ok = await withSystem(pool, async (client) => {
      const userId = await consumeOneTimeToken(client, String(request.body?.token ?? ''), 'email_confirmation');
      if (!userId) return false;
      await client.query('update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1', [userId]);
      return true;
    });
    if (!ok) throw authError(400, 'El enlace de confirmación no es válido o ya expiró.', 'invalid_token');
    return reply.code(204).send();
  });

  app.post('/email/resend', authRate, async (request, reply) => {
    noStore(reply);
    const email = normalizeEmail(request.body?.email);
    await withUniformTiming(async () => {
      if (!EMAIL_RE.test(email)) return;
      const mail = await withSystem(pool, async (client) => {
        const { rows } = await client.query('select id from auth.users where lower(email) = $1 and email_confirmed_at is null', [email]);
        if (!rows[0]) return null;
        const token = await createOneTimeToken(client, rows[0].id, 'email_confirmation', 24 * 60);
        return () => mailer.sendEmailConfirmation(email, `${config.appPublicUrl}/login#confirm=${encodeURIComponent(token)}`);
      });
      if (mail) sendLater(mail);
    });
    return reply.code(204).send();
  });
}
