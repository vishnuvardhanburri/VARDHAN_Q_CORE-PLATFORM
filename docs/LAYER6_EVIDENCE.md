# Layer 6 Evidence — Vardhan Data Fabric

## Layer 6.1: Common Event Model + Enterprise Model + Dependency Graph

**Status**: ✅ Complete — compiles, all 38 tests pass

## Architecture (as requested)

The Vardhan platform now follows this dependency chain:

```text
vP8
  ↓
P9 container/runtime
  ↓
Event Fabric         ← (Layer 6.1: Common Event Model)
  ↓
Enterprise Model     ← (Layer 6.2: Entity model)
  ↓
Dependency Graph     ← (Layer 6.3: typed relationships + blast radius)
  ↓
Risk Engine
  ↓
Scenario Engine
  ↓
Decision Engine
  ↓
Vardhan-owned ML
  ↓
Business Intelligence
  ↓
Governed Automation
```

## Deliverables

### `backend/vardhan_model` crate (new)

| Module | File | Description |
|--------|------|-------------|
| Common Event Model | `src/events.rs` | `VardhanEvent`, `EventBuilder`, `EventType` (8 variants), `Severity` (5 levels), `Confidence` (4 levels), `EventId`, 50 controlled vocabulary actions, deterministic canonical hashing via BLAKE3 + BTreeMap |
| Enterprise Model | `src/entities.rs` | 22 entity types (Tenant, Organization, BusinessUnit, Application, Service, Asset, Node, Container, Identity, CryptoAsset, CryptoKey, Certificate, BusinessProcess, Transaction, Risk, Control, Policy, Decision, Action, Outcome, Incident, Event), `Entity` trait, `EntityId`, `EntityType` |
| Dependency Graph | `src/graph.rs` | `DependencyGraph`, `Relationship` enum (12 forward + 7 inverse variants), `Edge`, `TraversalResult`, blast radius analysis, cycle detection, forward/backward traversal |
| Schema Registry | `src/schema.rs` | `SchemaVersion` (semver), `SchemaCompatibility` checker, `SchemaRegistry` (in-memory) |
| Identity Fabric | `src/identity.rs` | `PrincipalRef`, `PrincipalKind` (8 variants), `PrincipalRegistry`, `IdentityError` |

### Test Results

```
running 38 tests
test events::tests::* ... 5 passed
test entities::tests::* ... 8 passed
test graph::tests::* ... 10 passed
test schema::tests::* ... 5 passed
test identity::tests::* ... 5 passed

test result: ok. 38 passed; 0 failed; 0 ignored
```

### Constraints verified

- ✅ Only dependencies in `Cargo.lock`: serde, serde_json, blake3, uuid, thiserror, chrono
- ✅ No external LLM dependencies
- ✅ Standard cryptography only: BLAKE3 (event hashing)
- ✅ `cargo check --workspace` passes (only pre-existing `pq_verify` error remains)
- ✅ No P8 source files modified
- ✅ P7.3_EVIDENCE.md hash unchanged: `dca898d9c757a12c33e807b2d61b2b05a1744d251c12b20a729fe2c06787f573`
