# LoopUp — architecture and what it actually does

LoopUp takes one goal and runs it through five separately-deployed Cloudflare
Workers, in order, as a single durable run you can watch, approve, and re-verify.
This document is the technical account: the run model, each stage's real
contract, the honesty guarantees, and where the edges are.

Live: https://loopmachine.coey.dev · public fallback: https://loopmachine.coy.workers.dev

## The one-sentence claim

Five small production services compose into one durable, resumable,
human-authorized run that ends in an independently re-checkable result and a
newly minted reusable tool — with no service copying another's code.

## The run is a Durable Object, not a request

A run is not a synchronous HTTP call that dies with the request. `POST /api/runs`
creates a **Durable Object** (`LoopupRun`) with **SQLite** storage that holds the
run's identity, its stage table, and every stage's receipt. The DO advances
itself with an **alarm-driven stage machine**: each stage runs, writes its result
to SQLite, broadcasts to any connected watchers, then schedules the next stage
via `storage.setAlarm(...)`. This is why a run survives the request, can be polled
or streamed, blocks for human approval, and can be replayed later.

```
POST /api/runs {goal}
  -> DO LoopupRun created, SQLite row written, alarm set
       stage 0 backwards   -> receipt -> alarm
       stage 1 manyface    -> receipt -> alarm
       stage 2 temper      -> receipt -> alarm
       stage 3 deja-shared -> receipt -> alarm
       stage 4 airdesk     -> status = awaiting_approval, HALT (no alarm)
                              [human approves/denies]  -> alarm
       stage 5 approval    -> pass only if status === approved
       stage 6 mint        -> promote composite -> new hammer
       stage 7 done        -> status = completed
```

`STAGE_NAMES = [backwards, manyface, temper, deja-shared, airdesk, approval, mint, done]`.

## Composition, not absorption

Every stage calls another service's **live HTTP API** with `fetch`. LoopUp holds
adapters and the run engine; it contains none of the five services' internals.
If a stage's service is unreachable, that leg is recorded as a real error and
marked unproven — the run does not fabricate a result.

| Stage | Live service | Real call | What it contributes |
|---|---|---|---|
| backwards | backwards.coey.dev | `POST /api/runs`, `/complete`, `GET /receipt` | Turns the goal into concrete checks; a failed check (verified-disproved) is surfaced honestly, not hidden |
| manyface | manyface.coey.dev | `POST /api/tournament {claim}` | Races candidate answers; a critic attacks each; returns the winner + every loser's verdict |
| temper | temper.coey.dev | `GET /api/hammers/:shapeKey`, else `POST /api/promote` | Reuses a prior proven tool if one exists for this goal shape; otherwise promotes the winning move into a new one |
| deja-shared | deja-shared.coey.dev | `GET /v1/shared/events`, `POST /v1/shared/remember` | Injects a prior learned instinct if one exists; records this run's episode (consented, redaction-aware) |
| airdesk | airdesk.coey.dev | `POST /api/task`, poll `GET /api/frontier/task-:id`, `POST /api/dev-sign` or real passkey | Runs the irreversible step to `awaiting_signature`, then BLOCKS for a human decision |

## The approval gate is a real halt

At the airdesk stage the run sets `status = awaiting_approval` and **stops
scheduling alarms**. Nothing proceeds until a human acts:

- `POST /api/runs/:id/approve` — production path, a real WebAuthn passkey signature.
- `POST /api/runs/:id/dev-sign` — a clearly labeled **non-production demo signer**,
  for visitors without a passkey. It returns `{note: "demo signer (not production)"}`.
- `POST /api/runs/:id/deny` — records denial; the run stays resumable.

Approval binds to the exact artifact hash shown. `POST` an artifact hash that
does not match the run's `approvalArtifactHash` and you get `409 approval void`.
If the underlying result changed, a prior approval is meaningless — you must
approve the thing you actually saw.

## What "verified" means, honestly

`GET /api/runs/:id?replay=true` re-fetches each **deterministic** upstream receipt
and recomputes the evidence root. The verdict distinguishes two kinds of leg,
because they are not equally re-derivable:

