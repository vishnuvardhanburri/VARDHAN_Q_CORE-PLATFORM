# Technical Architecture and Data-Flow Overview: Vardhan Q Core

## 1. High-Level Data Flow
`Intelligence Plane` $\rightarrow$ `Control Plane (Q Core)` $\rightarrow$ `Evidence Ledger` $\rightarrow$ `Independent Verifier`.

### The "Proof-Carrying" Chain
1. **Observation**: Intelligence Plane detects a vulnerable RSA-2048 key.
2. **Assessment**: Risk Engine classifies the asset and recommends `ML-DSA-87`.
3. **Blueprint**: Blueprint Engine generates a migration plan.
4. **Authorization**: Q Core evaluates the plan against Bank Policy $\rightarrow$ Issues a Signed Receipt.
5. **Execution**: System applies the change $\rightarrow$ Captures pre/post state hashes.
6. **Verification**: `vardhan_verifier` checks the Receipt + Execution Evidence $\rightarrow$ Marks Migration as `INDEPENDENTLY_VERIFIED`.

## 2. Trust Boundaries
- **Intelligence Boundary**: The Intelligence Plane is treated as "untrusted" input. No change is executed based on a finding alone.
- **Authorization Boundary**: Only the `authority_gate` can sign a `VQR-` receipt.
- **Verification Boundary**: The `vardhan_verifier` is a standalone binary that does not require network access to the Control Plane to validate a receipt.

## 3. Data Model: The Quantum Migration Passport
The Passport is the durable record of the migration.
- **Passport ID**: Unique UUID.
- **Evidence Chain**: A sequence of linked receipts and hashes.
- **Final State**: `INDEPENDENTLY_VERIFIED`.

## 4. Deployment Model
- **Air-Gapped Support**: All core cryptographic operations are local.
- **Tenant Isolation**: Sled DB keys are prefixed by `org:`, ensuring logical isolation between different bank business units.
- **Key Ownership**: Support for bank-managed KEKs (Key Encryption Keys) via the `EnvelopeProtectionProvider`.
