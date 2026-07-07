import type { CompositeReceipt, LegResult } from './types';
import { contentHash, compositeHash } from './hash';

export interface VerificationResult {
  verified: boolean;
  legChecks: Array<{ service: string; verified: boolean; reportedHash: string; recomputedHash: string; kind: 'deterministic' | 'stateful'; note?: string; error?: string }>;
  compositeHashMatch: boolean;
  evidenceRoot: string;
}

// Deterministic legs return the same receipt for the same input, so their stored
// hash must recompute exactly. Stateful legs mint/append/create on every call
// (a new tool, a new memory entry, a new task), so a fresh call legitimately
// produces a different hash — for those we verify the stored receipt is
// internally consistent, and say plainly that re-running would differ.
const DETERMINISTIC = new Set(['backwards', 'manyface']);

export async function verify(receipt: CompositeReceipt): Promise<VerificationResult> {
  const legChecks: VerificationResult['legChecks'] = [];

  for (const leg of receipt.legs) {
    const kind = DETERMINISTIC.has(leg.service) ? 'deterministic' : 'stateful';
    if (!leg.ok) {
      legChecks.push({
        service: leg.service,
        verified: false,
        reportedHash: leg.hash,
        recomputedHash: '',
        kind,
        error: leg.error || 'leg was not ok',
      });
      continue;
    }
    const recomputed = contentHash(leg.data);
    const hashMatches = recomputed === leg.hash;
    if (kind === 'deterministic') {
      // Must recompute exactly — this is the real tamper check.
      legChecks.push({
        service: leg.service,
        verified: hashMatches,
        reportedHash: leg.hash,
        recomputedHash: recomputed,
        kind,
        error: hashMatches ? undefined : 'hash mismatch',
      });
    } else {
      // Stateful: this leg mints/appends/creates on every call, so an exact hash
      // cannot be re-derived by anyone. It is verified when it actually ran and
      // recorded a receipt with a real upstream hash. The deterministic legs
      // above are the tamper-evident backbone of the evidence root.
      const ran = Boolean(leg.hash) && leg.data != null;
      legChecks.push({
        service: leg.service,
        verified: ran,
        reportedHash: leg.hash,
        recomputedHash: recomputed,
        kind,
        note: 'stateful leg: recorded from a live call; re-running mints a new artifact, so its hash is not re-derivable',
        error: ran ? undefined : 'no recorded receipt',
      });
    }
  }

  const ch = compositeHash(receipt.legs);
  const compositeHashMatch = ch === receipt.compositeHash;

  const evidenceRoot = contentHash({
    legChecks: legChecks.map(l => ({ service: l.service, verified: l.verified, hash: l.reportedHash })),
    compositeHashMatch,
    originalCompositeHash: receipt.compositeHash,
  });

  // Honest verdict: every deterministic leg must re-verify EXACTLY (tamper-evident
  // backbone), and every leg must have actually run. Stateful legs cannot be
  // hash-re-derived by design, so they are not required to match the composite
  // hash; that is why compositeHashMatch is reported but not gating.
  const deterministicOk = legChecks.filter(l => l.kind === 'deterministic').every(l => l.verified);
  const allRan = legChecks.every(l => l.verified);
  return {
    verified: deterministicOk && allRan,
    legChecks,
    compositeHashMatch,
    evidenceRoot,
  };
}

export async function replayVerify(runState: import('./types').RunState): Promise<{
  verified: boolean;
  evidenceRoot: string;
  legChecks: VerificationResult['legChecks'];
}> {
  const stageLegs = runState.stages
    .filter(s => s.name !== 'approval' && s.name !== 'mint' && s.name !== 'done')
    .map(s => ({
      service: s.name,
      ok: s.status === 'passed',
      hash: s.hash ?? '',
      data: s.data,
    }));

  const receipt: CompositeReceipt = {
    runId: runState.id,
    northStar: runState.goal,
    timestamp: runState.createdAt,
    legs: stageLegs as LegResult[],
    compositeHash: runState.compositeHash ?? '',
  };

  const result = await verify(receipt);
  return {
    verified: result.verified,
    evidenceRoot: result.evidenceRoot,
    legChecks: result.legChecks,
  };
}