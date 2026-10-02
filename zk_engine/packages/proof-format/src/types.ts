/**
 * Versioned proof envelope and circuit manifest types (ADR-0006, ADR-0007,
 * ADR-0009).
 */

import type { SupportedCurve, SupportedScheme, SupportedSignatureAlgo } from './constants.js';

/** A canonical BN254 field element as a decimal string. */
export type Fr = string;

/** Groth16 proof in snarkjs-compatible coordinate layout (curves.json style). */
export interface Groth16Proof {
  /** G1 point (x, y, 1). */
  pi_a: [Fr, Fr, Fr];
  /** G2 point as (x, y) affine pairs in [a, b, 1] layout. */
  pi_b: [
    [Fr, Fr],
    [Fr, Fr],
    [Fr, Fr],
  ];
  /** G1 point (x, y, 1). */
  pi_c: [Fr, Fr, Fr];
}

/**
 * The on-the-wire proof envelope (ADR-0006). `proofHash` binds the rest of the
 * envelope; recompute with `computeProofHash` and verify with `validateEnvelope`.
 */
export interface ProofEnvelope {
  formatVersion: 1;
  circuitId: string;
  circuitVersion: string;
  /** keccak256 of the canonical verification key (0x-prefixed 64 hex). */
  vkHash: string;
  /**
   * sha256 of the compiled artifact bundle (r1cs, wasm, zkey, vk JSON)
   * this proof was generated from. Binds the proof to the exact deployed
   * artifact; the gatekeeper requires it (artifact binding).
   */
  artifactHash?: string;
  /** Public inputs in canonical field-element order. */
  publicInputs: Fr[];
  proof: Groth16Proof;
  /** proofHash = keccak256(canonical envelope minus proofHash). */
  proofHash: string;
  /** Optional, informational only; never part of verification. */
  proverTimestamp?: number;
}

/**
 * Envelope signature section (ADR-0009). `value` is the Ed25519 signature
 * over the canonical bytes of the envelope minus this section — i.e.
 * `canonicalize(envelope minus signature)` — so it binds every other field,
 * including `formatVersion` (downgrade-proof) and `proofHash`.
 */
export interface EnvelopeSignature {
  /** Frozen by ADR-0009. */
  algo: SupportedSignatureAlgo;
  /** keyId of the signing key (SHA-256 thumbprint of the public key). */
  keyId: string;
  /** Hex-encoded 64-byte Ed25519 signature. */
  value: string;
  /** Optional signing-key rotation counter (informational). */
  keyVersion?: number;
}

/**
 * The signed on-the-wire proof envelope (ADR-0009). Carries everything v1 has
 * plus a `signature`; `proofHash` is recomputed over the whole v2 envelope
 * (signature included), and the signature covers `proofHash` — mutual binding.
 */
export interface SignedEnvelope {
  formatVersion: 2;
  circuitId: string;
  circuitVersion: string;
  /** keccak256 of the canonical verification key (0x-prefixed 64 hex). */
  vkHash: string;
  /** sha256 of the compiled artifact bundle (see ProofEnvelope.artifactHash). */
  artifactHash?: string;
  /** Public inputs in canonical field-element order. */
  publicInputs: Fr[];
  proof: Groth16Proof;
  /** proofHash = keccak256(canonical envelope minus proofHash). */
  proofHash: string;
  /** Optional, informational only; never part of verification. */
  proverTimestamp?: number;
  signature: EnvelopeSignature;
}

/** Input schema entry in a CircuitManifest (ADR-0007). */export interface CircuitInputSpec {
  id: string;
  type: 'field' | 'u8' | 'u32' | 'u1';
  /** 1 = single value, or the id of another input whose value sets the arity. */
  arity: number | string;
}

export interface CircuitOutputSpec {
  id: string;
  /** `u1` = boolean flag (e.g. isZero); `field` = BN254 field element (e.g. digest). */
  type: 'u1' | 'field';
  arity: number;
}

/**
 * Content-addressed circuit declaration (ADR-0007). `manifestHash` is
 * keccak256(canonical manifest).
 */
export interface CircuitManifest {
  manifestVersion: 1;
  circuitId: string;
  circuitVersion: string;
  scheme: SupportedScheme;
  curve: SupportedCurve;
  inputs: CircuitInputSpec[];
  privateInputs: CircuitInputSpec[];
  outputs: CircuitOutputSpec[];
  artifacts: {
    r1cs: string;
    wasm: string;
    zkey: string;
    vk: { vkHash: string; sha256: string };
  };
  constraints: { estimated: number; max: number };
  compatibility: { minEngine: string; minProofFormat: string };
  manifestHash: string;
}
