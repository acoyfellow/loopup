import type { CompositeReceipt, LegResult } from './types';
import { compositeHash } from './hash';
import { legBackwards, legManyface, legTemperPromote, legDejaRemember, legAirdeskCreateTask, legAirdeskPoll, legAirdeskSign } from './adapters';

export async function compose(northStar: string, sessionId: string): Promise<CompositeReceipt> {
  const legs: LegResult[] = [];

  const backwardsLeg = await legBackwards(northStar);
  legs.push(backwardsLeg);

  const claim = `compose:${northStar}`;
  const manyfaceLeg = await legManyface(claim);
  legs.push(manyfaceLeg);

  let temperLeg: LegResult = { service: 'temper', ok: false, hash: '', data: null, error: 'skipped' };
  if (backwardsLeg.ok && manyfaceLeg.ok) {
    const backwardsData = backwardsLeg.data as { hash: string };
    const manyfaceData = manyfaceLeg.data as { winnerId: string };
    temperLeg = await legTemperPromote(backwardsData.hash, claim, manyfaceData.winnerId);
  }
  legs.push(temperLeg);

  const dejaLeg = await legDejaRemember(
    `loopup-${sessionId}`,
    `LoopUp composition: northStar=${northStar}, backwards=${backwardsLeg.ok}, manyface=${manyfaceLeg.ok}, temper=${temperLeg.ok}`,
    sessionId,
    'loopup-demo',
  );
  legs.push(dejaLeg);

  const task = await legAirdeskCreateTask(northStar);
  let airdeskLeg: LegResult;
  if ('error' in task) {
    airdeskLeg = { service: 'airdesk', ok: false, hash: '', data: null, error: task.error };
  } else {
    const pollResult = await legAirdeskPoll(task.workflowId);
    if (!pollResult.ok) {
      airdeskLeg = pollResult;
    } else {
      airdeskLeg = await legAirdeskSign(task.workflowId);
    }
  }
  legs.push(airdeskLeg);

  const ch = compositeHash(legs);

  const receipt: CompositeReceipt = {
    runId: sessionId,
    northStar,
    timestamp: new Date().toISOString(),
    legs,
    compositeHash: ch,
  };

  const allLegsOk = legs.every((l) => l.ok);
  if (allLegsOk) {
    const mintLeg = await legTemperPromote(ch, `loopup-orchestration:${northStar}`, `composite-${ch}`);
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