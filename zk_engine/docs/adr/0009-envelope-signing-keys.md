# ADR-0009 — Envelope Signing & Key Management

**Status:** Accepted
**Date:** 2026-08-08
**Companion docs:** ADR-0006 (proof format), ADR-0008 (crypto freeze), doc 14
(implementation notes), doc 09 §6 (proof binding).

## Context

The gatekeeper (M8) and API (M5) need to attribute proof submissions to a
prover and detect tampered or re-sent envelopes. Milestone 2 delivers the
cryptographic layer: signed, versioned envelopes and a key lifecycle.

## Decision

### 1. Signature scheme: Ed25519 (RFC 8032)

- Pure Ed25519 via Node's `node:crypto` (no external crypto dependency).
- Deterministic signatures (same envelope + same key → same signature),
  no ECDSA malleability, 64-byte signatures.
- Off-chain integrity only: on-chain trust comes from the Groth16 proof and
  the registry's `vkHash` binding (M4). Ed25519 is never used on-chain.

### 2. Signed envelope format: `formatVersion: 2`

The v1 envelope (ADR-0006) stays as the unsigned format. Signed envelopes add
a `signature` section and are versioned `2`:

```ts
interface EnvelopeSignature {
  algo: 'ed25519';          // frozen here; other algos require reopening
  keyId: string;            // SHA-256 thumbprint of the public JWK, hex
  value: string;            // 64-byte signature, 128 hex chars
  keyVersion?: number;      // rotation counter (informational)
}
```

- `proofHash` = keccak256(canonical envelope minus `proofHash` and minus
  `signature`) — binds the content only.
- The signature is computed over the canonical bytes of the envelope minus
  the `signature` section — binding `formatVersion` (downgrade-proof),
  `proofHash`, and all content. This resolves the mutual-binding circularity.
- Deterministic serialization: proof-format's canonical JSON (RFC 8785
  subset). Field order never affects hashes or signatures.
- Policy: gatekeeper/API contexts MUST require `formatVersion: 2` +
  valid signature (`requireSigned`). v1 is readable for backward
  compatibility only.

### 3. Key ids

`keyId` = SHA-256 of the canonical public JWK (RFC 7638 thumbprint input
order: `kty`, `crv`, `x`), lowercase hex (64 chars). Keys are validated:
`kty=OKP`, `crv=Ed25519`, 32-byte `x` and `d`, and `d` must derive the
claimed `x`.

### 4. Key lifecycle (`@zkpe/keys`)

- **Generation**: Ed25519 via `node:crypto`; JWK primary, PEM (PKCS8/SPKI)
  export/import supported.
- **Rotation**: `KeyRing.rotate()` makes a fresh key active; previous keys
  remain verifiable. History is bounded (`maxRetainedKeys`, default 8);
  the active key is never evicted.
- **Validation**: every import recomputes and cross-checks the keyId,
  rejects duplicates and inconsistent key material, and enforces
  `KeyRing.fromJSON` structural checks on persisted data.
- **Storage**: `FileKeyStore` writes atomically with 0600 permissions and
  refuses to load group/other-accessible files. Private keys NEVER appear in
  logs or artifacts.

### 5. What this ADR does not change

- Envelope hashing stays keccak256; artifact hashing stays SHA-256
  (ADR-0008). No parameter of the proof system or circuits changes.

## Consequences

- `@zkpe/keys@0.1.0` new package; proof-format bumped to 0.2.0 (additive v2
  envelope support, no v1 breakage).
- The gatekeeper predicate becomes: v2 envelope + valid Ed25519 signature by
  an allow-listed keyId + Groth16 verification + vkHash match.
- Reopening this ADR is required before adding ECDSA/other algos, changing
  the keyId scheme, or using signatures on-chain.
