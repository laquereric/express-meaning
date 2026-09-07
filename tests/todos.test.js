// The todo store, now on SQLite. Same envelope contract as when it was a JSON
// file -- these tests barely changed, which was the argument for having had an
// envelope: the seam above was written against the shape, not the storage.

import test from 'node:test';
import assert from 'node:assert';

import { db, reset } from '../src/db.js';
import * as todos from '../src/todos.js';

// Each test gets a fresh in-memory database. No fixtures, no cleanup, no
// ordering between tests.
test.beforeEach(() => {
  reset();
  process.env.TODOS_DB = ':memory:';
  db(':memory:');
});
test.after(() => { reset(); delete process.env.TODOS_DB; });

test('an empty database lists nothing, and that is not an error', () => {
  const out = todos.list();
  assert.equal(out.ok, true);
  assert.deepEqual(out.todos, []);
});

test('add, toggle, remove round-trip through SQLite', () => {
  const added = todos.add('  Cut the release  ');
  assert.equal(added.ok, true);
  assert.equal(added.todo.title, 'Cut the release', 'the title is trimmed');
  assert.equal(added.todo.done, false, 'done is a boolean, not SQLite 0/1');

  const toggled = todos.toggle(added.todo.id);
  assert.equal(toggled.todo.done, true);
  assert.ok(toggled.todo.completed_at, 'completing stamps a time');

  // Re-read rather than trusting the returned object.
  assert.equal(todos.list().todos[0].done, true);

  const back = todos.toggle(added.todo.id);
  assert.equal(back.todo.done, false);
  assert.equal(back.todo.completed_at, null, 'un-completing clears the stamp');

  assert.equal(todos.remove(added.todo.id).ok, true);
  assert.deepEqual(todos.list().todos, []);
});

test('done crosses the boundary as a boolean in every shape', () => {
  // SQLite has no boolean. If the conversion were missing anywhere, a client
  // would get 0/1 from one call and true/false from another.
  const created = todos.add('x');
  assert.equal(typeof created.todo.done, 'boolean');
  assert.equal(typeof created.todos[0].done, 'boolean');
  assert.equal(typeof todos.list().todos[0].done, 'boolean');
  assert.equal(typeof todos.toggle(created.todo.id).todo.done, 'boolean');
});

test('an empty or blank title refuses as data', () => {
  for (const bad of ['', '   ', null, undefined, 42]) {
    const out = todos.add(bad);
    assert.equal(out.ok, false, `${JSON.stringify(bad)} must refuse`);
    assert.equal(out.reason, 'missing_params');
  }
});

test('an over-long title refuses with the measured length', () => {
  const out = todos.add('x'.repeat(501));
  assert.equal(out.reason, 'title_too_long');
  assert.match(out.because, /501 characters/);
});

test('toggling or removing an unknown id refuses with not_found', () => {
  assert.equal(todos.toggle('nope').reason, 'not_found');
  assert.equal(todos.remove('nope').reason, 'not_found');
});

test('clear-done removes only completed items and reports the count', () => {
  const keep = todos.add('keep').todo;
  const drop = todos.add('drop').todo;
  todos.toggle(drop.id);

  const out = todos.clearDone();
  assert.equal(out.removed, 1);
  assert.deepEqual(out.todos.map((t) => t.id), [keep.id]);
});

test('ids are unique across rapid adds', () => {
  const ids = new Set();
  for (let i = 0; i < 50; i += 1) ids.add(todos.add(`task ${i}`).todo.id);
  assert.equal(ids.size, 50);
});

test('the id is a primary key, so a collision could not silently overwrite', () => {
  const first = todos.add('one').todo;
  assert.throws(() => {
    db().prepare('INSERT INTO todos (id, title, done, created_at) VALUES (?, ?, 0, ?)')
      .run(first.id, 'two', new Date().toISOString());
  }, 'a duplicate id must be rejected by the schema, not by luck');
});

test('three roles can open a cold database at once', async () => {
  // A regression test for a bug the split introduced and a passing suite hid.
  // Six concurrent opens of a NON-EXISTENT file: before busy_timeout, five of
  // six died with "database is locked" -- and BACK usually won, so the app
  // looked healthy while BACKJOB was already dead.
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);

  const file = join(mkdtempSync(join(tmpdir(), 'em-race-')), 'cold.sqlite3');
  const src = new URL('../src/db.js', import.meta.url).href;
  const open = () => run(process.execPath, ['--input-type=module', '-e',
    `import { db } from ${JSON.stringify(src)}; db(${JSON.stringify(file)});`]);

  const results = await Promise.allSettled([open(), open(), open(), open(), open(), open()]);
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(failed.length, 0,
    `${failed.length}/6 concurrent cold opens failed: ${failed[0]?.reason?.stderr?.slice(0, 120)}`);
});
