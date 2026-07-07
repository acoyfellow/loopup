import type { CompositeReceipt, LegResult, BackwardsReceipt, ManyfaceResult } from './types';
import { contentHash, compositeHash } from './hash';

export interface VerificationResult {
  verified: boolean;
  legChecks: Array<{ service: string; verified: boolean; reportedHash: string; recomputedHash: string; kind: 'deterministic' | 'stateful'; note?: string; error?: string }>;
  compositeHashMatch: boolean;
  evidenceRoot: string;
}

const DETERMINISTIC = new Set(['backwards', 'manyface']);

async function fetchUpstreamReceipt(service: string, data: unknown): Promise<{ ok: boolean; hash: string; error?: string }> {
  try {
    if (service === 'backwards') {
      const d = data as { runId?: string; id?: string } | null;
      const runId = d?.runId ?? d?.id;
      if (!runId) return { ok: false, hash: '', error: 'no runId in stored data' };
      const res = await fetch(`https://backwards.coey.dev/api/runs/${runId}/receipt`);
      if (!res.ok) return { ok: false, hash: '', error: `upstream HTTP ${res.status}` };
      const receipt = await res.json() as BackwardsReceipt;
      return { ok: true, hash: contentHash(receipt) };
    }
    if (service === 'manyface') {
      const d = data as { tournamentId?: string } | null;
      const tournamentId = d?.tournamentId;
      if (!tournamentId) return { ok: false, hash: '', error: 'no tournamentId in stored data' };
      const res = await fetch(`https://manyface.coey.dev/api/replay/${tournamentId}`);
      if (!res.ok) return { ok: false, hash: '', error: `upstream HTTP ${res.status}` };
      const result = await res.json() as ManyfaceResult;
      return { ok: true, hash: contentHash(result) };
    }
    return { ok: false, hash: '', error: 'unknown deterministic service' };
  } catch (e) {
    return { ok: false, hash: '', error: `upstream fetch failed: ${String(e)}` };
  }
}

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
      legChecks.push({
        service: leg.service,
        verified: hashMatches,
        reportedHash: leg.hash,
        recomputedHash: recomputed,
        kind,
        error: hashMatches ? undefined : 'hash mismatch',
      });
    } else {
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

  // For deterministic legs, re-fetch upstream and compare hashes
  const reFetchedLegs: LegResult[] = [];
  for (const leg of stageLegs) {
    if (DETERMINISTIC.has(leg.service) && leg.ok && leg.data != null) {
      const upstream = await fetchUpstreamReceipt(leg.service, leg.data);
      if (upstream.ok) {
        const hashMatches = upstream.hash === leg.hash;
        reFetchedLegs.push({
          service: leg.service,
          ok: hashMatches,
          hash: leg.hash,
          data: leg.data,
          error: hashMatches ? undefined : `upstream hash mismatch: stored=${leg.hash}, upstream=${upstream.hash}`,
        });
      } else {
        reFetchedLegs.push({
          service: leg.service,
          ok: false,
          hash: leg.hash,
          data: leg.data,
          error: upstream.error || 'upstream re-fetch failed',
        });
      }
    } else {
      reFetchedLegs.push(leg as LegResult);
    }
  }

  const receipt: CompositeReceipt = {
    runId: runState.id,
    northStar: runState.goal,
    timestamp: runState.createdAt,
    legs: reFetchedLegs,
    compositeHash: runState.compositeHash ?? '',
  };

  const result = await verify(receipt);

  // Update notes for deterministic legs to indicate they were re-fetched
  for (const check of result.legChecks) {
    if (check.kind === 'deterministic') {
      if (check.verified) {
        check.note = 're-fetched from upstream — receipt matches';
      } else if (check.error?.includes('upstream HTTP 404')) {
        check.note = 'upstream service has no replay endpoint for this leg; cannot independently verify';
      } else if (check.error?.includes('upstream hash mismatch')) {
        check.note = 're-fetched from upstream — upstream data changed since run (e.g. timestamp), hash differs';
      } else {
        check.note = 're-fetched from upstream — receipt MISMATCHES: ' + (check.error || 'unknown error');
      }
    } else {
      check.note = 'stateful leg: recorded from a live call; not re-fetched from upstream';
    }
  }

  return {
    verified: result.verified,
    evidenceRoot: result.evidenceRoot,
    legChecks: result.legChecks,
  };
}