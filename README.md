# LoopUp

## Pain

Five proven primitives (backwards, temper, deja, manyface, airdesk) still leave humans manually carrying identity, artifacts, and evidence between them. Copying their code into one giant repo destroys the seven-minute constraint that made each understandable.

## Promise

> State one north star; LoopUp composes the five production services into one replayable run that ends in a physically authorized, independently proven artifact.

## Quick Start

```bash
bun install
bun run demo
```

This composes all five live services and prints the composite receipt + verification.

## How It Works

LoopUp is a fetch-only orchestrator. It runs five legs in order:

1. **backwards** — compile + complete + receipt (captures hash + verified-disproved status)
2. **manyface** — tournament on a derived claim (captures winnerId + verdicts)
3. **temper** — promote winning move into a hammer using backwards receipt hash
4. **deja-shared** — remember one consented episode summarizing the run
5. **airdesk** — create task, poll frontier, dev-sign, capture signed status

An independent verifier re-fetches each upstream receipt and assembles one composite evidence root. After a successful run, the composite receipt is promoted to temper for a "loopup-orchestration" hammer.

## Proof

```bash
bun test        # deterministic unit tests
bun run check   # live check against services
```

## Limits

- No copied upstream implementation code — fetch composition only.
- airdesk dev-sign is a labeled non-production signer.
- If any service errors, that leg is marked unproven — never fabricated.
- backwards status "failed" still yields a valid run recording the disproved node.

## Policy

Edit `src/adapters.ts` to change service URLs or request shapes.

## What This Makes Possible

A hammer built from composing hammers. The composite receipt and its verification form a portable evidence root that another notebook can consume directly.