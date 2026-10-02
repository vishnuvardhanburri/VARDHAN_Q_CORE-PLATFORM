/**
 * Certification check: verify every certified manifest matches the artifacts
 * currently on disk (Security T1). Exits non-zero on any mismatch, so this can
 * gate CI ("artifact hashes reproduced in 2 runs" acceptance criterion).
 *
 * Usage: `node scripts/certify-circuits.mjs [circuitId...]` (default: all)
 */

import { checkArtifacts, getCircuitDefinition, listCircuitIds } from '../dist/index.js';
import { log } from './common.mjs';

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested : listCircuitIds();

let failed = false;
for (const id of targets) {
  const def = getCircuitDefinition(id);
  try {
    await checkArtifacts(def);
    log(`${id}: artifacts match certified manifest`);
  } catch (err) {
    failed = true;
    console.error(`[circuit-lib] ${id}: FAILED — ${err.message}`);
  }
}

if (failed) process.exit(1);
log('certification ok');
