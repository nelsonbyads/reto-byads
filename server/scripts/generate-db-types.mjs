// Generates src/types/database.ts from the live schema: arguments and results
// of every allowlisted RPC function and the columns of every allowlisted table.
// CI regenerates it on a freshly migrated database and fails if the committed
// file is stale, so the frontend types always match the SQL.
//
//   DATABASE_ADMIN_URL=postgres://… node scripts/generate-db-types.mjs [output]
//
// Value mapping follows what the API returns as JSON: bigint and numeric come
// back as strings (node-postgres keeps their precision), so result fields of
// those types are typed `string`, while arguments accept `number | string`.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { RPC_ALLOWLIST } from '../src/rpcAllowlist.js';
import { TABLE_ALLOWLIST } from '../src/catalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(here, '../../src/types/database.ts'));
const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error('DATABASE_ADMIN_URL is required');

const STRINGS = new Set(['uuid', 'text', 'character varying', 'character', 'citext', 'name', 'date', 'time without time zone',
  'time with time zone', 'timestamp without time zone', 'timestamp with time zone', 'interval', 'inet', 'bytea']);
const NUMBERS = new Set(['smallint', 'integer', 'real', 'double precision']);
const BIG = new Set(['bigint', 'numeric']);

/** TypeScript type for a SQL type name as produced by format_type(). */
function tsType(sqlType, enums, direction) {
  const base = sqlType.replace(/\(.*\)/, '').trim();
  if (base.endsWith('[]')) return `${wrap(tsType(base.slice(0, -2), enums, direction))}[]`;
  if (STRINGS.has(base)) return 'string';
  if (NUMBERS.has(base)) return 'number';
  if (BIG.has(base)) return direction === 'in' ? 'number | string' : 'string';
  if (base === 'boolean') return 'boolean';
  if (base === 'json' || base === 'jsonb') return 'Json';
  const enumName = base.replace(/^public\./, '');
  if (enums.has(enumName)) return enums.get(enumName).map((v) => `'${v.replaceAll("'", "\\'")}'`).join(' | ');
  return 'unknown';
}
const wrap = (type) => (type.includes('|') ? `(${type})` : type);
const prop = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`);

const pool = new pg.Pool({ connectionString, max: 1 });
try {
  const { rows: enumRows } = await pool.query(`
    select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' group by t.typname`);
  const enums = new Map(enumRows.map((row) => [row.name, row.labels]));

  const { rows: fnRows } = await pool.query(`
    select p.proname as name, p.oid,
           p.proretset as returns_set,
           p.prorettype = 'void'::regtype as returns_void,
           t.typtype as return_typtype,
           t.typrelid as return_relid,
           format_type(p.prorettype, null) as return_type,
           p.pronargs as nargs, p.pronargdefaults as ndefaults,
           coalesce(p.proargnames, '{}') as arg_names,
           coalesce(p.proargmodes::text[], '{}') as arg_modes,
           array(select format_type(x, null) from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) as x) as all_types
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype
     where n.nspname = 'public' and p.proname = any($1)
     order by p.proname, p.oid`, [[...RPC_ALLOWLIST]]);

  async function relationColumns(relid) {
    const { rows } = await pool.query(`
      select attname as name, format_type(atttypid, atttypmod) as type, not attnotnull as nullable
        from pg_attribute where attrelid = $1 and attnum > 0 and not attisdropped order by attnum`, [relid]);
    return rows;
  }

  const functions = new Map();
  for (const fn of fnRows) {
    const inputs = [];
    const outputs = [];
    fn.all_types.forEach((type, index) => {
      const mode = fn.arg_modes[index] ?? 'i';
      const name = fn.arg_names[index] ?? `arg${index + 1}`;
      if (mode === 'i' || mode === 'b' || mode === 'v') inputs.push({ name, type });
      if (mode === 'o' || mode === 'b' || mode === 't') outputs.push({ name, type, nullable: true });
    });
    const args = inputs.slice(0, fn.nargs).map((arg, index) => ({ ...arg, optional: index >= fn.nargs - fn.ndefaults }));
    const argsType = args.length
      ? `{ ${args.map((a) => `${prop(a.name)}${a.optional ? '?' : ''}: ${tsType(a.type, enums, 'in')} | null`).join('; ')} }`
      : 'Record<string, never>';

    const columns = outputs.length ? outputs : fn.return_typtype === 'c' ? await relationColumns(fn.return_relid) : null;
    const rowType = columns
      ? `{ ${columns.map((c) => `${prop(c.name)}: ${tsType(c.type, enums, 'out')}${c.nullable ? ' | null' : ''}`).join('; ')} }`
      : null;
    let returns;
    if (fn.returns_void) returns = 'null';
    else if (rowType) returns = fn.returns_set ? `${rowType}[]` : rowType;
    else if (fn.return_typtype === 'p') returns = fn.returns_set ? 'Record<string, unknown>[]' : 'Record<string, unknown>';
    else returns = fn.returns_set ? `${wrap(tsType(fn.return_type, enums, 'out'))}[]` : `${tsType(fn.return_type, enums, 'out')} | null`;

    if (!functions.has(fn.name)) functions.set(fn.name, []);
    functions.get(fn.name).push({ args: argsType, returns });
  }

  const tables = [];
  for (const table of Object.keys(TABLE_ALLOWLIST).sort()) {
    const { rows } = await pool.query(`
      select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, not a.attnotnull as nullable
        from pg_attribute a
       where a.attrelid = ('public.' || quote_ident($1))::regclass and a.attnum > 0 and not a.attisdropped
       order by a.attnum`, [table]);
    tables.push({ table, columns: rows });
  }

  const missing = [...RPC_ALLOWLIST].filter((name) => !functions.has(name)).sort();
  const lines = [
    '// Generated by server/scripts/generate-db-types.mjs from the database schema.',
    '// Do not edit by hand: change the SQL and regenerate. CI fails if this file is stale.',
    '',
    'export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];',
    '',
    '/** Arguments and results of the functions callable through backend.rpc(). */',
    'export interface RpcFunctions {',
    ...[...functions.keys()].sort().map((name) => {
      const overloads = functions.get(name);
      const args = [...new Set(overloads.map((o) => o.args))].join(' | ');
      const returns = [...new Set(overloads.map((o) => o.returns))].join(' | ');
      return `  ${name}: { Args: ${args}; Returns: ${returns} };`;
    }),
    '}',
    '',
    'export type RpcName = keyof RpcFunctions;',
    "export type RpcArgs<N extends RpcName> = RpcFunctions[N]['Args'];",
    "export type RpcReturns<N extends RpcName> = RpcFunctions[N]['Returns'];",
    '',
    '/** Rows of the tables reachable through backend.from(). */',
    'export interface Tables {',
    ...tables.map(({ table, columns }) => `  ${table}: { ${columns.map((c) => `${prop(c.name)}: ${tsType(c.type, enums, 'out')}${c.nullable ? ' | null' : ''}`).join('; ')} };`),
    '}',
    '',
    'export type TableName = keyof Tables;',
    'export type TableRow<T extends TableName> = Tables[T];',
    '',
  ];
  await writeFile(output, lines.join('\n'), 'utf8');
  console.log(JSON.stringify({ output: path.relative(process.cwd(), output), functions: functions.size, tables: tables.length, missing }));
  if (missing.length) process.exitCode = 1;
} finally {
  await pool.end();
}
