# VARDHAN Bank Assurance Trust Pack

## implemented Controls
- **Dual-Signing**: Hybrid PQC/Classic signature requirement for all migration proofs.
- **Proof-Carrying Passports**: Durable records binding discovery through verification.
- **Binding Enforcement**: Cryptographic binding of receipts to specific assets.
- **Session Rotation**: Mandatory token rotation to prevent session hijacking.

## Internal Verification Results
- **Adversarial Suite**: 10/10 gates passed.
- **Reproducibility**: Confirmed via `adversarial_security_test.sh`.

## Outstanding Requirements for Production
- **Hardware Security Modules (HSM)**: Integration of signing keys into FIPS 140-2 Level 3 HSMs.
- **Distributed Ledger**: Migration of the `Sled` DB to a distributed, immutable ledger for audit.
- **Independent Audit**: Completion of the scope defined in `assessment_scope.md`.

## Limitations
- Current implementation uses a local Sled database for the trust registry.
- The `vardhan_verifier` is implemented in the same repository as the API (though in a separate crate).
