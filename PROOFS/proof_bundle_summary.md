# VARDHAN Q-Core Lab Release Proof Bundle

## 1. Reproducibility Evidence
- **Commit SHA**: 99d284ea48923b702bdb7ac351eab4bbfb656647
- **Vertical Slice Trace**: `PROOFS/vertical_slice_trace.log`
- **E2E Validation Trace**: `PROOFS/e2e_validation_trace.log`
- **Latest Verified Receipt**: Receipt ID: VQR-2411a7ae-3526-42b8-b941-4a269e13cc19

## 2. Adversarial Validation (Fails-Closed)
The system was tested against the following attack vectors:

| Vector | Result | Evidence |
|---|---|---|
| Replay Attack | ✅ REJECTED | `PROOFS/adversarial_trace.log` |
| Unknown Tenant | ✅ REJECTED | `PROOFS/adversarial_trace.log` |
| Unauthorized Actor | ✅ REJECTED | `PROOFS/adversarial_trace.log` |

## 3. Cryptographic Integrity
- **Signatures**: Dual-signed with Ed25519 and ML-DSA-87.
- **Canonicalization**: Strict `length:value|` pattern.
- **Hashing**: BLAKE3 used for payload and fingerprints.
- **Verifier**: Rust-based `vardhan-receipt verify` passed 19 critical checks.

## 4. Deployment Assumptions
- **Env**: Lab demo (transport bypassed).
- **Auth**: Externalized via `auth_config.json`.
- **Identity**: Workload-based identity prefixes.
