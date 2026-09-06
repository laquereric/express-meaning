'use strict';

// The traditional half: a TODO list on a JSON file.
//
// No database, no ORM. The whole point of this half is that it is boring
// and obviously correct, so the interesting half (the seam) has something
// real to be interesting about.
//
// Same never-raise discipline as the seam: every operation returns
// { ok: true, ... } or { ok: false, reason, because }.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'todos.json');
const MAX_TITLE = 500;

function refuse(reason, because) {
  return { ok: false, reason, because };
}

class TodoStore {
  constructor(file = DEFAULT_PATH) {
    this.file = file;
  }

  /** Read the file. A missing file is an empty list, not an error. */
  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(parsed.todos) ? parsed.todos : [];
    } catch (err) {
      if (err && err.code === 'ENOENT') return [];
      throw err;
    }
  }

  /** Write via a temp file + rename so a crash mid-write cannot truncate. */
  write(todos) {
    const tmp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify({ todos }, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.file);
    return todos;
  }

  list() {
    try {
      return { ok: true, todos: this.read() };
    } catch (err) {
      return refuse('todos_unreadable', String((err && err.message) || err));
    }
  }

  add(title) {
    const text = typeof title === 'string' ? title.trim() : '';
    if (!text) return refuse('missing_params', 'a todo needs a non-empty title');
    if (text.length > MAX_TITLE) {
      return refuse('title_too_long', `title was ${text.length} characters; the limit is ${MAX_TITLE}`);
    }
    try {
      const todos = this.read();
      const todo = {
        id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        title: text,
        done: false,
        created_at: new Date().toISOString(),
      };
      todos.push(todo);
      this.write(todos);
      return { ok: true, todo, todos };
    } catch (err) {
      return refuse('todos_unwritable', String((err && err.message) || err));
    }
  }

  toggle(id) {
    try {
      const todos = this.read();
      const todo = todos.find((t) => t.id === id);
      if (!todo) return refuse('not_found', `no todo with id ${id}`);
      todo.done = !todo.done;
      todo.completed_at = todo.done ? new Date().toISOString() : null;
      this.write(todos);
      return { ok: true, todo, todos };
    } catch (err) {
      return refuse('todos_unwritable', String((err && err.message) || err));
    }
  }

  remove(id) {
    try {
      const todos = this.read();
      const next = todos.filter((t) => t.id !== id);
      if (next.length === todos.length) return refuse('not_found', `no todo with id ${id}`);
      this.write(next);
      return { ok: true, todos: next };
    } catch (err) {
      return refuse('todos_unwritable', String((err && err.message) || err));
    }
  }

  clearDone() {
    try {
      const todos = this.read();
      const next = todos.filter((t) => !t.done);
      this.write(next);
      return { ok: true, removed: todos.length - next.length, todos: next };
    } catch (err) {
      return refuse('todos_unwritable', String((err && err.message) || err));
    }
  }
}

module.exports = { TodoStore, DEFAULT_PATH, MAX_TITLE };
