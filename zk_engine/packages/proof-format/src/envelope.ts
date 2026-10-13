import {
  ED25519_SIGNATURE_HEX_PATTERN,
  HEX_DIGEST_PATTERN,
  KEY_ID_PATTERN,
  PROOF_FORMAT_VERSION,
  SEMVER_PATTERN,
  SIGNED_FORMAT_VERSION,
  SUPPORTED_SIGNATURE_ALGOS,
} from './constants.js';
import { canonicalize } from './canonical.js';
import { keccak256Utf8 } from './hash.js';
import { isValidFieldElement } from './field.js';
import type { EnvelopeSignature, ProofEnvelope, Groth16Proof, SignedEnvelope } from './types.js';

/**
 * proofHash = keccak256(canonical(envelope minus proofHash)).
 * Deterministic; binds circuitId, vkHash, artifactHash, publicInputs and
 * proof (doc 09 §6). For signed envelopes the `signature` section is
 * excluded — proofHash binds the content, and the signature (computed over
 * the envelope minus signature, proofHash included) binds the formatVersion
 * + proofHash + content.
 */
export function computeProofHash(
  envelope: Omit<ProofEnvelope, 'proofHash'> | Omit<SignedEnvelope, 'proofHash' | 'signature'>,
): string {
  return keccak256Utf8(canonicalize(envelope as unknown));
}

/**
 * Deterministic signature input (ADR-0009): the canonical bytes of a signed
 * envelope minus its `signature` section. The signature covers every other
 * field — including `formatVersion` (prevents downgrade to v1) and
 * `proofHash`.
 */
export function signatureInput(envelope: unknown): string {
  const e = envelope as Record<string, unknown>;
  const { signature: _omitted, ...rest } = e;
  return canonicalize(rest);
}

/** Build an envelope from parts and compute its proofHash. */
export function createEnvelope(
  parts: Omit<ProofEnvelope, 'formatVersion' | 'proofHash'>,
): ProofEnvelope {
  const { proverTimestamp, ...rest } = parts;
  const withoutHash: Omit<ProofEnvelope, 'proofHash'> =
    proverTimestamp === undefined ? { formatVersion: PROOF_FORMAT_VERSION, ...rest } : { formatVersion: PROOF_FORMAT_VERSION, ...rest, proverTimestamp };
  return { ...withoutHash, proofHash: computeProofHash(withoutHash) };
}

function isValidFrArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isValidFieldElement);
}

/** Validate the Groth16 proof coordinate shape (not the pairing). */
export function isValidProofShape(proof: unknown): proof is Groth16Proof {
  if (typeof proof !== 'object' || proof === null) return false;
  const p = proof as Record<string, unknown>;
  return (
    isValidFrArray(p['pi_a']) && p['pi_a']?.length === 3 &&
    Array.isArray(p['pi_b']) && p['pi_b'].length === 3 &&
    p['pi_b'].every(
      (row) => isValidFrArray(row) && (row as string[]).length === 2,
    ) &&
    isValidFrArray(p['pi_c']) && p['pi_c']?.length === 3
  );
}

/**
 * Structural validation of an envelope (v1 unsigned or v2 signed).
 * Returns a list of errors (empty = valid). Does NOT cryptographically verify
 * the proof or the signature; use the engine verifier and @zkpe/keys for that.
 */
export function validateEnvelope(value: unknown): string[] {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null) {
    return ['envelope must be an object'];
  }
  const e = value as Record<string, unknown>;

  const version = e['formatVersion'];
  if (version !== PROOF_FORMAT_VERSION && version !== SIGNED_FORMAT_VERSION) {
    errors.push(`formatVersion must be ${PROOF_FORMAT_VERSION} or ${SIGNED_FORMAT_VERSION}`);
  }
  if (typeof e['circuitId'] !== 'string' || e['circuitId'].length === 0) {
    errors.push('circuitId must be a non-empty string');
  }
  if (typeof e['circuitVersion'] !== 'string' || !SEMVER_PATTERN.test(e['circuitVersion'])) {
    errors.push('circuitVersion must be semver');
  }
  if (typeof e['vkHash'] !== 'string' || !HEX_DIGEST_PATTERN.test(e['vkHash'])) {
    errors.push('vkHash must be 0x-prefixed 32-byte hex');
  }
  if (e['artifactHash'] !== undefined && (typeof e['artifactHash'] !== 'string' || !HEX_DIGEST_PATTERN.test(e['artifactHash']))) {
    errors.push('artifactHash, if present, must be 0x-prefixed 32-byte hex');
  }
  if (!isValidFrArray(e['publicInputs'])) {
    errors.push('publicInputs must be an array of canonical field elements');
  }
  if (!isValidProofShape(e['proof'])) {
    errors.push('proof must be a well-formed Groth16 proof');
  }
  if (typeof e['proofHash'] !== 'string' || !HEX_DIGEST_PATTERN.test(e['proofHash'])) {
    errors.push('proofHash must be 0x-prefixed 32-byte hex');
  }
  if (e['proverTimestamp'] !== undefined && typeof e['proverTimestamp'] !== 'number') {
    errors.push('proverTimestamp, if present, must be a number');
  }

  const signature = e['signature'];
  if (version === SIGNED_FORMAT_VERSION) {
    const sigErrors = validateSignatureShape(signature);
    if (sigErrors.length > 0) {
      errors.push(...sigErrors);
    }
  } else if (signature !== undefined) {
    errors.push('unsigned envelopes (formatVersion 1) must not carry a signature');
  }

  if (errors.length === 0) {
    const { proofHash: _omitted, signature: _sigOmitted, ...withoutHash } = e;
    const recomputed = computeProofHash(
      withoutHash as unknown as Omit<ProofEnvelope, 'proofHash'>,
    );
    if (recomputed !== e['proofHash']) {
      errors.push('proofHash does not match canonical envelope contents');
    }
  }
  return errors;
}

/** Validate the structural shape of the signature section (not the crypto). */
export function validateSignatureShape(value: unknown): string[] {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null) {
    return ['signature must be an object'];
  }
  const s = value as Record<string, unknown>;
  if (typeof s['algo'] !== 'string' || !(SUPPORTED_SIGNATURE_ALGOS as readonly string[]).includes(s['algo'])) {
    errors.push(`signature.algo must be one of ${SUPPORTED_SIGNATURE_ALGOS.join(', ')}`);
  }
  if (typeof s['keyId'] !== 'string' || !KEY_ID_PATTERN.test(s['keyId'])) {
    errors.push('signature.keyId must be a 64-char lowercase hex key id');
  }
  if (typeof s['value'] !== 'string' || !ED25519_SIGNATURE_HEX_PATTERN.test(s['value'])) {
    errors.push('signature.value must be a 128-char lowercase hex Ed25519 signature');
  }
  if (s['keyVersion'] !== undefined && typeof s['keyVersion'] !== 'number') {
    errors.push('signature.keyVersion, if present, must be a number');
  }
  return errors;
}

/** Type guard for a structurally valid signature section. */
export function isValidSignatureShape(value: unknown): value is EnvelopeSignature {
  return validateSignatureShape(value).length === 0;
}
