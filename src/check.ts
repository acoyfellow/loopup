import { compose } from './orchestrator';
import { verify } from './verifier';

const northStar = 'Check that loopup composes live services';
const sessionId = `check-${Date.now()}`;

console.log('Running LoopUp check against live services...');
const receipt = await compose(northStar, sessionId);

const result = await verify(receipt);

const okLegs = receipt.legs.filter(l => l.ok).length;
const totalLegs = receipt.legs.length;

console.log(`Legs: ${okLegs}/${totalLegs} ok`);
console.log(`Composite hash: ${receipt.compositeHash}`);
console.log(`Verification: ${result.verified ? 'PASS' : 'FAIL'}`);

for (const leg of receipt.legs) {
  const status = leg.ok ? 'OK' : 'ERROR';
  console.log(`  ${leg.service}: ${status}${leg.error ? ` - ${leg.error}` : ''} hash=${leg.hash.slice(0, 12)}`);
}

process.exit(result.verified ? 0 : 1);