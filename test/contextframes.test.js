'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const frames = require('../lib/contextframes');

function seam(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
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

/** A seam that publishes contextframe.list and answers it. */
function publishingSeam(result) {
  return seam((req, res) => {
    if (req.url.endsWith('/cid.json')) {
      return json(res, 200, {
        title: 'test seam',
        operations: [{ name: 'build.list' }, { name: 'contextframe.list' }],
      });
    }
    return json(res, 200, { jsonrpc: '2.0', id: 1, ok: true, result });
  });
}

// ------------------------------------------------------------ coercion

test('a Meaning nested under a ContextFrame is read as contained', async () => {
  const frame = frames.coerceFrame({
    '@type': 'cf:ContextFrame',
    canonicalId: 'Y1',
    title: 'Harbour operations',
    'cf:meaning': [
      {
        title: 'A reading',
        excerpt: 'what it means',
        acceptance: 'accepted',
        'cf:clarification': [{ title: 'a note', source: 'ops', source_at: '2026-08-20' }],
      },
    ],
  });

  assert.equal(frame.canonicalId, 'Y1');
  assert.equal(frame.meanings.length, 1);
  // Containment all the way down: the clarification is under its meaning,
  // not a sibling of it.
  assert.equal(frame.meanings[0].clarifications.length, 1);
  assert.equal(frame.meanings[0].clarifications[0].source, 'ops');
});

test('a frame without a canonicalId is refused, not given a positional id', () => {
  // canonicalId is the stable external identifier and the selection key.
  // Synthesizing one would look stable and would not be.
  assert.equal(frames.coerceFrame({ title: 'no id' }), null);
  assert.equal(frames.coerceFrame({ canonicalId: 'F9' }), null, 'a title is required too');
});

test('acceptance is never coerced to accepted', () => {
  // R2 splits accepted from suggested precisely so one cannot be mistaken
  // for the other. Guessing here would launder a machine candidate into
  // a settled reading.
  assert.equal(frames.coerceMeaning({ title: 'm', acceptance: 'suggested' }).accepted, false);
  assert.equal(frames.coerceMeaning({ title: 'm' }).acceptance, 'unstated');
  assert.equal(frames.coerceMeaning({ title: 'm' }).accepted, false);
  assert.equal(frames.coerceMeaning({ title: 'm', acceptance: 'accepted' }).accepted, true);
});

test('no eligibility band is ever produced', () => {
  // Display band is a request-time derivation, never stored. A band
  // column would be the first thing to get this wrong.
  const m = frames.coerceMeaning({ title: 'm', acceptance: 'accepted', band: 'Effect-eligible' });
  assert.equal(m.band, undefined);
  const f = frames.coerceFrame({ canonicalId: 'F1', title: 't', displayBandLabel: 'Explorable' });
  assert.equal(f.band, undefined);
  assert.equal(f.displayBandLabel, undefined);
});

test('dispute_open survives as a stored field', () => {
  assert.equal(frames.coerceMeaning({ title: 'm', dispute_open: true }).dispute_open, true);
  assert.equal(frames.coerceMeaning({ title: 'm', disputeOpen: true }).dispute_open, true);
  assert.equal(frames.coerceMeaning({ title: 'm' }).dispute_open, false);
});

test('a single contained node is read as well as an array', () => {
  const f = frames.coerceFrame({ canonicalId: 'F1', title: 't', 'cf:meaning': { title: 'lone' } });
  assert.equal(f.meanings.length, 1);
});

// ------------------------------------------------------------ local file

test('the shipped local file parses and every frame is well formed', () => {
  const local = frames.readLocal();
  assert.ok(Array.isArray(local), 'the local file must parse');
  assert.ok(local.length >= 1);
  for (const f of local) {
    assert.ok(f.canonicalId, 'every local frame has a canonicalId');
    assert.ok(f.title);
    for (const m of f.meanings) {
      assert.ok(['accepted', 'suggested'].includes(m.acceptance), `unexpected acceptance ${m.acceptance}`);
    }
  }
  assert.ok(
    local.some((f) => f.meanings.some((m) => m.clarifications.length > 0)),
    'the fixture must exercise all three levels of containment',
  );
});

// ------------------------------------------------------------ the seam

test('when the seam publishes contextframe.list, upstream is the source', async () => {
  // This is the claim the whole design rests on: no code changes on the
  // day magenticmarket.ai publishes the affordance. Prove it, do not
  // assert it.
  const s = await publishingSeam({
    '@graph': [
      {
        '@id': 'https://example.test/contextframe/Y1',
        '@type': 'cf:ContextFrame',
        canonicalId: 'Y1',
        title: 'Harbour operations',
        'cf:meaning': [{ title: 'upstream reading', acceptance: 'accepted' }],
      },
    ],
  });

  const out = await frames.load({ origin: s.origin });
  assert.equal(out.ok, true);
  assert.equal(out.provenance.source, 'upstream');
  assert.equal(out.provenance.published, true);
  assert.equal(out.frames[0].canonicalId, 'Y1');
  assert.equal(out.frames[0].iri, 'https://example.test/contextframe/Y1');
  assert.equal(out.frames[0].meanings[0].title, 'upstream reading');
  await s.close();
});

test('when the CID omits the operation, it falls back and names why', async () => {
  const s = await seam((req, res) => {
    if (req.url.endsWith('/cid.json')) {
      return json(res, 200, { operations: [{ name: 'build.list' }, { name: 'build.get' }] });
    }
    return json(res, 200, { ok: false, error: { reason: 'unknown_operation', because: 'nope' } });
  });

  const out = await frames.load({ origin: s.origin });
  assert.equal(out.ok, true);
  assert.equal(out.provenance.source, 'local');
  assert.equal(out.provenance.published, false);
  assert.equal(out.provenance.upstream_refusal.reason, 'unknown_operation');
  assert.match(out.provenance.upstream_refusal.because, /build\.list/, 'the refusal names what the CID does publish');
  await s.close();
});

test('an unreachable seam falls back to local and records the reason', async () => {
  const out = await frames.load({ origin: 'http://127.0.0.1:1/_cpcp' });
  assert.equal(out.ok, true);
  assert.equal(out.provenance.source, 'local');
  assert.equal(out.provenance.upstream_refusal.reason, 'unreachable');
  assert.ok(out.frames.length > 0, 'the app still works offline');
});

test('a published-but-empty collection falls back rather than showing nothing', async () => {
  const s = await publishingSeam({ '@graph': [] });
  const out = await frames.load({ origin: s.origin });
  assert.equal(out.provenance.source, 'local');
  assert.equal(out.provenance.upstream_refusal.reason, 'empty_collection');
  await s.close();
});

test('local frames are never labelled as upstream', async () => {
  const out = await frames.load({ origin: 'http://127.0.0.1:1/_cpcp' });
  assert.equal(out.provenance.source, 'local');
  assert.match(out.provenance.label, /locally/);
  assert.doesNotMatch(out.provenance.label, /served by/, 'a local list must not read as served by the seam');
});
