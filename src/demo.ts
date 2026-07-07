import { compose } from './orchestrator';
import { verify } from './verifier';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const northStar = 'Build a seven-minute repo that composes five live services';
const sessionId = `demo-${Date.now()}`;

console.log('=== LoopUp Composition Run ===');
console.log(`North Star: ${northStar}`);
console.log(`Session: ${sessionId}\n`);

const receipt = await compose(northStar, sessionId);

console.log('\n=== Composite Receipt ===');
console.log(JSON.stringify(receipt, null, 2));

console.log('\n=== Independent Verification ===');
const result = await verify(receipt);
console.log(JSON.stringify(result, null, 2));

console.log(`\n=== Result: ${result.verified ? 'PASSED' : 'FAILED'} ===`);
if (receipt.hammerId) {
  console.log(`Hammer ID: ${receipt.hammerId}`);
  console.log(`Hammer Provenance: ${JSON.stringify(receipt.hammerProvenance)}`);
}

const proofDir = join(import.meta.dir, '..', 'proof');
mkdirSync(proofDir, { recursive: true });
writeFileSync(join(proofDir, 'loopup-receipt.json'), JSON.stringify({ receipt, verification: result }, null, 2));
console.log('\nReceipt written to proof/loopup-receipt.json');