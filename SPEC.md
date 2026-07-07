# loopup — the next-level hammer (full product spec)

loopup is not a proof that five HTTP calls can be chained. It is the product that
makes the whole thesis believable: **enough small, comprehensible, production
hammers compose upward into one durable, watchable, physically-authorized run —
without becoming a giant platform.**

A stranger opens loopup, types one goal, and *watches the machine work*: five
independently-deployed services light up in real time, each contributing real
capability, ending in a human-authorized irreversible step and a replayable
evidence trail — plus a brand-new reusable tool minted from the run.

## The five live services it composes (by fetch/RPC only, never copied)

- backwards.coey.dev — turn the goal into checkable claims, run them, report pass/fail
- temper.coey.dev — /api/promote: turn a proven move into a reusable tool
- deja-shared.coey.dev — /v1/shared: durable consented episode log
- manyface.coey.dev — /api/tournament: race answers, a critic attacks, survivor wins
- airdesk.coey.dev — sessionless task -> awaits a real human approval on the one irreversible step

## What made the first build fall short (do not repeat)

- It was a single synchronous `POST /api/compose` that died with the request.
- No durability, no identity, no resume, no live view — just JSON at the end.
- The "authorization" was the labeled dev-sign shortcut, not a real approval gate.
- Stages didn't contribute *real* capability: temper never reused a prior hammer,
  deja never supplied a learned instinct, the manyface critic was a fixed fixture.
- The UI was one input and one button.

## The full-product bar (each is required)

1. **Durable, watchable run.** A run is a Durable Object with SQLite state and a
   Workflow-style stage machine. It has an id, survives the request, and streams
   its progress. `POST /api/runs {goal}` -> `{runId}`; the run advances on its own.

2. **Live surface.** `GET /runs/:id` streams stage transitions over WebSocket/SSE:
   each of the five stages shows pending -> running -> passed/failed with its real
   receipt hash as it happens. The stranger watches the machine, not a spinner.

3. **Each stage contributes real capability, not a checkbox.**
   - backwards: real claim run; a verified-disproved node is surfaced honestly, not hidden.
   - manyface: the critic actually attacks; losing answers are shown with why they lost.
   - temper: **reuses a prior hammer if one exists for the goal's shape**, and
     promotes the winning move into a new one. Both facts appear in the receipt.
   - deja: **records the episode AND, on a later run, injects the prior repair
     instinct** it learned. First run has none; a second run for a similar goal shows it.
   - airdesk: the run **pauses at the one irreversible step and waits for a real
     approval** (see 4). It does not auto-proceed.

4. **Real authorization gate.** The irreversible step blocks. The live surface
   shows exactly what is being approved (the goal, the winning artifact hash, the
   powers, the evidence so far). A human approves with a passkey via airdesk's real
   WebAuthn path, or explicitly denies. A labeled "demo signer" button may exist
   for people without a passkey, but it is clearly marked non-production and the
   real passkey path is the default. Approval binds to that exact artifact; if the
   artifact changed, the approval is void. Denial leaves the run safely resumable.

5. **Replay.** `GET /runs/:id` on a finished run re-serves the full receipt graph.
   An independent verifier re-fetches each upstream receipt fresh and recomputes
   the evidence root, so a stranger can confirm the run without trusting loopup.

6. **The recursion.** After a fully-approved run, loopup mints a new
   `loopup-orchestration` tool from the composite evidence root via temper, and
   the run record shows it. A hammer built from composing hammers.

7. **Honesty bar (non-negotiable).** Every leg records its real upstream response
   and hash; an unreachable service is recorded as a real error and that leg is
   marked unproven; a verified-disproved backwards result is shown truthfully; the
   demo signer is labeled; no upstream code is copied; nothing is fabricated.

## Cloudflare shape

- Durable Object (+ SQLite) — one per run: identity, stage state, resume, WebSocket hub.
- Workflow (or DO alarm-driven stage machine) — durable multi-step advance across the five services.
- R2 — the shared content-addressed evidence root and per-run artifacts.
- Queues — optional cross-stage events; keep only if it earns its place.
- Access — operator boundary for privileged run controls, not for the public demo.
- Service composition by fetch/RPC to the five live services; never copy internals.

## Public surface

- svelte-hono, AX brand, PWA, SEO/share.
- Landing: the plain-language story + one goal input + "Run the stack live".
- Run view: the five stages animating live, receipts appearing, the approval gate,
  the final verified evidence root, the minted tool, and a "replay this run" link.
- loopup.coey.dev (custom domain) plus the public workers.dev URL.

## Stop gate

- All five upstream services independently healthy and versioned.
- One clean end-to-end run through real fetch composition, watched live.
- The airdesk step genuinely blocks on approval and voids on artifact change.
- deja demonstrably injects a learned instinct on a second similar run.
- Independent replay recomputes the evidence root from fresh upstream fetches.
- No copied implementation code; honest receipt graph spanning all stages.
- A stranger opens the URL, runs it, and understands the machine in minutes.

loopup stays a seven-minute repo: adapters, the run engine, the live UI, policy,
and the proof. If a stage needs real capability to make this honest (e.g. deja
instinct injection, a temper hammer lookup), fix that seven-minute repo first and
compose it — do not fake it inside loopup.
