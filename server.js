// express-meaning
//
// Input  -- a traditional TODO list, frame-independent.
// Frame  -- ContextFrames read from magenticmarket.ai over CPCP, each
//           containing its Meanings, each containing its Clarifications.
// Translation -- a prompt you paste into Chrome AI Mode.
//
// Every route answers a never-raise envelope -- { ok: true, ... } or
// { ok: false, reason, because } -- because that is the contract the seam
// speaks, and a client that only has to learn one shape is a client that
// handles failure by default.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';

import * as frames from './src/contextframes.js';
import { TodoStore } from './src/todos.js';
import { compose } from './src/prompt.js';

const PORT = Number(process.env.PORT || 3200);
const HOST = process.env.HOST || '127.0.0.1';
const ORIGIN = process.env.CPCP_ORIGIN || frames.DEFAULT_ORIGIN;
const CACHE_MS = Number(process.env.FRAMES_CACHE_MS || 60_000);

const store = new TodoStore(process.env.TODOS_PATH || undefined);

// ContextFrame is a small closed set that changes rarely, and the
// upstream is a network hop away. Cache briefly; let the client force a
// re-check so "has the seam published it yet?" is answerable without a
// restart.
let cache = { at: 0, value: null };

async function frameList({ refresh = false } = {}) {
  const fresh = Date.now() - cache.at < CACHE_MS;
  if (!refresh && fresh && cache.value) return { ...cache.value, cached: true };
  const value = await frames.load({ origin: ORIGIN });
  if (value.ok) cache = { at: Date.now(), value };
  return { ...value, cached: false };
}

function build() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use(express.static(path.join(import.meta.dirname, 'public')));

  // A malformed JSON body is a parse refusal, not a stack trace. This has
  // to sit right after the parser to catch its throw.
  app.use((err, _req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, reason: 'unparseable_json', because: 'request body was not JSON' });
    }
    return next(err);
  });

  // --- input: todos -----------------------------------------------------

  app.get('/api/todos', (_req, res) => {
    const out = store.list();
    res.status(out.ok ? 200 : 500).json(out);
  });

  app.post('/api/todos', (req, res) => {
    const out = store.add(req.body && req.body.title);
    res.status(out.ok ? 201 : 400).json(out);
  });

  app.patch('/api/todos/:id', (req, res) => {
    const out = store.toggle(req.params.id);
    res.status(out.ok ? 200 : out.reason === 'not_found' ? 404 : 500).json(out);
  });

  app.delete('/api/todos/:id', (req, res) => {
    const out = store.remove(req.params.id);
    res.status(out.ok ? 200 : out.reason === 'not_found' ? 404 : 500).json(out);
  });

  app.post('/api/todos/clear-done', (_req, res) => {
    const out = store.clearDone();
    res.status(out.ok ? 200 : 500).json(out);
  });

  // --- frame: contextframes --------------------------------------------

  app.get('/api/contextframes', async (req, res) => {
    const out = await frameList({ refresh: req.query.refresh === '1' });
    res.status(out.ok ? 200 : 502).json(out);
  });

  // --- translation: the prompt -----------------------------------------

  app.post('/api/prompt', async (req, res) => {
    const canonicalId = req.body && req.body.canonicalId;
    if (!canonicalId) {
      return res.status(400).json({ ok: false, reason: 'missing_params', because: 'canonicalId is required' });
    }

    const list = await frameList();
    if (!list.ok) return res.status(502).json(list);

    const frame = list.frames.find((f) => f.canonicalId === canonicalId);
    if (!frame) {
      return res.status(404).json({
        ok: false,
        reason: 'not_found',
        because: `no ContextFrame with canonicalId ${canonicalId} in the current set`,
      });
    }

    const todos = store.list();
    if (!todos.ok) return res.status(500).json(todos);

    const out = compose({ todos: todos.todos, frame, provenance: list.provenance });
    return res.status(out.ok ? 200 : 400).json(out);
  });

  // --- catch-all --------------------------------------------------------

  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, reason: 'unknown_operation', because: 'no such API route' });
  });

  // Last resort. An unexpected throw still leaves as an envelope.
  app.use((err, _req, res, _next) => {
    res.status(500).json({ ok: false, reason: 'unexpected', because: String((err && err.message) || err) });
  });

  return app;
}

// Run the server only when this file IS the entry point, so tests can
// import build() without binding a port.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  build().listen(PORT, HOST, () => {
    console.log(`express-meaning on http://${HOST}:${PORT}`);
    console.log(`ContextFrames from ${ORIGIN} (method ${frames.FRAME_METHOD})`);
  });
}

export { build };