- **Deterministic legs** (backwards, manyface): the same input yields the same
  receipt. Replay calls `GET /api/runs/<runId>/receipt` on backwards and
  `GET /api/replay/<tournamentId>` on manyface, hashes the fresh response, and
  compares to the stored hash. Verified only if the freshly-fetched upstream
  receipt matches. This is the tamper-evident backbone — if these don't match,
  something was altered or the upstream data changed.
- **Stateful legs** (temper mint, deja append, airdesk task): each call creates a
  new artifact (a new tool, a new memory entry, a new task), so their hash is
  **not re-derivable by anyone**. They are verified as *recorded from a live
  call*, and the receipt says so in plain terms rather than faking a match.
  Replay does NOT re-fetch upstream for stateful legs.

`verified: true` means every deterministic leg re-verified exactly against its
upstream service and every leg actually ran. This is deliberately narrower than
"all hashes identical," because claiming a stateful leg is hash-stable would be
dishonest.

## The recursion

After a fully-approved run, LoopUp takes its own composite evidence root and
`POST`s it to temper `/api/promote`, minting a `loopup-orchestration` tool whose
provenance points at the run that proved the whole stack. A tool built by
composing tools. The mint is downstream of the evidence root and is deliberately
**not** folded back into that root (that would be circular).

## HTTP contract

```
POST /api/runs              {goal}            -> {runId}
GET  /api/runs/:id                            -> {run: {...stages, status, receipts}}
GET  /api/runs/:id?replay=true                -> {run, replay: {verified, evidenceRoot, legChecks}}
GET  /api/runs/:id/ws                         -> WebSocket, streams stage transitions
POST /api/runs/:id/approve  {artifactHash}    -> 200 | 409 (hash mismatch, void)
POST /api/runs/:id/dev-sign {artifactHash}    -> 200 {note: demo signer}
POST /api/runs/:id/deny     {reason?}         -> 200, run resumable
GET  /api/status                              -> {ok, service, timestamp}
POST /api/compose           {goal}            -> synchronous one-shot (legacy inner engine)
```

Run status values: `running`, `awaiting_approval`, `approved`, `completed`,
`failed`, `denied`.

## Frontend progress model

The page drives progress by **polling `GET /api/runs/:id` every 1.5s**, not by
WebSocket alone. The backend reaches the approval gate in about 8 seconds —
often before a socket finishes handshaking — so polling is the primary driver and
the WebSocket is an optional low-latency enhancement. (An earlier version relied
on the socket only and appeared stuck at "starting"; polling fixed that.)

## Cloudflare primitives used

- **Durable Object + SQLite** — one per run: identity, stage state, receipts,
  resume, and the WebSocket hub.
- **DO alarms** — the stage machine's clock; each stage schedules the next.
- **Worker fetch** — composition to the five live services; no shared code.
- **Assets binding** — serves the static site; the worker owns only `/api/*` and
  falls through to assets for everything else.

## Honest limits

- The default approval on the public site uses the **labeled demo signer**, not a
  real passkey, so a stranger can complete a run. Real WebAuthn is wired and is
  the production path.
- Runs are ephemeral demos; the DO holds run state but this is not positioned as
  durable customer data.
- Stateful legs cannot be hash-replayed by third parties by design; replay proves
  the deterministic backbone and that every leg ran, not bit-for-bit reproduction
  of mint/append/task calls.
- `manyface` currently races a fixed candidate/critic set; it demonstrates
  selection-by-test, not an open-ended model tournament.

## Why the service is named `loopmachine`

The worker was originally `loopup`. Repeated delete/redeploy cycles during
development left per-service edge state that returned `403 {"error":"Authentication
required"}` on its custom domains — it survived deleting the worker and followed
to fresh hostnames, but was keyed to the service *name*. Deploying identical code
under a new service name (`loopmachine`) cleared it. The product is still
"LoopUp"; the Cloudflare service is `loopmachine`.
