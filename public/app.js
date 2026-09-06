'use strict';

// Vanilla JS. No framework, no build step, no dependencies.
//
// Every server route answers the same never-raise envelope, so this
// client has exactly one failure path: read `ok`, and if it is false show
// `reason` and `because`. There is no try/catch scattered per call and no
// status-code branching -- `request()` turns even a dead network into an
// envelope, so callers below never see a rejection.

const $ = (sel) => document.querySelector(sel);

const el = {
  todoForm: $('#todo-form'),
  todoTitle: $('#todo-title'),
  todoList: $('#todo-list'),
  todoCount: $('#todo-count'),
  todoEmpty: $('#todo-empty'),
  clearDone: $('#clear-done'),
  frameList: $('#frame-list'),
  provenance: $('#provenance'),
  refreshFrames: $('#refresh-frames'),
  compose: $('#compose'),
  composeHint: $('#compose-hint'),
  modal: $('#prompt-modal'),
  promptText: $('#prompt-text'),
  copyPrompt: $('#copy-prompt'),
  copyStatus: $('#copy-status'),
  closeModal: $('#close-modal'),
  toast: $('#toast'),
};

let selectedFrame = null;
let openTodoCount = 0;

// ---------------------------------------------------------------- fetch

async function request(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'content-type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : { ok: false, reason: 'empty_body', because: `${url} answered ${res.status}` };
    } catch {
      return { ok: false, reason: 'unparseable_json', because: `${url} answered ${res.status} with a non-JSON body` };
    }
  } catch (err) {
    return { ok: false, reason: 'unreachable', because: String((err && err.message) || err) };
  }
}

let toastTimer = null;
function toast(envelope) {
  const text = envelope.ok
    ? String(envelope.message || 'Done')
    : `${envelope.reason}: ${stringify(envelope.because)}`;
  el.toast.textContent = text;
  el.toast.classList.toggle('bad', !envelope.ok);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 6000);
}

function stringify(because) {
  if (because === null || because === undefined) return 'no detail given';
  return typeof because === 'string' ? because : JSON.stringify(because);
}

// ---------------------------------------------------------------- todos

function renderTodos(todos) {
  el.todoList.replaceChildren();
  const open = todos.filter((t) => !t.done);
  openTodoCount = open.length;
  el.todoEmpty.hidden = todos.length > 0;
  el.todoCount.textContent = todos.length ? `${open.length} open · ${todos.length - open.length} done` : '';

  for (const todo of todos) {
    const li = document.createElement('li');
    li.className = `todo${todo.done ? ' done' : ''}`;

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = todo.done;
    box.id = `cb-${todo.id}`;
    box.addEventListener('change', () => act(`/api/todos/${todo.id}`, { method: 'PATCH' }));

    const label = document.createElement('label');
    label.htmlFor = box.id;
    label.textContent = todo.title; // textContent, not innerHTML: titles are user input

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon';
    del.textContent = '×';
    del.setAttribute('aria-label', `Delete "${todo.title}"`);
    del.addEventListener('click', () => act(`/api/todos/${todo.id}`, { method: 'DELETE' }));

    li.append(box, label, del);
    el.todoList.append(li);
  }
  updateComposeState();
}

async function loadTodos() {
  const out = await request('/api/todos');
  if (!out.ok) return toast(out);
  renderTodos(out.todos);
}

async function act(url, options) {
  const out = await request(url, options);
  if (!out.ok) return toast(out);
  renderTodos(out.todos);
}

el.todoForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = el.todoTitle.value.trim();
  if (!title) return;
  const out = await request('/api/todos', { method: 'POST', body: { title } });
  if (!out.ok) return toast(out);
  el.todoTitle.value = '';
  renderTodos(out.todos);
});

el.clearDone.addEventListener('click', () => act('/api/todos/clear-done', { method: 'POST' }));

// --------------------------------------------------------- contextframes

// Provenance is shown, never implied. If the frames came from a local
// file because the seam does not publish the operation yet, the banner
// says which operation, what the CID does publish, and why.
function renderProvenance(p) {
  el.provenance.replaceChildren();
  el.provenance.className = `provenance ${p.source === 'upstream' ? 'upstream' : 'local'}`;

  const line = document.createElement('div');
  line.className = 'prov-line';
  const dot = document.createElement('span');
  dot.className = 'dot';
  const strong = document.createElement('strong');
  strong.textContent = p.source === 'upstream' ? 'From the seam' : 'Local fallback';
  const rest = document.createElement('span');
  rest.textContent = ` — ${p.label || ''}`;
  line.append(dot, strong, rest);
  el.provenance.append(line);

  if (p.upstream_refusal) {
    const detail = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `upstream said: ${p.upstream_refusal.reason}`;
    const body = document.createElement('p');
    body.textContent = stringify(p.upstream_refusal.because);
    detail.append(summary, body);

    if (Array.isArray(p.cid_operations)) {
      const ops = document.createElement('p');
      ops.className = 'ops';
      ops.textContent = `CID publishes: ${p.cid_operations.join(', ')}`;
      detail.append(ops);
    }
    el.provenance.append(detail);
  }
}

