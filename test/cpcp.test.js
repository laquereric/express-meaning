'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const cpcp = require('../lib/cpcp');

/** Stand up a throwaway seam that answers exactly what a case needs. */
function seam(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ origin: `http://127.0.0.1:${port}/_cpcp`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

test('discover reads the CID and lists its operations', async () => {
  const s = await seam((req, res) =>
    json(res, 200, { title: 'test seam', operations: [{ name: 'a.list' }, { name: 'b.get' }] }),
  );
  const out = await cpcp.discover(s.origin);
  assert.equal(out.ok, true);
  assert.deepEqual(out.operations, ['a.list', 'b.get']);
  assert.equal(out.title, 'test seam');
  await s.close();
});

test('discover refuses a CID with no operations array, as data', async () => {
  const s = await seam((req, res) => json(res, 200, { title: 'malformed' }));
  const out = await cpcp.discover(s.origin);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'cid_malformed');
  await s.close();
});

test('an unreachable seam is a refusal, never a throw', async () => {
  // Port 1 on loopback: nothing listens, connection is refused immediately.
  const out = await cpcp.discover('http://127.0.0.1:1/_cpcp');
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'unreachable');
  assert.ok(out.because, 'a refusal carries a because');
});

test('pull reads the NESTED refusal shape (reason under error)', async () => {
  const s = await seam((req, res) =>
    json(res, 200, {
      jsonrpc: '2.0',
      id: 1,
      ok: false,
      error: { reason: 'unknown_operation', because: 'no CPCP operation "nope"' },
    }),
  );
  const out = await cpcp.pull(s.origin, 'nope');
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'unknown_operation');
  assert.match(out.because, /no CPCP operation/);
  await s.close();
});

test('pull reads the FLAT refusal shape (reason at top level)', async () => {
  // Both shapes are live upstream and deliberately not unified, so a
  // client that handles only one is broken against half the seams.
  const s = await seam((req, res) =>
    json(res, 200, { ok: false, reason: 'unknown_store', because: { store: 'vault' }, jsonrpc: '2.0', id: 1 }),
  );
  const out = await cpcp.pull(s.origin, 'x.y');
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'unknown_store');
  assert.deepEqual(out.because, { store: 'vault' });
  await s.close();
});

test('a non-200 still has its body read', async () => {
  // Dual-signal: status describes the exchange, the envelope describes
  // the outcome. A client that branches on status alone loses the reason.
  const s = await seam((req, res) => json(res, 503, { ok: false, reason: 'graph_unreachable', because: 'store down' }));
  const out = await cpcp.pull(s.origin, 'x.y');
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'graph_unreachable');
  assert.equal(out.http, 503);
  await s.close();
});

test('a 200 with a non-JSON body is a parse refusal, not a crash', async () => {
  const s = await seam((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>not json</html>');
  });
  const out = await cpcp.pull(s.origin, 'x.y');
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'unparseable_json');
  await s.close();
});

test('non-object params are refused locally, never coerced to {}', async () => {
  // spec/methods.md is explicit: a client MUST NOT coerce a falsey
  // non-object params to {}. Refuse before sending.
  for (const bad of [null, 'string', 42, ['a']]) {
    const out = await cpcp.pull('http://127.0.0.1:1/_cpcp', 'x.y', bad);
    assert.equal(out.ok, false, `params ${JSON.stringify(bad)} must refuse`);
    assert.equal(out.reason, 'unparseable_json');
  }
});

test('a success envelope passes through with its result', async () => {
  const s = await seam((req, res) => json(res, 200, { jsonrpc: '2.0', id: 1, ok: true, result: { '@graph': [1, 2] } }));
  const out = await cpcp.pull(s.origin, 'x.list');
  assert.equal(out.ok, true);
  assert.deepEqual(out.result['@graph'], [1, 2]);
  await s.close();
});

module.exports = { seam, json };
