// The ContextFrame list.
//
// The frame this app reads is ContextFrame -> Meaning -> Clarification,
// defined in magentic-stack as SHACL:
//
//   gems/shapes-level-8/bundles/contextframe.shacl.ttl
//   namespace https://w3id.org/cpcp/osi8/contextframe#   (prefix cf:)
//
// Three properties of that frame drive every decision in this file:
//
//   1. CONTAINMENT, NOT THREE PEERS. A Meaning sits *under* a
//      ContextFrame (cf:inContextFrame, exactly one). A Clarification
//      sits *under* a Meaning (cf:inMeaning, exactly one). So the list
//      this app offers is a list of ContextFrames, and the Meanings and
//      Clarifications arrive nested inside them -- never flattened into
//      a sibling list, which would bend the kind.
//
//   2. CONTEXTFRAME IS A SMALL CLOSED SET WITH CANONICAL IDS. It is the
//      only entity in the board model carrying a stable external
//      identifier (the board's own set is Y1/Y2/Y3). That is precisely
//      what makes it the thing you pick from a list, and why selection
//      is by canonicalId rather than row position.
//
//   3. THE FRAME IS A READ-TIME LENS, NOT A STORED EDGE. "Read this
//      input through Y2" conditions how the list is read; it does not
//      attach the frame to anything. So selecting a frame here mutates
//      no todo. Nothing is written back.
//
// Upstream status: magenticmarket.ai's CID publishes build.list /
// build.get / build.create today, and GAP107 records the frame as
// "not a CPCP operation yet (no wrap)". The affordance is coming. Until
// the CID names it, this module falls back to a local file and says so
// -- in the API response, in the UI, and inside the generated prompt.
// Nothing local is ever presented as upstream, and no code changes on
// the day the seam publishes.

import fs from 'node:fs';
import path from 'node:path';
import * as cpcp from './cpcp/front/client.js';

const FRAME_METHOD = 'contextframe.list';
const DEFAULT_ORIGIN = 'https://magenticmarket.ai/_cpcp';
const LOCAL_PATH = path.join(import.meta.dirname, '..', 'data', 'contextframes.local.json');
const CF = 'https://w3id.org/cpcp/osi8/contextframe#';

/** Read a property under either its cf: prefixed name or its bare one. */
function prop(node, name) {
  if (!node || typeof node !== 'object') return undefined;
  for (const key of [`cf:${name}`, `${CF}${name}`, name]) {
    if (node[key] !== undefined) return node[key];
  }
  return undefined;
}

