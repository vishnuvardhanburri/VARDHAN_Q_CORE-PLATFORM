/**
 * Compile all circuits in `circuits/` to R1CS + WASM using the pinned circom
 * binary (`.tools/circom-macos-219` / `circom-linux-amd64`, v2.1.9).
 *
 * Outputs: `build/<artifactBase>.r1cs` and `build/<artifactBase>_js/<base>.wasm`.
 * Also updates each definition's measured constraint count into
 * `build/<base>.constraints.json` for the certify step.
 *
 * Usage: `node scripts/build-circuits.mjs`
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD_DIR, assertCircomVersion, circomBin, circomlibDir, log, run } from './common.mjs';

const defs = [
  { id: 'poseidon-preimage', file: 'poseidon-preimage.circom', base: 'poseidon-preimage' },
  { id: 'merkle-inclusion', file: 'merkle-inclusion.circom', base: 'merkle-inclusion' },
];

for (const dir of [BUILD_DIR]) {
  mkdirSync(dir, { recursive: true });
}

assertCircomVersion();

for (const def of defs) {
  log(`compiling ${def.id} (${def.file})`);
  const out = run(
    circomBin(),
    ['--r1cs', '--wasm', '-o', BUILD_DIR, '-l', circomlibDir(), join('circuits', def.file)],
  );
  const m = out.match(/non-linear constraints:\s*(\d+)/i) ?? out.match(/constraints:\s*(\d+)/i);
  if (!m) {
    throw new Error(`could not parse constraint count for ${def.id}:\n${out}`);
  }
  const constraints = Number(m[1]);
  writeFileSync(join(BUILD_DIR, `${def.base}.constraints.json`), JSON.stringify({ constraints }, null, 2));
  log(`${def.id}: ${constraints} constraints`);
}

log('all circuits compiled');
