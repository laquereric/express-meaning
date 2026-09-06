// A CPCP client, in the magentic-stack pattern.
//
// Three rules carry over from the contract package
// (coordination-protocol-contract-package/spec):
//
//   1. Never raise across the boundary. Every failure is data:
//      { ok: false, reason, because }. This module has no throw path.
//   2. Read the body on every status. HTTP status and envelope are two
//      channels (spec/http-mapping.md); a non-200 still carries an
//      envelope, and a 200 can still be a refusal.
//   3. Refusals arrive in two stable shapes -- nested under `error`, and
//      flat at the top level. Both are live and are deliberately NOT
//      unified upstream, so a client must handle both (spec/envelope.md).

const DEFAULT_TIMEOUT_MS = 8000;

/** Build a refusal in the shape every caller in this app expects. */
function refuse(reason, because, extra = {}) {
  return { ok: false, reason, because, ...extra };
}

/**
 * Collapse either refusal shape into one. Success passes through.
 * `http` is attached by the caller; it is a transport fact, not a domain one.
 */
function normalize(envelope) {
  if (envelope && envelope.ok === true) return envelope;
  const nested = (envelope && typeof envelope.error === 'object' && envelope.error) || {};
  const reason =
    nested.reason ||
    (envelope && typeof envelope.reason === 'string' ? envelope.reason : null) ||
    'unparseable_envelope';
  const because =
    nested.because !== undefined
      ? nested.because
      : envelope && envelope.because !== undefined
        ? envelope.because
        : null;
  const layer = nested.failure_layer || (envelope && envelope.failure_layer) || null;
  return { ok: false, reason, because, failure_layer: layer };
}

/** One HTTP exchange. Resolves for every outcome, including network failure. */
async function exchange(url, init, timeoutMs) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: control.signal });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      return {
        http: res.status,
        envelope: refuse('unparseable_json', `${url} answered ${res.status} with a non-JSON body`),
      };
    }
    return { http: res.status, envelope: parsed };
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

/** Strip a trailing slash so `${base}/rpc` never doubles up. */
function trim(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

/**
 * GET <base>/cid.json -- the seam's self-description.
 *
 * The CID *is* the contract: it names every operation the seam will
 * answer. Reading it before calling is what lets this app know that
 * `meaning.list` is absent without guessing from a failed call.
 */
async function discover(baseUrl, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = `${trim(baseUrl)}/cid.json`;
  const { http, envelope } = await exchange(url, { headers: { accept: 'application/json' } }, timeoutMs);

  if (envelope && envelope.ok === false) return { ...normalize(envelope), http, url };
  if (http !== 200) {
    return { ...refuse('cid_unavailable', `${url} answered HTTP ${http}`), http, url };
  }
  if (!envelope || !Array.isArray(envelope.operations)) {
    return { ...refuse('cid_malformed', `${url} published no operations array`), http, url };
  }

  const operations = envelope.operations
    .map((op) => (op && typeof op.name === 'string' ? op.name : null))
    .filter(Boolean);

  return { ok: true, http, url, cid: envelope, operations, title: envelope.title || null };
}

/**
 * POST <base>/rpc -- call one method.
 *
 * Returns the normalized envelope with `http` attached. Callers branch on
 * `.ok`; they never see a thrown error and never need the status alone.
 */
async function pull(baseUrl, method, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, operationId } = {}) {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    // spec/methods.md: a client MUST NOT coerce a non-object params to {}.
    // Refuse locally rather than send something the seam would have to reject.
    return refuse('unparseable_json', 'params must be a JSON object');
  }

  const url = `${trim(baseUrl)}/rpc`;
  const body = { jsonrpc: '2.0', id: 1, method, params };
  if (operationId) body.operationId = operationId;

  const { http, envelope } = await exchange(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );

  if (envelope === null) {
    return { ...refuse('empty_body', `${url} answered HTTP ${http} with no body`), http };
  }
  return { ...normalize(envelope), http };
}

export { discover, pull, normalize, refuse, DEFAULT_TIMEOUT_MS };
