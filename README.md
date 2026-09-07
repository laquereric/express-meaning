# express-meaning

[![gate-tests](https://github.com/laquereric/express-meaning/actions/workflows/test.yml/badge.svg)](https://github.com/laquereric/express-meaning/actions/workflows/test.yml)

A traditional TODO list, and one **ContextFrame** to read it through — sliced
into the three roles a CPCP unit deploys as.

Express 5, vanilla JavaScript, no build step. One runtime dependency; SQLite
comes from `node:sqlite`, which is built in.

```bash
npm install
npm test                 # 57 tests, no network required

# one image, three roles -- each in its own terminal
TODOS_DB=data/todos.sqlite3 npm run start:back      # :3200  the seam
TODOS_DB=data/todos.sqlite3 npm run start:backjob   #        no ingress
PORT=3201 BACK_CPCP_ORIGIN=http://127.0.0.1:3200/_cpcp npm run start:front
```

## One image, three roles

| `ROLE` | serves | holds |
|---|---|---|
| `back` | `/_cpcp/rpc`, `/_cpcp/cid.json` — the todo seam | the SQLite database |
| `front` | the browser UI and its `/api/*` routes | **no database** |
| `backjob` | nothing. No ingress. | reaps idempotency receipts |

Same shape as a Rails deploy of this unit, deliberately: one build, three
containers, distinguished by `ROLE`.

### The split is the point

FRONT used to call the todo store as a function, so nothing could stand between
an intent and its effect. Every mutation now crosses a process boundary as a
typed message, and four things became true **without anyone adding a policy
layer**:

| | |
|---|---|
| an intent is **named** before it is performed | `operationId` on every PUSH |
| a retry is the **same write**, not a second one | receipts, in the same database |
| a refusal is a **record**, not an exception | the never-raise envelope |
| what the seam answers is **discoverable** | the CID |

None of that is application logic. It is what the boundary *being there* makes
true — which is why governance can arrive later without rewriting a single
caller. FRONT imports no store and opens no database: it could not bypass the
seam if it wanted to.

The `/api/*` routes a browser calls look exactly as they did. Each is now a
thin proxy making a CPCP call to BACK. The browser did not have to learn
anything.

## The spine: Input → Frame → Translation

Those are the columns of the translation board in
[`magentic-stack`](https://github.com/laquereric/magentic-stack), and they are
this app's structure:

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
[contract package](https://github.com/laquereric/coordination-protocol-contract-package)
pattern:

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

The client (`src/cpcp/front/client.js`) handles three things a naive one gets
wrong — and the same code talks to both seams, this app's BACK and
magenticmarket.ai, because a seam is a seam:

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
server.js                        ROLE=front|back|backjob; the three surfaces
src/cpcp/                        PROTOCOL -- nothing here knows what a todo is
  envelope.js                      ok / no / refuse / normalize
  front/client.js                  discover, pull, push
  back/seam.js                     register / dispatch / cid
  back/receipts.js                 idempotency store, and its own table
  backjob/reaper.js                reap receipts past their TTL
src/projection.js                DOMAIN meets protocol: registers todo.*
src/todos.js                     the todo store, on SQLite
src/db.js                        the connection and the domain schema
src/contextframes.js             CID discovery, coercion, provenance, fallback
src/prompt.js                    Input + Frame -> Translation
public/                          vanilla JS, no framework, no build
tests/                           57 tests, all offline
```

**`src/cpcp/` is generic on purpose.** The seam knows nothing about todos:
operations are *registered* by `src/projection.js`, the same way `rails-cpcp`
separates its engine from the initializer that projects a resource. A second
application replaces the projection and keeps the rest —
`tests/seam-generic.test.js` proves it by registering invented `widget.*`
operations into a reset registry and watching them inherit the envelope, the
`operationId` requirement, receipt replay and the CID.

## Configuration

| variable | default | |
|---|---|---|
| `ROLE` | `back` | `front`, `back` or `backjob` |
| `PORT` | `3200` | |
| `HOST` | `127.0.0.1` | loopback only by default |
| `TODOS_DB` | `data/todos.sqlite3` | BACK and BACKJOB share it; FRONT never opens it |
| `BACK_CPCP_ORIGIN` | `http://127.0.0.1:$PORT/_cpcp` | where FRONT finds BACK |
| `CPCP_BASE_IRI` | `http://127.0.0.1:3200` | the IRI the CID publishes |
| `CPCP_ORIGIN` | `https://magenticmarket.ai/_cpcp` | the *frame* seam, not this app's |
| `RECEIPT_TTL_HOURS` | `24` | past this a retry is a **new** write |
| `BACKJOB_INTERVAL_MS` | `60000` | |
| `SQLITE_BUSY_TIMEOUT_MS` | `5000` | see below |

### Why there is a busy timeout

Three roles open the same SQLite file, and on a **cold** start they open it at
the same moment while the schema does not yet exist. Without a busy timeout
SQLite returns `SQLITE_BUSY` instantly rather than waiting: six concurrent
opens were measured at five failures and one success.

It hid in the worst way — BACK usually won the race and looked healthy, so the
app served requests while BACKJOB was already dead. A worker that dies on cold
start and a worker with nothing to do print the same amount of nothing.
`tests/todos.test.js` spawns six concurrent cold opens to keep it fixed.

## A terminology note

The word *orientation* names human-to-human conversation only and is not used
for any computer-involved operation, kind, table, column, method, or field
anywhere in this repo.
