// The BACK's durable state. SQLite via node:sqlite -- built in since Node 22,
// so persistence costs no dependency.
//
// Two tables and they are not the same kind of thing:
//
//   todos      domain state, declared here. What the application is about.
//   receipts   idempotency, declared by src/cpcp/back/receipts.js and applied
//              here -- the CPCP layer brings its own table.
//
// They share ONE database on purpose. A receipt that outlives its process but
// not the state it protects lies after a restore, so the two move together or
// neither is trustworthy. Sharing the file is what makes that automatic.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { ensureSchema as ensureReceipts } from './cpcp/back/receipts.js';

// Long enough to outlast schema creation by a sibling role, short enough that a
// genuinely stuck database still fails rather than hanging a boot forever.
export const BUSY_TIMEOUT_MS = Number(process.env.SQLITE_BUSY_TIMEOUT_MS || 5000);

export const DEFAULT_PATH = join(import.meta.dirname, '..', 'data', 'todos.sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS todos (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  done         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  completed_at TEXT
);
`;

let handle = null;
let handlePath = null;

/**
 * Open (once) and migrate. Idempotent: every statement is IF NOT EXISTS, so
 * boot order does not matter and a second role opening the same file is fine.
 */
export function db(path = process.env.TODOS_DB || DEFAULT_PATH) {
  if (handle && handlePath === path) return handle;
  if (handle) handle.close();

  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const conn = new DatabaseSync(path);

  // BUSY_TIMEOUT FIRST, BEFORE ANY OTHER STATEMENT.
  //
  // Three roles open this file, and on a COLD start they open it at the same
  // moment -- the schema does not exist yet, so all three try to create it and
  // all but one get SQLITE_BUSY immediately. Reproduced with six concurrent
  // opens: five died with "database is locked" and one succeeded.
  //
  // The failure was quiet in the worst way: BACK usually won the race and
  // looked healthy, so the app served requests while BACKJOB was dead. A
  // worker that dies on cold start and a worker with nothing to do print the
  // same amount of nothing.
  //
  // Without a timeout SQLite returns BUSY instantly rather than waiting. This
  // is the wait, and it has to be set before the statements that would contend.
  if (path !== ':memory:') conn.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);

  // WAL so BACKJOB can reap while BACK serves: without it the reaper's writes
  // block reads and maintenance becomes an outage. Setting it is itself a write
  // to the file header, which is why it comes after the timeout and not before.
  if (path !== ':memory:') conn.exec('PRAGMA journal_mode = WAL');
  conn.exec('PRAGMA foreign_keys = ON');
  conn.exec(SCHEMA);
  ensureReceipts(conn);

  handle = conn;
  handlePath = path;
  return conn;
}

/** Test seam: drop the memoised handle so the next db() reopens. */
export function reset() {
  if (handle) handle.close();
  handle = null;
  handlePath = null;
}

export const nowIso = () => new Date().toISOString();
