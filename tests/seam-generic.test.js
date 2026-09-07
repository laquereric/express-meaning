// The seam knows nothing about todos.
//
// That is the claim the src/cpcp/ split makes, and a claim about reusability is
// worth exactly as much as the test that exercises it somewhere else. These
// register invented operations into a reset registry: no todos, no projection,
// no domain module imported at all.

import test from 'node:test';
import assert from 'node:assert';

import { db, reset } from '../src/db.js';
import * as seam from '../src/cpcp/back/seam.js';

let conn;
test.beforeEach(() => {
  reset();
  seam.reset();
  process.env.TODOS_DB = ':memory:';
  conn = db(':memory:');
});
test.after(() => { reset(); delete process.env.TODOS_DB; });

const call = (method, params = {}, operationId) =>
  seam.dispatch({ jsonrpc: '2.0', id: 1, method, params, ...(operationId ? { operationId } : {}) },
                { conn });

test('an unprojected seam answers unknown_operation for everything', () => {
  // Which is the right answer: a seam with no operations serves none.
  assert.equal(call('todo.list').envelope.error.reason, 'unknown_operation');
  assert.deepEqual(seam.operations(), {});
});

test('a foreign domain gets the same envelope, idempotency and CID', () => {
  const ledger = [];
  seam.register('widget.list', {
    direction: 'PULL', summary: 'List widgets', result: { shape: 'Collection' },
    run: () => ({ ok: true, widgets: ledger }),
  });
  seam.register('widget.forge', {
    direction: 'PUSH', summary: 'Forge a widget', params: ['name'],
    run: (p) => {
      if (!p.name) return { ok: false, reason: 'missing_params', because: 'a widget needs a name' };
      ledger.push(p.name);
      return { ok: true, widget: p.name };
    },
  });

  // The CID describes them without the seam knowing what a widget is.
  const doc = seam.cid('https://widgets.test');
  assert.deepEqual(doc.operations.map((o) => o.name).sort(), ['widget.forge', 'widget.list']);
  assert.equal(doc.operations.find((o) => o.name === 'widget.forge').direction, 'PUSH');

  // PUSH still requires a named intent.
  assert.equal(call('widget.forge', { name: 'a' }).envelope.error.reason, 'operation_id_required');

  // And the retry is still the same write -- receipts are the seam's, not the
  // application's, which is why a second application inherits them.
  call('widget.forge', { name: 'a' }, 'forge-1');
  const replay = call('widget.forge', { name: 'a' }, 'forge-1');
  assert.equal(replay.envelope.result.replayed, true);
  assert.deepEqual(ledger, ['a'], 'the replayed intent forged one widget');

  // A domain refusal is still a record at HTTP 200, and still writes no receipt.
  const bad = call('widget.forge', {}, 'forge-2');
  assert.equal(bad.status, 200);
  assert.equal(bad.envelope.error.reason, 'missing_params');
  const fixed = call('widget.forge', { name: 'b' }, 'forge-2');
  assert.equal(fixed.envelope.ok, true);
});

test('register refuses a malformed operation at declaration time', () => {
  // Better to fail at boot than to serve a method that cannot answer.
  assert.throws(() => seam.register('x.y', { direction: 'SIDEWAYS', run: () => ({}) }), TypeError);
  assert.throws(() => seam.register('x.y', { direction: 'PULL', run: 'not a function' }), TypeError);
});
