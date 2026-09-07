// BACKJOB's half of CPCP: keeping receipts from accumulating forever.
//
// This is deliberately the ONLY job. A BACKJOB invented to justify the role
// would be worse than an honest one with a single task: the split is about
// where work may run, not about having three kinds of it.
//
// Why not a timer inside BACK: BACK is synchronous and authoritative. Work that
// can wait must not share a process with work that cannot, or a slow reap
// becomes a slow answer.

import { reap } from '../back/receipts.js';

// A caller retrying a day later is retrying a decision, not a request.
export const DEFAULT_TTL_HOURS = Number(process.env.RECEIPT_TTL_HOURS || 24);
export const DEFAULT_INTERVAL_MS = Number(process.env.BACKJOB_INTERVAL_MS || 60_000);

/** One pass. Returns an envelope like everything else. */
export function reapReceipts(conn, ttlHours = DEFAULT_TTL_HOURS, now = new Date().toISOString()) {
  try {
    return { ok: true, ...reap(conn, ttlHours, now) };
  } catch (err) {
    return { ok: false, reason: 'reap_failed', because: String(err?.message || err) };
  }
}

/** The loop. Returns a stop function so a test can start and stop it. */
export function run({ conn, intervalMs = DEFAULT_INTERVAL_MS, ttlHours = DEFAULT_TTL_HOURS,
                      log = console.log } = {}) {
  const tick = () => {
    const out = reapReceipts(conn, ttlHours);
    // Say what it did, INCLUDING NOTHING. A maintenance job that only speaks
    // when it acts is one you cannot tell from a maintenance job that died.
    log(out.ok
      ? `[backjob] reaped ${out.reaped} receipt(s) older than ${ttlHours}h`
      : `[backjob] ${out.reason}: ${out.because}`);
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
