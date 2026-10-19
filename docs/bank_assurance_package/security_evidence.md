# VARDHAN Proof-Carrying Migration: Security Evidence Package

## 1. Executive Summary
The Proof-Carrying Migration vertical slice has undergone adversarial verification. All 10 security gates designed to prevent the forging, substitution, or replay of migration proofs were passed.

## 2. Verification Environment
- **Control Plane API**: v1.0.0-beta (Rust)
- **Cryptographic Engine**: `vardhan_verifier` (ML-DSA-87 + Ed25519)
- **Hardware/OS**: Darwin 27.0.0
- **Test Tooling**: `scripts/adversarial_security_test.sh` (Custom Integration Suite)

## 3. Adversarial Test Results
| Test ID | Scenario | Intended Outcome | Result |
|---------|-----------|------------------|--------|
| T1 | Genuine Receipt | Acceptance | PASS |
| T2 | Modified Payload | Rejection | PASS |
| T3 | Invalid Ed25519 | Rejection | PASS |
| T4 | Invalid ML-DSA-87 | Rejection | PASS |
| T5 | Wrong Trusted Key | Rejection | PASS |
| T6 | Subject Substitution | Rejection | PASS |
| T7 | Cross-Tenant Substitution | Rejection | PASS |
| T8 | Trust-service failure | Rejection | PASS |
| T9 | Replay Protection | Rejection | PASS |
| T10 | Lifecycle Integrity | Rejection | PASS |

## 4. Cryptographic Assertions
- **Hybridity**: Every receipt must carry both a classic (Ed25519) and a post-quantum (ML-DSA-87) signature.
- **Binding**: Receipts are bound to a specific `asset_id`.
- **Immutability**: Any modification to the canonical payload invalidates the signature.
- **Rotation**: Session tokens are rotated on every state-changing request.
