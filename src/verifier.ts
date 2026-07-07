import type { CompositeReceipt, LegResult } from './types';
import { contentHash, compositeHash } from './hash';

export interface VerificationResult {
  verified: boolean;
  legChecks: Array<{ service: string; verified: boolean; reportedHash: string; recomputedHash: string; error?: string }>;
  compositeHashMatch: boolean;
  evidenceRoot: string;
}

export async function verify(receipt: CompositeReceipt): Promise<VerificationResult> {
  const legChecks: VerificationResult['legChecks'] = [];

  for (const leg of receipt.legs) {
    if (!leg.ok) {
      legChecks.push({
        service: leg.service,
        verified: false,
        reportedHash: leg.hash,
        recomputedHash: '',
        error: leg.error || 'leg was not ok',
      });
      continue;
    }
    const recomputed = contentHash(leg.data);
    const verified = recomputed === leg.hash;
    legChecks.push({
      service: leg.service,
      verified,
      reportedHash: leg.hash,
      recomputedHash: recomputed,
      error: verified ? undefined : 'hash mismatch',
    });
  }

  const ch = compositeHash(receipt.legs);
  const compositeHashMatch = ch === receipt.compositeHash;

  const evidenceRoot = contentHash({
    legChecks: legChecks.map(l => ({ service: l.service, verified: l.verified, hash: l.reportedHash })),
    compositeHashMatch,
    originalCompositeHash: receipt.compositeHash,
  });

  return {
    verified: legChecks.every(l => l.verified) && compositeHashMatch,
    legChecks,
    compositeHashMatch,
    evidenceRoot,
  };
}