# Runtime Status

**Branch:** `main`

## Architecture
- **Vardhan Intelligence:** discovery, collection, normalization, entity resolution, enrichment, correlation, verification, scoring, and delivery.
- **Vardhan Q Core:** trust boundary, authority, policy, transaction execution, cryptographic security, receipts, ledger, and independent verification.
- **PQ/Quantum security is a Q Core capability**, including ML-KEM-1024, ML-DSA-87, and AER-KEP-Q.
- Seven industry planes are implemented as Q Core domain capabilities, not separate products.

## Verified Engineering Capabilities
- Intelligence → Q Core `VerifiedFindingContract` integration.
- 22-check trust-boundary validation.
- Receipt signing, authority evaluation, transaction state machine, ledger, and independent verification.
- AER-KEP-Q authenticated epoch lifecycle, exposure quarantine, fresh-epoch recovery, replay protection, and HA descriptor validation.
- Restart-safe runtime state and durable idempotency.
- Linux eBPF production path with userspace/kernel ABI alignment.

## Security Limits
- Full-state exposure does not provide retroactive protection for ciphertexts created under the exposed epoch.
- No complete QROM proof is claimed for AER-KEP-Q.
- Production HSM/KMS persistence and deployment-specific HA transport remain deployment/assurance work.
- Independent external security review and certification are not implied by repository CI.

## CI Truth
GitHub Actions is the authoritative repository build/test status. This document must not claim a workflow is green unless the corresponding workflow run has been independently verified.
