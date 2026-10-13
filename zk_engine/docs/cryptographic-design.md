# Cryptographic Design & Specification

This document details the cryptographic principles, zero-knowledge proving system parameters, and field arithmetic specifications enforced by `zk-proof-engine`.

---

## 1. Proving System & Primitive Selection

| Primitive | Specification | Standard / Reference |
|---|---|---|
| **Proving System** | Groth16 (circom 2 / snarkjs) | [Groth16 paper](https://eprint.iacr.org/2016/260.pdf) |
| **Elliptic Curve** | BN254 (alt_bn128) | EIP-196 / EIP-197 EVM precompiles |
| **Field Modulus ($r$)** | `21888242871839275222246405745257275088548364400416034343698204186575808495617` | BN254 Scalar Field |
| **Base Field Modulus ($q$)** | `21888242871839275222246405745257275088696311157297823662689037894645226208583` | BN254 Base Field |
| **Hash Function (Circuit)** | Poseidon (T3, T4 for BN254) | Circomlib Poseidon implementation |
| **Hash Function (Envelope)**| SHA-256 / Keccak-256 | FIPS 180-4 / Ethereum standard |

---

## 2. Envelope Canonicalization & Field Validation

To prevent malleability and field overflow vulnerabilities:

1. **Scalar Range Bounds:** Every public input field element $x$ MUST satisfy $0 \le x < r$. Input strings exceeding the scalar field modulus are rejected at parsing time before entering the witness calculator.
2. **Canonical Serialization:** All proof payloads serialize into deterministic JSON (`zk-proof/v1` and `zk-proof/v2` schemas) with sorted keys, unpadded hex strings, and standard field name ordering.
3. **Verification Key Binding (`vkHash`):** Verification keys are hashed using `keccak256(canonical(VK))`. The engine and API verify that `proof.vkHash` matches the certified registry `vkHash` before processing pairing equations.

---

## 3. Cryptographic Security Level & Trade-offs

- **Bits of Security:** BN254 pairing-friendly curve provides $\approx 100$ bits of security under modern NFS discrete log attacks.
- **EVM Alignment:** BN254 is natively accelerated via Ethereum precompiles (`0x06`, `0x07`, `0x08`), making on-chain verification gas-efficient (~200k gas).
- **Future Migration:** A universal setup migration path to Plonk/Halo2 (128-bit+ security) is planned in the [ROADMAP.md](../ROADMAP.md).

---

## Related Specifications
- [Proof Envelope Format (09-proof-specification.md)](09-proof-specification.md)
- [Cryptographic Design Review (12-crypto-design-review.md)](12-crypto-design-review.md)
- [Trusted Setup Plan (21-trusted-setup-plan.md)](21-trusted-setup-plan.md)
