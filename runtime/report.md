# Runtime Report

## Current Architecture

Vardhan Technologies operates as two integrated pillars:

1. **Vardhan Intelligence** — external/internal intelligence, discovery, normalization, entity resolution, enrichment, correlation, verification, scoring, and `VerifiedFindingContract` delivery.
2. **Vardhan Q Core** — trust boundary, authority, policy, transaction execution, PQ/quantum security, AER-KEP-Q, key lifecycle, receipts, ledger, and independent verification.

The seven industry planes and PQ/quantum capabilities are Q Core capabilities, not separate products.

## Runtime Security Boundary

- Intelligence findings enter Q Core through the canonical `VerifiedFindingContract`.
- Q Core validates the trust boundary before authority and transaction execution.
- Existing receipt signing, authority, ledger, and independent-verification paths remain protected.
- AER-KEP-Q authenticates epoch descriptors, quarantines exposed epochs, and establishes fresh epochs after exposure.

## eBPF Runtime Contract

- Kernel XDP program: `vardhan_firewall`.
- Peer allowlist map: `ALLOWED_PEERS` with IPv4 `u32` keys and `u32` values.
- Object path is configurable through `EBPF_OBJECT_PATH`.
- Network interface is configurable through `EBPF_INTERFACE`.

## Security Limits

- Full-state exposure does not provide retroactive protection for ciphertexts created under an exposed epoch.
- No complete QROM proof is claimed for AER-KEP-Q.
- HSM/KMS persistence, deployment-specific HA transport, and independent external assurance remain deployment/assurance work.
- CI success is build/test evidence, not a security certification.
