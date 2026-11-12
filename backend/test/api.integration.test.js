// Integration tests against a running stack (API + Postgres + Mailpit).
//
//   BASE_URL            API base (default http://127.0.0.1:8782)
//   MAILPIT_URL         Mailpit HTTP API (default http://127.0.0.1:8785)
//   DATABASE_ADMIN_URL  owner connection, only for fixtures (platform admin, suspension checks)
//
// Run: npm test   (from backend/, with the stack up)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8782';
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8785';
const admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
const RUN = randomUUID().slice(0, 8);
const PASSWORD = `Dadofit-${RUN}-2026`;

class Client {
  constructor() {
    this.cookies = new Map();
    this.token = null;
  }
  async request(method, path, body, { raw, headers = {} } = {}) {
    const all = { ...headers };
    if (this.cookies.size) all.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (this.token) all.authorization = `Bearer ${this.token}`;
    if (this.cookies.has('dadofit_csrf')) all['x-csrf-token'] = this.cookies.get('dadofit_csrf');
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) {
      all['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${BASE_URL}${path}`, { method, headers: all, body: payload });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const [name, ...rest] = pair.split('=');
      const value = rest.join('=');
      if (!value || /Expires=Thu, 01 Jan 1970/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  }
  rpc(name, params = {}) {
    return this.request('POST', `/api/rpc/${name}`, params);
  }
  query(body) {
    return this.request('POST', '/api/db/query', body);
  }
}

async function latestMailToken(email, pathPart) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const list = await (await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const message = list.messages?.[0];
    if (message) {
      const full = await (await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)).json();
      const match = new RegExp(`${pathPart}#(?:confirm|token)=([A-Za-z0-9_%-]+)`).exec(full.Text);
      if (match) return decodeURIComponent(match[1]);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`no e-mail for ${email}`);
}

async function registerConfirmed(label) {
  const client = new Client();
  const email = `${label}-${RUN}@test.local`;
  const reg = await client.request('POST', '/api/auth/register', { email, password: PASSWORD, display_name: label });
  assert.equal(reg.status, 200, JSON.stringify(reg.json));
  assert.equal(reg.json.requiresEmailConfirmation, true);
  const token = await latestMailToken(email, '/login');
  assert.equal((await client.request('POST', '/api/auth/email/confirm', { token })).status, 204);
  const login = await client.request('POST', '/api/auth/login', { email, password: PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  client.token = login.json.session.access_token;
  client.user = login.json.session.user;
  client.email = email;
  return client;
}

describe('DadoFit API', () => {
  let a;
  let b;
  let stranger;

  before(async () => {
    a = await registerConfirmed('alice');
    b = await registerConfirmed('bob');
    stranger = await registerConfirmed('eve');
  });

  after(async () => {
    await admin.end();
  });

  it('reports health and readiness', async () => {
    assert.deepEqual((await new Client().request('GET', '/api/health')).json, { status: 'ok' });
    assert.equal((await new Client().request('GET', '/api/ready')).status, 200);
  });

  it('enforces the password policy and confirmation', async () => {
    const weak = await new Client().request('POST', '/api/auth/register', { email: `weak-${RUN}@test.local`, password: 'short' });
    assert.equal(weak.status, 400);
    const email = `pending-${RUN}@test.local`;
    const client = new Client();
    await client.request('POST', '/api/auth/register', { email, password: PASSWORD });
    const login = await client.request('POST', '/api/auth/login', { email, password: PASSWORD });
    assert.equal(login.status, 403);
    assert.equal(login.json.code, 'email_not_confirmed');
  });

  it('does not reveal whether an e-mail is registered', async () => {
    const again = await new Client().request('POST', '/api/auth/register', { email: a.email, password: PASSWORD });
    assert.equal(again.status, 200);
    assert.equal(again.json.requiresEmailConfirmation, true);
    const forgot = await new Client().request('POST', '/api/auth/password/forgot', { email: `nobody-${RUN}@test.local` });
    assert.equal(forgot.status, 204);

    // The owner of the existing account is told about the attempt instead.
    let notice = null;
    for (let attempt = 0; attempt < 30 && !notice; attempt += 1) {
      const list = await (await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${a.email} subject:"Intento de registro"`)}`)).json();
      notice = list.messages?.[0] ?? null;
      if (!notice) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(notice, 'account-exists notice e-mail');
  });

  it('answers at the same pace whether or not the account exists (S5)', async () => {
    const timed = async (path, email) => {
      const started = performance.now();
      const res = await new Client().request('POST', path, { email });
      return { status: res.status, ms: performance.now() - started };
    };
    for (const path of ['/api/auth/password/forgot', '/api/auth/email/resend']) {
      const existing = await timed(path, path.endsWith('resend') ? `pending-${RUN}@test.local` : a.email);
      const missing = await timed(path, `ghost-${randomUUID()}@test.local`);
      assert.equal(existing.status, 204);
      assert.equal(missing.status, 204);
      // Both take at least the uniform floor (400 ms by default) and differ by
      // less than the jitter plus some network noise.
      assert.ok(existing.ms >= 390 && missing.ms >= 390, JSON.stringify({ path, existing, missing }));
      assert.ok(Math.abs(existing.ms - missing.ms) < 200, JSON.stringify({ path, existing, missing }));
    }
  });

  it('returns the session user and bootstraps the profile', async () => {
    const me = await a.request('GET', '/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, a.email);
    assert.equal(me.json.user.profile.display_name, 'alice');
  });

  it('accepts concurrent refreshes from several tabs (S1)', async () => {
    const tab2 = new Client();
    tab2.cookies = new Map(a.cookies);
    const [first, second] = await Promise.all([a.request('POST', '/api/auth/refresh'), tab2.request('POST', '/api/auth/refresh')]);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(second.status, 200, JSON.stringify(second.json));
    // Neither request was taken for theft: both new tokens keep working.
    assert.equal((await tab2.request('POST', '/api/auth/refresh')).status, 200);
    const again = await a.request('POST', '/api/auth/refresh');
    assert.equal(again.status, 200);
    a.token = again.json.session.access_token;
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const stolen = a.cookies.get('dadofit_rt');
    const refreshed = await a.request('POST', '/api/auth/refresh');
    assert.equal(refreshed.status, 200);
    a.token = refreshed.json.session.access_token;
    // Past the concurrent-refresh grace window, reuse means theft.
    await admin.query(
      "update auth.refresh_tokens set revoked_at = revoked_at - interval '1 hour' where token_hash = encode(sha256(convert_to($1, 'utf8')), 'hex')",
      [stolen],
    );
    const attacker = new Client();
    attacker.cookies.set('dadofit_rt', stolen);
    attacker.cookies.set('dadofit_csrf', 'x');
    const reused = await attacker.request('POST', '/api/auth/refresh');
    assert.equal(reused.status, 401);
    // The whole family is revoked: the legitimate refresh token no longer works either.
    assert.equal((await a.request('POST', '/api/auth/refresh')).status, 401);
    const login = await a.request('POST', '/api/auth/login', { email: a.email, password: PASSWORD });
    a.token = login.json.session.access_token;
  });

  it('requires the CSRF header on refresh', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `dadofit_rt=${a.cookies.get('dadofit_rt')}` },
    });
    assert.equal(res.status, 403);
  });

  it('applies RLS through the generic query endpoint', async () => {
    const wallet = await a.query({ table: 'wallets', action: 'select', columns: 'balance, user_id', single: 'single', filters: [{ column: 'user_id', op: 'eq', value: a.user.id }] });
    assert.equal(wallet.status, 200, JSON.stringify(wallet.json));
    assert.equal(wallet.json.data.user_id, a.user.id);
    const others = await a.query({ table: 'wallets', action: 'select', columns: 'user_id', filters: [{ column: 'user_id', op: 'eq', value: b.user.id }] });
    assert.deepEqual(others.json.data, []);
    const anon = await new Client().query({ table: 'wallets', action: 'select', columns: 'balance' });
    assert.equal(anon.status, 403);
    const forbiddenTable = await a.query({ table: 'platform_admins', action: 'select' });
    assert.equal(forbiddenTable.status, 404);
    const forbiddenAction = await a.query({ table: 'wallets', action: 'update', values: { balance: 999 }, filters: [{ column: 'user_id', op: 'eq', value: a.user.id }] });
    assert.equal(forbiddenAction.status, 403);
    const badColumn = await a.query({ table: 'profiles', action: 'select', columns: 'id; drop table x' });
    assert.equal(badColumn.status, 400);
  });

  it('only exposes allowlisted functions', async () => {
    assert.equal((await a.rpc('consume_dc_budget_internal', {})).status, 404);
    const ctx = await a.rpc('get_dadofit_workspace_context');
    assert.equal(ctx.status, 200);
    assert.ok(Array.isArray(ctx.json.data.workspaces));
    const business = await a.rpc('redeem_reward', { p_reward_id: randomUUID(), p_payment_method: 'dc' });
    assert.equal(business.status, 400);
    assert.match(business.json.message, /reward not found/);
  });

  it('answers is_platform_admin only about the caller', async () => {
    const { rows } = await admin.query("insert into public.platform_admins (user_id, role, active) values ($1, 'superadmin', true) returning user_id", [stranger.user.id]);
    assert.equal(rows.length, 1);
    const probe = await a.rpc('is_platform_admin', { p_user_id: stranger.user.id });
    assert.equal(probe.json.data, false);
    const self = await stranger.rpc('is_platform_admin', { p_user_id: a.user.id });
    assert.equal(self.json.data, true);
  });

  it('uploads, signs, streams and removes challenge evidence under storage RLS', async () => {
    assert.equal((await a.query({ table: 'friendships', action: 'insert', values: { requester_id: a.user.id, addressee_id: b.user.id, status: 'pending' } })).status, 200);
    const pending = await b.query({ table: 'friendships', action: 'select', columns: 'id', filters: [{ column: 'requester_id', op: 'eq', value: a.user.id }] });
    const accept = await b.query({ table: 'friendships', action: 'update', values: { status: 'accepted' }, filters: [{ column: 'id', op: 'eq', value: pending.json.data[0].id }] });
    assert.equal(accept.status, 200, JSON.stringify(accept.json));

    const created = await a.rpc('create_direct_challenge', { p_recipient_id: b.user.id, p_exercise_id: 'x1', p_exercise_name: 'Sentadilla', p_reps: 12, p_dice_level: 'amateur' });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const parts = await b.query({ table: 'challenge_participants', action: 'select', columns: 'id, user_id, challenge_id', filters: [{ column: 'user_id', op: 'eq', value: b.user.id }] });
    const participant = parts.json.data[0];
    assert.equal((await b.rpc('respond_direct_challenge', { p_participant_id: participant.id, p_accept: true })).status, 200);

    const path = `${b.user.id}/${participant.id}/${randomUUID()}-proof.jpg`;
    // A real JPEG header (the API checks magic bytes, S6) followed by filler.
    const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake-jpeg-content-0123456789')]);

    // Someone else cannot write into b's folder.
    const intruder = await stranger.request('POST', '/api/files/upload-url', { bucket: 'challenge-evidence', path, content_type: 'image/jpeg', size: bytes.length });
    assert.equal(intruder.status, 403);
    const badType = await b.request('POST', '/api/files/upload-url', { bucket: 'challenge-evidence', path, content_type: 'text/html', size: bytes.length });
    assert.equal(badType.status, 415);

    // Evidence row without an uploaded file is rejected (SEC-09).
    const early = await b.query({ table: 'challenge_evidence', action: 'insert', values: { participant_id: participant.id, evidence_kind: 'image', storage_path: path, file_name: 'proof.jpg', mime_type: 'image/jpeg', size_bytes: bytes.length } });
    assert.equal(early.status, 400);

    // Content that is not what it claims to be is refused and not stored (S6).
    const fakePath = `${b.user.id}/${participant.id}/${randomUUID()}-fake.jpg`;
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const fakeUp = await b.request('POST', '/api/files/upload-url', { bucket: 'challenge-evidence', path: fakePath, content_type: 'image/jpeg', size: html.length });
    assert.equal(fakeUp.status, 200, JSON.stringify(fakeUp.json));
    const fakePut = await fetch(`${BASE_URL}${fakeUp.json.data.signedUrl}`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: html });
    assert.equal(fakePut.status, 415);
    const fakeSigned = await b.request('POST', '/api/files/sign', { bucket: 'challenge-evidence', path: fakePath });
    if (fakeSigned.status === 200) assert.equal((await fetch(`${BASE_URL}${fakeSigned.json.data.signedUrl}`)).status, 404);
    await b.request('POST', '/api/files/remove', { bucket: 'challenge-evidence', paths: [fakePath] });

    const up = await b.request('POST', '/api/files/upload-url', { bucket: 'challenge-evidence', path, content_type: 'image/jpeg', size: bytes.length });
    assert.equal(up.status, 200, JSON.stringify(up.json));
    const put = await fetch(`${BASE_URL}${up.json.data.signedUrl}`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: bytes });
    assert.equal(put.status, 200);
    const overwrite = await fetch(`${BASE_URL}${up.json.data.signedUrl}`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: bytes });
    assert.equal(overwrite.status, 409);

