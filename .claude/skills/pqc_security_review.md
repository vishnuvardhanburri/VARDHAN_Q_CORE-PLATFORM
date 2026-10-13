---
name: pqc-security-review
description: Expert review of post-quantum cryptographic implementations and trust boundaries.
---

# Post-Quantum Security and Cryptographic Review Skill

## Scope
Review and validation of ML-KEM, ML-DSA, Ed25519, and the overall trust fabric (receipts, passports, and seals).

## Mandatory Checks
- **Algorithm Correctness**: 
    - `ML-KEM` $\rightarrow$ Key Encapsulation only (not direct encryption).
    - `ML-DSA` $\rightarrow$ Digital Signatures only.
- **Trust Boundaries**: Verify that the `vardhan_verifier` does not rely on the `control_plane_api` for authenticity; it must be independently verifiable.
- **Failure Modes**: Check for "fail-open" behavior. If a signature check fails, the system MUST reject the transition/action.
- **Replay Defense**: Ensure every receipt/passport event has a unique identifier and timestamp checked against a sliding window.

## Failure Conditions
- Using a classical algorithm where a PQC algorithm is mandated.
- Allowing a state transition in the `MigrationPassport` without a valid `VQR-` receipt.
- Hardcoding public keys instead of using a managed `ReceiptKeyRegistry`.

## Review Workflow
1. **Inspect**: Examine the `payload_hash` generation in `vardhan_verifier`.
2. **Validate**: Cross-reference the used algorithms against FIPS 203/204 standards.
3. **Test**: Attempt to modify a single byte in a sealed receipt and confirm `vardhan_verifier` returns `Invalid`.
