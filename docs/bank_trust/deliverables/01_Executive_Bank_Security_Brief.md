# Executive Bank Security Brief: Vardhan Q Core

## Overview
Vardhan Q Core provides a high-assurance, post-quantum security control plane designed specifically for regulated financial institutions. Unlike traditional security tools that rely on "trust-the-vendor" models, Vardhan implements a **Proof-Carrying Security** architecture.

## The Core Value Proposition: Trust via Evidence
Banks do not need to trust Vardhan. They only need to trust the cryptographic evidence produced by the system.

1. **Independent Verification**: Every security decision (e.g., "This migration is safe") is issued as a dual-signed receipt (ML-DSA-87 + Ed25519). These receipts can be verified independently of the Vardhan platform using the `vardhan_verifier` tool.
2. **Honest Migration Lifecycle**: Cryptographic assets (RSA, ECDSA) are migrated to PQC standards via a strict state machine (Discovered $\rightarrow$ Assessed $\rightarrow$ Authorized $\rightarrow$ Verified). No state can be reached without the prerequisite cryptographic proof.
3. **Quantum-Resilient Key Establishment**: Using the **AER-KEP-Q** protocol, the system ensures that key establishment is resilient to exposure and supports automatic quarantine and reissue.

## Security Controls Summary
| Control | Implementation | Bank-Controlled Evidence |
|---|---|---|
| **Authorization** | Policy-based gatekeeping | Signed `VQR-` receipts |
| **Integrity** | BLAKE3 Hash Chaining | Append-only audit ledger |
| **PQC Standards** | ML-KEM-1024, ML-DSA-87 | FIPS 203/204 compliant |
| **Deployment** | On-Premise / Air-Gapped | Bank-owned KEKs / HSMs |
| **Verification** | `vardhan_verifier` binary | Independent validation results |

## Conclusion
Vardhan reduces the systemic risk of the "Quantum Harvest" (Store Now, Decrypt Later) by providing a verifiable, governed path to post-quantum agility without introducing new, untrusted dependencies into the bank's core infrastructure.
