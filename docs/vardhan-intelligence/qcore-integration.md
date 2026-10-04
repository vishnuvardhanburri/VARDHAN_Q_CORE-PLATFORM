# Vardhan Intelligence — Q Core Integration

## Purpose

Document the canonical flow from Vardhan Intelligence to Q Core.

## Canonical Flow

```
Vardhan Intelligence
    ↓
Discovery → Correlation → Verification → Confidence Scoring
    ↓
Intelligence Finding
    ↓
VerifiedFindingContract  (formal contract)
    ↓
Trust Boundary (22 checks — both TS and Rust)
    ↓
Q-Core Gateway (HTTP POST /api/v1/seal)
    ↓
Authority / Policy Evaluation
    ↓
Cryptographic Protection
    ↓
Industry Plane
    ↓
Transaction State Machine
    ↓
Secure Execution
    ↓
Signed Receipt (ML-DSA-87 + Ed25519)
    ↓
Ledger (append-only)
    ↓
Independent Verification
```

## Contract: VerifiedFindingContract

The sole interface between Intelligence and Q Core. Defined in:
- TypeScript: `intelligence_plane/src/server/VerifiedFindingContract.ts`
- Rust: `backend/vardhan_receipt/src/main.rs` (`QCoreValidationRequest`)

## Integration Components

| Component | File | Role |
|---|---|---|
| `QCoreIntegrationService` | `QCoreIntegrationService.ts` | HTTP client to Q-Core Gateway |
| `QCoreSubmissionOrchestrator` | `QCoreSubmissionOrchestrator.ts` | Idempotent submission orchestration |
| `VerificationToContractAdapter` | `VerificationToContractAdapter.ts` | Adapts verified finding to contract |
| `TrustBoundaryValidator` | `TrustBoundaryValidator.ts` | 22-check validation before submission |

## Submission Flow

```
FindingVerificationEngine.verify()
  → Finding VERIFIED
  → VerificationToContractAdapter.adapt()
  → VerifiedFindingContract created
  → TrustBoundaryValidator.validate()  [TS, 22 checks]
  → QCoreSubmissionOrchestrator.submitFindings()
      → PersistentIdempotencyStore.check()
      → QCoreIntegrationService.submitFinding()
          → HTTP POST /api/v1/seal
              → TrustBoundaryValidator.validate()  [Rust, 22 checks]
              → GatewayAuthorityEvaluator.evaluate()
              → VardhanTransaction::transition()
              → VardhanSealedReceipt::seal()
              → Audit ledger append
  ← VardhanSealedReceipt (signed)
  ← VardhanVerifier::verify()  [independent verification]
```

## Idempotency

- `PersistentIdempotencyStore` (TypeScript) — file-backed JSON, 0o600 permissions.
- `DurableIdempotencyRegistry` (Rust) — file-based persistence, OS locking.
- Both survive process restart.
- Duplicate submission within TTL → rejected.

## Security Guarantees

1. **No bypass** — TrustBoundaryValidator runs on both sides (TS pre-submit,
   Rust at gateway).
2. **No downgrade** — All 22 checks enforced identically on both sides.
3. **No plaintext keys** — Production requires KMS/HSM KEK (F-001).
4. **No state bypass** — `reject()` routes through `transition()` (F-002).
5. **No hardcoded allowlists** — Externalized to `auth_config.json` (F-003).
6. **No hash truncation** — Full SHA-256 everywhere (F-008).
7. **No canonical payload bypass** — 10-field payload (F-014).

## Failure Behavior

| Failure | Response |
|---|---|
| Trust boundary check fails (TS) | Submission skipped, error logged |
| Trust boundary check fails (Rust) | `VALIDATION_FAILED`, no state transition |
| Authority denied (Rust) | `AUTHORITY_DENIED`, no state transition |
| Idempotency duplicate (Rust) | `DUPLICATE_TRANSACTION`, no new receipt |
| Receipt signing fails | `SEALING_FAILED`, transaction `Failed` |
| Ledger append fails | Panic — ledger integrity is non-negotiable |
| Verifier detects mismatch | Receipt marked `REVOKED`, audit alert |
