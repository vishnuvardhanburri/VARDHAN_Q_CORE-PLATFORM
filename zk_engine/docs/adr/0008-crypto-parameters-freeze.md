# ADR-0008 — Cryptographic Parameters Freeze

**Status:** Accepted
**Date:** 2026-08-07

## Context
The Cryptographic Design Review (doc 12) freezes cryptographic decisions before any
crypto code is implemented. This ADR records the freeze; reopening requires the CRD
procedure (12 §5).

## Decision — frozen parameters

| Parameter | Value |
|-----------|-------|
| Proving scheme | Groth16 |
| Curve | BN254 (alt_bn128) |
| Proof size (on-chain) | 3 elements: G1·2 + G2·1 (≈128 B) |
| Scalar field | BN254 r = 21888242871839275222246405745257275088548364400416034343698204186575808495617 |
| Setup regimes | dev weak-PTau 2^12 (hash-verified); prod community ceremony (DEBT-1) |
| Envelope hashing | keccak256 over canonical JSON (doc 09 §6) |
| Artifact hashing | SHA-256 (r1cs, wasm, zkey, vk) |
| Circuit-internal hash | Poseidon (v1 circuits, M1) |
| Registry binding | status keyed `(circuitId, publicInputHash)`, `publicInputHash = keccak256(abi.encode(uint256[] public inputs))`; append-only leaf `proofHash = keccak256(abi.encode(circuitId, vkHash, publicInputs, A, B, C))` (ZKVerifierRegistry.sol) |
| Verify gas budget | ≤ 250 k gas (targets: doc 11) |
| v1 circuit set | poseidon-preimage@1, merkle-inclusion@1 |

## Amendment 1 (2026-08-08, M1)

The v1 circuit set is implemented as `poseidon-preimage@1` (Poseidon-2
preimage, 240 constraints) and `merkle-inclusion@1` (height-4 Poseidon-2
membership, 974 constraints). The originally planned `sha256-preimage@1` is
deferred to v2: the only usable circom binaries in this environment
(unofficial v2.1.9 / v2.2.1, committed under `.tools/`) miscompile circomlib
2.0.5 `sha256.circom` (invalid padding wiring; see docs/13 §3). No
cryptographic parameter changes otherwise — this amendment only records the
circuit-name change and the deferral. Reopen CRD before adding SHA-256
in-circuit.

## Consequences
- Any change to this table requires reopening CRD and re-reviewing docs 04/08/09/11.
- M1+ code must reference these constants (proof-format exposes the field order).
- The scheme-agnostic envelope keeps future PLONK/Halo2 backends possible without
  changing this ADR's scope (ADR-0007 isolation).