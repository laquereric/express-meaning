// express-meaning: ONE IMAGE, THREE ROLES.
//
//   ROLE=back      serves /_cpcp -- the todo seam. Owns the database.
//   ROLE=front     serves the browser UI. Holds NO database; reaches BACK
//                  over CPCP for every todo, read or write.
//   ROLE=backjob   no ingress. Reaps expired idempotency receipts.
//
// THE SPLIT IS THE POINT. FRONT used to call the todo store as a function, so
// nothing could stand between an intent and its effect. Now every mutation is
// a PUSH across a process boundary: it names its intent, a retry replays rather
// than repeats, a refusal is a record, and what the seam answers is published
// in a CID. None of that is application logic -- it is what the boundary being
// there makes true, which is why governance can arrive later without rewriting
// a single caller.
//
// Same shape as a Rails deploy of this unit, deliberately: one build, three
// containers, distinguished by ROLE.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';

import * as frames from './src/contextframes.js';
import * as client from './src/cpcp/front/client.js';
import { compose } from './src/prompt.js';
import * as seam from './src/cpcp/back/seam.js';
import { project, BASE_IRI } from './src/projection.js';
import * as reaper from './src/cpcp/backjob/reaper.js';
import { db } from './src/db.js';

const ROLE = process.env.ROLE || 'back';
const PORT = Number(process.env.PORT || 3200);
const HOST = process.env.HOST || '127.0.0.1';
const ORIGIN = process.env.CPCP_ORIGIN || frames.DEFAULT_ORIGIN;

// Where FRONT finds BACK: its own seam, over the pod network.
const BACK = process.env.BACK_CPCP_ORIGIN || `http://127.0.0.1:${PORT}/_cpcp`;

const CACHE_MS = Number(process.env.FRAMES_CACHE_MS || 60_000);
let cache = { at: 0, value: null };

async function frameList({ refresh = false } = {}) {
  const fresh = Date.now() - cache.at < CACHE_MS;
  if (!refresh && fresh && cache.value) return { ...cache.value, cached: true };
  const value = await frames.load({ origin: ORIGIN });
  if (value.ok) cache = { at: Date.now(), value };
  return { ...value, cached: false };
}

/** A PUSH names its intent BEFORE performing it, and once per intent. */
const intent = (what) =>
  `em-${what}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** FRONT's view of the todos: a CPCP call, not a function call. */
async function callBack(method, params = {}, operationId) {
  const answer = await client.pull(BACK, method, params, operationId ? { operationId } : {});
  return answer.ok ? { ok: true, ...answer.result } : answer;
}

// ---------------------------------------------------------------- BACK

function backApp() {
  // The projection declares what this seam answers; the seam itself knows
  // nothing about todos. One call, at boot, before anything can dispatch.
  project();
  const conn = db();

  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.use((err, _req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({
        jsonrpc: '2.0', id: null, ok: false,
        error: { reason: 'unparseable_json', because: 'request body was not JSON' },
      });
    }
    return next(err);
  });

  // The CID is the contract. A caller reads it rather than inferring the seam
  // from a failed call.
  app.get('/_cpcp/cid.json', (_req, res) => res.json(seam.cid(BASE_IRI)));
  app.get('/_cpcp/up', (_req, res) => res.json({ ok: true, role: 'back' }));

  app.post('/_cpcp/rpc', (req, res) => {
    const { status, envelope } = seam.dispatch(req.body, { conn });
    res.status(status).json(envelope);
  });

  app.use((_req, res) => res.status(404).json({
    jsonrpc: '2.0', id: null, ok: false,
    error: { reason: 'unknown_operation', because: 'BACK serves /_cpcp only' },
  }));
  return app;
}

// ---------------------------------------------------------------- FRONT

function frontApp() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use(express.static(path.join(import.meta.dirname, 'public')));

  app.use((err, _req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, reason: 'unparseable_json', because: 'request body was not JSON' });
    }
    return next(err);
  });

  // These routes look like the ones they replaced and are not the same thing:
  // each is now a CPCP call to BACK. FRONT imports no store and opens no
  // database -- it could not write a todo if it wanted to.
  app.get('/api/todos', async (_req, res) => {
    const out = await callBack('todo.list');
    res.status(out.ok ? 200 : 502).json(out);
  });

  app.post('/api/todos', async (req, res) => {
    const out = await callBack('todo.create', { title: req.body?.title }, intent('create'));
    res.status(out.ok ? 201 : out.reason === 'missing_params' ? 400 : 502).json(out);
  });

  app.patch('/api/todos/:id', async (req, res) => {
    const out = await callBack('todo.toggle', { id: req.params.id }, intent('toggle'));
    res.status(out.ok ? 200 : out.reason === 'not_found' ? 404 : 502).json(out);
  });

  app.delete('/api/todos/:id', async (req, res) => {
    const out = await callBack('todo.remove', { id: req.params.id }, intent('remove'));
    res.status(out.ok ? 200 : out.reason === 'not_found' ? 404 : 502).json(out);
  });

  app.post('/api/todos/clear-done', async (_req, res) => {
    const out = await callBack('todo.clearDone', {}, intent('cleardone'));
    res.status(out.ok ? 200 : 502).json(out);
  });

  app.get('/api/contextframes', async (req, res) => {
    const out = await frameList({ refresh: req.query.refresh === '1' });
    res.status(out.ok ? 200 : 502).json(out);
  });

  app.post('/api/prompt', async (req, res) => {
    const canonicalId = req.body?.canonicalId;
    if (!canonicalId) {
      return res.status(400).json({ ok: false, reason: 'missing_params', because: 'canonicalId is required' });
    }
    const list = await frameList();
    if (!list.ok) return res.status(502).json(list);

    const frame = list.frames.find((f) => f.canonicalId === canonicalId);
    if (!frame) {
      return res.status(404).json({
        ok: false, reason: 'not_found',
        because: `no ContextFrame with canonicalId ${canonicalId} in the current set`,
      });
    }
    // The Input comes from BACK, across the seam, like everything else.
    const todos = await callBack('todo.list');
    if (!todos.ok) return res.status(502).json(todos);

    const out = compose({ todos: todos.todos, frame, provenance: list.provenance });
    return res.status(out.ok ? 200 : 400).json(out);
  });

  app.use('/api', (_req, res) => res.status(404).json({
    ok: false, reason: 'unknown_operation', because: 'no such API route',
  }));
  app.use((err, _req, res, _next) => res.status(500).json({
    ok: false, reason: 'unexpected', because: String(err?.message || err),
  }));
  return app;
}

export function build(role = ROLE) {
  return role === 'front' ? frontApp() : backApp();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (ROLE === 'backjob') {
    // No ingress. A worker that listened would be a BACK with extra steps.
    console.log('express-meaning BACKJOB (no ingress)');
    reaper.run({ conn: db() });
  } else {
    build(ROLE).listen(PORT, HOST, () => {
      console.log(`express-meaning ${ROLE.toUpperCase()} on http://${HOST}:${PORT}`);
      if (ROLE === 'front') {
        console.log(`  todos  -> ${BACK} (CPCP)`);
        console.log(`  frames -> ${ORIGIN} (${frames.FRAME_METHOD})`);
      }
    });
  }
}
