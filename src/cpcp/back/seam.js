// BACK's half of CPCP: the seam itself.
//
// GENERIC ON PURPOSE. Nothing here knows what a todo is. Operations are
// REGISTERED by the application (see src/projection.js), the way rails-cpcp
// keeps the engine separate from the projection that declares a resource. That
// separation is what makes this directory reusable rather than merely
// relocated: a second application registers different operations and gets the
// same envelope, the same idempotency, the same CID.
//
// What the boundary buys, and none of it is application logic:
//
//   an intent is NAMED before it is performed     operationId on every PUSH
//   a retry is the same write, not a second one   receipts
//   a refusal is a record, not an exception       the never-raise envelope
//   what the seam answers is discoverable         the CID

import { ok, no } from '../envelope.js';
import * as receipts from './receipts.js';

const registry = new Map();

/**
 * Declare one operation.
 *
 * @param {string} name        wire name, `<domain>.<verb>`
 * @param {object} spec
 * @param {'PULL'|'PUSH'} spec.direction  PUSH requires an operationId
 * @param {function} spec.run             (params) => envelope
 */
export function register(name, spec) {
  if (!['PULL', 'PUSH'].includes(spec.direction)) {
    throw new TypeError(`${name}: direction must be PULL or PUSH`);
  }
  if (typeof spec.run !== 'function') throw new TypeError(`${name}: run must be a function`);
  registry.set(name, { params: [], result: { shape: 'Record' }, summary: '', ...spec });
  return registry.get(name);
}

/** Test seam: forget every registration. */
export function reset() {
  registry.clear();
}

export const operations = () => Object.fromEntries(registry);

/** The CID: what this seam answers. A caller reads it instead of guessing. */
export function cid(baseIri) {
  return {
    '@context': { '@vocab': 'https://w3id.org/cpcp/ns#', op: `${baseIri}/op/` },
    '@id': `${baseIri}/cid`,
    standard: 'JSON-RPC-LD-PS1',
    title: 'express-meaning todo seam',
    operations: [...registry.entries()].map(([name, op]) => ({
      '@id': `${baseIri}/op/${name}`,
      name,
      direction: op.direction,
      summary: op.summary,
      params: op.params,
      result: op.result,
    })),
  };
}

/**
 * Dispatch one envelope. Never throws: every outcome is an envelope.
 *
 * @returns {{status:number, envelope:object}} status and body are two channels.
 *   A domain refusal is HTTP 200 because the method ran and decided; only a
 *   malformed request is a transport-level 400.
 */
export function dispatch(payload, { conn, now = () => new Date().toISOString() } = {}) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { status: 400, envelope: no(null, 'unparseable_json', 'body was not a JSON object') };
  }

  const id = payload.id ?? null;
  const method = payload.method;
  const op = registry.get(method);
  if (!op) {
    return { status: 200, envelope: no(id, 'unknown_operation', `no CPCP operation "${method}"`) };
  }

  const params = payload.params ?? {};
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    return { status: 400, envelope: no(id, 'unparseable_json', 'params must be an object') };
  }

  if (op.direction !== 'PUSH') {
    const out = op.run(params);
    return out.ok
      ? { status: 200, envelope: ok(id, out) }
      : { status: 200, envelope: no(id, out.reason, out.because) };
  }

  const operationId = payload.operationId;
  if (!operationId) {
    // A write with no named intent cannot be made idempotent, so it is refused
    // before it happens rather than performed and regretted.
    return { status: 200, envelope: no(id, 'operation_id_required',
      `${method} is a PUSH and must name its intent with an operationId`) };
  }

  const already = receipts.find(conn, operationId);
  if (already) {
    // THE RETRY IS THE SAME WRITE. Not a second one, and not an error: the
    // caller gets the answer its intent already produced.
    return { status: 200, envelope: ok(id, { ...already, replayed: true }) };
  }

  const out = op.run(params);
  // A refusal writes NO receipt. Recording one would make the mistake
  // permanent: correct the input, retry the same intent, get your own error back.
  if (!out.ok) return { status: 200, envelope: no(id, out.reason, out.because) };

  receipts.keep(conn, operationId, method, out, now());
  return { status: 200, envelope: ok(id, out) };
}
