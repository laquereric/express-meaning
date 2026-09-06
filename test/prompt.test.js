'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { compose } = require('../lib/prompt');

const FRAME = {
  canonicalId: 'F1',
  title: 'Shipping',
  summary: 'Read the list by what each item would prove.',
  meanings: [
    {
      title: 'Done means someone outside can use it',
      excerpt: 'Not merged — used.',
      acceptance: 'accepted',
      dispute_open: false,
      clarifications: [{ title: 'Internal users count', source: 'team', source_at: '2026-08-14' }],
    },
    {
      title: 'Shipping means deployed',
      excerpt: 'Contested.',
      acceptance: 'accepted',
      dispute_open: true,
      clarifications: [],
    },
    {
      title: 'Small means under a day',
      excerpt: 'Machine-proposed.',
      acceptance: 'suggested',
      dispute_open: false,
      clarifications: [],
    },
  ],
};

const TODOS = [
  { id: 'a', title: 'Rewrite the onboarding email', done: false },
  { id: 'b', title: 'Cut the release', done: false },
  { id: 'c', title: 'Archive last quarter', done: true },
];

test('composes a prompt carrying the frame, its meanings, and the list', () => {
  const out = compose({ todos: TODOS, frame: FRAME, provenance: { source: 'local' }, now: '2026-09-06T00:00:00Z' });
  assert.equal(out.ok, true);
  assert.match(out.prompt, /F1: Shipping/);
  assert.match(out.prompt, /Rewrite the onboarding email/);
  assert.match(out.prompt, /2 open, 1 done/);
  assert.deepEqual(out.counts, { open: 2, done: 1, accepted: 2, suggested: 1, disputed: 1 });
});

test('machine suggestions are labelled unaccepted IN the artifact', () => {
  // The person pastes the prompt somewhere this app's styling does not
  // reach. If "not accepted" lives only in a CSS class, it is lost.
  const out = compose({ todos: TODOS, frame: FRAME, now: 'T' });
  const suggestedAt = out.prompt.indexOf('Small means under a day');
  const labelAt = out.prompt.indexOf('Machine-proposed and NOT accepted');
  assert.ok(labelAt > -1, 'the artifact states the label');
  assert.ok(labelAt < suggestedAt, 'the label precedes the suggestion it governs');

  const settledAt = out.prompt.indexOf('What this frame takes as settled');
  assert.ok(settledAt > -1 && settledAt < labelAt, 'accepted meanings are a separate, earlier section');
});

test('a disputed meaning is marked disputed, not silently settled', () => {
  const out = compose({ todos: TODOS, frame: FRAME, now: 'T' });
  assert.match(out.prompt, /Shipping means deployed — DISPUTED/);
  assert.match(out.prompt, /give both readings rather than picking one/);
});

test('clarifications render under their meaning, not as a flat list', () => {
  const out = compose({ todos: TODOS, frame: FRAME, now: 'T' });
  const lines = out.prompt.split('\n');
  const meaningLine = lines.findIndex((l) => l.includes('Done means someone outside can use it'));
  const clarLine = lines.findIndex((l) => l.includes('Internal users count'));
  assert.ok(clarLine > meaningLine, 'the clarification follows its meaning');
  assert.match(lines[clarLine], /^ {2}· clarification:/, 'and is indented under it');
  assert.match(lines[clarLine], /\(team, 2026-08-14\)/);
});

test('no eligibility band appears anywhere in the artifact', () => {
  const out = compose({ todos: TODOS, frame: FRAME, now: 'T' });
  assert.doesNotMatch(out.prompt, /Effect-eligible|Explorable|\bband\b/i);
});

test('provenance is stated in the artifact, and local never reads as upstream', () => {
  const local = compose({
    todos: TODOS,
    frame: FRAME,
    provenance: { source: 'local', origin: 'https://magenticmarket.ai/_cpcp', method: 'contextframe.list' },
    now: 'T',
  });
  assert.match(local.prompt, /served locally by express-meaning/);
  assert.match(local.prompt, /does not publish contextframe\.list yet/);
  assert.doesNotMatch(local.prompt, /served by https/);

  const upstream = compose({
    todos: TODOS,
    frame: FRAME,
    provenance: { source: 'upstream', origin: 'https://magenticmarket.ai/_cpcp', method: 'contextframe.list' },
    now: 'T',
  });
  assert.match(upstream.prompt, /served by https:\/\/magenticmarket\.ai\/_cpcp via contextframe\.list/);
});

test('refuses rather than composing an empty or frameless prompt', () => {
  const noFrame = compose({ todos: TODOS });
  assert.equal(noFrame.ok, false);
  assert.equal(noFrame.reason, 'missing_params');

  const noTodos = compose({ todos: [], frame: FRAME });
  assert.equal(noTodos.ok, false);
  assert.equal(noTodos.reason, 'nothing_to_act_on');

  const allDone = compose({ todos: [{ title: 'x', done: true }], frame: FRAME });
  assert.equal(allDone.ok, false);
  assert.match(allDone.because, /all 1 todos are done/);

  const noId = compose({ todos: TODOS, frame: { title: 'no canonical id' } });
  assert.equal(noId.ok, false, 'a frame without its stable identifier cannot be composed');
});

test('a frame with no meanings still composes, and says so', () => {
  const out = compose({ todos: TODOS, frame: { canonicalId: 'F9', title: 'Bare' }, now: 'T' });
  assert.equal(out.ok, true);
  assert.match(out.prompt, /carries no recorded meanings/);
});

test('done items are marked context-only so they are not re-planned', () => {
  const out = compose({ todos: TODOS, frame: FRAME, now: 'T' });
  assert.match(out.prompt, /Already done \(context only, do not re-plan these\)/);
  assert.match(out.prompt, /- Archive last quarter/);
});
