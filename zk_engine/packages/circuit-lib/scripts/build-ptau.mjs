/**
 * Deterministic dev PTau (power 16, BN254) for key generation (ADR-0008 dev
 * regime: "weak-PTau, hash-verified").
 *
 * Generation steps mirror `snarkjs powersoftau`:
 *   1. `new bn254 16`          — random start (never shared with prod)
 *   2. `beacon <fixed-hex> 10` — fixed public beacon makes the file
 *                                deterministic; anyone can reproduce it
 *   3. `verify` + `prepare phase2` — finalize into the phase-2-ready file
 *
 * The resulting digest is recorded in `build/ptau16_dev.ptau.sha256`; every
 * keygen run re-verifies it, so key material is reproducible across machines
 * (acceptance: "artifact hashes reproduced in 2 runs").
 *
 * Usage: `node scripts/build-ptau.mjs`
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { BUILD_DIR, PTAU_DIR, PTAU_FILE, PTAU_SUMS, log, run } from './common.mjs';
import { createRequire } from 'node:module';

// Fixed public beacon (64 hex chars, NO 0x prefix — snarkjs rejects the
// prefix). This is a DEV-ONLY beacon; it is not entropy — the file is
// reproducible by design. Prod PTau is out of scope (DEBT-1) and must never
// reuse this beacon.
const BEACON_HEX = '112f4cc6830ef4d0a8541d56177c4aa4b64befc8ca91aa5e2b5cea53878e1719';

function snarkjsCli() {
  const require = createRequire(import.meta.url);
  const main = require.resolve('snarkjs');
  return join(dirname(main), 'cli.cjs');
}

function sha256File(path) {
  const data = readFileSync(path);
  return createHash('sha256').update(data).digest('hex');
}

function skipIfFresh() {
  if (existsSync(PTAU_FILE) && existsSync(PTAU_SUMS)) {
    const recorded = readFileSync(PTAU_SUMS, 'utf8').trim();
    if (sha256File(PTAU_FILE) === recorded) {
      log(`ptau16_dev.ptau up to date (sha256 ${recorded})`);
      return true;
    }
    log('ptau16_dev.ptau changed since last certified build; regenerating');
  }
  return false;
}

function snarkjs(args) {
  return run(process.execPath, [snarkjsCli(), ...args], { cwd: BUILD_DIR });
}

if (skipIfFresh()) process.exit(0);

mkdirSync(PTAU_DIR, { recursive: true });

const tmp = join(PTAU_DIR, 'ptau16_dev.tmp.ptau');
const tmp2 = join(PTAU_DIR, 'ptau16_dev.tmp2.ptau');

log('powersoftau new bn254 16');
snarkjs(['powersoftau', 'new', 'bn254', '16', tmp, '-v']);

log('beacon (fixed dev beacon, 10 iterations)');
snarkjs(['powersoftau', 'beacon', tmp, tmp2, BEACON_HEX, '10', '-v']);

log('verify');
snarkjs(['powersoftau', 'verify', tmp2, '-v']);

log('prepare phase2');
snarkjs(['powersoftau', 'prepare', 'phase2', tmp2, PTAU_FILE, '-v']);

// Clean up temp files after a successful prepare.
writeFileSync(PTAU_SUMS, sha256File(PTAU_FILE) + '\n');
if (existsSync(tmp)) rmSync(tmp);
if (existsSync(tmp2)) rmSync(tmp2);

log(`ptau16_dev.ptau certified: sha256 ${sha256File(PTAU_FILE)}`);
