// Periodic clean-up of authentication bookkeeping so the tables do not grow
// forever. Only rows that can no longer be used are removed:
//   - login attempts older than the audit window (lockout only looks at minutes)
//   - refresh tokens and one-time tokens expired for more than a grace period
//     (an expired token is rejected anyway; keeping it a few days helps when
//     investigating an incident)

const LOCK_KEY = 482_190_331; // pg advisory lock: one replica purges at a time

export const DEFAULT_RETENTION = {
  loginAttemptsDays: 30,
  expiredTokensDays: 7,
};

export async function purgeAuthTables(pool, retention = DEFAULT_RETENTION) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query('select pg_try_advisory_xact_lock($1) as locked', [LOCK_KEY]);
    if (!rows[0].locked) {
      await client.query('rollback');
      return null;
    }
    const attempts = await client.query(
      'delete from auth.login_attempts where created_at < now() - make_interval(days => $1)',
      [retention.loginAttemptsDays],
    );
    const refresh = await client.query(
      'delete from auth.refresh_tokens where expires_at < now() - make_interval(days => $1)',
      [retention.expiredTokensDays],
    );
    const oneTime = await client.query(
      'delete from auth.one_time_tokens where expires_at < now() - make_interval(days => $1)',
      [retention.expiredTokensDays],
    );
    await client.query('commit');
    return { loginAttempts: attempts.rowCount, refreshTokens: refresh.rowCount, oneTimeTokens: oneTime.rowCount };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Runs the purge shortly after start-up and then every `intervalMs`. */
export function scheduleMaintenance({ pool, log, intervalMs = 60 * 60 * 1000, retention = DEFAULT_RETENTION }) {
  const run = async () => {
    try {
      const removed = await purgeAuthTables(pool, retention);
      if (removed) log.info({ removed }, 'auth tables purged');
    } catch (error) {
      log.error({ err: error.message }, 'auth table purge failed');
    }
  };
  const first = setTimeout(run, 30_000);
  const timer = setInterval(run, intervalMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
