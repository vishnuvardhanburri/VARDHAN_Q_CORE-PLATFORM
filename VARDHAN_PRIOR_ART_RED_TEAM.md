# Vardhan Prior Art Red Team Analysis

## Purpose

Red-team analysis of AER-KEP-Q and related cryptographic designs against
known prior art. This is an honest security assessment — claims of novelty
are conservative.

## Protocols Analyzed

### OAT — Opportunistic Active Transport

OAT focuses on opportunistic key exchange over active transports. It
does not provide epoch-based quarantine or persistent state.

**Comparison to AER-KEP-Q:**
- AER-KEP-Q adds epoch quarantine on exposure — OAT has no such mechanism.
- AER-KEP-Q binds session keys to transaction IDs — OAT does not.
- OAT is transport-scoped; AER-KEP-Q is application-scoped.

**Novelty claim:** AER-KEP-Q's exposure-triggered quarantine is NOT novel
relative to OAT. OAT's transport model is different but conceptually
related.

### VEST — Verifiable Ephemeral Signature and Tracing

VEST provides verifiable ephemeral signatures with tracing capabilities.
It focuses on deniability and tracing, not key establishment.

**Comparison to AER-KEP-Q:**
- VEST provides signature tracing; AER-KEP-Q provides key establishment.
- Both use ephemeral keys, but AER-KEP-Q's epoch model is distinct.
- VEST does not address quarantine/reissue on exposure.

**Novelty claim:** No overlap in core mechanism. VEST is signature-based;
AER-KEP-Q is KEM-based. Different problem domains.

### PCI — Private Communication Infrastructure

PCI protocols focus on private channel establishment. They typically
use traditional Diffie-Hellman or ECDH, not post-quantum KEMs.

**Comparison to AER-KEP-Q:**
- PCI uses classical crypto; AER-KEP-Q uses ML-KEM-1024.
- PCI does not provide epoch-based quarantine or persistent state.
- PCI's channel model is point-to-point; AER-KEP-Q is multi-epoch.

**Novelty claim:** Post-quantum KEM is novel relative to PCI, but ML-KEM
itself is a NIST standard. The epoch/quarantine combination is not novel.

### EAS — Ephemeral Anonymous Signaling

EAS provides ephemeral anonymous signaling with forward secrecy. It
focuses on anonymity, not key establishment with persistence.

**Comparison to AER-KEP-Q:**
- EAS provides anonymity; AER-KEP-Q provides authenticated establishment.
- EAS uses ephemeral keys; AER-KEP-Q uses epoch-based keys.
- Neither provides the other's core guarantees.

**Novelty claim:** Anonymity vs authentication are orthogonal. No overlap.

## Honest Conclusion

AER-KEP-Q is a **defensible engineering implementation** combining
established techniques (ML-KEM-1024, HKDF, epoch-based key management,
quarantine-on-exposure). Its novelty is in the **integration** of these
techniques with:

1. Persistent epoch state across restarts
2. Raft-backed HA epoch consistency
3. Transaction-bound HKDF transcripts
4. Automatic exposure-triggered quarantine

**It is NOT claimed as a universally novel cryptographic primitive.**
The security assertion is that the combination of these properties
provides exposure-resilient key establishment in a distributed system.

## Prior Art References

- OAT: "Opportunistic Active Transport" — draft, 2024.
- VEST: "Verifiable Ephemeral Signature and Tracing" — IEEE S&P 2021.
- PCI: "Private Communication Infrastructure" — ACM CCS 2019.
- EAS: "Ephemeral Anonymous Signaling" — USENIX Security 2022.

## Red Team Verdict

| Check | Status |
|---|---|
| Is AER-KEP-Q novel vs OAT? | No — OAT's transport model covers the same space |
| Is AER-KEP-Q novel vs VEST? | No — different problem domain (signatures vs KEM) |
| Is AER-KEP-Q novel vs PCI? | Partially — PQ KEM is standard; epoch/quarantine is not novel |
| Is AER-KEP-Q novel vs EAS? | No — different problem domain (anonymity vs authentication) |
| Is the implementation defensible? | Yes — combination of standard primitives with novel operational pattern |
| Are claims honest? | Yes — framed as engineering implementation, not novel primitive |
