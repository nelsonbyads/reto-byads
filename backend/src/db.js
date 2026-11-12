import pg from 'pg';

// int8 (bigint) values are returned as strings by default; the frontend already
// handles `number | string` for balances (IntegerValue), and PostgREST returned
// bigint as JSON numbers. Keep numbers when they are safe integers.
pg.types.setTypeParser(20, (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
});
// numeric → number when safe (PostgREST returned numeric as JSON number).
pg.types.setTypeParser(1700, (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPool(config) {
  const pool = new pg.Pool({
    connectionString: config.database.connectionString,
    max: config.database.max,
    application_name: 'dadofit-api',
    statement_timeout: config.database.statementTimeoutMs,
    ssl: config.database.ssl ?? false,
  });
  pool.on('error', (error) => {
    // Idle client errors (e.g. server restart) must not crash the process.
    console.error(JSON.stringify({ level: 'error', msg: 'pg pool error', error: error.message }));
  });
  return pool;
}

/**
 * Runs `work` inside a transaction that impersonates the request identity the
 * same way Supabase did: role `anon` or `authenticated`, and the user id in
 * `request.jwt.claim.sub` (read by auth.uid()). RLS and SECURITY DEFINER
 * functions therefore behave exactly as before.
 */
export async function withIdentity(pool, userId, work) {
  if (userId !== null && !UUID_RE.test(userId)) throw new Error('invalid identity');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? '']);
    await client.query(userId ? 'set local role authenticated' : 'set local role anon');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Runs `work` in a privileged transaction (migration owner). Auth service only. */
export async function withSystem(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}
