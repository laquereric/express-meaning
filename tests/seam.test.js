// The seam: what the FRONT/BACK split actually buys.
//
// Each of these is a property the old in-process call could not have had,
// because there was no boundary for it to be a property of.

import test from 'node:test';
import assert from 'node:assert';

import { db, reset } from '../src/db.js';
import * as seam from '../src/cpcp/back/seam.js';
import { project, BASE_IRI } from '../src/projection.js';

let conn;
test.beforeEach(() => {
  reset();
  seam.reset();
  process.env.TODOS_DB = ':memory:';
  conn = db(':memory:');
  // The projection is the app's; the seam is generic. A test that forgot this
  // would dispatch into an empty registry and see unknown_operation for
  // everything -- which is the right answer to an unprojected seam.
  project();
});
test.after(() => { reset(); delete process.env.TODOS_DB; });

const call = (method, params = {}, operationId) =>
  seam.dispatch({ jsonrpc: '2.0', id: 1, method, params, ...(operationId ? { operationId } : {}) },
                { conn });

test('the CID publishes every operation, with its direction', () => {
  const doc = seam.cid(BASE_IRI);
  const names = doc.operations.map((o) => o.name);
  assert.deepEqual(names.sort(), Object.keys(seam.operations()).sort());
  const create = doc.operations.find((o) => o.name === 'todo.create');
  assert.equal(create.direction, 'PUSH');
  assert.equal(doc.operations.find((o) => o.name === 'todo.list').direction, 'PULL');
});

test('an unknown method refuses as data, at HTTP 200', () => {
  // The method ran and decided: that is a domain outcome, not a transport
  // failure, so it is 200 with ok:false rather than a 404.
  const { status, envelope } = call('todo.nope');
  assert.equal(status, 200);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.reason, 'unknown_operation');
  assert.match(envelope.error.because, /todo\.nope/);
});

test('a PUSH without an operationId is refused BEFORE it happens', () => {
  const { envelope } = call('todo.create', { title: 'x' });
  assert.equal(envelope.error.reason, 'operation_id_required');
  // And nothing was written.
  assert.equal(call('todo.list').envelope.result.todos.length, 0);
});

test('a PULL needs no operationId', () => {
  assert.equal(call('todo.list').envelope.ok, true);
});

test('THE RETRY IS THE SAME WRITE, not a second one', () => {
  // The property the whole split exists for. Same intent, twice, over a
  // boundary that can be retried by anything -- a proxy, a browser, a user.
  const first = call('todo.create', { title: 'once' }, 'intent-1');
  const again = call('todo.create', { title: 'once' }, 'intent-1');

  assert.equal(first.envelope.ok, true);
  assert.equal(again.envelope.ok, true);
  assert.equal(again.envelope.result.replayed, true, 'the second is marked a replay');

  const listed = call('todo.list').envelope.result.todos;
  assert.equal(listed.length, 1, 'one intent, one todo');
  assert.equal(listed[0].title, 'once');
});

test('a different intent is a different write', () => {
  call('todo.create', { title: 'a' }, 'intent-a');
  call('todo.create', { title: 'b' }, 'intent-b');
  assert.equal(call('todo.list').envelope.result.todos.length, 2);
});

test('a refused PUSH leaves no receipt, so a fixed retry can proceed', () => {
  // A receipt for a refusal would make the mistake permanent: the caller
  // corrects the title, retries the same intent, and gets its own error back.
  const bad = call('todo.create', { title: '' }, 'intent-fix');
  assert.equal(bad.envelope.ok, false);
  assert.equal(bad.envelope.error.reason, 'missing_params');

  const good = call('todo.create', { title: 'corrected' }, 'intent-fix');
  assert.equal(good.envelope.ok, true);
  assert.equal(good.envelope.result.todo.title, 'corrected');
});

test('a non-object body and non-object params are parse refusals at 400', () => {
  for (const bad of [null, 'string', 42, []]) {
    assert.equal(seam.dispatch(bad, { conn }).status, 400);
  }
  const out = seam.dispatch({ jsonrpc: '2.0', id: 1, method: 'todo.list', params: 'nope' }, { conn });
  assert.equal(out.status, 400);
  assert.equal(out.envelope.error.reason, 'unparseable_json');
});

test('the envelope id echoes back on success and on refusal', () => {
  assert.equal(seam.dispatch({ id: 7, method: 'todo.list' }, { conn }).envelope.id, 7);
  assert.equal(seam.dispatch({ id: 7, method: 'nope' }, { conn }).envelope.id, 7);
});

test('a toggle is idempotent by intent, not by state', () => {
  // Without receipts, retrying a toggle flips it back -- the failure mode that
  // makes "just retry it" unsafe for anything but reads.
  const made = call('todo.create', { title: 't' }, 'i1').envelope.result.todo;
  call('todo.toggle', { id: made.id }, 'i2');
  call('todo.toggle', { id: made.id }, 'i2');
  assert.equal(call('todo.list').envelope.result.todos[0].done, true,
    'the replayed toggle did not flip it back');
});