/** Contained children arrive as one node or many; always yield an array. */
function contained(node, name) {
  const value = prop(node, name);
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * A Clarification: title, source, source_at (board model section 1).
 *
 * It carries no acceptance and no band. A clarification attaches to a
 * bridge when it has one; that edge is not on this wire and is not
 * invented here.
 */
function coerceClarification(node) {
  if (!node || typeof node !== 'object') return null;
  const title = prop(node, 'title') || prop(node, 'label');
  if (!title) return null;
  return {
    title: String(title),
    source: orNull(prop(node, 'source')),
    source_at: orNull(prop(node, 'source_at') || prop(node, 'sourceAt')),
    excerpt: orNull(prop(node, 'excerpt')),
  };
}

/**
 * A Meaning: title, excerpt, dispute_open, acceptance.
 *
 * `acceptance` is a real record distinction, not a rendering: an accepted
 * meaning and a machine candidate are different records, and R2 gives
 * them separate lists so one cannot be mistaken for the other. An
 * unrecognized value is reported as-is rather than coerced to
 * "accepted" -- guessing here would launder a suggestion into a
 * settled reading.
 *
 * No band. Eligibility is derived at read time, never stored, and this
 * client neither reads nor computes one.
 */
function coerceMeaning(node) {
  if (!node || typeof node !== 'object') return null;
  const title = prop(node, 'title') || prop(node, 'label');
  if (!title) return null;

  const raw = prop(node, 'acceptance');
  const acceptance = raw === undefined || raw === null ? 'unstated' : String(raw);

  return {
    title: String(title),
    excerpt: orNull(prop(node, 'excerpt') || prop(node, 'summary')),
    acceptance,
    accepted: acceptance === 'accepted',
    dispute_open: prop(node, 'dispute_open') === true || prop(node, 'disputeOpen') === true,
    clarifications: contained(node, 'clarification')
      .concat(contained(node, 'clarifications'))
      .map(coerceClarification)
      .filter(Boolean),
  };
}

/**
 * A ContextFrame: canonicalId + title, with Meanings nested under it.
 *
 * canonicalId is the stable external identifier and the selection key. A
 * frame without one is refused rather than given a positional id: a
 * synthesized identifier would look stable and would not be.
 */
function coerceFrame(node) {
  if (!node || typeof node !== 'object') return null;
  const canonicalId = prop(node, 'canonicalId') || prop(node, 'canonical_id');
  const title = prop(node, 'title') || prop(node, 'label');
  if (!canonicalId || !title) return null;

  const iri = node['@id'] && String(node['@id']).startsWith('http') ? String(node['@id']) : null;

  return {
    canonicalId: String(canonicalId),
    title: String(title),
    summary: orNull(prop(node, 'summary') || prop(node, 'description')),
    iri,
    meanings: contained(node, 'meaning')
      .concat(contained(node, 'meanings'))
      .map(coerceMeaning)
      .filter(Boolean),
  };
}

function orNull(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

/**
 * A CPCP collection result arrives as `result: {"@graph": [...]}`
 * (spec/envelope.md). Accept the plainer shapes too rather than refuse a
 * seam that answers sensibly in a way the spec did not spell out.
 */
function extractNodes(result) {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return null;
  for (const key of ['@graph', 'contextFrames', 'context_frames', 'frames', 'items']) {
    if (Array.isArray(result[key])) return result[key];
  }
  return null;
}

function readLocal(localPath = LOCAL_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    const nodes = extractNodes(parsed) || [];
    return nodes.map(coerceFrame).filter(Boolean);
  } catch (err) {
    // Even the fallback fails as data. A stated reason beats a crash.
    return { ok: false, reason: 'local_frames_unreadable', because: String((err && err.message) || err) };
  }
}

/**
 * Load the ContextFrame list.
 *
 * Always resolves. Always reports provenance: which source answered,
 * what the upstream said, and when it was asked.
 */
async function load({ origin = DEFAULT_ORIGIN, localPath = LOCAL_PATH, timeoutMs } = {}) {
  const provenance = {
    origin,
    method: FRAME_METHOD,
    shape: `${CF}ContextFrame`,
    checked_at: new Date().toISOString(),
    source: null,
    published: null,
    upstream_refusal: null,
    label: null,
  };

  const cid = await cpcp.discover(origin, { timeoutMs });

  if (!cid.ok) {
    provenance.upstream_refusal = { reason: cid.reason, because: cid.because, http: cid.http };
  } else {
    provenance.published = cid.operations.includes(FRAME_METHOD);
    provenance.cid_operations = cid.operations;
    provenance.cid_title = cid.title;

    if (provenance.published) {
      const answer = await cpcp.pull(origin, FRAME_METHOD, {}, { timeoutMs });
      if (answer.ok) {
        const nodes = extractNodes(answer.result);
        if (nodes) {
          const frames = nodes.map(coerceFrame).filter(Boolean);
          if (frames.length > 0) {
            provenance.source = 'upstream';
            provenance.label = `served by ${origin} via ${FRAME_METHOD}`;
            return { ok: true, frames, provenance };
          }
          provenance.upstream_refusal = {
            reason: 'empty_collection',
            because: `${FRAME_METHOD} answered with no ContextFrame carrying both a canonicalId and a title`,
            http: answer.http,
          };
        } else {
          provenance.upstream_refusal = {
            reason: 'unrecognized_result_shape',
            because: `${FRAME_METHOD} result was neither a @graph, an array, nor a known collection key`,
            http: answer.http,
          };
        }
      } else {
        provenance.upstream_refusal = { reason: answer.reason, because: answer.because, http: answer.http };
      }
    } else {
      provenance.upstream_refusal = {
        reason: 'unknown_operation',
        because: `the CID at ${origin}/cid.json publishes [${cid.operations.join(', ')}] and does not include ${FRAME_METHOD}`,
        http: cid.http,
      };
    }
  }

  const local = readLocal(localPath);
  if (!Array.isArray(local)) {
    return { ok: false, reason: local.reason, because: local.because, provenance };
  }

  provenance.source = 'local';
  provenance.label = `served locally by express-meaning; ${origin} does not publish ${FRAME_METHOD} yet`;
  return { ok: true, frames: local, provenance };
}

export {
  load,
  readLocal,
  coerceFrame,
  coerceMeaning,
  coerceClarification,
  extractNodes,
  FRAME_METHOD,
  DEFAULT_ORIGIN,
  LOCAL_PATH,
  CF,
};
