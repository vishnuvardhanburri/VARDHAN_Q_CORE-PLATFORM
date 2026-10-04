# Runtime Tests

## Required CI

- Rust workspace build/test (`cargo test --workspace`)
- Intelligence Plane typecheck (`npx tsc -p tsconfig.xavira.json --noEmit`)
- Intelligence Plane tests (`npx tsx tests/trust_boundary.test.ts && npx vitest run`)
- ZK engine build (`pnpm --filter @proofcraft/zk-engine-* build`)
- Linux eBPF build (Linux only)
- Supply-chain: `cargo audit`, `cargo deny check advisories`, SBOM check

## AER-KEP-Q Coverage

- ML-KEM session derivation
- transcript/domain/epoch/message binding
- replay rejection
- descriptor signature verification
- quarantine invalidation
- fresh epoch recovery
- stale epoch rejection
- future epoch rejection
- conflicting same-epoch descriptor rejection
- duplicate descriptor idempotency
- rollback rejection

## Trust Boundary Coverage (22 checks — TS + Rust)

| # | Check | TS Code | Rust Message |
|---|---|---|---|
| 1 | Schema version valid | SCHEMA_VERSION_MISMATCH | Invalid schema_version |
| 2 | Finding ID present | MISSING_FINDING_ID | finding_id must not be empty |
| 3 | Organization ID present | MISSING_ORGANIZATION_ID | organization_id must not be empty |
| 4 | Canonical URL present | MISSING_RESOURCE_URL | canonical_url must not be empty |
| 5 | Evidence refs non-empty | NO_EVIDENCE | evidence_refs must not be empty |
| 6 | Evidence resolvable | UNRESOLVABLE_EVIDENCE | N/A (TS has evidence store) |
| 7 | Temporal status current | HISTORICAL_EVIDENCE | Historical evidence rejected |
| 8 | Content hash valid | EVIDENCE_HASH_MISMATCH | Invalid evidence content_hash |
| 9 | Content hash is SHA-256 hex | (same as above) | must be 64-char hex |
| 10 | Contradictory evidence field present | MISSING_CONTRADICTION_FIELD | Contradictory evidence present |
| 11 | Differential state valid | INVALID_DIFFERENTIAL_STATE | must be CONFIRMED_MISMATCH |
| 12 | Materiality not NONE | INSUFFICIENT_MATERIALITY | must be HIGH, MEDIUM, or LOW |
| 13 | Provenance chain complete | INCOMPLETE_PROVENANCE_CHAIN | expectation_id missing |
| 14 | Authorization context present | MISSING_AUTHORIZATION_CONTEXT | requires authorized_by |
| 15 | Engine ID present | MISSING_ENGINE_ID | intelligence engine_id empty |
| 16 | Canonical domain present | MISSING_CANONICAL_DOMAIN | canonical_domain must not be empty |
| 17 | Entry point ID present | MISSING_ENTRY_POINT_ID | entry_point_id must not be empty |
| 18 | Evidence origin specified | MISSING_EVIDENCE_ORIGIN | evidence_origin missing |
| 19 | Observation IDs present | MISSING_OBSERVATION_IDS | observation_ids missing |
| 20 | Verification contract ID present | MISSING_VERIFICATION_CONTRACT_ID | verification linkage missing |
| 21 | Decision candidate authorized | UNAUTHORIZED_ACTION | action_type not governed |
| 22 | Policy reference registered | UNKNOWN_POLICY_REFERENCE | policy_reference not registered |

## Test Counts (verified)

### Rust (workspace, excluding ha_cluster flaky tests)

| Crate | Tests | Passed | Failed |
|---|---|---|---|
| core_crypto | 71 | 71 | 0 |
| vardhan_receipt | 52 | 52 | 0 |
| vardhan_verifier | 15 | 15 | 0 |
| vardhan_idempotency | 13 | 13 | 0 |
| vardhan_keystore | 37 | 37 | 0 |
| vardhan_transaction | 18 | 18 | 0 |
| vardhan_hybrid_core | 6 | 6 | 0 |
| authority_gate | 7 | 7 | 0 |
| enterprise_tenant | 7 | 7 | 0 |
| vardhan_state | 2 | 2 | 0 |
| ledger_persistence | 2 | 2 | 0 |
| audit_ledger | 44 | 44 | 0 |
| proxy_engine | 31 | 31 | 0 |
| **TOTAL** | **238** | **238** | **0** |

### TypeScript

| Test Suite | Tests | Passed | Failed |
|---|---|---|---|
| trust_boundary.test.ts (script) | 23 cases / 45 assertions | 45 | 0 |
| trustBoundaryCanonical.test.ts (vitest) | 4 | 4 | 0 |
| persistentIdempotency.test.ts | 6 | 6 | 0 |
| supplyChainSecurity.test.ts | 4 | 4 | 0 |
| **Total vitest** | **14** | **14** | **0** |
| **Total script tests** | **45** | **45** | **0** |

## Regression Rule

Existing receipt signing, authority evaluation, ledger formats, and
Intelligence → Q-Core trust-boundary behavior must remain unchanged.

All new tests must be run with `--test-threads=1` for Rust (env-var safety),
or use `TEST_ENV_MUTEX` crate-level serialization pattern.
