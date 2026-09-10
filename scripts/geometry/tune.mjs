#!/usr/bin/env node
/**
 * yarn geometry:tune — SCAFFOLD ONLY.
 *
 * Future: parameter set → benchmark train → evaluate validation → rank.
 * Hidden test set stays untouched.
 */

import { PARAMETER_SPACE, TUNE_PROTOCOL, defaultCandidate } from './lib/params-space.mjs';
import { documentSyntheticWorkflow, SYNTHETIC_INTERFACE } from './lib/synthetic.mjs';

console.log('GEOMETRY TUNE (scaffold)');
console.log('─'.repeat(48));
console.log('No parameter search is performed today.');
console.log('Production detector / params.ts are untouched.\n');

console.log('Protocol:');
console.log(`  train metric:     ${TUNE_PROTOCOL.trainMetric}`);
console.log(`  validation gate:  ${TUNE_PROTOCOL.validationGate}`);
console.log(`  test set:         ${TUNE_PROTOCOL.testSet}`);
console.log(`  runtime:          ${TUNE_PROTOCOL.runtime}`);

console.log('\nParameter space groups:');
for (const g of PARAMETER_SPACE.groups) {
  console.log(`  [${g.id}] ${g.note ?? ''}`);
  for (const p of g.params) {
    console.log(`    - ${p.name} (${p.path}) default=${JSON.stringify(p.default)}`);
  }
}

console.log('\nCurrent candidate (frozen production defaults):');
console.log(JSON.stringify(defaultCandidate(), null, 2));

console.log('\nSynthetic interface status:', SYNTHETIC_INTERFACE.status);
console.log(documentSyntheticWorkflow());

if (process.argv.includes('--search')) {
  console.error('\nRefusing --search: corpus/trusted annotations insufficient and host/native parity not wired for injection.');
  process.exit(2);
}
