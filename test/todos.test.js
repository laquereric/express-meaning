'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TodoStore, MAX_TITLE } = require('../lib/todos');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'express-meaning-'));
  return new TodoStore(path.join(dir, 'todos.json'));
}

test('a missing file reads as an empty list, not an error', () => {
  const store = tempStore();
  const out = store.list();
  assert.equal(out.ok, true);
  assert.deepEqual(out.todos, []);
});

test('add, toggle, remove round-trip through the file', () => {
  const store = tempStore();

  const added = store.add('  Cut the release  ');
  assert.equal(added.ok, true);
  assert.equal(added.todo.title, 'Cut the release', 'the title is trimmed');
  assert.equal(added.todo.done, false);

  const toggled = store.toggle(added.todo.id);
  assert.equal(toggled.ok, true);
  assert.equal(toggled.todo.done, true);
  assert.ok(toggled.todo.completed_at, 'completing stamps a time');

  // Re-read from disk rather than trusting the in-memory return.
  assert.equal(store.list().todos[0].done, true);

  const untoggled = store.toggle(added.todo.id);
  assert.equal(untoggled.todo.done, false);
  assert.equal(untoggled.todo.completed_at, null, 'un-completing clears the stamp');

  const removed = store.remove(added.todo.id);
  assert.equal(removed.ok, true);
  assert.deepEqual(store.list().todos, []);
});

test('an empty or blank title refuses as data', () => {
  const store = tempStore();
  for (const bad of ['', '   ', null, undefined, 42]) {
    const out = store.add(bad);
    assert.equal(out.ok, false, `${JSON.stringify(bad)} must refuse`);
    assert.equal(out.reason, 'missing_params');
  }
});

test('an over-long title refuses with the measured length', () => {
  const store = tempStore();
  const out = store.add('x'.repeat(MAX_TITLE + 1));
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'title_too_long');
  assert.match(out.because, new RegExp(`${MAX_TITLE + 1} characters`));
});

test('toggling or removing an unknown id refuses with not_found', () => {
  const store = tempStore();
  assert.equal(store.toggle('nope').reason, 'not_found');
  assert.equal(store.remove('nope').reason, 'not_found');
});

test('clear-done removes only completed items and reports the count', () => {
  const store = tempStore();
  const a = store.add('keep').todo;
  const b = store.add('drop').todo;
  store.toggle(b.id);

  const out = store.clearDone();
  assert.equal(out.ok, true);
  assert.equal(out.removed, 1);
  assert.deepEqual(
    out.todos.map((t) => t.id),
    [a.id],
  );
});

test('ids are unique across rapid adds', () => {
  const store = tempStore();
  const ids = new Set();
  for (let i = 0; i < 50; i += 1) ids.add(store.add(`task ${i}`).todo.id);
  assert.equal(ids.size, 50, 'no id collisions');
});
