// FRONT's half of CPCP: how a caller reaches a seam.
//
// Used for both seams this app talks to -- its own BACK, and magenticmarket.ai
// for the frame list. That it is the same code either way is the point: a seam
// is a seam, and FRONT does not know which side of the pod network it is on.
//
// Three things a naive client gets wrong, handled here:
//
//   1. NEVER RAISE. Every failure is data. No throw path in this file.
//   2. READ THE BODY ON EVERY STATUS. A 200 can refuse; a 503 still carries a
//      reason. Status and envelope are two channels.
//   3. BOTH REFUSAL SHAPES, via envelope.normalize.

import { refuse, normalize } from '../envelope.js';

const DEFAULT_TIMEOUT_MS = 8000;

async function exchange(url, init, timeoutMs) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: control.signal });
    const text = await res.text();
    try {
      return { http: res.status, envelope: text ? JSON.parse(text) : null };
    } catch {
      return {
        http: res.status,
        envelope: refuse('unparseable_json', `${url} answered ${res.status} with a non-JSON body`),
      };
    }
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
    return {
      http: 0,
      envelope: refuse(
        aborted ? 'upstream_timeout' : 'unreachable',
        aborted ? `no answer from ${url} within ${timeoutMs}ms` : String((err && err.message) || err),
      ),
    };
  } finally {
    clearTimeout(timer);
  }
}

const trim = (base) => String(base || '').replace(/\/+$/, '');

/**
 * GET <base>/cid.json — the seam's self-description.
 *
 * THE CID IS THE CONTRACT. Reading it before calling is what lets this app
 * report "not published yet" as a measurement rather than a guess.
 */
export async function discover(baseUrl, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = `${trim(baseUrl)}/cid.json`;
  const { http, envelope } = await exchange(url, { headers: { accept: 'application/json' } }, timeoutMs);

  if (envelope && envelope.ok === false) return { ...normalize(envelope), http, url };
  if (http !== 200) return { ...refuse('cid_unavailable', `${url} answered HTTP ${http}`), http, url };
  if (!envelope || !Array.isArray(envelope.operations)) {
    return { ...refuse('cid_malformed', `${url} published no operations array`), http, url };
  }
  return {
    ok: true,
    http,
    url,
    cid: envelope,
    operations: envelope.operations.map((o) => (o && o.name) || null).filter(Boolean),
    title: envelope.title || null,
  };
}

/** POST <base>/rpc — call one method. Returns a normalized envelope. */
export async function pull(baseUrl, method, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, operationId } = {}) {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    // The method conventions are explicit: a client MUST NOT coerce a non-object
    // params to {}. Refuse locally rather than send what the seam must reject.
    return refuse('unparseable_json', 'params must be a JSON object');
  }
  const url = `${trim(baseUrl)}/rpc`;
  const body = { jsonrpc: '2.0', id: 1, method, params };
  if (operationId) body.operationId = operationId;

  const { http, envelope } = await exchange(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  }, timeoutMs);

  if (envelope === null) return { ...refuse('empty_body', `${url} answered HTTP ${http} with no body`), http };
  return { ...normalize(envelope), http };
}

/**
 * A PUSH names its intent before performing it.
 *
 * Generate the operationId ONCE per intent and reuse it across retries. A fresh
 * id per attempt is an idempotency key that idempotates nothing.
 */
export async function push(baseUrl, method, params, operationId, opts = {}) {
  if (!operationId) return refuse('operation_id_required', 'a PUSH names its intent before performing it');
  return pull(baseUrl, method, params, { ...opts, operationId });
}

export { refuse, normalize };
