'use strict';

// Compose the Input (todos) and one ContextFrame into the Translation:
// a prompt a person pastes into Chrome's AI Mode.
//
// The board's three columns are Input / Frame / Translation. The todos
// are Input and are frame-independent -- they do not change when you pick
// a different frame, and the frame is not written onto them. Reading an
// input through a lens is exactly ContextFrame semantics.
//
// Two rules from the board model shape the rendering, and both are about
// not overclaiming:
//
//   * ACCEPTANCE IS A RECORD DISTINCTION, NOT A RENDERING. R2 gives
//     accepted meanings and machine suggestions separate lists precisely
//     so a variant cannot be mistaken for the other. So they get separate
//     sections here, and the suggestions are labelled machine-proposed
//     and unaccepted in the artifact itself -- not merely styled
//     differently in a UI the reader will not have.
//
//   * NO ELIGIBILITY BAND. Display band is a request-time derivation,
//     never stored; display is not authorization. This composer computes
//     no band, sorts by none, and asserts none.
//
// Containment is preserved in the output: clarifications render indented
// under the meaning they belong to, never as a flat third list.
//
// The app never calls an LLM. It holds no key, names no model, and makes
// no outbound request on this path -- the human carries the prompt
// across. The seam this app demonstrates is the one to magenticmarket.ai,
// not one to a model vendor.

function refuse(reason, because) {
  return { ok: false, reason, because };
}

function renderMeaning(meaning) {
  const lines = [];
  const flag = meaning.dispute_open ? ' — DISPUTED, read as contested, not settled' : '';
  lines.push(`- ${meaning.title}${flag}`);
  if (meaning.excerpt) lines.push(`  ${meaning.excerpt}`);
  for (const c of meaning.clarifications || []) {
    const attrib = [c.source, c.source_at].filter(Boolean).join(', ');
    lines.push(`  · clarification: ${c.title}${attrib ? ` (${attrib})` : ''}`);
  }
  return lines.join('\n');
}

/**
 * @param {object}  args
 * @param {Array}   args.todos        every todo, done and open (the Input)
 * @param {object}  args.frame        the selected ContextFrame
 * @param {object}  [args.provenance] where the frame came from
 * @param {string}  [args.now]        ISO timestamp, injectable for tests
 */
function compose({ todos, frame, provenance = {}, now } = {}) {
  if (!frame || typeof frame !== 'object' || !frame.title || !frame.canonicalId) {
    return refuse('missing_params', 'no ContextFrame was selected');
  }
  if (!Array.isArray(todos)) {
    return refuse('missing_params', 'todos must be an array');
  }

  const open = todos.filter((t) => t && !t.done);
  const done = todos.filter((t) => t && t.done);

  if (open.length === 0) {
    // A prompt with nothing to act on wastes the round trip. Say why
    // rather than produce an empty artifact the person has to diagnose.
    return refuse(
      'nothing_to_act_on',
      done.length > 0
        ? `all ${done.length} todos are done; add an open one before composing`
        : 'the todo list is empty',
    );
  }

  const meanings = Array.isArray(frame.meanings) ? frame.meanings : [];
  const accepted = meanings.filter((m) => m.acceptance === 'accepted');
  const suggested = meanings.filter((m) => m.acceptance !== 'accepted');

  const stamp = now || new Date().toISOString();
  const parts = [];

  parts.push('Read my task list through one frame. The list does not change; how I read it does.');
  parts.push('');
  parts.push(`## The frame — ${frame.canonicalId}: ${frame.title}`);
  if (frame.summary) parts.push(frame.summary);

  if (accepted.length > 0) {
    parts.push('');
    parts.push('What this frame takes as settled:');
    parts.push(accepted.map(renderMeaning).join('\n'));
  }

  if (suggested.length > 0) {
    parts.push('');
    parts.push('Machine-proposed and NOT accepted — treat as candidates, not as the frame:');
    parts.push(suggested.map(renderMeaning).join('\n'));
  }

  if (accepted.length === 0 && suggested.length === 0) {
    parts.push('');
    parts.push('This frame carries no recorded meanings; read the list through its title alone.');
  }

  parts.push('');
  parts.push(`## My list — ${open.length} open, ${done.length} done`);
  parts.push('');
  parts.push('Open:');
  parts.push(open.map((t, i) => `${i + 1}. ${t.title}`).join('\n'));
  if (done.length > 0) {
    parts.push('');
    parts.push('Already done (context only, do not re-plan these):');
    parts.push(done.map((t) => `- ${t.title}`).join('\n'));
  }

  parts.push('');
  parts.push('## What I want back');
  parts.push(
    [
      '1. The three open items this frame ranks highest, one line each on why — in the frame’s terms, not generic advice.',
      '2. For the top one, the smallest concrete next action I could start in the next ten minutes.',
      '3. Anything the frame says to drop or defer. Name it plainly; do not soften it.',
      '4. Any item the frame cannot speak to at all. Say so rather than stretching it.',
      '',
      'Where a meaning is marked disputed, give both readings rather than picking one.',
      'Do not restate my list back to me, and do not add items I did not write.',
    ].join('\n'),
  );

  parts.push('');
  parts.push('---');
  parts.push(provenanceLine(frame, provenance, stamp));

  return {
    ok: true,
    prompt: parts.join('\n'),
    frame: { canonicalId: frame.canonicalId, title: frame.title },
    counts: {
      open: open.length,
      done: done.length,
      accepted: accepted.length,
      suggested: suggested.length,
      disputed: meanings.filter((m) => m.dispute_open).length,
    },
    generated_at: stamp,
    provenance,
  };
}

/** One line, at the foot of the artifact, naming where the frame came from. */
function provenanceLine(frame, provenance, stamp) {
  const method = provenance.method || 'contextframe.list';
  const where =
    provenance.source === 'upstream'
      ? `served by ${provenance.origin} via ${method}`
      : provenance.source === 'local'
        ? `served locally by express-meaning — ${provenance.origin || 'the upstream seam'} does not publish ${method} yet`
        : 'source unrecorded';
  return `ContextFrame ${frame.canonicalId} "${frame.title}" ${where}. Composed ${stamp} by express-meaning.`;
}

module.exports = { compose, provenanceLine, renderMeaning };
