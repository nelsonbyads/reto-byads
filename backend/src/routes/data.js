import { withIdentity } from '../db.js';
import { TABLE_ALLOWLIST, resolveFunction } from '../catalog.js';
import { buildQuery, QueryError } from '../sqlBuilder.js';
import { RPC_ALLOWLIST } from '../rpcAllowlist.js';

const PARAM_RE = /^[a-z_][a-z0-9_]{0,62}$/;

// Functions anonymous visitors can use to write data (ad analytics, contact
// form). They get a stricter per-IP rate limit (SEC-04 / SEC-05).
const PUBLIC_WRITE_RPCS = new Set(['record_ad_event', 'submit_support_request']);

// Parameters the server fixes regardless of what the client sends.
const PARAM_OVERRIDES = {
  // SEC-10: a user can only ask whether *they* are a platform admin.
  is_platform_admin: (params, userId) => ({ ...params, p_user_id: userId }),
};

const jsonParam = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : value;

export default async function dataRoutes(app, { pool, catalog, storage, config }) {
  app.post(
    '/rpc/:name',
    {
      config: {
        rateLimit: {
          // Keyed by IP (rate limiting runs before authentication).
          // Strict budgets only for anonymous *writes*; public reads (ads,
          // schema version) share the general budget.
          max: (request) =>
            request.params.name === 'submit_support_request'
              ? 5
              : PUBLIC_WRITE_RPCS.has(request.params.name)
                ? config.rateLimit.publicRpcPerMinute
                : config.rateLimit.globalPerMinute,
          timeWindow: '1 minute',
          // One counter per IP and function, so a busy page cannot exhaust the
          // budget of the contact form and vice versa.
          keyGenerator: (request) => `${request.ip}:${request.params.name}`,
        },
      },
    },
    async (request, reply) => {
      const { name } = request.params;
      if (!RPC_ALLOWLIST.has(name)) return reply.code(404).send({ message: `function ${name} is not available`, code: 'PGRST202' });
      let params = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
      if (PARAM_OVERRIDES[name]) params = PARAM_OVERRIDES[name](params, request.userId);
      const keys = Object.keys(params);
      if (keys.some((key) => !PARAM_RE.test(key))) throw new QueryError('invalid parameter name');

      const fn = resolveFunction(catalog, name, keys);
      if (!fn) return reply.code(404).send({ message: `function ${name} does not accept these parameters`, code: 'PGRST202' });

      const values = [];
      const args = keys.map((key) => {
        const declared = fn.params.find((p) => p.name === key);
        values.push(jsonParam(params[key]));
        return `"${key}" => $${values.length}::${declared.type}`;
      });
      const call = `public."${name}"(${args.join(', ')})`;

      const result = await withIdentity(pool, request.userId, async (client) => {
        if (fn.shape === 'rows') return (await client.query(`select * from ${call}`, values)).rows;
        if (fn.shape === 'values') return (await client.query(`select ${call} as v`, values)).rows.map((r) => r.v);
        if (fn.shape === 'row') {
          const { rows } = await client.query(`select * from ${call}`, values);
          return rows[0] ?? null;
        }
        const { rows } = await client.query(`select ${call} as v`, values);
        return fn.shape === 'void' ? null : rows[0]?.v ?? null;
      });
      return { data: result };
    },
  );

  app.post('/db/query', async (request, reply) => {
    const body = request.body ?? {};
    const table = body.table;
    const allowed = TABLE_ALLOWLIST[table];
    if (!allowed || !catalog.tables.has(table)) return reply.code(404).send({ message: `table ${String(table)} is not available`, code: 'PGRST205' });
    if (!allowed.includes(body.action)) return reply.code(403).send({ message: `${String(body.action)} is not allowed on ${table}`, code: '42501' });
    if (body.action !== 'select' && !request.userId) return reply.code(401).send({ message: 'Sesión no iniciada.', code: 'no_session' });

    const columns = catalog.tables.get(table);
    const query = buildQuery(table, columns, body);

    if (table === 'challenge_evidence' && body.action === 'insert') {
      await verifyEvidenceObjects(storage, request.userId, body.values);
    }

    return withIdentity(pool, request.userId, async (client) => {
      let count = null;
      if (query.countSql) count = Number((await client.query(query.countSql, query.countParams)).rows[0].count);
      let rows = null;
      if (query.sql) {
        const res = await client.query(query.sql, query.params);
        rows = body.action === 'select' || body.returning ? res.rows : null;
      }
      if (body.single && body.action === 'select') {
        if (rows.length > 1 || (rows.length === 0 && body.single === 'single')) {
          return reply.code(406).send({ message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' });
        }
        rows = rows[0] ?? null;
      }
      return { data: rows, count };
    });
  });
}

/**
 * SEC-09: an evidence row may only point to a file the same user uploaded for
 * that participant, and the file must exist in storage.
 */
async function verifyEvidenceObjects(storage, userId, values) {
  const rows = Array.isArray(values) ? values : [values];
  for (const row of rows) {
    const path = String(row?.storage_path ?? '');
    const participant = String(row?.participant_id ?? '');
    if (!path.startsWith(`${userId}/${participant}/`) || path.includes('..')) {
      throw new QueryError('La evidencia no corresponde a este participante.', 403);
    }
    if (!(await storage.exists('challenge-evidence', path))) throw new QueryError('El archivo de evidencia no se subió correctamente. Inténtalo de nuevo.', 400);
  }
}
