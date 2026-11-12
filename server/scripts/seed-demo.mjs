// Demo data seeder: fills a LOCAL stack with a large, realistic dataset by
// driving the real API as each kind of user (platform admin, gym owners, brand
// owners, athletes). Every business rule (RLS, budgets, anti-farming, partner
// economies, inventory) is enforced by the same SQL the app uses, so a clean run
// is also an end-to-end test of the flows.
//
// Development only. Requires the API with raised per-IP limits (all simulated
// users share one IP) and the owner connection for the few things that have no
// API (platform admin row, e-mail confirmation shortcut, final invariants):
//
//   RATE_LIMIT_AUTH_PER_MINUTE=10000 RATE_LIMIT_GLOBAL_PER_MINUTE=100000 \
//   RATE_LIMIT_PUBLIC_RPC_PER_MINUTE=100000 RATE_LIMIT_UPLOADS_PER_MINUTE=100000 \
//     docker compose -f infra/docker-compose.yml --env-file infra/.env up -d api
//   DATABASE_ADMIN_URL=postgres://… node scripts/seed-demo.mjs
//
// Options: SEED_ATHLETES (120), SEED_GYMS (6), SEED_BRANDS (4), BASE_URL.
// Demo accounts are written to infra/seed/demo-users.json (git-ignored).

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8782';
const ATHLETES = Number(process.env.SEED_ATHLETES ?? 120);
const GYMS = Number(process.env.SEED_GYMS ?? 6);
const BRANDS = Number(process.env.SEED_BRANDS ?? 4);
// Local demo credential shared by every seeded account (documented in docs/DEMO_LOCAL.md).
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'DadoFit-Demo-2026!';
const DOMAIN = 'demo.dadofit.test';
const USERS_FILE = path.resolve(here, '../../infra/seed/demo-users.json');
const admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 4 });
if (!process.env.DATABASE_ADMIN_URL) throw new Error('DATABASE_ADMIN_URL is required');

// --------------------------------------------------------------------------
// Utilities
// --------------------------------------------------------------------------
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const exercises = JSON.parse(await readFile(path.resolve(here, '../../data/exercises.json'), 'utf8'));
const DICE = ['amateur', 'beginner', 'intermediate', 'advanced'];
let seed = 20261111;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (min, max) => min + Math.floor(rand() * (max - min + 1));
const chance = (p) => rand() < p;
const exercise = () => { const e = pick(exercises); return { id: String(e.id), name: String(e.name).slice(0, 120) }; };
// Demo creatives use the project's own exercise images (served by the web at
// /images/...), so the demo works offline and needs no third-party host.
const LOCAL_IMAGES = (await readdir(path.resolve(here, '../../images'))).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
const img = (key) => {
  let hash = 0;
  for (const ch of String(key)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `/images/${LOCAL_IMAGES[hash % LOCAL_IMAGES.length]}`;
};
const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString();

const stats = { ok: new Map(), failed: new Map() };
async function step(label, fn) {
  try {
    const value = await fn();
    stats.ok.set(label, (stats.ok.get(label) ?? 0) + 1);
    return value;
  } catch (error) {
    const key = `${label}: ${error.message}`.slice(0, 220);
    stats.failed.set(key, (stats.failed.get(key) ?? 0) + 1);
    return null;
  }
}
async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }));
  return results;
}
const log = (msg) => console.log(`[seed ${new Date().toISOString().slice(11, 19)}] ${msg}`);

class ApiError extends Error {
  constructor(status, body) {
    super(`${status} ${typeof body === 'object' && body ? body.message ?? JSON.stringify(body) : body}`);
    this.status = status;
  }
}

