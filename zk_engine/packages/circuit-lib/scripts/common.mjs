/**
 * Shared helpers for circuit-lib build scripts.
 *
 * The circom binary is pinned and committed under `<repo>/.tools/`; its
 * version string is verified before every compile. Artifact paths are
 * resolved relative to this package's `build/` directory so scripts work
 * from any CWD.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
export const BUILD_DIR = join(PACKAGE_ROOT, 'build');
export const CIRCOM_VERSION = '2.1.9';
export const PTAU_DIR = BUILD_DIR;
export const PTAU_FILE = join(PTAU_DIR, 'ptau16_dev.ptau');
export const PTAU_SUMS = join(PTAU_DIR, 'ptau16_dev.ptau.sha256');

export function circomBin() {
  const platform = process.platform;
  const name =
    platform === 'darwin'
      ? 'circom-macos-219'
      : platform === 'linux'
        ? 'circom-linux-amd64'
        : null;
  if (!name) {
    throw new Error(`unsupported platform ${platform} for pinned circom binary`);
  }
  const bin = join(REPO_ROOT, '.tools', name);
  if (!existsSync(bin)) {
    throw new Error(`pinned circom binary missing: ${bin}`);
  }
  return bin;
}

/** Run a command and return stdout+stderr combined; throws on non-zero exit. */
export function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: opts.cwd ?? PACKAGE_ROOT,
  });
}

/** Verify the pinned circom binary reports the expected version. */
export function assertCircomVersion() {
  const out = run(circomBin(), ['--version']);
  if (!out.includes(CIRCOM_VERSION)) {
    throw new Error(
      `pinned circom version mismatch: expected ${CIRCOM_VERSION}, got: ${out.trim()}`,
    );
  }
}

export function log(msg) {
  process.stdout.write(`[circuit-lib] ${msg}\n`);
}

/** Directory containing the installed `circomlib` package (for `-l`). */
export function circomlibDir() {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('circomlib/circuits/poseidon.circom');
  return join(dirname(entry), '..', '..');
}
