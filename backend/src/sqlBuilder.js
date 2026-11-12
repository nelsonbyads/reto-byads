// Translates the small query-builder payload sent by src/lib/backend.ts into a
// parameterised SQL statement. Identifiers are validated against the catalog
// and quoted; values are always bound parameters.

export const MAX_ROWS = 1000; // same cap PostgREST applied (supabase/config.toml max_rows)

const IDENT_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const OPS = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'like',
  ilike: 'ilike',
};

export class QueryError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const quote = (ident) => `"${ident}"`;

function column(columns, name) {
  if (typeof name !== 'string' || !IDENT_RE.test(name) || !columns.has(name)) {
    throw new QueryError(`unknown column: ${String(name)}`);
  }
  return quote(name);
}

function parseColumnList(columns, list) {
  if (list === undefined || list === null || list === '' || list === '*') return '*';
  if (typeof list !== 'string') throw new QueryError('invalid column list');
  return list
    .split(',')
    .map((part) => column(columns, part.trim()))
    .join(', ');
}

function buildWhere(columns, filters, params) {
  if (!filters) return '';
  if (!Array.isArray(filters) || filters.length > 30) throw new QueryError('invalid filters');
  const clauses = filters.map((filter) => {
    const col = column(columns, filter?.column);
    const negate = filter.negate === true;
    let clause;
    if (filter.op === 'is') {
      const value = filter.value;
      if (value === null) clause = `${col} is null`;
      else if (value === true) clause = `${col} is true`;
      else if (value === false) clause = `${col} is false`;
      else throw new QueryError('is() accepts null, true or false');
    } else if (filter.op === 'in') {
      if (!Array.isArray(filter.value) || filter.value.length > 1000) throw new QueryError('in() needs an array');
      params.push(filter.value);
      clause = `${col} = any($${params.length})`;
    } else if (OPS[filter.op]) {
      params.push(filter.value);
      clause = `${col} ${OPS[filter.op]} $${params.length}`;
    } else {
      throw new QueryError(`unsupported operator: ${String(filter.op)}`);
    }
    return negate ? `not (${clause})` : clause;
  });
  return clauses.length ? ` where ${clauses.join(' and ')}` : '';
}

function buildOrder(columns, order) {
  if (!order || (Array.isArray(order) && order.length === 0)) return '';
  if (!Array.isArray(order) || order.length > 5) throw new QueryError('invalid order');
  const parts = order.map((item) => {
    const col = column(columns, item?.column);
    const dir = item.ascending === false ? 'desc' : 'asc';
    const nulls = item.nullsFirst === true ? ' nulls first' : item.nullsFirst === false ? ' nulls last' : '';
    return `${col} ${dir}${nulls}`;
  });
  return ` order by ${parts.join(', ')}`;
}

function rowValues(columns, row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new QueryError('invalid values');
  const keys = Object.keys(row);
  if (!keys.length) throw new QueryError('empty values');
  keys.forEach((key) => column(columns, key));
  return keys;
}

const jsonParam = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : value;

/** Returns { sql, params, countSql?, countParams? } for one request. */
export function buildQuery(table, columns, request) {
  const params = [];
  const target = `public.${quote(table)}`;
  const returning = request.returning ? ` returning ${parseColumnList(columns, request.returning)}` : '';

  switch (request.action) {
    case 'select': {
      const where = buildWhere(columns, request.filters, params);
      const result = {};
      if (request.count === 'exact') {
        result.countSql = `select count(*)::bigint as count from ${target}${where}`;
        result.countParams = [...params];
      }
      if (request.head) return { ...result, sql: null, params };
      const limit = Math.min(Number.isInteger(request.limit) && request.limit > 0 ? request.limit : MAX_ROWS, MAX_ROWS);
      const offset = Number.isInteger(request.offset) && request.offset > 0 ? request.offset : 0;
      result.sql = `select ${parseColumnList(columns, request.columns)} from ${target}${where}${buildOrder(columns, request.order)} limit ${limit} offset ${offset}`;
      result.params = params;
      return result;
    }
    case 'insert': {
      const rows = Array.isArray(request.values) ? request.values : [request.values];
      if (!rows.length || rows.length > 100) throw new QueryError('invalid values');
      const keys = rowValues(columns, rows[0]);
      const tuples = rows.map((row) => {
        const rowKeys = rowValues(columns, row);
        if (rowKeys.length !== keys.length || rowKeys.some((k) => !keys.includes(k))) {
          throw new QueryError('all inserted rows must have the same columns');
        }
        return `(${keys.map((k) => { params.push(jsonParam(row[k])); return `$${params.length}`; }).join(', ')})`;
      });
      return { sql: `insert into ${target} (${keys.map(quote).join(', ')}) values ${tuples.join(', ')}${returning}`, params };
    }
    case 'update': {
      const keys = rowValues(columns, request.values);
      const sets = keys.map((k) => { params.push(jsonParam(request.values[k])); return `${quote(k)} = $${params.length}`; });
      const where = buildWhere(columns, request.filters, params);
      if (!where) throw new QueryError('update requires filters');
      return { sql: `update ${target} set ${sets.join(', ')}${where}${returning}`, params };
    }
    case 'delete': {
      const where = buildWhere(columns, request.filters, params);
      if (!where) throw new QueryError('delete requires filters');
      return { sql: `delete from ${target}${where}${returning}`, params };
    }
    default:
      throw new QueryError('unsupported action');
  }
}
