// Load test: many logged-in users hitting the API the way the app pages do.
// Reports throughput, latency percentiles and errors per endpoint.
//
//   BASE_URL=http://127.0.0.1:8782 \
//   LOAD_USERS_FILE=../infra/seed/demo-users.json   (written by seed-demo.mjs)
//   LOAD_CONCURRENCY=25 LOAD_SECONDS=30 node scripts/load-test.mjs
//
// The API's per-IP rate limits must be raised while it runs (every simulated
// user comes from the same IP): RATE_LIMIT_GLOBAL_PER_MINUTE=100000 and
// RATE_LIMIT_AUTH_PER_MINUTE=10000.

import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8782';
const USERS_FILE = process.env.LOAD_USERS_FILE ?? new URL('../../infra/seed/demo-users.json', import.meta.url);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 25);
const SECONDS = Number(process.env.LOAD_SECONDS ?? 30);
const LOGINS = Number(process.env.LOAD_LOGINS ?? 40);

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const start = performance.now();
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, ms: performance.now() - start, json: text ? JSON.parse(text) : null };
}

// A page-like mix of reads (weights approximate a browsing session).
const SCENARIOS = [
  { name: 'rpc get_dadofit_workspace_context', weight: 3, run: (t) => call('POST', '/api/rpc/get_dadofit_workspace_context', { token: t, body: {} }) },
  { name: 'rpc get_dadofit_marketplace', weight: 3, run: (t) => call('POST', '/api/rpc/get_dadofit_marketplace', { token: t, body: {} }) },
  { name: 'rpc get_my_partner_marketplaces', weight: 2, run: (t) => call('POST', '/api/rpc/get_my_partner_marketplaces', { token: t, body: {} }) },
  { name: 'rpc get_active_ads', weight: 4, run: (t) => call('POST', '/api/rpc/get_active_ads', { token: t, body: { p_placement_key: 'workout-right-top' } }) },
  { name: 'rpc get_season_hub', weight: 1, run: (t) => call('POST', '/api/rpc/get_season_hub', { token: t, body: {} }) },
  { name: 'rpc get_my_reward_redemption_history', weight: 1, run: (t) => call('POST', '/api/rpc/get_my_reward_redemption_history', { token: t, body: {} }) },
  {
    name: 'query notifications',
    weight: 3,
    run: (t) => call('POST', '/api/db/query', {
      token: t,
      body: { table: 'notifications', action: 'select', columns: 'id,title,read_at,created_at', order: [{ column: 'created_at', ascending: false }], limit: 20 },
    }),
  },
  {
    name: 'query challenges',
    weight: 2,
    run: (t) => call('POST', '/api/db/query', {
      token: t,
      body: { table: 'challenges', action: 'select', columns: 'id,status,exercise_name,created_at', order: [{ column: 'created_at', ascending: false }], limit: 30 },
    }),
  },
  { name: 'GET /api/auth/me', weight: 2, run: (t) => call('GET', '/api/auth/me', { token: t }) },
];
const WEIGHTED = SCENARIOS.flatMap((s) => Array(s.weight).fill(s));

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

async function main() {
  const users = JSON.parse(await readFile(USERS_FILE, 'utf8')).athletes.slice(0, LOGINS);
  if (!users.length) throw new Error('no demo users: run seed-demo.mjs first');
  const tokens = [];
  for (const user of users) {
    const res = await call('POST', '/api/auth/login', { body: { email: user.email, password: user.password } });
    if (res.status !== 200) throw new Error(`login ${user.email}: ${res.status} ${JSON.stringify(res.json)}`);
    tokens.push(res.json.session.access_token);
  }

  const stats = new Map(SCENARIOS.map((s) => [s.name, { ms: [], errors: 0, codes: new Map() }]));
  const deadline = Date.now() + SECONDS * 1000;
  let total = 0;
  const worker = async (index) => {
    let i = index;
    while (Date.now() < deadline) {
      const scenario = WEIGHTED[Math.floor(Math.random() * WEIGHTED.length)];
      const entry = stats.get(scenario.name);
      try {
        const res = await scenario.run(tokens[i % tokens.length]);
        entry.ms.push(res.ms);
        if (res.status >= 400) {
          entry.errors += 1;
          entry.codes.set(res.status, (entry.codes.get(res.status) ?? 0) + 1);
        }
      } catch (error) {
        entry.errors += 1;
        entry.codes.set(error.code ?? 'network', (entry.codes.get(error.code ?? 'network') ?? 0) + 1);
      }
      total += 1;
      i += CONCURRENCY;
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  const elapsed = (performance.now() - started) / 1000;

  const all = [];
  const rows = [];
  for (const [name, entry] of stats) {
    const sorted = entry.ms.sort((a, b) => a - b);
    all.push(...sorted);
    rows.push({
      endpoint: name,
      requests: sorted.length,
      errors: entry.errors,
      p50_ms: Math.round(percentile(sorted, 50)),
      p95_ms: Math.round(percentile(sorted, 95)),
      p99_ms: Math.round(percentile(sorted, 99)),
      ...(entry.codes.size ? { codes: Object.fromEntries(entry.codes) } : {}),
    });
  }
  all.sort((a, b) => a - b);
  console.table(rows);
  const errors = rows.reduce((sum, row) => sum + row.errors, 0);
  console.log(JSON.stringify({
    users: tokens.length,
    concurrency: CONCURRENCY,
    seconds: Math.round(elapsed),
    requests: total,
    rps: Math.round(total / elapsed),
    errors,
    p50_ms: Math.round(percentile(all, 50)),
    p95_ms: Math.round(percentile(all, 95)),
    p99_ms: Math.round(percentile(all, 99)),
  }));
  if (errors) process.exitCode = 1;
}

await main();
