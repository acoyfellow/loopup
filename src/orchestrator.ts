import type { CompositeReceipt, LegResult } from './types';
import { compositeHash } from './hash';
import { legBackwards, legManyface, legTemper, legDejaRemember, legAirdesk } from './adapters';

export async function compose(northStar: string, sessionId: string): Promise<CompositeReceipt> {
  const legs: LegResult[] = [];

  // a) backwards
  const backwardsLeg = await legBackwards(northStar);
  legs.push(backwardsLeg);

  // b) manyface — derive claim from northStar
  const claim = `compose:${northStar}`;
  const manyfaceLeg = await legManyface(claim);
  legs.push(manyfaceLeg);

  // c) temper — promote winning move into hammer
  let temperLeg: LegResult = { service: 'temper', ok: false, hash: '', data: null, error: 'skipped' };
  if (backwardsLeg.ok && manyfaceLeg.ok) {
    const backwardsData = backwardsLeg.data as { hash: string };
    const manyfaceData = manyfaceLeg.data as { winnerId: string };
    temperLeg = await legTemper(backwardsData.hash, claim, manyfaceData.winnerId);
  }
  legs.push(temperLeg);

  // d) deja-shared remember episode
  const dejaLeg = await legDejaRemember(
    `loopup-${sessionId}`,
    `LoopUp composition: northStar=${northStar}, backwards=${backwardsLeg.ok}, manyface=${manyfaceLeg.ok}, temper=${temperLeg.ok}`,
    sessionId,
  );
  legs.push(dejaLeg);

  // e) airdesk task + dev-sign
  const airdeskLeg = await legAirdesk(northStar);
  legs.push(airdeskLeg);

  const ch = compositeHash(legs);

  const receipt: CompositeReceipt = {
    runId: sessionId,
    northStar,
    timestamp: new Date().toISOString(),
    legs,
    compositeHash: ch,
  };

  // THE RECURSION: mint a distinct loopup-orchestration hammer FROM the composite
  // evidence root (receiptId = compositeHash), only when every leg verified. This
  // is a hammer built by composing hammers — its provenance points at the run that
  // proved the whole stack, not at any single upstream move.
  const allLegsOk = legs.every((l) => l.ok);
  if (allLegsOk) {
    // The mint is DOWNSTREAM of the evidence root — it consumes the composite
    // hash as its receiptId and is recorded on the receipt, but is deliberately
    // NOT folded back into `legs`/compositeHash (that would be circular).
    const mintLeg = await legTemper(ch, `loopup-orchestration:${northStar}`, `composite-${ch}`);
    const mint = mintLeg.data as {
      hammer?: { id: string; provenance: { contentHash: string; sourceReceipt: string } };
      verification?: { passed: boolean };
    } | null;
    if (mintLeg.ok && mint?.hammer) {
      receipt.hammerId = mint.hammer.id;
      receipt.hammerProvenance = mint.hammer.provenance;
      receipt.hammerVerified = mint.verification?.passed ?? false;
    } else {
      receipt.hammerError = mintLeg.error ?? 'temper returned no hammer';
    }
  } else {
    receipt.hammerError = 'not minted: one or more composition legs did not verify';
  }

  return receipt;
}