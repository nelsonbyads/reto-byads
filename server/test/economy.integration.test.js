// Economy invariants checked directly against Postgres (ported from the former
// scripts/test-dc-budget-concurrency.mjs, which needed the Supabase service key).
//
//   DATABASE_ADMIN_URL  owner connection to the stack database

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 4 });

describe('DC budgets', () => {
  after(async () => {
    await pool.end();
  });

  it('serialises concurrent grants and replays idempotent requests', async () => {
    const marker = `economy-concurrency-${randomUUID()}`;
    const { rows } = await pool.query(
      `insert into public.dc_budgets (is_dadofit_internal, budget_dc, used_dc, status, starts_at, ends_at)
       values (true, 50, 0, 'active', now() - interval '1 minute', now() + interval '1 hour') returning id`,
    );
    const budgetId = rows[0].id;
    const consume = async (amount, key) => {
      const result = await pool.query(
        `select public.consume_dc_budget_internal($1, $2, 'grant', null, null, null, $3, 'economy_test', null, $4) as r`,
        [budgetId, amount, marker, key],
      );
      return result.rows[0].r;
    };
    try {
      const [a, b] = await Promise.all([consume(30, `${marker}:a`), consume(30, `${marker}:b`)]);
      assert.equal([a, b].filter((r) => r?.success).length, 1, 'exactly one concurrent grant fits the budget');
      const first = await consume(10, `${marker}:idem`);
      const replay = await consume(10, `${marker}:idem`);
      assert.equal(first.success, true);
      assert.equal(replay.idempotent_replay, true);
      const { rows: used } = await pool.query('select used_dc from public.dc_budgets where id = $1', [budgetId]);
      assert.equal(Number(used[0].used_dc), 40);
    } finally {
      await pool.query('delete from public.dc_budget_transactions where dc_budget_id = $1', [budgetId]);
      await pool.query('delete from public.dc_budgets where id = $1', [budgetId]);
    }
  });

  it('pays a DC reward from an active budget (eco4c_grant_dc regression)', async () => {
    // Everything runs in a transaction that is rolled back: no data is left behind.
    const client = await pool.connect();
    try {
      await client.query('begin');
      const userId = randomUUID();
      await client.query(
        `insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         values ($1, 'authenticated', 'authenticated', $2, '{}', '{}', now(), now())`,
        [userId, `eco4c-${userId}@test.local`],
      );
      await client.query('insert into public.wallets (user_id) values ($1) on conflict (user_id) do nothing', [userId]);
      const { rows: [budget] } = await client.query(
        `insert into public.dc_budgets (is_dadofit_internal, budget_dc, used_dc, status, starts_at, ends_at)
         values (true, 100, 0, 'active', now() - interval '1 minute', now() + interval '1 hour') returning id`,
      );
      const { rows: [challenge] } = await client.query(
        `insert into public.challenges (creator_kind, challenge_type, exercise_id, exercise_name, reps, dice_level, dc_budget_id)
         values ('system', 'public', 'test', 'Regression test', 10, 'amateur', $1) returning id`,
        [budget.id],
      );
      const { rows: [grant] } = await client.query(
        "select * from public.eco4c_grant_dc($1, 25, 'eco4c_regression', $2, 'regression', $3)",
        [userId, challenge.id, `eco4c-regression-${userId}`],
      );
      assert.equal(grant.granted, true);
      assert.equal(Number(grant.new_balance), 25);
      const { rows: [used] } = await client.query('select used_dc from public.dc_budgets where id = $1', [budget.id]);
      assert.equal(Number(used.used_dc), 25);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('exposes the economy schema version', async () => {
    const { rows } = await pool.query('select public.get_dadofit_schema_version() as v');
    assert.ok(rows[0].v, 'schema version reported');
  });
});
