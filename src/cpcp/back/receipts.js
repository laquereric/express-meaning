// Idempotency receipts: what a named intent already did.
//
// BACK owns these, and they live in the SAME database as the state they
// protect. A receipt that outlives its process but not its database lies after
// a restore -- it would say an intent was performed when the write it recorded
// is gone. The two move together or neither is trustworthy.
//
// The CPCP layer brings its own table. Domain schema is db.js's business; this
// is not domain.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS receipts (
  operation_id TEXT PRIMARY KEY,
  method       TEXT NOT NULL,
  result       TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS receipts_created_at ON receipts (created_at);
`;

export function ensureSchema(conn) {
  conn.exec(SCHEMA);
  return conn;
}

/** The answer this intent already produced, or null. */
export function find(conn, operationId) {
  const row = conn.prepare('SELECT result FROM receipts WHERE operation_id = ?').get(operationId);
  return row ? JSON.parse(row.result) : null;
}

export function keep(conn, operationId, method, result, now) {
  conn.prepare(
    'INSERT OR REPLACE INTO receipts (operation_id, method, result, created_at) VALUES (?, ?, ?, ?)',
  ).run(operationId, method, JSON.stringify(result), now);
}

/**
 * Delete receipts older than the TTL. BACKJOB's only job.
 *
 * Past the TTL a retry becomes a NEW write. The TTL is therefore a claim about
 * how long a caller might still retry an intent, and setting it too short
 * duplicates work rather than losing it.
 */
export function reap(conn, ttlHours, now) {
  const cutoff = new Date(new Date(now).getTime() - ttlHours * 3600_000).toISOString();
  const out = conn.prepare('DELETE FROM receipts WHERE created_at < ?').run(cutoff);
  return { reaped: out.changes, cutoff };
}
