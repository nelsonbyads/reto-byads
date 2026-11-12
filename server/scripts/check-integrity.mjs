// Economy and data integrity checks over the whole database (read-only).
// Every check must return zero offending rows.
//
//   DATABASE_ADMIN_URL=postgres://… node scripts/check-integrity.mjs

import pg from 'pg';

if (!process.env.DATABASE_ADMIN_URL) throw new Error('DATABASE_ADMIN_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });

const CHECKS = [
  ['DadoCoins: saldo = suma de movimientos', `
    select w.id from public.wallets w
      left join public.wallet_transactions t on t.wallet_id = w.id
     group by w.id, w.balance having w.balance <> coalesce(sum(t.amount), 0)`],
  ['DadoCoins: sin saldos negativos', 'select id from public.wallets where balance < 0'],
  ['Puntos de gym: saldo = suma del ledger', `
    select w.user_id from public.gym_point_wallets w
      left join public.gym_point_ledger l on l.user_id = w.user_id and l.gym_organization_id = w.gym_organization_id
     group by w.user_id, w.gym_organization_id, w.balance having w.balance <> coalesce(sum(l.amount), 0)`],
  ['Puntos de marca: saldo = suma del ledger', `
    select w.user_id from public.sponsor_point_wallets w
      left join public.sponsor_point_ledger l on l.user_id = w.user_id and l.sponsor_organization_id = w.sponsor_organization_id
     group by w.user_id, w.sponsor_organization_id, w.balance having w.balance <> coalesce(sum(l.amount), 0)`],
  ['Puntos: sin saldos negativos', `
    select user_id from public.gym_point_wallets where balance < 0
    union all select user_id from public.sponsor_point_wallets where balance < 0`],
  ['Presupuestos DC: usado <= presupuesto', 'select id from public.dc_budgets where used_dc > budget_dc or used_dc < 0'],
  ['Presupuestos DC: usado = suma de movimientos', `
    select b.id from public.dc_budgets b
      left join public.dc_budget_transactions t on t.dc_budget_id = b.id
     group by b.id, b.used_dc
    having b.used_dc <> coalesce(sum(case t.direction when 'grant' then t.amount when 'reversal' then -t.amount else t.amount end), 0)`],
  ['Premios: canjes vigentes <= inventario', `
    select r.id from public.rewards r
      join public.reward_redemptions rr on rr.reward_id = r.id and rr.status <> 'cancelled'
     where r.inventory is not null
     group by r.id, r.inventory having count(*) > r.inventory`],
  ['Premios: canjes por usuario <= máximo por usuario', `
    select rr.user_id from public.reward_redemptions rr
      join public.rewards r on r.id = rr.reward_id
     where rr.status <> 'cancelled' and r.max_per_user is not null
     group by rr.user_id, r.id, r.max_per_user having count(*) > r.max_per_user`],
  ['Cupones: cada código asignado una sola vez', `
    select assigned_redemption_id from public.reward_coupon_codes
     where assigned_redemption_id is not null group by assigned_redemption_id having count(*) > 1`],
  ['Retos: aprobados con recompensa tienen fecha de recompensa', `
    select id from public.challenge_participants
     where status = 'approved' and coalesce(reward_coins_granted, 0) + coalesce(reward_xp_granted, 0) > 0 and rewarded_at is null`],
  ['Evidencias: cada archivo existe en storage.objects', `
    select e.id from public.challenge_evidence e
     where not exists (select 1 from storage.objects o where o.bucket_id = 'challenge-evidence' and o.name = e.storage_path)`],
];

let failures = 0;
const rows = [];
for (const [name, sql] of CHECKS) {
  try {
    const { rowCount } = await pool.query(sql);
    rows.push({ check: name, offending_rows: rowCount, result: rowCount === 0 ? 'OK' : 'FALLA' });
    if (rowCount) failures += 1;
  } catch (error) {
    rows.push({ check: name, offending_rows: '-', result: `ERROR: ${error.message}` });
    failures += 1;
  }
}
const totals = (await pool.query(`
  select (select count(*) from auth.users) usuarios,
         (select count(*) from public.organizations) organizaciones,
         (select count(*) from public.challenges) retos,
         (select count(*) from public.challenge_participants) participaciones,
         (select count(*) from public.challenge_evidence) evidencias,
         (select count(*) from public.rewards) premios,
         (select count(*) from public.reward_redemptions) canjes,
         (select count(*) from public.ad_campaigns) campanas_ads,
         (select count(*) from public.ad_events) eventos_ads,
         (select coalesce(sum(balance), 0) from public.wallets) dc_en_circulacion,
         (select count(*) from public.notifications) notificaciones`)).rows[0];
await pool.end();
console.table(rows);
console.log(JSON.stringify(totals));
if (failures) process.exitCode = 1;
