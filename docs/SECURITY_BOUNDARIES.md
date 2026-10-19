# VARDHAN Q-Core Security Boundaries & Lab State

## 1. Receipt State Lifecycle
The system enforces a strict state machine for cryptographic proofs. A proof is only authoritative when it has transitioned through these states:

- **SEALED**: The Q-Core Gateway has validated the Finding Contract against the Policy Registry and applied a dual-signature. It is now cryptographically immutable.
- **VERIFIED**: An independent verifier (e.g., `vardhan-receipt verify`) has validated the dual-signatures and canonical payload hash against the public key registry.
- **PUBLISHED**: The receipt has been committed to the durable ledger/transport. 

*Note: In the current Lab Release, "PUBLISHED" is simulated via a bypass to avoid infrastructure dependencies, but the "SEALED" and "VERIFIED" states are cryptographically real.*

## 2. Key Custody & Trust Root
- **Lab State**: Keys are stored in a local keystore managed by the  binary.
- **Production Requirement**: Keys must be migrated to a Hardware Security Module (HSM) or a Cloud KMS (AWS KMS / Azure Key Vault).
- **Root of Trust**: The Trust Root is the public key fingerprint of the Q-Core Issuer, which is embedded in the Verifier.

## 3. Tenant Isolation
- **Mechanism**: The `TenantRegistry` loads a restricted allowlist from `auth_config.json`.
- **Enforcement**: Every request is checked for `tenant_id` registration. Any unknown tenant is immediately rejected with `DENY_TENANT_UNKNOWN`.
- **Cross-Tenant Boundary**: The system prevents one tenant from sealing findings for another.

## 4. Known Limitations (Lab Release)
- **Transport**: Real network transport is bypassed in the lab demo.
- **Hypothesis vs. Fact**: The "Standard Chartered" exposure used in the vertical slice is a candidate hypothesis for demonstration; it is not a confirmed vulnerability.
- **MFA**: MFA is currently optional and not enabled by default in the lab binary.
