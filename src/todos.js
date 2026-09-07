// The todo store, on SQLite.
//
// Same never-raise envelope as before: every operation returns { ok: true, ... }
// or { ok: false, reason, because }. That did not change when the storage did,
// which is the point of having had it -- the seam above this file was written
// against the envelope, not against a JSON file, so swapping the store is a
// change to one module.
//
// This is the BACK's code. FRONT never imports it; FRONT calls the seam.

import { db, nowIso } from './db.js';

const MAX_TITLE = 500;

const refuse = (reason, because) => ({ ok: false, reason, because });

// SQLite has no boolean. Converting at the edge means nothing above this file
// has to know that, and `done` is a boolean everywhere a caller can see it.
const row = (r) => (r ? { ...r, done: r.done === 1 } : r);

function newId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function list() {
  try {
    const rows = db().prepare('SELECT * FROM todos ORDER BY created_at').all();
    return { ok: true, todos: rows.map(row) };
  } catch (err) {
    return refuse('todos_unreadable', String(err?.message || err));
  }
}

export function add(title) {
  const text = typeof title === 'string' ? title.trim() : '';
  if (!text) return refuse('missing_params', 'a todo needs a non-empty title');
  if (text.length > MAX_TITLE) {
    return refuse('title_too_long', `title was ${text.length} characters; the limit is ${MAX_TITLE}`);
  }
  try {
    const todo = { id: newId(), title: text, done: 0, created_at: nowIso(), completed_at: null };
    db().prepare(
      'INSERT INTO todos (id, title, done, created_at, completed_at) VALUES (?, ?, ?, ?, ?)',
    ).run(todo.id, todo.title, todo.done, todo.created_at, todo.completed_at);
    return { ok: true, todo: row(todo), todos: list().todos };
  } catch (err) {
    return refuse('todos_unwritable', String(err?.message || err));
  }
}

export function toggle(id) {
  try {
    const found = db().prepare('SELECT * FROM todos WHERE id = ?').get(id);
    if (!found) return refuse('not_found', `no todo with id ${id}`);
    const done = found.done === 1 ? 0 : 1;
    db().prepare('UPDATE todos SET done = ?, completed_at = ? WHERE id = ?')
      .run(done, done ? nowIso() : null, id);
    const after = db().prepare('SELECT * FROM todos WHERE id = ?').get(id);
    return { ok: true, todo: row(after), todos: list().todos };
  } catch (err) {
    return refuse('todos_unwritable', String(err?.message || err));
  }
}

export function remove(id) {
  try {
    const out = db().prepare('DELETE FROM todos WHERE id = ?').run(id);
    if (out.changes === 0) return refuse('not_found', `no todo with id ${id}`);
    return { ok: true, todos: list().todos };
  } catch (err) {
    return refuse('todos_unwritable', String(err?.message || err));
  }
}

export function clearDone() {
  try {
    const out = db().prepare('DELETE FROM todos WHERE done = 1').run();
    return { ok: true, removed: out.changes, todos: list().todos };
  } catch (err) {
    return refuse('todos_unwritable', String(err?.message || err));
  }
}
