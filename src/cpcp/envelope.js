// The envelope, both directions.
//
// Building one (this app is the BACK) and reading one (this app is a caller)
// are the same vocabulary seen from two ends, so they live together. Nothing
// here knows what a todo is.
//
// NEVER RAISE. There is no throw path in this module: every failure is data.

export const CONTEXT = {
  '@vocab': 'https://w3id.org/cpcp/ns#',
  id: '@id',
  type: '@type',
  operationId: 'https://w3id.org/json-rpc-ld/ns#operationId',
};

/** A success envelope, for a seam answering. */
export const ok = (id, result) => ({ jsonrpc: '2.0', '@context': CONTEXT, id, ok: true, result });

/**
 * A refusal envelope, for a seam answering.
 *
 * NESTED under `error`, which is the shape this app serves. It reads both on
 * the way in (see `normalize`) because both are live upstream; it emits one,
 * because a producer that varied its refusal shape would be the reason clients
 * have to handle two.
 */
export const no = (id, reason, because) => ({
  jsonrpc: '2.0', '@context': CONTEXT, id, ok: false, error: { reason, because },
});

/** A refusal this process produced locally, before or instead of a call. */
export const refuse = (reason, because, extra = {}) => ({ ok: false, reason, because, ...extra });

/**
 * Collapse either refusal shape into one, for a caller reading.
 *
 * Refusals arrive nested (`error.reason`) AND flat (top-level `reason`). Both
 * are live upstream and deliberately not unified, so a client handling one is
 * broken against half the seams. Success passes through untouched.
 */
export function normalize(envelope) {
  if (envelope && envelope.ok === true) return envelope;
  const nested = (envelope && typeof envelope.error === 'object' && envelope.error) || {};
  const reason =
    nested.reason ||
    (envelope && typeof envelope.reason === 'string' ? envelope.reason : null) ||
    'unparseable_envelope';
  const because =
    nested.because !== undefined ? nested.because
      : envelope && envelope.because !== undefined ? envelope.because : null;
  return { ok: false, reason, because, failure_layer: nested.failure_layer || null };
}