    const row = await b.query({ table: 'challenge_evidence', action: 'insert', values: { participant_id: participant.id, evidence_kind: 'image', storage_path: path, file_name: 'proof.jpg', mime_type: 'image/jpeg', size_bytes: bytes.length } });
    assert.equal(row.status, 200, JSON.stringify(row.json));

    const signed = await b.request('POST', '/api/files/sign', { bucket: 'challenge-evidence', path, expires_in: 120 });
    assert.equal(signed.status, 200);
    const ranged = await fetch(`${BASE_URL}${signed.json.data.signedUrl}`, { headers: { range: 'bytes=4-7' } });
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), 'fake');
    assert.equal(ranged.headers.get('content-type'), 'image/jpeg');

    assert.equal((await stranger.request('POST', '/api/files/sign', { bucket: 'challenge-evidence', path })).status, 404);
    const tampered = signed.json.data.signedUrl.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    assert.equal((await fetch(`${BASE_URL}${tampered}`)).status, 403);

    assert.equal((await b.query({ table: 'challenge_evidence', action: 'delete', filters: [{ column: 'storage_path', op: 'eq', value: path }] })).status, 200);
    const strangerRemove = await stranger.request('POST', '/api/files/remove', { bucket: 'challenge-evidence', paths: [path] });
    assert.deepEqual(strangerRemove.json.data, []);
    const removed = await b.request('POST', '/api/files/remove', { bucket: 'challenge-evidence', paths: [path] });
    assert.deepEqual(removed.json.data, [{ name: path }]);
  });

  it('cuts off suspended accounts (SEC-01)', async () => {
    const victim = await registerConfirmed('mallory');
    // `stranger` was made platform superadmin in an earlier test.
    const suspend = await stranger.rpc('admin_set_user_status', { p_user_id: victim.user.id, p_status: 'suspended', p_reason: 'integration test' });
    assert.equal(suspend.status, 200, JSON.stringify(suspend.json));
    // Refresh token was revoked by the suspension.
    const accessToken = victim.token;
    victim.token = null;
    assert.equal((await victim.request('POST', '/api/auth/refresh')).status, 401);
    victim.token = accessToken;
    const login = await victim.request('POST', '/api/auth/login', { email: victim.email, password: PASSWORD });
    assert.equal(login.status, 403);
    assert.equal(login.json.code, 'user_banned');
    // The still-valid access token is rejected once the ban cache expires (≤15 s).
    let status = 0;
    for (let attempt = 0; attempt < 20 && status !== 403; attempt += 1) {
      status = (await victim.rpc('get_dadofit_workspace_context')).status;
      if (status !== 403) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.equal(status, 403);
  });

  it('recovers a password with a single-use e-mail token', async () => {
    const user = await registerConfirmed('trent');
    assert.equal((await new Client().request('POST', '/api/auth/password/forgot', { email: user.email })).status, 204);
    const token = await latestMailToken(user.email, '/reset-password');
    const next = `${PASSWORD}-new1`;
    assert.equal((await new Client().request('POST', '/api/auth/password/reset', { token, password: next })).status, 204);
    assert.equal((await new Client().request('POST', '/api/auth/password/reset', { token, password: next })).status, 400);
    assert.equal((await new Client().request('POST', '/api/auth/login', { email: user.email, password: PASSWORD })).status, 400);
    assert.equal((await new Client().request('POST', '/api/auth/login', { email: user.email, password: next })).status, 200);
  });

  it('locks repeated failed logins per source without locking the owner out (S2)', async () => {
    const user = await registerConfirmed('mallory-target');
    const attackerIp = { headers: { 'x-forwarded-for': '10.9.0.1' } };
    let last;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = await new Client().request('POST', '/api/auth/login', { email: user.email, password: 'wrong-password-1' }, attackerIp);
    }
    assert.equal(last.status, 429);
    assert.equal(last.json.code, 'locked');
    // Even the right password is refused from the attacking source…
    assert.equal((await new Client().request('POST', '/api/auth/login', { email: user.email, password: PASSWORD }, attackerIp)).status, 429);
    // …but the owner, from another IP, can still sign in.
    const owner = await new Client().request('POST', '/api/auth/login', { email: user.email, password: PASSWORD }, { headers: { 'x-forwarded-for': '10.9.0.2' } });
    assert.equal(owner.status, 200, JSON.stringify(owner.json));
  });

  it('purges expired auth bookkeeping (S4)', async () => {
    const { purgeAuthTables } = await import('../src/maintenance.js');
    const user = await registerConfirmed('purge');
    const { rows } = await admin.query(
      `insert into auth.login_attempts (email, ip, succeeded, created_at)
       values ($1, '10.9.9.9', false, now() - interval '40 days'), ($1, '10.9.9.9', false, now())
       returning id`,
      [user.email],
    );
    await admin.query(
      `insert into auth.one_time_tokens (user_id, purpose, token_hash, expires_at)
       values ($1, 'password_recovery', $2, now() - interval '10 days')`,
      [user.user.id, `purge-test-${RUN}`],
    );
    const removed = await purgeAuthTables(admin);
    assert.ok(removed.loginAttempts >= 1);
    assert.ok(removed.oneTimeTokens >= 1);
    const left = await admin.query('select id from auth.login_attempts where id = any($1)', [rows.map((r) => r.id)]);
    assert.deepEqual(left.rows.map((r) => r.id), [rows[1].id]);
    // The live session is untouched.
    assert.equal((await user.request('POST', '/api/auth/refresh')).status, 200);
  });
});
