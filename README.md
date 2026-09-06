# express-meaning

[![gate-tests](https://github.com/laquereric/express-meaning/actions/workflows/test.yml/badge.svg)](https://github.com/laquereric/express-meaning/actions/workflows/test.yml)

A traditional TODO list, and one **ContextFrame** to read it through.

Express 5, vanilla JavaScript, no build step. One runtime dependency.

```bash
npm install
npm start          # http://127.0.0.1:3200
npm test           # 37 tests, no network required
```

## The spine: Input → Frame → Translation

Those are the columns of the translation board in
[`magentic-stack`](../magentic-stack), and they are this app's structure:

| column | here | property |
|---|---|---|
| **Input** | your todos | **frame-independent** — picking a frame changes nothing about them |
| **Frame** | a ContextFrame from magenticmarket.ai | a **read-time lens**, not a stored edge |
| **Translation** | the composed prompt | what you paste into Chrome AI Mode |

Selecting a frame writes nothing. *"Read this input through Y2"* conditions how
the list is read, not what is stored — so there is no frame column on a todo,
and there never should be.

## ContextFrame → Meaning → Clarification

The shape is defined upstream, in SHACL:

```
magentic-stack/gems/shapes-level-8/bundles/contextframe.shacl.ttl
namespace https://w3id.org/cpcp/osi8/contextframe#   (prefix cf:)
```

**Containment, not three peers.** A Meaning sits *under* a ContextFrame
(`cf:inContextFrame`, exactly one). A Clarification sits *under* a Meaning
(`cf:inMeaning`, exactly one). So the list you pick from is a list of
**ContextFrames**, and their Meanings and Clarifications arrive nested inside
them — never flattened into a sibling list, in the API, in the UI, or in the
generated prompt.

ContextFrame is the only entity in the model with a **stable external
identifier** (`canonicalId` — the board's own set is Y1/Y2/Y3), and a small
closed set. That is exactly what makes it the thing you select from a list, and
why selection is by `canonicalId` rather than row position. A frame arriving
without one is refused rather than given a positional id: a synthesized
identifier would look stable and would not be.

### Two rules the composer will not break

**Acceptance is a record distinction, not a rendering.** An accepted Meaning and
a machine candidate are different records; the board gives them separate lists
precisely so one cannot be mistaken for the other. They get separate sections
here — and the suggestions are labelled *machine-proposed and NOT accepted*
**inside the prompt text**, not merely styled differently in a UI the reader
will not have. An unrecognized `acceptance` value is reported as `unstated`
rather than coerced to `accepted`.

**No eligibility band, anywhere.** Display band is a request-time derivation,
never stored; display is not authorization. This app computes no band, sorts by
none, and asserts none. A test greps the generated artifact to keep it that way.

`dispute_open` *is* stored, and a disputed Meaning is marked DISPUTED in the
prompt, with an instruction to give both readings rather than pick one.

## Where the frames come from

Over CPCP, from magenticmarket.ai's live seam, using the
[contract package](../coordination-protocol-contract-package) pattern:

```
GET  https://magenticmarket.ai/_cpcp/cid.json     → what the seam publishes
POST https://magenticmarket.ai/_cpcp/rpc          → {"method": "contextframe.list"}
```

**The CID is the contract.** This app reads it *before* calling, so it knows
what the seam offers rather than inferring it from a failed call.

### Status today: the affordance is coming, not yet published

The seam is real and live, but its CID publishes exactly three operations —
`build.list`, `build.get`, `build.create`. GAP107 records the frame as *"not a
CPCP operation yet (no wrap)"*, and calling it returns a genuine refusal:

```json
{"ok": false, "error": {"reason": "unknown_operation",
                        "because": "no CPCP operation \"contextframe.list\""}}
```

So until the CID names it, frames come from `data/contextframes.local.json`, and
the app **says so** — in the API response, in a banner above the list, and in the
footer of every generated prompt:

> ContextFrame F1 "Shipping" served locally by express-meaning —
> https://magenticmarket.ai/_cpcp does not publish contextframe.list yet.

Nothing local is ever presented as upstream. **No code changes on the day the
seam publishes** — the switch is driven by the CID, and a test stands up a fake
seam that *does* publish `contextframe.list` to prove the upstream path works
rather than merely asserting it will.

The local set uses its own `canonicalId` series (`F1`–`F4`) rather than
borrowing the board's external `Y1`/`Y2`/`Y3`.

## Envelopes: failure is data

Every route — and every internal library call — answers a never-raise envelope:

```js
{ ok: true,  ... }
{ ok: false, reason: "unknown_operation", because: "…" }
```

No exceptions cross a boundary. `Dry::Monads`-style wrappers are not used, and
neither is `throw`. The browser client therefore has exactly one failure path:
read `ok`, show `reason` and `because`.

The CPCP client (`src/cpcp.js`) handles three things a naive client gets wrong:

* **Both refusal shapes.** Refusals arrive nested (`error.reason`) *and* flat
  (top-level `reason`). Both are live upstream and deliberately not unified, so
  a client handling only one is broken against half the seams.
* **Dual-signal HTTP.** Status describes the exchange; the envelope describes the
  outcome. A 200 can be a refusal and a 503 still carries a reason — so the body
  is read on **every** status.
* **Non-object `params` are refused locally**, never coerced to `{}`.

## Sending it to your LLM

Pick a frame, press **Compose prompt**, and the modal shows the full text with a
**Copy** button and a link to Chrome AI Mode.

**This app calls no model.** It holds no API key, names no model, and makes no
outbound request on that path — you carry the prompt across by pasting it. The
seam this app demonstrates is the one to magenticmarket.ai, not one to a model
vendor.

## Layout

```
server.js                        Express routes; every answer an envelope
src/cpcp.js                      the CPCP client — never raises
src/contextframes.js             CID discovery, coercion, provenance, fallback
src/prompt.js                    Input + Frame → Translation
src/todos.js                     the boring half, on a JSON file
data/contextframes.local.json    labelled local fallback
public/                          vanilla JS, no framework, no build
tests/                           37 tests, all offline
```

ESM throughout (`"type": "module"`), Node ≥ 20.11, Apache-2.0 — matching the
conventions of the other JavaScript projects in this ecosystem. There is no
gemspec and no Gemfile entry: this is a JavaScript project, and `gems/` is for
Ruby gems.

## Configuration

| variable | default | |
|---|---|---|
| `PORT` | `3200` | |
| `HOST` | `127.0.0.1` | loopback only by default |
| `CPCP_ORIGIN` | `https://magenticmarket.ai/_cpcp` | point at a local seam to develop against one |
| `FRAMES_CACHE_MS` | `60000` | *Re-check seam* in the UI bypasses it |
| `TODOS_PATH` | `data/todos.json` | |

## A terminology note

The word *orientation* names human-to-human conversation only and is not used
for any computer-involved operation, kind, table, column, method, or field
anywhere in this repo.
