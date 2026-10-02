/**
 * On-disk artifact layout and integrity checking for `@zkpe/circuit-lib`.
 *
 * Artifacts live under the package `build/` directory (gitignored; the
 * certified manifests are the committed contract). `loadArtifactHashes` reads
 * the files that `scripts/keygen.mjs` produced and `checkArtifacts` compares
 * them against a certified manifest (Security T1: hashes checked before use).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize, type CircuitManifest } from '@zkpe/proof-format';
import type { CircuitDefinition } from './circuits.js';
import { sha256File, sha256Utf8 } from './hashes.js';
import { computeVkHash, type ArtifactHashes } from './manifest.js';

/** Resolve the package build directory (independent of CWD). */
export function buildDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'build');
}

/** Absolute paths of all artifacts for a definition. */
export function artifactPaths(def: CircuitDefinition): {
  r1cs: string;
  wasm: string;
  zkey: string;
  vk: string;
} {
  const dir = buildDir();
  return {
    r1cs: join(dir, `${def.artifactBase}.r1cs`),
    wasm: join(dir, `${def.artifactBase}_js`, `${def.artifactBase}.wasm`),
    zkey: join(dir, `${def.artifactBase}.zkey`),
    vk: join(dir, `${def.artifactBase}.vkey.json`),
  };
}

/** True if every artifact file exists on disk. */
export function artifactsExist(def: CircuitDefinition): boolean {
  const paths = artifactPaths(def);
  return [paths.r1cs, paths.wasm, paths.zkey, paths.vk].every(existsSync);
}

/** Path of the certified manifest JSON for a definition. */
export function manifestPath(def: CircuitDefinition): string {
  return join(buildDir(), `${def.artifactBase}.manifest.json`);
}

/** True if a certified manifest file exists on disk. */
export function manifestExists(def: CircuitDefinition): boolean {
  return existsSync(manifestPath(def));
}

/** Absolute path of the deterministic dev PTau (power 16, ADR-0008 dev regime). */
export function devPtauFile(): string {
  return join(buildDir(), 'ptau16_dev.ptau');
}

/** Absolute path of the recorded dev PTau sha256 sum (produced by `build:ptau`). */
export function devPtauChecksumFile(): string {
  return join(buildDir(), 'ptau16_dev.ptau.sha256');
}

/** Read the recorded dev PTau sha256 (lowercase hex, no prefix). */
export function readDevPtauChecksum(): string {
  return readFileSync(devPtauChecksumFile(), 'utf8').trim();
}

/**
 * Compute digests of the on-disk artifacts. Throws if any file is missing —
 * call {@link artifactsExist} first to give callers a friendly error.
 */
export async function loadArtifactHashes(def: CircuitDefinition): Promise<ArtifactHashes> {
  const paths = artifactPaths(def);
  const vkRaw = readFileSync(paths.vk, 'utf8');
  const vk = JSON.parse(vkRaw) as Record<string, unknown>;
  const [r1cs, wasm, zkey] = await Promise.all([
    sha256File(paths.r1cs),
    sha256File(paths.wasm),
    sha256File(paths.zkey),
  ]);
  const vkSha256 = sha256Utf8(vkRaw.replace(/\r\n/g, '\n'));
  return { r1cs, wasm, zkey, vkHash: computeVkHash(vk), vkSha256 };
}

/** Load the certified manifest JSON from disk. Throws when absent. */
export function loadManifest(def: CircuitDefinition): CircuitManifest {
  const raw = readFileSync(manifestPath(def), 'utf8');
  return JSON.parse(raw) as CircuitManifest;
}

/**
 * Artifact bundle digest: sha256 of the canonical JSON of the four artifact
 * digests (r1cs, wasm, zkey, vk sha256 + vkHash). This is the value the
 * proof envelope's `artifactHash` must carry so the proof is cryptographically
 * bound to the exact compiled artifact deployed (gatekeeper artifact binding).
 */
export async function computeArtifactBundleHash(def: CircuitDefinition): Promise<string> {
  const hashes = await loadArtifactHashes(def);
  const bundle = canonicalize({
    r1cs: hashes.r1cs,
    wasm: hashes.wasm,
    zkey: hashes.zkey,
    vk: { sha256: hashes.vkSha256, vkHash: hashes.vkHash },
  });
  return sha256Utf8(bundle);
}

/**
 * Verify that on-disk artifact digests match the certified manifest.
 * Throws `Error` describing the first mismatch (Security T1).
 */
export async function checkArtifacts(def: CircuitDefinition): Promise<void> {
  if (!artifactsExist(def)) {
    throw new Error(
      `artifacts for ${def.id} not built — run \`npm run build:circuits -w @zkpe/circuit-lib\` first`,
    );
  }
  const manifest = loadManifest(def);
  const hashes = await loadArtifactHashes(def);
  const mismatches: string[] = [];
  if (manifest.artifacts.r1cs !== hashes.r1cs) mismatches.push('r1cs');
  if (manifest.artifacts.wasm !== hashes.wasm) mismatches.push('wasm');
  if (manifest.artifacts.zkey !== hashes.zkey) mismatches.push('zkey');
  if (manifest.artifacts.vk.vkHash !== hashes.vkHash) mismatches.push('vkHash');
  if (manifest.artifacts.vk.sha256 !== hashes.vkSha256) mismatches.push('vk.sha256');
  if (mismatches.length > 0) {
    throw new Error(
      `artifact integrity check failed for ${def.id}: ${mismatches.join(', ')} differ from manifest`,
    );
  }
}
