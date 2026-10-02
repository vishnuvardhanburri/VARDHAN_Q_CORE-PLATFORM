/**
 * Normative constants per ADR-0008 (Cryptographic Parameters Freeze).
 */

/** BN254 scalar field order r (Groth16 works in F_r). */
export const BN254_SCALAR_FIELD_ORDER: bigint =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Current version of the proof envelope format (ADR-0006). */
export const PROOF_FORMAT_VERSION = 1 as const;

/**
 * Version of the signed proof envelope format (ADR-0009). Signed envelopes
 * are `formatVersion: 2` and carry a `signature` section; v1 envelopes are
 * readable but MUST NOT be accepted by the gatekeeper (unsigned).
 */
export const SIGNED_FORMAT_VERSION = 2 as const;

/** Supported envelope signature algorithms (ADR-0009): Ed25519 only. */
export const SUPPORTED_SIGNATURE_ALGOS = ['ed25519'] as const;
export type SupportedSignatureAlgo = (typeof SUPPORTED_SIGNATURE_ALGOS)[number];

/** Key ids: 64 lowercase hex chars (SHA-256 thumbprint of the public key). */
export const KEY_ID_PATTERN = /^[0-9a-f]{64}$/;

/** Ed25519 signatures are 64 bytes → 128 lowercase hex chars. */
export const ED25519_SIGNATURE_HEX_PATTERN = /^[0-9a-f]{128}$/;

/** Current version of the circuit manifest format (ADR-0007). */
export const CIRCUIT_MANIFEST_VERSION = 1 as const;

/** Supported proving schemes (scheme-agnostic envelope, ADR-0008). */
export const SUPPORTED_SCHEMES = ['groth16'] as const;
export type SupportedScheme = (typeof SUPPORTED_SCHEMES)[number];

/** Supported curves. */
export const SUPPORTED_CURVES = ['bn254'] as const;
export type SupportedCurve = (typeof SUPPORTED_CURVES)[number];

/** 0x-prefixed 32-byte hex digest (keccak256 or sha256) shape. */
export const HEX_DIGEST_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** SemVer shape. */
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
