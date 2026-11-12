// Pure unit tests (no database needed).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, MAX_ROWS } from '../src/sqlBuilder.js';

const columns = new Map([
  ['id', 'uuid'],
  ['user_id', 'uuid'],
  ['read_at', 'timestamp with time zone'],
  ['created_at', 'timestamp with time zone'],
  ['title', 'text'],
]);

describe('buildQuery', () => {
  it('builds a select without order or filters', () => {
    const q = buildQuery('notifications', columns, { action: 'select', columns: 'id, title', filters: [], order: [] });
    assert.equal(q.sql, `select "id", "title" from public."notifications" limit ${MAX_ROWS} offset 0`);
    assert.deepEqual(q.params, []);
  });

  it('binds every value and quotes identifiers', () => {
    const q = buildQuery('notifications', columns, {
      action: 'select',
      columns: 'id',
      filters: [
        { column: 'user_id', op: 'eq', value: 'u1' },
        { column: 'id', op: 'in', value: ['a', 'b'] },
        { column: 'read_at', op: 'is', value: null, negate: true },
      ],
      order: [{ column: 'created_at', ascending: false }],
      limit: 10,
      offset: 20,
    });
    assert.equal(
      q.sql,
      'select "id" from public."notifications" where "user_id" = $1 and "id" = any($2) and not ("read_at" is null) order by "created_at" desc limit 10 offset 20',
    );
    assert.deepEqual(q.params, ['u1', ['a', 'b']]);
  });

  it('caps the page size', () => {
    const q = buildQuery('notifications', columns, { action: 'select', limit: 999999 });
    assert.match(q.sql, new RegExp(`limit ${MAX_ROWS} `));
  });

  it('counts with the same filters and supports head requests', () => {
    const q = buildQuery('notifications', columns, { action: 'select', count: 'exact', head: true, filters: [{ column: 'user_id', op: 'eq', value: 'u1' }] });
    assert.equal(q.sql, null);
    assert.equal(q.countSql, 'select count(*)::bigint as count from public."notifications" where "user_id" = $1');
  });

  it('rejects unknown columns, operators and injection attempts', () => {
    assert.throws(() => buildQuery('t', columns, { action: 'select', columns: 'id; drop table x' }), /unknown column/);
    assert.throws(() => buildQuery('t', columns, { action: 'select', filters: [{ column: 'title', op: 'raw', value: 1 }] }), /unsupported operator/);
    assert.throws(() => buildQuery('t', columns, { action: 'select', order: [{ column: 'title"; --' }] }), /unknown column/);
    assert.throws(() => buildQuery('t', columns, { action: 'select', filters: [{ column: 'read_at', op: 'is', value: 'x' }] }), /is\(\)/);
  });

  it('refuses unfiltered update and delete', () => {
    assert.throws(() => buildQuery('t', columns, { action: 'update', values: { title: 'x' } }), /requires filters/);
    assert.throws(() => buildQuery('t', columns, { action: 'delete' }), /requires filters/);
  });

  it('builds parameterised inserts and updates', () => {
    const insert = buildQuery('t', columns, { action: 'insert', values: { user_id: 'u1', title: 'hola' } });
    assert.equal(insert.sql, 'insert into public."t" ("user_id", "title") values ($1, $2)');
    const update = buildQuery('t', columns, { action: 'update', values: { read_at: '2026-01-01' }, filters: [{ column: 'id', op: 'eq', value: 'n1' }] });
    assert.equal(update.sql, 'update public."t" set "read_at" = $1 where "id" = $2');
    assert.deepEqual(update.params, ['2026-01-01', 'n1']);
  });
});
