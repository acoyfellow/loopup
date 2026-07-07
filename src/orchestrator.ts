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
    const backwardsData = backwardsLeg.data as { id: string; hash: string };
    const manyfaceData = manyfaceLeg.data as { winnerId: string };
    temperLeg = await legTemper(backwardsData.id, claim, manyfaceData.winnerId);
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

  // NEW HAMMER: if temper succeeded, promote composite receipt to temper for a loopup-orchestration hammer
  if (temperLeg.ok) {
    const temperData = temperLeg.data as { id: string; provenance: { contentHash: string; sourceReceipt: string }; verification: { passed: boolean } };
    receipt.hammerId = temperData.id;
    receipt.hammerProvenance = temperData.provenance;
  } else {
    // Try to mint a new hammer from the composite receipt
    const mintLeg = await legTemper(sessionId, `loopup-composite:${northStar}`, ch);
    if (mintLeg.ok) {
      const mintData = mintLeg.data as { id: string; provenance: { contentHash: string; sourceReceipt: string } };
      receipt.hammerId = mintData.id;
      receipt.hammerProvenance = mintData.provenance;
    }
  }

  return receipt;
}