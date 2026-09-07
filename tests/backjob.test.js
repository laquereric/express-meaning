// BACKJOB: the one job it has, and the boundaries of it.
import test from 'node:test';
import assert from 'node:assert';

import { db, reset } from '../src/db.js';
import * as seam from '../src/cpcp/back/seam.js';
import { project } from '../src/projection.js';
import { reapReceipts } from '../src/cpcp/backjob/reaper.js';

let conn;
test.beforeEach(() => {
  reset();
  seam.reset();
  process.env.TODOS_DB = ':memory:';
  conn = db(':memory:');
  project();
});
test.after(() => { reset(); delete process.env.TODOS_DB; });

const call = (method, params, operationId) =>
  seam.dispatch({ jsonrpc: '2.0', id: 1, method, params, ...(operationId ? { operationId } : {}) },
                { conn });

test('a fresh receipt survives the reaper', () => {
  call('todo.create', { title: 'x' }, 'keep-me');
  const out = reapReceipts(conn, 24);
  assert.equal(out.ok, true);
  assert.equal(out.reaped, 0);
  // And the intent is still idempotent.
  assert.equal(call('todo.create', { title: 'x' }, 'keep-me').envelope.result.replayed, true);
});

test('an expired receipt is reaped, and the intent stops replaying', () => {
  call('todo.create', { title: 'x' }, 'old-intent');
  db().prepare("UPDATE receipts SET created_at = '2020-01-01T00:00:00.000Z'").run();

  const out = reapReceipts(conn, 24);
  assert.equal(out.reaped, 1);

  // This is the honest consequence and worth stating: past the TTL, a retry is
  // a NEW write. The TTL is a claim about how long a caller might retry, and
  // getting it wrong duplicates work rather than losing it.
  const after = call('todo.create', { title: 'x' }, 'old-intent');
  assert.equal(after.envelope.result.replayed, undefined);
  assert.equal(call('todo.list').envelope.result.todos.length, 2);
});

test('reaping receipts never touches domain state', () => {
  call('todo.create', { title: 'a' }, 'i1');
  db().prepare("UPDATE receipts SET created_at = '2020-01-01T00:00:00.000Z'").run();
  reapReceipts(conn, 24);
  assert.equal(call('todo.list').envelope.result.todos.length, 1,
    'the reaper is maintenance, not a deleter of todos');
});

test('the cutoff is computed from the injected now, not the wall clock', () => {
  const out = reapReceipts(conn, 1, '2030-01-01T12:00:00.000Z');
  assert.equal(out.cutoff, '2030-01-01T11:00:00.000Z');
});
