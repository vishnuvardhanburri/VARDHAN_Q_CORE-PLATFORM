/**
 * Dev key generation + manifest certification for all circuits.
 *
 * For each circuit (in `CIRCUIT_DEFS`):
 *   1. `snarkjs groth16 setup <r1cs> <ptau> <zkey>`   — dev key pair
 *   2. `snarkjs zkey export verificationkey`          — verification key
 *   3. certify via `buildManifest` (src): sha256 of r1cs/wasm/zkey/vk +
 *      keccak256 vkHash (ADR-0008) → `build/<base>.manifest.json`.
 *
 * Verifies the dev PTau digest before keygen so keys are reproducible
 * (acceptance: "artifact hashes reproduced in 2 runs"). DEV-ONLY key material
 * (ADR-0008 dev regime — prod ceremony is DEBT-1).
 *
 * Requires `npm run build` first (imports `dist/index.js`).
 * Usage: `node scripts/keygen.mjs [circuitId...]` (default: all)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import {
  buildManifest,
  getCircuitDefinition,
  listCircuitIds,
  loadArtifactHashes,
  sha256File,
} from '../dist/index.js';
import { BUILD_DIR, PTAU_FILE, PTAU_SUMS, log, run } from './common.mjs';

function snarkjsCli() {
  const require = createRequire(import.meta.url);
  const main = require.resolve('snarkjs');
  return join(dirname(main), 'cli.cjs');
}

function snarkjs(args) {
  return run(process.execPath, [snarkjsCli(), ...args], { cwd: BUILD_DIR });
}

async function assertPtauFresh() {
  if (!existsSync(PTAU_FILE)) {
    throw new Error('dev PTau missing — run `npm run build:ptau -w @zkpe/circuit-lib` first');
  }
  if (!existsSync(PTAU_SUMS)) {
    throw new Error('dev PTau not certified — run `npm run build:ptau -w @zkpe/circuit-lib` first');
  }
  const recorded = readFileSync(PTAU_SUMS, 'utf8').trim();
  const actual = (await sha256File(PTAU_FILE)).replace(/^0x/, '');
  if (actual !== recorded) {
    throw new Error(`dev PTau digest mismatch (recorded ${recorded}, got ${actual})`);
  }
}

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested : listCircuitIds();

await assertPtauFresh();

for (const id of targets) {
  const def = getCircuitDefinition(id);
  const r1cs = join(BUILD_DIR, `${def.artifactBase}.r1cs`);
  const wasm = join(BUILD_DIR, `${def.artifactBase}_js`, `${def.artifactBase}.wasm`);
  const zkey = join(BUILD_DIR, `${def.artifactBase}.zkey`);
  const vk = join(BUILD_DIR, `${def.artifactBase}.vkey.json`);
  if (!existsSync(r1cs) || !existsSync(wasm)) {
    throw new Error(`artifacts for ${id} not built — run \`npm run build:circuits\` first`);
  }

  log(`${id}: groth16 setup`);
  snarkjs(['groth16', 'setup', r1cs, PTAU_FILE, zkey]);
  log(`${id}: export verification key`);
  snarkjs(['zkey', 'export', 'verificationkey', zkey, vk]);

  const hashes = await loadArtifactHashes(def);
  const manifest = buildManifest(def, hashes);
  writeFileSync(
    join(BUILD_DIR, `${def.artifactBase}.manifest.json`),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  log(
    `${id}: certified manifest — vkHash ${manifest.artifacts.vk.vkHash.slice(0, 18)}… ` +
      `manifestHash ${manifest.manifestHash.slice(0, 18)}…`,
  );
}

log('keygen + certification complete');