class Client {
  constructor(email, name, kind) {
    this.email = email;
    this.name = name;
    this.kind = kind;
    this.cookies = new Map();
    this.token = null;
    this.id = null;
  }
  async raw(method, url, { body, headers = {}, rawBody } = {}) {
    const all = { ...headers };
    if (this.cookies.size) all.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (this.token) all.authorization = `Bearer ${this.token}`;
    if (this.cookies.has('dadofit_csrf')) all['x-csrf-token'] = this.cookies.get('dadofit_csrf');
    let payload = rawBody;
    if (body !== undefined) { all['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(`${BASE_URL}${url}`, { method, headers: all, body: payload });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const [name, ...rest] = pair.split('=');
      this.cookies.set(name, rest.join('='));
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, json };
  }
  async login() {
    const res = await this.raw('POST', '/api/auth/login', { body: { email: this.email, password: DEMO_PASSWORD } });
    if (res.status !== 200) throw new ApiError(res.status, res.json);
    this.token = res.json.session.access_token;
    this.id = res.json.session.user.id;
  }
  async call(method, url, opts) {
    let res = await this.raw(method, url, opts);
    if (res.status === 401 && this.token) { await this.login(); res = await this.raw(method, url, opts); }
    if (res.status >= 400) throw new ApiError(res.status, res.json);
    return res.json;
  }
  async rpc(name, params = {}) {
    return (await this.call('POST', `/api/rpc/${name}`, { body: params }))?.data ?? null;
  }
  async query(body) {
    return (await this.call('POST', '/api/db/query', { body }))?.data ?? null;
  }
  async participantId(challengeId) {
    const rows = await this.query({
      table: 'challenge_participants', action: 'select', columns: 'id,status',
      filters: [{ column: 'challenge_id', op: 'eq', value: challengeId }, { column: 'user_id', op: 'eq', value: this.id }],
    });
    return rows?.[0]?.id ?? null;
  }
  async uploadEvidence(participantId) {
    const objectPath = `${this.id}/${participantId}/${randomUUID()}-evidencia.png`;
    const signed = await this.call('POST', '/api/files/upload-url', {
      body: { bucket: 'challenge-evidence', path: objectPath, content_type: 'image/png', size: PNG.length },
    });
    await this.call('PUT', signed.data.signedUrl, { rawBody: PNG, headers: { 'content-type': 'image/png' } });
    await this.query({
      table: 'challenge_evidence', action: 'insert',
      values: [{ participant_id: participantId, evidence_kind: 'image', storage_path: objectPath, file_name: 'evidencia.png', mime_type: 'image/png', size_bytes: PNG.length }],
    });
  }
}

// --------------------------------------------------------------------------
// Accounts
// --------------------------------------------------------------------------
const FIRST = ['Ana', 'Luis', 'Sofía', 'Mateo', 'Valentina', 'Santiago', 'Camila', 'Andrés', 'Mariana', 'Juan', 'Isabella', 'Daniel', 'Laura', 'Sebastián', 'Paula', 'Nicolás', 'Daniela', 'Felipe', 'Gabriela', 'Tomás'];
const LAST = ['Gómez', 'Rodríguez', 'Martínez', 'López', 'Hernández', 'Díaz', 'Moreno', 'Álvarez', 'Ruiz', 'Torres', 'Ramírez', 'Castro', 'Vargas', 'Rojas', 'Ortiz'];
const GYM_NAMES = ['Iron Temple Medellín', 'Pulso Fitness Bogotá', 'Titan Box Cali', 'Ritmo Gym Barranquilla', 'Cumbre CrossFit Manizales', 'Núcleo Training Bucaramanga', 'Forja Gym Pereira', 'Vértice Fit Cartagena'];
const BRAND_NAMES = ['Andes Sportswear', 'HidraMax Bebidas', 'ProteLab Nutrición', 'Zancada Running', 'Ola Wellness', 'Cima Outdoor'];

async function register(kind, local, displayName, accountType) {
  const client = new Client(`${local}@${DOMAIN}`, displayName, kind);
  const res = await client.raw('POST', '/api/auth/register', { body: { email: client.email, password: DEMO_PASSWORD, display_name: displayName, account_type: accountType } });
  if (res.status !== 200) throw new ApiError(res.status, res.json);
  // Shortcut for local data only: the confirmation e-mail flow is covered by the test suite.
  await admin.query('update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where lower(email) = lower($1)', [client.email]);
  await client.login();
  return client;
}

async function befriend(a, b) {
  await a.query({ table: 'friendships', action: 'insert', values: [{ requester_id: a.id, addressee_id: b.id, status: 'pending' }] });
  await b.query({
    table: 'friendships', action: 'update', values: { status: 'accepted' },
    filters: [{ column: 'requester_id', op: 'eq', value: a.id }, { column: 'addressee_id', op: 'eq', value: b.id }],
  });
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------
async function main() {
  const existing = await admin.query('select count(*)::int as n from auth.users where email like $1', [`%@${DOMAIN}`]);
  if (existing.rows[0].n > 0) {
    throw new Error(`there are already ${existing.rows[0].n} demo accounts (@${DOMAIN}). Restore the pre-seed backup before seeding again.`);
  }
  const started = Date.now();

  log(`registering 1 admin, ${GYMS} gym owners, ${BRANDS} brand owners (+1 brand co-admin), ${ATHLETES} athletes`);
  const superadmin = await register('admin', 'admin', 'Admin DadoFit Demo', 'personal');
  await admin.query("insert into public.platform_admins (user_id, role, active) values ($1, 'superadmin', true) on conflict (user_id) do update set role = 'superadmin', active = true", [superadmin.id]);
  const gymOwners = await pool([...Array(GYMS).keys()], 4, (i) => register('gym', `gym${i + 1}`, `Coach ${pick(FIRST)} ${pick(LAST)}`, 'gym'));
  const brandOwners = await pool([...Array(BRANDS).keys()], 4, (i) => register('brand', `brand${i + 1}`, `Marca ${pick(FIRST)} ${pick(LAST)}`, 'brand'));
  const brandCoAdmin = await register('brand', 'brand1-coadmin', `Auditora ${pick(FIRST)} ${pick(LAST)}`, 'brand');
  const athletes = (await pool([...Array(ATHLETES).keys()], 8, (i) => step('register athlete', () => register('athlete', `atleta${String(i + 1).padStart(3, '0')}`, `${pick(FIRST)} ${pick(LAST)}`, 'personal')))).filter(Boolean);
  await mkdir(path.dirname(USERS_FILE), { recursive: true });
  const describe = (c) => ({ email: c.email, password: DEMO_PASSWORD, name: c.name, id: c.id });
  await writeFile(USERS_FILE, JSON.stringify({
    note: 'Cuentas de demostración locales (sembradas por server/scripts/seed-demo.mjs). No usar fuera de local.',
    admin: describe(superadmin), gymOwners: gymOwners.map(describe), brandOwners: brandOwners.map(describe),
    brandCoAdmin: describe(brandCoAdmin), athletes: athletes.map(describe),
  }, null, 2));
  log(`accounts ready (${athletes.length} athletes) -> ${path.relative(process.cwd(), USERS_FILE)}`);

  // ---- Organizations, verification, economies, budgets ---------------------
  log('creating gyms and brands, verifying them and enabling their economies');
  const gyms = (await pool(gymOwners, 4, (owner, i) => step('create gym', async () => ({
    owner, name: GYM_NAMES[i % GYM_NAMES.length],
    id: await owner.rpc('create_organization', { p_name: GYM_NAMES[i % GYM_NAMES.length], p_organization_type: 'gym', p_description: 'Gimnasio de demostración con clases funcionales, pesas y retos semanales.', p_website_url: `https://gym${i + 1}.${DOMAIN}`, p_country_code: 'CO' }),
  })))).filter(Boolean);
  const brands = (await pool(brandOwners, 4, (owner, i) => step('create brand', async () => ({
    owner, name: BRAND_NAMES[i % BRAND_NAMES.length],
    id: await owner.rpc('create_organization', { p_name: BRAND_NAMES[i % BRAND_NAMES.length], p_organization_type: 'brand', p_description: 'Marca aliada de demostración que patrocina retos y premios.', p_website_url: `https://brand${i + 1}.${DOMAIN}`, p_country_code: 'CO' }),
  })))).filter(Boolean);
  const POINT_NAMES = [['Iron Points', 'IRP'], ['Pulso Points', 'PLS'], ['Titan Coins', 'TTC'], ['Ritmo Points', 'RTM'], ['Cumbre Points', 'CMB'], ['Núcleo Points', 'NCL'], ['Andes Points', 'AND'], ['Hidra Points', 'HDR'], ['Prote Points', 'PRT'], ['Zancada Points', 'ZNC']];
  for (const [i, org] of [...gyms, ...brands].entries()) {
    await step('verify org', () => superadmin.rpc('admin_set_organization_verification', { p_organization_id: org.id, p_status: 'verified', p_reason: null }));
    const [name, short] = POINT_NAMES[i % POINT_NAMES.length];
    await step('enable partner economy', () => superadmin.rpc('admin_update_partner_point_config', { p_organization_id: org.id, p_points_name: name, p_points_short_name: short, p_points_icon: null, p_points_color: pick(['#22c55e', '#f97316', '#3b82f6', '#eab308', '#a855f7']), p_enabled: true }));
    const budget = await step('create DC budget', () => superadmin.rpc('superadmin_create_dc_budget', { p_budget_dc: 5000, p_organization_id: org.id, p_is_dadofit_internal: false, p_starts_at: iso(-1), p_ends_at: iso(90) }));
    const budgetId = Array.isArray(budget) ? budget[0]?.id : budget?.id;
    if (budgetId) await step('approve DC budget', () => superadmin.rpc('superadmin_approve_dc_budget', { p_budget_id: budgetId }));
  }
  const internal = await step('create internal DC budget', () => superadmin.rpc('superadmin_create_dc_budget', { p_budget_dc: 50000, p_is_dadofit_internal: true, p_starts_at: iso(-1), p_ends_at: iso(90) }));
  const internalId = Array.isArray(internal) ? internal[0]?.id : internal?.id;
  if (internalId) await step('approve internal DC budget', () => superadmin.rpc('superadmin_approve_dc_budget', { p_budget_id: internalId }));

  // ---- Gym memberships ------------------------------------------------------
  log('building gym communities (Gymbros -> invitations -> memberships)');
  const membersOf = new Map(gyms.map((g) => [g.id, []]));
  const gymsOf = new Map();
  const brandsOf = new Map();
  const memberships = [];
  athletes.forEach((athlete, i) => {
    memberships.push([gyms[i % gyms.length], athlete]);
    if (i % 4 === 0) memberships.push([gyms[(i + 1) % gyms.length], athlete]);
  });
  await pool(memberships, 8, ([gym, athlete]) => step('join gym', async () => {
    await befriend(gym.owner, athlete);
    await gym.owner.rpc('invite_organization_member', { p_organization_id: gym.id, p_user_id: athlete.id });
    await athlete.rpc('respond_organization_invite', { p_organization_id: gym.id, p_accept: true });
    membersOf.get(gym.id).push(athlete);
    (gymsOf.get(athlete) ?? gymsOf.set(athlete, new Set()).get(athlete)).add(gym.id);
  }));

  // Brand co-admin for double validation on the first brand.
  if (brands[0]) {
    await step('brand co-admin', async () => {
      await befriend(brands[0].owner, brandCoAdmin);
      await brands[0].owner.rpc('invite_organization_member', { p_organization_id: brands[0].id, p_user_id: brandCoAdmin.id });
      await brandCoAdmin.rpc('respond_organization_invite', { p_organization_id: brands[0].id, p_accept: true });
      await brands[0].owner.rpc('set_organization_member_role', { p_organization_id: brands[0].id, p_user_id: brandCoAdmin.id, p_role: 'admin' });
    });
  }

  // ---- Gym challenges -------------------------------------------------------
  log('running gym challenges (accept -> evidence -> submit -> review -> finalize)');
  const runChallenge = async ({ challengeId, participants, reviewer, kind }) => {
    await pool(participants, 6, (athlete) => step(`${kind}: participate`, async () => {
      const pid = await athlete.participantId(challengeId);
      if (!pid) throw new Error('participant not found');
      const accept = { org: 'respond_organization_challenge', direct: 'respond_direct_challenge' }[kind];
      if (accept) {
        if (!chance(0.85)) { await athlete.rpc(accept, { p_participant_id: pid, p_accept: false }); return; }
        await athlete.rpc(accept, { p_participant_id: pid, p_accept: true });
      }
      if (!chance(0.9)) return; // accepted but never submitted
      await athlete.uploadEvidence(pid);
      await athlete.rpc({ org: 'submit_organization_challenge', direct: 'submit_direct_challenge', group: 'submit_group_challenge', sponsored: 'submit_sponsored_challenge' }[kind], { p_participant_id: pid });
      const decision = chance(0.88) ? 'approved' : 'rejected';
      const reviewerClient = typeof reviewer === 'function' ? reviewer(athlete) : reviewer;
      await reviewerClient.rpc({ org: 'review_organization_challenge', direct: 'review_direct_challenge', group: 'review_group_challenge', sponsored: 'review_sponsored_challenge' }[kind], {
        p_participant_id: pid, p_decision: decision, p_notes: decision === 'approved' ? '¡Buen trabajo!' : 'La evidencia no muestra el ejercicio completo.',
      });
    }));
  };
  for (const gym of gyms) {
    const members = membersOf.get(gym.id);
    for (let c = 0; c < 3; c += 1) {
      const ex = exercise();
      const challengeId = await step('create gym challenge', () => gym.owner.rpc('create_organization_challenge', {
        p_organization_id: gym.id, p_exercise_id: ex.id, p_exercise_name: ex.name, p_reps: between(8, 40), p_dice_level: pick(DICE),
        p_reward_coins: between(10, 25), p_reward_xp: between(20, 50), p_gym_points: between(40, 100),
      }));
      if (!challengeId) continue;
      await runChallenge({ challengeId, participants: members, reviewer: gym.owner, kind: 'org' });
      if (c < 2) await step('finalize gym challenge', () => gym.owner.rpc('finalize_organization_challenge', { p_challenge_id: challengeId }));
    }
  }

  // ---- Direct challenges between Gymbros -------------------------------------
  log('running direct challenges between Gymbros');
  const pairs = athletes.map((a, i) => [a, athletes[(i + 1) % athletes.length]]);
  await pool(pairs, 6, ([a, b]) => step('direct: befriend', () => befriend(a, b)));
  await pool(pairs.filter((_, i) => i % 2 === 0), 6, ([creator, recipient]) => step('direct: challenge', async () => {
    const ex = exercise();
    const challengeId = await creator.rpc('create_direct_challenge', { p_recipient_id: recipient.id, p_exercise_id: ex.id, p_exercise_name: ex.name, p_reps: between(10, 30), p_dice_level: pick(DICE) });
    await runChallenge({ challengeId, participants: [recipient], reviewer: creator, kind: 'direct' });
  }));

  // ---- Squads and squad battles ---------------------------------------------
  log('creating squads and squad battles');
  const SQUADS = 6;
  const squads = [];
  for (let s = 0; s < SQUADS && athletes.length >= SQUADS * 6; s += 1) {
    const captain = athletes[s * 6];
    const crew = athletes.slice(s * 6 + 1, s * 6 + 5);
    const id = await step('create squad', () => captain.rpc('create_squad', { p_name: `${pick(['Lobos', 'Halcones', 'Titanes', 'Rayos', 'Jaguares', 'Cóndores'])} ${s + 1}`, p_visibility: 'public' }));
    if (!id) continue;
    for (const member of crew) {
      await step('squad member', async () => {
        if (member !== athletes[s * 6 + 1]) await befriend(captain, member); // the first one is already a Gymbro (pairs ring)
        await captain.rpc('invite_squad_member', { p_group_id: id, p_user_id: member.id });
        await member.rpc('respond_squad_invite', { p_group_id: id, p_accept: true });
      });
    }
    squads.push({ id, captain, members: [captain, ...crew] });
  }
  for (let s = 0; s + 1 < squads.length; s += 2) {
    const [a, b] = [squads[s], squads[s + 1]];
    await step('squad battle', async () => {
      const ex = exercise();
      const battleId = await a.captain.rpc('create_group_challenge', { p_challenger_group_id: a.id, p_challenged_group_id: b.id, p_exercise_id: ex.id, p_exercise_name: ex.name, p_reps: between(15, 40), p_dice_level: pick(DICE) });
      await b.captain.rpc('respond_group_challenge', { p_battle_id: battleId, p_accept: true });
      const [battle] = await a.captain.query({ table: 'group_battles', action: 'select', columns: 'challenge_id', filters: [{ column: 'id', op: 'eq', value: battleId }] });
      const sideOf = new Map([...a.members.map((m) => [m, b.captain]), ...b.members.map((m) => [m, a.captain])]);
      await runChallenge({ challengeId: battle.challenge_id, participants: [...a.members, ...b.members], reviewer: (athlete) => sideOf.get(athlete), kind: 'group' });
    });
  }

  // ---- Sponsored challenges -------------------------------------------------
  log('running sponsored campaigns and challenges');
  for (const [i, brand] of brands.entries()) {
    const campaignId = await step('create sponsor campaign', () => brand.owner.rpc('create_sponsor_campaign', {
      p_organization_id: brand.id, p_name: `${brand.name}: Reto ${pick(['de verano', 'de fuerza', 'cardio', 'de resistencia'])}`,
      p_description: 'Campaña de demostración con recompensas en DadoCoins y puntos de la marca.', p_default_reward_coins: between(20, 50), p_default_reward_xp: between(40, 100), p_default_reward_sp: between(150, 400), p_max_participants: 500,
    }));
    if (!campaignId) continue;
    if (i === 0) await step('enable double validation', () => brand.owner.rpc('set_sponsor_campaign_double_validation', { p_campaign_id: campaignId, p_enabled: true }));
    await step('activate campaign', () => brand.owner.rpc('set_sponsor_campaign_status', { p_campaign_id: campaignId, p_status: 'active' }));
    const goals = [['repetitions', between(20, 100), 'reps'], ['distance', between(3, 10), 'km'], ['time', between(10, 45), 'minutes'], ['quantity', between(5000, 12000), 'steps']];
    for (let c = 0; c < 2; c += 1) {
      const [goalType, goalValue, unit] = goals[(i + c) % goals.length];
      const ex = exercise();
      const challengeId = await step('publish sponsored challenge', () => brand.owner.rpc('publish_sponsored_challenge', {
        p_campaign_id: campaignId, p_exercise_name: goalType === 'repetitions' ? ex.name : `${pick(['Caminata', 'Carrera', 'Plancha', 'Bici'])} ${brand.name.split(' ')[0]}`,
        p_goal_type: goalType, p_goal_value: goalValue, p_goal_unit: unit, p_duration_hours: 168, p_max_participants: 300, ...(goalType === 'repetitions' ? { p_exercise_id: ex.id } : {}),
      }));
      if (!challengeId) continue;
      const joiners = athletes.filter(() => chance(0.3));
      await pool(joiners, 6, (athlete) => step('sponsored: join', async () => {
        await athlete.rpc('join_sponsored_challenge', { p_challenge_id: challengeId });
        (brandsOf.get(athlete) ?? brandsOf.set(athlete, new Set()).get(athlete)).add(brand.id);
      }));
      await runChallenge({ challengeId, participants: joiners, reviewer: brand.owner, kind: 'sponsored' });
      if (i === 0) {
        // Double validation: a second owner/admin audits what the owner approved.
        const pending = await brand.owner.query({ table: 'challenge_participants', action: 'select', columns: 'id', filters: [{ column: 'challenge_id', op: 'eq', value: challengeId }, { column: 'status', op: 'eq', value: 'pending_audit' }] });
        await pool(pending ?? [], 4, (row) => step('sponsored: audit', () => brandCoAdmin.rpc('audit_sponsored_challenge', { p_participant_id: row.id, p_decision: chance(0.92) ? 'approved' : 'rejected', p_notes: 'Auditoría de demostración' })));
      }
      if (c === 1) await step('close sponsored challenge', () => brand.owner.rpc('close_sponsored_challenge', { p_challenge_id: challengeId }));
    }
  }

  // ---- Marketplaces ---------------------------------------------------------
  log('publishing DadoFit and partner rewards');
  const CATALOG = [
    { title: 'Botella térmica DadoFit', type: 'product', fulfillment: 'physical_product', mode: 'instructions_only', cost: 40 },
    { title: '15% en suplementos', type: 'discount', fulfillment: 'digital_code', mode: 'generated_code', cost: 15 },
    { title: 'Pase de un día', type: 'gym_pass', fulfillment: 'in_person', mode: 'instructions_only', cost: 25 },
    { title: 'Mes de app premium', type: 'subscription', fulfillment: 'digital_benefit', mode: 'redemption_url', cost: 30 },
    { title: 'Clase privada con coach', type: 'experience', fulfillment: 'in_person', mode: 'instructions_only', cost: 55 },
    { title: 'Cupón 2x1 en batidos', type: 'discount', fulfillment: 'digital_code', mode: 'code_pool', cost: 10 },
    { title: 'Código envío gratis', type: 'discount', fulfillment: 'digital_code', mode: 'shared_code', cost: 12 },
    { title: 'Camiseta edición reto', type: 'product', fulfillment: 'physical_product', mode: 'instructions_only', cost: 60 },
  ];
  const rewardArgs = (item, key, extra = {}) => ({
    p_title: item.title, p_description: `${item.title}. Premio de demostración.`, p_reward_type: item.type, p_coin_cost: item.cost,
    p_inventory: between(20, 80), p_max_per_user: 2, p_image_url: img(key), p_fulfillment_type: item.fulfillment,
    p_fulfillment_instructions: item.mode === 'instructions_only' ? 'Presenta el código de canje en recepción.' : 'Usa el código al pagar.',
    p_terms: 'Válido durante la demostración. No acumulable.', p_starts_at: iso(-1), p_ends_at: iso(60), p_fulfillment_mode: item.mode,
    p_shared_code: item.mode === 'shared_code' ? 'DEMOENVIO' : null,
    p_redemption_url: item.mode === 'redemption_url' ? `https://premios.${DOMAIN}/canjear` : null,
    p_coupon_codes: item.mode === 'code_pool' ? Array.from({ length: 100 }, (_, n) => `DEMO-${key.toUpperCase().slice(0, 4)}-${String(n).padStart(3, '0')}`).join('\n') : null,
    ...extra,
  });
  const dadofitRewards = [];
  for (const [i, item] of CATALOG.entries()) {
    const id = await step('create DadoFit reward', () => superadmin.rpc('admin_create_dadofit_reward', rewardArgs(item, `dadofit-${i}`)));
    if (id && await step('activate DadoFit reward', () => superadmin.rpc('admin_set_dadofit_reward_status', { p_reward_id: id, p_status: 'active' }))) dadofitRewards.push(id);
  }
  const partnerRewards = [];
  for (const org of [...gyms.map((g) => ({ ...g, native: [40, 90] })), ...brands.map((b) => ({ ...b, native: [120, 350] }))]) {
    for (let r = 0; r < 3; r += 1) {
      const item = CATALOG[(r * 3 + org.name.length) % CATALOG.length];
      const id = await step('create partner reward', () => org.owner.rpc('provider_create_reward', rewardArgs({ ...item, title: `${item.title} · ${org.name.split(' ')[0]}` }, `${org.id}-${r}`, { p_organization_id: org.id, p_native_cost: between(...org.native) })));
      if (id && await step('activate partner reward', () => org.owner.rpc('provider_set_reward_status', { p_reward_id: id, p_status: 'active' }))) partnerRewards.push({ id, org });
    }
  }

  // ---- Redemptions -----------------------------------------------------------
  log('redeeming rewards with DadoCoins and partner points');
  const redemptions = [];
  await pool(athletes, 6, async (athlete) => {
    for (const rewardId of [pick(dadofitRewards), pick(dadofitRewards)].filter(Boolean)) {
      const r = await step('redeem DadoFit reward (dc)', () => athlete.rpc('redeem_reward', { p_reward_id: rewardId, p_payment_method: 'dc' }));
      if (r) redemptions.push(r);
    }
    // Partner rewards only where the athlete can pay: gyms they belong to, brands whose challenges they joined.
    const eligible = partnerRewards.filter((r) => gymsOf.get(athlete)?.has(r.org.id) || brandsOf.get(athlete)?.has(r.org.id));
    for (const reward of eligible.filter(() => chance(0.5))) {
      const method = gyms.some((g) => g.id === reward.org.id) ? 'gp' : 'sp';
      const r = await step(`redeem partner reward (${method})`, () => athlete.rpc('redeem_reward', { p_reward_id: reward.id, p_payment_method: method }));
      if (r) redemptions.push({ ...r, org: reward.org });
    }
  });
  // Providers validate part of the in-person / physical redemptions.
  const toFulfil = redemptions.filter((r) => r.org && ['in_person', 'physical_product'].includes(r.fulfillment_type) && chance(0.6));
  await pool(toFulfil, 4, (r) => step('fulfil redemption', async () => {
    await r.org.owner.rpc('provider_lookup_reward_redemption', { p_lookup: r.redemption_reference });
    await r.org.owner.rpc('provider_fulfill_reward_redemption', { p_redemption_id: r.redemption_id, p_notes: 'Entregado en recepción (demo)' });
  }));

  // ---- Ads -------------------------------------------------------------------
  log('creating ad campaigns and recording impressions/clicks');
  const PLACEMENTS = ['workout-left-top', 'workout-left-middle', 'workout-left-bottom', 'workout-right-top', 'workout-right-middle', 'workout-right-bottom', 'workout-mobile'];
  const ADS = [...BRAND_NAMES, ...GYM_NAMES.slice(0, 6)];
  const campaigns = [];
  for (const [i, brandName] of ADS.entries()) {
    const id = await step('create ad campaign', () => superadmin.rpc('admin_create_ad_campaign', {
      p_brand_name: brandName, p_campaign_name: `${brandName} — ${pick(['Lanzamiento', 'Temporada', 'Promo', 'Reto del mes'])}`,
      p_image_url: img(`ad-${i}`), p_target_url: `https://www.${brandName.toLowerCase().replace(/[^a-z]+/g, '')}.${DOMAIN}/`, p_starts_at: iso(-3), p_ends_at: iso(45),
    }));
    if (!id) continue;
    for (const key of PLACEMENTS.filter((_, p) => (p + i) % 3 !== 0)) await step('assign ad placement', () => superadmin.rpc('admin_assign_ad_placement', { p_campaign_id: id, p_placement_key: key, p_enabled: true }));
    const status = i % 7 === 6 ? 'paused' : 'active';
    if (await step('activate ad campaign', () => superadmin.rpc('admin_set_ad_campaign_status', { p_campaign_id: id, p_status: status }))) campaigns.push(id);
  }
  const events = [];
  for (let n = 0; n < 2500; n += 1) events.push({ athlete: pick(athletes), click: chance(0.06) });
  await pool(events, 10, ({ athlete, click }) => step('ad events', async () => {
    const key = pick(PLACEMENTS);
    const ads = await athlete.rpc('get_active_ads', { p_placement_key: key });
    const ad = Array.isArray(ads) ? pick(ads) : null;
    if (!ad) return;
    const session = randomUUID();
    const route = pick(['/app', '/challenges', '/rewards', '/workspace']);
    const device = key === 'workout-mobile' ? 'mobile' : pick(['desktop', 'desktop', 'tablet']);
    const campaignId = ad.campaign_id ?? ad.id;
    await athlete.rpc('record_ad_event', { p_campaign_id: campaignId, p_placement_key: key, p_event_type: 'impression', p_session_id: session, p_route_path: route, p_device_type: device });
    if (click) await athlete.rpc('record_ad_event', { p_campaign_id: campaignId, p_placement_key: key, p_event_type: 'click', p_session_id: session, p_route_path: route, p_device_type: device });
  }));

  // ---- Competitive seasons ---------------------------------------------------
  log('creating competitive seasons');
  await step('gym season', () => superadmin.rpc('admin_create_competitive_season', { p_name: 'Temporada Gyms Demo', p_season_type: 'gym', p_starts_at: iso(-2), p_ends_at: iso(28), p_entry_ids: gyms.map((g) => g.id) }));
  if (squads.length) await step('squad season', () => superadmin.rpc('admin_create_competitive_season', { p_name: 'Temporada Squads Demo', p_season_type: 'squad', p_starts_at: iso(-2), p_ends_at: iso(28), p_entry_ids: squads.map((s) => s.id) }));

  // ---- Support requests --------------------------------------------------------
  await pool(athletes.slice(0, 5), 1, (athlete, i) => step('support request', () => athlete.rpc('submit_support_request', {
    p_name: athlete.name, p_email: athlete.email, p_subject: pick(['No veo mis puntos', 'Duda sobre un canje', 'Problema con evidencia', 'Quiero registrar mi gimnasio']),
    p_message: `Mensaje de soporte de demostración número ${i + 1}.`, p_company: null, p_request_type: pick(['support', 'commercial', 'advertising', 'gym_registration', 'report']),
  })));

  // ---- Report ------------------------------------------------------------------
  log(`done in ${Math.round((Date.now() - started) / 1000)} s`);
  console.log('\nOK steps:');
  console.table(Object.fromEntries([...stats.ok].sort()));
  if (stats.failed.size) {
    console.log('\nFailed steps (rule rejections are expected for some, e.g. anti-farming or empty balances):');
    console.table(Object.fromEntries([...stats.failed].sort((a, b) => b[1] - a[1])));
  }
}

try {
  await main();
} finally {
  await admin.end();
}
