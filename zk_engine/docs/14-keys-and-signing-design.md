# 14 — Envelope Signing & Key Management (M2 Implementation Notes)

**Status:** Implemented (M2) · **Date:** 2026-08-08
**Companion docs:** ADR-0009, ADR-0006, ADR-0008, doc 07 (roadmap).

---

## 1. Scope (what M2 shipped)

| Package | Version | Change |
|---|---|---|
| `@zkpe/proof-format` | 0.1.0 → 0.2.0 | Versioned envelope: v1 unsigned + v2 signed (`EnvelopeSignature`, `SignedEnvelope`); version-aware `validateEnvelope`; `signatureInput` canonical helper; `validateSignatureShape` |
| `@zkpe/keys` | 0.1.0 (new) | Ed25519 key lifecycle + envelope signing (ADR-0009) |

## 2. Signed envelope (v2) — binding order

1. `content` = v2 fields minus `proofHash` and `signature`.
2. `proofHash = keccak256(canonical(content))` — binds content.
3. `sigInput = canonical(content + proofHash)` — binds version + hash + content.
4. `signature = Ed25519(sigInput)`.

Verification recomputes (2) excluding the signature section, then checks (3/4)
with the key resolved from `signature.keyId`. Downgrade to v1 is impossible
without invalidating the signature (formatVersion is signed); v1 envelopes
remain structurally valid but are rejected by `requireSigned` policy.

## 3. `@zkpe/keys` public API

- `generateKeyPair()`, `importKeyPair(material)` (private JWK / public JWK /
  PEM dispatch), `importPrivateJwk`, `importPublicJwk`, `privateKeyToPem`,
  `publicKeyToPem`, `importPrivateKeyPem`, `importPublicKeyPem`.
- `computeKeyId(publicJwk)` — SHA-256 RFC 7638 thumbprint, hex.
- `validatePublicJwk` / `validatePrivateJwk` — shape + `d↔x` consistency.
- `KeyRing` — `create`, `addKey`, `rotate`, `setActiveKey`, `remove`,
  `signBytes`, `verifyBytes`, `verifyBytesWithPublicKey`, `list`, `get`,
  `has`, `toJSON`/`fromJSON`, `maxRetainedKeys` eviction.
- `FileKeyStore` — atomic 0600 persistence, permission enforcement.
- `signEnvelope(envelope, material)` / `verifyEnvelope(envelope, verifier,
  {requireSigned})` / `assertEnvelopeSignature`.

## 4. Deterministic serialization

All hashing and signing operate on `@zkpe/proof-format` canonical JSON
(RFC 8785 subset: sorted object keys, integer-only numbers, UTF-8).
Property tests assert that key-order shuffling does not change
`signatureInput`; re-signing the same envelope reproduces the identical
signature (Ed25519 determinism).

## 5. Compatibility & negative coverage

- v1 envelopes still validate under `validateEnvelope`; v1 with a signature
  is rejected; v2 with malformed signatures is rejected.
- Cross-format: sign via keyring → verify via PEM-imported public key.
- Golden vector: fixed key + fixed message reproduces a recorded signature
  that was independently verified with the **openssl CLI**
  (`pkeyutl -verify`, "Signature Verified Successfully").
- Negatives: tampered payloads, mutated signatures, unknown signing keys,
  keyId/public-key mismatch, missing verifier key, downgrade attempts,
  duplicate/inconsistent keys, corrupt keyring JSON, unsafe file
  permissions (0644 → refused).

## 6. Benchmarks (doc 11 M2 targets)

`npm run bench -w @zkpe/keys` → `packages/keys/build/bench-m2.json`:

| metric | measured | budget |
|---|---|---|
| raw sign (Ed25519) | 57,183 ops/s | ≥ 5,000 |
| raw verify (Ed25519) | 24,266 ops/s | ≥ 5,000 |
| envelope sign+verify (v2) | 14,134 ops/s | ≥ 2,000 |
| keyring rotate | 0.065 ms/op | n/a |

## 7. Acceptance evidence (M2 gate)

- `npm run check` green across all four packages (lint + typecheck + tests).
- Envelope round trip + golden vector + all negative tests pass (39 keys
  tests, 35 proof-format tests, plus M0/M1 suites).
- Benchmarks within budget (section 6).

## 8. Deferred (tracked)

- Key export/rotation integration into the CLI (M6) and gatekeeper (M8).
- HSM/secret-store backends for the FileKeyStore (post-v1 hardening).
