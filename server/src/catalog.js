import { RPC_ALLOWLIST } from './rpcAllowlist.js';

/**
 * Tables reachable through POST /api/db/query and the operations the frontend
 * actually performs on each one. Everything runs under RLS as anon /
 * authenticated, exactly as the previous PostgREST access did; this allowlist
 * narrows the surface further.
 */
export const TABLE_ALLOWLIST = {
  ad_campaign_placements: ['select'],
  ad_campaigns: ['select'],
  ad_placements: ['select'],
  challenge_evidence: ['select', 'insert', 'delete'],
  challenge_participants: ['select'],
  challenges: ['select'],
  friendships: ['select', 'insert', 'update', 'delete'],
  group_battles: ['select'],
  group_members: ['select'],
  groups: ['select'],
  notifications: ['select', 'update'],
  organization_battles: ['select'],
  organization_members: ['select'],
  organizations: ['select'],
  profiles: ['select', 'update'],
  score_events: ['select'],
  sponsor_campaigns: ['select'],
  user_progress: ['select'],
  wallets: ['select'],
};

/** Loads function signatures and table columns once at startup. */
export async function loadCatalog(pool) {
  const functions = new Map();
  const { rows: fnRows } = await pool.query(
    `select p.proname as name,
            p.proretset as returns_set,
            t.typtype as return_typtype,
            p.prorettype = 'void'::regtype as returns_void,
            p.pronargs as nargs,
            p.pronargdefaults as ndefaults,
            coalesce(p.proargnames, '{}') as arg_names,
            coalesce(p.proargmodes::text[], '{}') as arg_modes,
            array(select format_type(x, null) from unnest(p.proargtypes) as x) as in_types
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       join pg_type t on t.oid = p.prorettype
      where n.nspname = 'public' and p.proname = any($1)`,
    [[...RPC_ALLOWLIST]],
  );

  for (const row of fnRows) {
    const inputNames = [];
    row.arg_names.forEach((name, index) => {
      const mode = row.arg_modes[index] ?? 'i';
      if (mode === 'i' || mode === 'b' || mode === 'v') inputNames.push(name);
    });
    const params = inputNames.slice(0, row.nargs).map((name, index) => ({
      name,
      type: row.in_types[index],
      hasDefault: index >= row.nargs - row.ndefaults,
    }));
    const shape = row.returns_void
      ? 'void'
      : row.returns_set
        ? row.return_typtype === 'c' || row.return_typtype === 'p'
          ? 'rows'
          : 'values'
        : row.return_typtype === 'c' || row.return_typtype === 'p'
          ? 'row'
          : 'scalar';
    if (!functions.has(row.name)) functions.set(row.name, []);
    functions.get(row.name).push({ name: row.name, params, shape });
  }

  const missing = [...RPC_ALLOWLIST].filter((name) => !functions.has(name));

  // information_schema only lists columns the current role can use, so read it
  // as `authenticated` (the role user requests run as).
  const tables = new Map();
  const client = await pool.connect();
  let colRows;
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    ({ rows: colRows } = await client.query(
      `select table_name, column_name, data_type
         from information_schema.columns
        where table_schema = 'public' and table_name = any($1)`,
      [Object.keys(TABLE_ALLOWLIST)],
    ));
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  for (const row of colRows) {
    if (!tables.has(row.table_name)) tables.set(row.table_name, new Map());
    tables.get(row.table_name).set(row.column_name, row.data_type);
  }

  return { functions, tables, missing };
}

/** Picks the overload that accepts exactly the given named parameters. */
export function resolveFunction(catalog, name, givenNames) {
  const overloads = catalog.functions.get(name);
  if (!overloads) return null;
  const given = new Set(givenNames);
  const candidates = overloads.filter((fn) => {
    const known = new Set(fn.params.map((p) => p.name));
    for (const g of given) if (!known.has(g)) return false;
    return fn.params.every((p) => p.hasDefault || given.has(p.name));
  });
  return candidates.length === 1 ? candidates[0] : null;
}
