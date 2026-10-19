/**
 * Dev key management (ADR-0008 dev regime: deterministic weak-PTau keygen,
 * checksum-verified; prod ceremony is DEBT-1 and out of scope for v1).
 *
 * Key generation shells out to the pinned `snarkjs` CLI (the official
 * interface for `groth16 setup` / `zkey export verificationkey`, which are
 * not exposed by snarkjs's JS API). The dev PTau digest is verified before
 * every keygen so keys are reproducible across machines ("artifact hashes
 * reproduced in 2 runs").
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  devPtauChecksumFile,
  devPtauFile,
  readDevPtauChecksum,
  sha256File,
} from '@zkpe/circuit-lib';
import type { Circuit } from './circuit.js';

/** snarkjs verification key (loosely typed; shape is stable across 0.7.x). */
export interface VerificationKey {
  protocol: 'groth16';
  curve: string;
  nPublic: number;
  vk_alpha_1: [string, string, string];
  vk_beta_2: [[string, string], [string, string], [string, string]];
  vk_gamma_2: [[string, string], [string, string], [string, string]];
  vk_delta_2: [[string, string], [string, string], [string, string]];
  IC: [string, string, string][];
  [key: string]: unknown;
}

/** Absolute path of the pinned snarkjs CLI (`build/cli.cjs`). */
export function snarkjsCliPath(): string {
  const require = createRequire(import.meta.url);
  const main = require.resolve('snarkjs'); // build/main.cjs via "require" export
  return join(dirname(main), 'cli.cjs');
}

/** Run the snarkjs CLI with the given args; returns combined output. */
export function runSnarkjs(args: string[], cwd: string): string {
  return execFileSync(process.execPath, [snarkjsCliPath(), ...args], {
    encoding: 'utf8',
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Thrown when the dev PTau is missing or its digest does not match. */
export class DevPtauError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevPtauError';
  }
}

/** Verify the dev PTau exists and matches its recorded digest. */
export async function verifyDevPtau(): Promise<string> {
  const file = devPtauFile();
  const sums = devPtauChecksumFile();
  const { existsSync } = await import('node:fs');
  if (!existsSync(file) || !existsSync(sums)) {
    throw new DevPtauError(
      'dev PTau missing — run `npm run build:ptau -w @zkpe/circuit-lib` first',
    );
  }
  const recorded = readDevPtauChecksum();
  const actual = (await sha256File(file)).replace(/^0x/, '');
  if (actual !== recorded) {
    throw new DevPtauError(`dev PTau digest mismatch (recorded ${recorded}, got ${actual})`);
  }
  return file;
}

/** Result of dev key generation. */
export interface DevKeyPair {
  provingKeyPath: string;
  verificationKey: VerificationKey;
}

/**
 * Generate dev keys for a circuit (setup + vk export) into the circuit-lib
 * build directory. Overwrites existing keys (dev-only material).
 */
export async function generateDevKeys(circuit: Circuit): Promise<DevKeyPair> {
  const ptau = await verifyDevPtau();
  const dir = dirname(circuit.artifactPaths.zkey);
  const zkey = circuit.artifactPaths.zkey;
  const vk = circuit.artifactPaths.vk;

  runSnarkjs(['groth16', 'setup', circuit.artifactPaths.r1cs, ptau, zkey], dir);
  runSnarkjs(['zkey', 'export', 'verificationkey', zkey, vk], dir);

  return {
    provingKeyPath: zkey,
    verificationKey: circuit.verificationKey,
  };
}