function renderMeaning(meaning) {
  const li = document.createElement('li');
  li.className = `meaning${meaning.dispute_open ? ' disputed' : ''}`;

  const head = document.createElement('div');
  head.className = 'meaning-head';
  const title = document.createElement('span');
  title.className = 'meaning-title';
  title.textContent = meaning.title;
  head.append(title);

  if (meaning.dispute_open) {
    const tag = document.createElement('span');
    tag.className = 'tag disputed-tag';
    tag.textContent = 'disputed';
    head.append(tag);
  }
  li.append(head);

  if (meaning.excerpt) {
    const p = document.createElement('p');
    p.className = 'excerpt';
    p.textContent = meaning.excerpt;
    li.append(p);
  }

  // Containment: clarifications render under their meaning, never as a
  // flat sibling list.
  if (meaning.clarifications && meaning.clarifications.length > 0) {
    const ul = document.createElement('ul');
    ul.className = 'clarifications';
    for (const c of meaning.clarifications) {
      const cli = document.createElement('li');
      const attrib = [c.source, c.source_at].filter(Boolean).join(', ');
      cli.textContent = attrib ? `${c.title} (${attrib})` : c.title;
      ul.append(cli);
    }
    li.append(ul);
  }
  return li;
}

function renderFrames(frames) {
  el.frameList.replaceChildren();

  for (const frame of frames) {
    const li = document.createElement('li');
    li.className = 'frame';

    const label = document.createElement('label');
    label.className = 'frame-head';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'frame';
    radio.value = frame.canonicalId;
    radio.addEventListener('change', () => {
      selectedFrame = frame.canonicalId;
      updateComposeState();
    });

    const id = document.createElement('span');
    id.className = 'canonical-id';
    id.textContent = frame.canonicalId; // the stable external identifier

    const title = document.createElement('span');
    title.className = 'frame-title';
    title.textContent = frame.title;

    label.append(radio, id, title);
    li.append(label);

    if (frame.summary) {
      const p = document.createElement('p');
      p.className = 'frame-summary';
      p.textContent = frame.summary;
      li.append(p);
    }

    const accepted = frame.meanings.filter((m) => m.acceptance === 'accepted');
    const suggested = frame.meanings.filter((m) => m.acceptance !== 'accepted');

    // Accepted and suggested get separate lists. An accepted meaning and
    // a machine candidate are different records, not two stylings of one.
    if (accepted.length > 0) {
      li.append(meaningSection('Meanings', accepted, 'accepted'));
    }
    if (suggested.length > 0) {
      li.append(meaningSection('Machine-proposed, not accepted', suggested, 'suggested'));
    }
    if (frame.meanings.length === 0) {
      const none = document.createElement('p');
      none.className = 'excerpt';
      none.textContent = 'No recorded meanings under this frame.';
      li.append(none);
    }

    el.frameList.append(li);
  }
}

function meaningSection(heading, meanings, kind) {
  const wrap = document.createElement('div');
  wrap.className = `meaning-section ${kind}`;
  const h = document.createElement('p');
  h.className = 'section-heading';
  h.textContent = heading;
  const ul = document.createElement('ul');
  ul.className = 'meanings';
  for (const m of meanings) ul.append(renderMeaning(m));
  wrap.append(h, ul);
  return wrap;
}

async function loadFrames({ refresh = false } = {}) {
  el.provenance.textContent = 'Asking the seam…';
  const out = await request(`/api/contextframes${refresh ? '?refresh=1' : ''}`);
  if (!out.ok) {
    el.provenance.className = 'provenance bad';
    el.provenance.textContent = `${out.reason}: ${stringify(out.because)}`;
    return;
  }
  renderProvenance(out.provenance);
  renderFrames(out.frames);
  updateComposeState();
}

el.refreshFrames.addEventListener('click', () => loadFrames({ refresh: true }));

// ----------------------------------------------------------- translation

function updateComposeState() {
  const ready = Boolean(selectedFrame) && openTodoCount > 0;
  el.compose.disabled = !ready;
  el.composeHint.textContent = !selectedFrame
    ? 'Select a frame to compose.'
    : openTodoCount === 0
      ? 'Add an open todo to compose.'
      : `Reading ${openTodoCount} open item${openTodoCount === 1 ? '' : 's'} through ${selectedFrame}.`;
}

el.compose.addEventListener('click', async () => {
  const out = await request('/api/prompt', { method: 'POST', body: { canonicalId: selectedFrame } });
  if (!out.ok) return toast(out);
  el.promptText.textContent = out.prompt;
  el.copyStatus.textContent = '';
  el.modal.showModal();
});

el.copyPrompt.addEventListener('click', async () => {
  const text = el.promptText.textContent;
  try {
    await navigator.clipboard.writeText(text);
    el.copyStatus.textContent = 'Copied. Paste it into AI Mode.';
  } catch {
    // Clipboard access can be denied or absent (insecure context). Select
    // the text so the person can copy it themselves rather than leaving
    // them with a button that silently did nothing.
    const range = document.createRange();
    range.selectNodeContents(el.promptText);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    el.copyStatus.textContent = 'Clipboard blocked — text selected, press ⌘C.';
  }
});

el.closeModal.addEventListener('click', () => el.modal.close());

// ------------------------------------------------------------------ boot

loadTodos();
loadFrames();
