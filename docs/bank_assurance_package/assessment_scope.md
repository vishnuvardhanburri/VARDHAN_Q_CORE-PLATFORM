# External Assessment Scope: Bank Trust Architecture

This document defines the boundaries for the independent third-party cryptographic audit.

## 1. Cryptographic Verification
- Audit the `vardhan_verifier` implementation.
- Verify that the ML-DSA-87 and Ed25519 implementations follow FIPS 204 and RFC 8032.
- Confirm that the canonical payload encoding is deterministic.

## 2. Trust-Key Management
- Review the `qcore:issuer-key` registry mechanism.
- Assess the security of the public key distribution channel.
- Verify that unauthorized keys cannot be injected into the trusted store.

## 3. Tenant and Asset Isolation
- Validate that `tenant_id` and `subject_id` checks are enforced before signature verification.
- Confirm that there are no "cross-talk" vulnerabilities between organizations.

## 4. Lifecycle and Replay Protection
- Audit the state transition logic in `passport_api.rs`.
- Verify that state-changing transitions are idempotent and protected against replay.
- Confirm that read-only verification does not advance the lifecycle state.
