# Runtime Health & Errors

## Health Check Points

| Component | Check | Frequency | Failure Mode |
|---|---|---|---|
| `vardhan-receipt` (Q-Core Gateway) | Process alive on port 8080 | Continuous | Port not listening → immediate alert |
| `vardhan-receipt` keystore | Keys loadable from KMS/HSM | Startup | Missing `VARDHAN_PRODUCTION_KEK` → panic (fail-closed) |
| `vardhan-receipt` auth config | `auth_config.json` present and valid | Startup | Missing config → fail-closed deny |
| `core_crypto` anti-tamper | Binary hash matches `VARDHAN_BINARY_HASH` | Startup | Mismatch → exit 137 |
| `core_crypto` AER-KEP-Q | Epoch is current, no exposure | Per-operation | Exposure → quarantine + rotation |
| `ha_cluster` | Epoch validation | Continuous | Stale epoch → reject |
| `intelligence_plane` | Script exit code | Per-run | Non-zero → investigate |

## Error Classification

### CRITICAL (immediate intervention)

| Error | Component | Condition |
|---|---|---|
| `KeyProtectionError::NoProductionKeyProvider` | vardhan_keystore | Production startup without KMS/HSM KEK |
| `assert_integrity() exit 137` | core_crypto | Production binary hash mismatch |
| `TransactionError::AlreadyTerminal` | vardhan_transaction | Attempt to transition from terminal state |
| `AuthConfigError::ProductionRequiresConfig` | vardhan_receipt | Production without auth_config.json |
| `DuplicateDetected` | vardhan_idempotency | Duplicate transaction within TTL (expected behavior, not an error) |

### HIGH (within-run intervention)

| Error | Component | Condition |
|---|---|---|
| `TrustBoundaryError` | TrustBoundaryValidator (TS + Rust) | Contract fails any of 22 checks |
| `PolicyDenied` | GatewayAuthorityEvaluator | Unauthorized tenant/policy/actor |
| `InvalidTransition` | VardhanTransaction | Invalid state transition |
| `DecapsulationFailed` | core_crypto | ML-KEM decapsulation failure |
| `SignatureVerificationFailed` | VardhanVerifier | ML-DSA-87 or Ed25519 verification failure |

### MEDIUM (log + alert)

| Error | Component | Condition |
|---|---|---|
| `ExposureDetected` | ExposureDetector | Public exposure of cryptographic material |
| `HistoricalEvidence` | TrustBoundaryValidator | Evidence with HISTORICAL temporal status |
| `StaleObservation` | FreshnessEngine | Observation older than freshness threshold |
| `ContradictionDetected` | DifferentialFindingEngine | Contradictory evidence in finding |

### LOW (log only)

| Error | Component | Condition |
|---|---|---|
| `LowConfidence` | ConfidenceScoringEngine | Finding confidence below threshold |
| `MissingField` | TrustBoundaryValidator | Non-critical optional field missing |
| `Retryable` | HTTP client | Transient network error (retries with backoff) |

## Error Handling Patterns

### Fail-Closed Defaults

All security-critical components default to denial:

- **Trust Boundary:** `TrustBoundaryValidator.validate()` returns `{ passed: false }`
  if any check fails. No partial passes.
- **Authority:** `GatewayAuthorityEvaluator.evaluate()` returns `DENY` for any
  unknown tenant, policy, action, or actor.
- **State Machine:** `VardhanTransaction::transition()` returns
  `Err(InvalidTransition)` for disallowed state pairs.
- **Binary Integrity:** `anti_tamper::assert_integrity()` exits with code 137
  in production if `VARDHAN_BINARY_HASH` is not set.
- **Key Protection:** `EnvironmentKeyProtectionProvider::select()` panics in
  production if no KMS/HSM provider is configured.

### Error Propagation

```
Rust: Result<T, Error> returned from all critical functions
TS: throws TrustBoundaryError / QCoreValidationError
```

### Logging Discipline

- **Never log:** Private keys, KEKs, raw evidence content, authentication
  tokens, session keys, ML-DSA/Ed25519 private key bytes.
- **Always log:** Correlation IDs, event types, timestamps, severity levels,
  component names, actor identities (prefix only).
- **Structured logging:** `tracing` crate (Rust), JSON log format in production.
