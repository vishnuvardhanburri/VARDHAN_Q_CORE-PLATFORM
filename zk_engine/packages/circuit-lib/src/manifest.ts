/**
 * Manifest construction and certification (ADR-0007).
 *
 * A certified manifest is the content-addressed declaration of a circuit:
 * every artifact is bound by its SHA-256 digest, the verification key by
 * `vkHash` (keccak256 of the canonical vk JSON), and the whole manifest by
 * `manifestHash` (keccak256 of the canonical manifest).
 */

import {
  type CircuitManifest,
  canonicalize,
  computeManifestHash,
  keccak256Utf8,
  validateManifest,
} from '@zkpe/proof-format';
import type { CircuitDefinition } from './circuits.js';

/** Content digests of the built artifacts of one circuit. */
export interface ArtifactHashes {
  readonly r1cs: string;
  readonly wasm: string;
  readonly zkey: string;
  /** keccak256 of the canonical vk JSON (ADR-0008). */
  readonly vkHash: string;
  /** sha256 of the vk JSON file (artifact integrity, independent of keccak). */
  readonly vkSha256: string;
}

/**
 * Build a `CircuitManifest` from a definition and its certified digests.
 * Throws `TypeError` if the result fails `validateManifest`.
 */
export function buildManifest(
  def: CircuitDefinition,
  artifacts: ArtifactHashes,
  minEngine = '1.0.0',
  minProofFormat = '1.0.0',
): CircuitManifest {
  const base: Omit<CircuitManifest, 'manifestHash'> = {
    manifestVersion: 1,
    circuitId: def.id,
    circuitVersion: def.version,
    scheme: 'groth16',
    curve: 'bn254',
    inputs: [...def.inputs],
    privateInputs: [...def.privateInputs],
    outputs: [...def.outputs],
    artifacts: {
      r1cs: artifacts.r1cs,
      wasm: artifacts.wasm,
      zkey: artifacts.zkey,
      vk: { vkHash: artifacts.vkHash, sha256: artifacts.vkSha256 },
    },
    constraints: { estimated: def.constraints.estimated, max: def.constraints.max },
    compatibility: { minEngine, minProofFormat },
  };

  const manifest: CircuitManifest = {
    ...base,
    manifestHash: computeManifestHash(base),
  };

  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    throw new TypeError(`invalid circuit manifest for ${def.id}: ${errors.join('; ')}`);
  }
  return manifest;
}

/**
 * vkHash for a verification key: keccak256 of the canonical JSON (ADR-0008).
 * The vk must be a plain JSON-serializable object (snarkjs-style).
 */
export function computeVkHash(vk: Record<string, unknown>): string {
  return keccak256Utf8(canonicalize(vk));
}

/** True if on-disk artifact digests match the manifest exactly. */
export function manifestMatchesArtifacts(
  manifest: CircuitManifest,
  artifacts: ArtifactHashes,
): boolean {
  return (
    manifest.artifacts.r1cs === artifacts.r1cs &&
    manifest.artifacts.wasm === artifacts.wasm &&
    manifest.artifacts.zkey === artifacts.zkey &&
    manifest.artifacts.vk.vkHash === artifacts.vkHash &&
    manifest.artifacts.vk.sha256 === artifacts.vkSha256
  );
}
