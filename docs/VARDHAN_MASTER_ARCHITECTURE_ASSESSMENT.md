# VARDHAN MASTER ARCHITECTURE ASSESSMENT
## Repository-Grounded Gap Analysis & Reconciliation Plan

> **Status**: LIVE ASSESSMENT — Generated 2026-09-22 from actual repository inspection  
> **Authority**: Grounded in `VARDHAN_ARCHITECTURE_CONSTITUTION.md` v1.1 (A1–A9)  
> **Scope**: Full backend (21 Rust crates) + docs (40 documents) + frontend  
> **Purpose**: Before any new implementation, establish what is real, what is missing, what conflicts, and the ordered plan forward.

---

## PART 1 — WHAT EXISTS AND WHERE IT SITS CONSTITUTIONALLY

### Workspace Members (21 crates)

| Crate | Constitutional Layer | Status | Evidence |
|-------|---------------------|--------|----------|
| `core_crypto` | L01 — Post-Quantum Trust Foundation | ✅ **COMPLETE** 65/65 tests | PQC, ML-KEM-1024, ML-DSA-87, key rotation, KeyTransitionRecord |
| `proxy_engine` | L01 — Secure Transport | ✅ **COMPLETE** 60/60 tests | AES-256-GCM AEAD, PQ handshake |
| `ha_cluster` | L02 — Distributed Trust | ✅ **COMPLETE** 65/65 P8 tests | Raft, HA, drain, peer manager, election, heartbeat |
| `audit_ledger` | L03 — Evidence Fabric | ✅ **COMPLETE** | Ledger, Merkle, checkpoints, 1663 lines |
| `ledger_persistence` | L03 — Evidence Fabric | ✅ **COMPLETE** | Persistence layer for audit_ledger |
| `ledger_sync` | L03 — Evidence Fabric | ✅ **COMPLETE** | Sync + 341 line test suite |
| `vardhan_model` | L04 — Enterprise State (Model) | ✅ **COMPLETE** 38/38 tests | VardhanEvent, Entity types, DependencyGraph, SchemaVersion, PrincipalRef |
| `vardhan_state` | L04 — Enterprise State (Runtime) | ✅ **SUBSTANTIAL** | 8 modules: objects, store, evidence, id, state_machine, state_markers, scope, time |
| `pq_shield` | L01/L02 boundary + API gateway | ✅ **OPERATIONAL** | Admin routes, telemetry, session, metrics |
| `auth_service` | L01/L09 — Identity + Authorization | ✅ **SUBSTANTIAL** | Session, API key, credentials, rate limiting, profile, settings, secrets |
| `enterprise_tenant` | L04 — Tenant model | ⚠️ **MINIMAL** | Exists, unclear scope |
| `orchestration_ai` | L05/L11 — Intelligence + Execution | ❌ **PROTOTYPE — VIOLATES CONSTITUTION** | See Critical Finding F-C1 |
| `saas_metering` | L10/PAYG | ⚠️ **PARTIAL** | Basic UsageMeter, BLAKE3 receipt — not VCU model |
| `quantum_node` | L01 — Node binary | ⚠️ **PARTIAL** | Exists, unclear completeness |
| `quantum_network` | L01 — Network | ⚠️ **PARTIAL** | Exists |
| `quantum_tui` | L12 — Experience | ⚠️ **OPERATIONAL** | TUI for ops visibility |
| `vardhan_model` (AI) | L05 — Intelligence | ⚠️ **EXISTS** | Source unclear — see below |
| `poc_auditor` | Internal tooling | INFO | POC audit tool |
| `pq_verify` | L03 — Verification | ✅ **OPERATIONAL** | 493 lines |
| `verifier` | L03 — Verification | ✅ **OPERATIONAL** | 273 lines |
| `load_tester` | Testing infrastructure | INFO | Load test tooling |
| `mock_upstream` | Testing infrastructure | INFO | Mock backend for tests |

---

## PART 2 — CRITICAL FINDINGS

### F-C1 [CRITICAL] `orchestration_ai` BYPASSES THE AUTHORITY GATE

**File**: `backend/orchestration_ai/src/lib.rs`

**Violation**: `OrchestrationIntelligence::launch_predictive_healing_daemon()` spins an infinite `tokio::spawn` loop that directly calls `Self::execute_zero_downtime_drain()` when thresholds are exceeded. This is:

```
AI metric check → direct drain execution
```

This is **prohibited** by the Constitution:
- CONST-1: "No unverified probabilistic output may directly create an authoritative enterprise state transition"
- CONST-7: "Every action_id must have a matching authorization_id tracing back to a completed DecisionTwin"
- A7: "There is exactly one execution authority: the Vardhan Authority Gate. All action invocations must pass through it."
- Section 22: "Prohibited paths: Agent → Executor"

The crate has no `DecisionTwin`, no `AssuranceResult`, no `PolicyEvaluation`, no Authority Gate, no `authorization_id`, and no evidence record produced before action execution.

**Severity**: CRITICAL — this is an unbounded autonomous execution path that violates the core architectural invariant.

**Required resolution**: Either (a) delete `orchestration_ai` and replace with a constitutional implementation through the Decision Twin lifecycle, or (b) scope it as a pure *candidate generator* that feeds into the Authority Gate.

---

### F-C2 [HIGH] Hardcoded Credentials in `pq_shield/src/admin.rs`

**Lines**: 1147, 1202, 1245, 1254, 1269, 1329, 1338, 1412, 1479

```
"password": "admin_pass_12345"
"password": "quantum_pass_secure_987"
```

These are in test vectors within `admin.rs`. If these are test-only assertions, they are acceptable in test code — but they exist in `src/admin.rs`, not `tests/`. This must be verified and if in production-path code, removed immediately.

**Severity**: HIGH if in production path, MEDIUM if test-only within src.

---

### F-C3 [HIGH] F17 Finding — `VARDHAN_ADMIN_PASSWORD` env var still present

**File**: `backend/auth_service/src/secrets.rs:45`

The `SecretReader::read_bootstrap_password()` still falls back to `VARDHAN_ADMIN_PASSWORD` environment variable as a secondary path after `VARDHAN_ADMIN_PASSWORD_FILE`. This partially addresses F17 but does not fully remediate it — the env var path is still alive and environment variables are not secure long-lived secret storage.

**Required**: Remove the env var fallback entirely. Only support: (1) file-based injection, (2) HSM/secrets-manager API.

---

### F-C4 [HIGH] `SessionEntry` lacks Zeroize — F9 finding persists

**File**: `backend/auth_service/src/session.rs`

`SessionEntry` struct contains `current_token: String`, `previous_token: Option<String>`, and `username: String`. These are not `Zeroizing<String>` wrappers. When a `SessionEntry` is dropped, the token bytes remain in memory until overwritten by the allocator.

The `SessionToken` newtype uses `String` internally but does not implement `ZeroizeOnDrop`. The `SecretReader` correctly uses `Zeroizing<String>` for passwords but the session token path does not.

---

### F-C5 [MEDIUM] F7 — Merkle Leaf Construction

Need to verify what `audit_ledger` commits into Merkle leaves. The finding states leaves must commit to canonical complete evidence entries. This requires reading `audit_ledger/src/lib.rs` fully to confirm.

---

### F-C6 [MEDIUM] `saas_metering` is not constitutional PAYG

The existing `UsageMeter` measures `bytes_shielded` and `requests_processed` only. The Constitution requires a **VCU (Vardhan Compute Unit)** model normalizing: compute, security events, AI inference, simulation, formal assurance, storage, network, protected assets, recovery actions, evidence operations.

The existing implementation is a pre-VCU stub. It does not produce a `UsageLedger` entry, `UsageEvidence`, or `WalletState`. It is not yet a constitutional PAYG system.

---

### F-C7 [MEDIUM] L05–L12 are entirely unimplemented

The following constitutional layers have **zero implementation**:

| Layer | Name | Status |
|-------|------|--------|
| L05 | Intelligence | ❌ NOT STARTED |
| L06 | AI Assurance (G0–G4) | ❌ NOT STARTED |
| L07 | Reasoning (State Graph, E-Graph) | ❌ NOT STARTED |
| L08 | Risk & Scenario | ❌ NOT STARTED |
| L09 | Decision Intelligence | ❌ NOT STARTED |
| L10 | Outcome & Memory | ❌ NOT STARTED |
| L11 | Governed Execution | ❌ NOT STARTED (Authority Gate stub only) |
| L12 | Experience & Command (full) | ⚠️ FRONTEND ONLY |

This is expected given the constitution explicitly states these are "TO BUILD" — but the `orchestration_ai` crate appears to be an attempt to shortcut past this with an unauthorized autonomous loop.

---

### F-C8 [MEDIUM] Security Twin / Protection Twin — not implemented

The Constitution defines three Twins: Enterprise State Twin, Risk Twin, Decision Twin.

The Master Prompt also requires a **Security Twin** / **Protection Twin** (L2 Adaptive Defense). Neither is implemented. The `vardhan_state` crate implements the object model that would underpin a Security Twin, but no crate models:
- Attack paths
- Exposure scoring
- Defensive state
- Credential dependency chains
- Trust relationship graph

---

### F-C9 [INFO] `orchestration_ai` naming suggests future AI orchestration

The crate name `orchestration_ai` suggests it is intended to become Vardhan's autonomous orchestration layer. The current implementation is a prototype/spike that was not aligned to the Constitution. Rather than deleting it, the correct action is to rebuild it constitutionally — as a component that generates `DecisionCandidate` objects and submits them to the Authority Gate.

---

## PART 3 — WHAT IS FULLY WORKING

### L01–L03 Foundation — PRODUCTION-GRADE

The bottom three layers are genuinely strong:

**`core_crypto`** — ML-KEM-1024, ML-DSA-87, AES-256-GCM, key rotation (`rotate_signing_key()`), `KeyTransitionRecord`, `QuantumNodeIdentity`, BLAKE3 hashing, `Zeroizing` used correctly for key material. 65 tests passing.

**`proxy_engine`** — PQ handshake, AEAD transport, session establishment. 60 integration tests passing.

**`ha_cluster`** — Full Raft implementation: leader election, log replication, heartbeat, drain state machine, peer manager, checkpoint/snapshot, transport layer. P8 hardening complete (65 tests). Key rotation regression test exists (`p8_10a_key_rotation_produces_verifiable_transition`). Byzantine findings documented (P8-001, P8-002) with confirmed mitigations via transport-layer authentication.

**`audit_ledger`** — Merkle chain, ledger, BLAKE3 hashing, checkpoint. 1663 lines.

**`vardhan_model`** — Constitutional baseline. VardhanEvent, 15+ Entity types, DependencyGraph, SchemaVersion, PrincipalRef, PrincipalRegistry. 38/38 tests.

**`vardhan_state`** — L04 runtime. 8 modules implementing: TenantScoped<T>, EntityId newtypes (34 types), StateTransitionRecord, StateSnapshot, StateVersion, VardhanEvent lifecycle, Observation, EvidenceRecord, time model (A3 — all four time domains), state_markers (SPECULATIVE vs AUTHORITATIVE), state_machine, scope enforcement.

**`auth_service`** — Session management (opaque tokens, hard+idle expiry, revocation), API key management, Argon2id hashing, rate limiting, RBAC (Role/Permission), profile, settings. Has `secrets.rs` with `Zeroizing<String>` for passwords, `SecretReader` hierarchy. Has `authorization.rs` with `AuthenticatedUser`, `Permission`, `Role`.

---

## PART 4 — ARCHITECTURAL GAPS vs. THE MASTER PROMPT

Mapping the Master Prompt's 46 sections against actual repository state:

### Section 3 — Three Logical Layers
**Current state**: The codebase maps to the Constitution's 12-layer model, not the Master Prompt's 3-layer simplification (L1 Enterprise Intelligence, L2 Adaptive Defense, L3 Secure Platform).

**Resolution**: The Master Prompt's 3-layer model is a *logical grouping* of the Constitution's 12 layers:
- L3 Secure Platform = Constitution L01–L03 (trust, consensus, evidence) ✅ EXISTS
- L2 Adaptive Defense = Constitution L04–L08 + Protection Twin ⚠️ PARTIALLY EXISTS
- L1 Enterprise Intelligence = Constitution L05–L12 ❌ NOT STARTED

**This is not a conflict** — the 3-layer model is the customer-facing view; the 12-layer model is the engineering implementation. Both must be preserved.

### Section 5 — State Model
**Current state**: `vardhan_state` implements `SPECULATIVE → VARDHAN_COMMITTED_STATE → OBSERVED_EXTERNAL_STATE` as specified (A1). State markers enforce the boundary. `logical_time` is `Option<u64>` (None before Raft commit, as A3 requires). `TenantScoped<T>` enforces A2. This is **correct**.

### Section 6 — Security Twin
**Current state**: `vardhan_model` has entity types `Asset`, `Application`, `Service`, `Identity`, `CryptoAsset`, `CryptoKey`, `Certificate`, `Risk`, `Control`, `Policy`, `Decision`, `Action`, `Outcome`, `Incident`. The `DependencyGraph` models relationships.

**Gap**: No crate assembles these into a live, queryable Security Twin that models attack paths, exposure, trust relationships, or defensive state. The objects exist but the runtime twin does not.

### Section 7 — Decision Twin
**Current state**: The DecisionTwin lifecycle is fully specified in the Constitution (CREATED → ... → MEMORIZED, plus REVALIDATION_REQUIRED via A8). The `vardhan_state` evidence module covers decision evidence categories (A5).

**Gap**: No crate implements the DecisionTwin runtime. The lifecycle exists in the spec and partial object structures exist in `vardhan_state`, but no `DecisionTwin` record is created, stored, traversed, or queried.

### Section 8 — Adaptive Defense Fabric
**Current state**: `ha_cluster` has a `drain.rs` that implements node drain as a state machine. `pq_shield` handles session management. But there is no:
- Threat detection pipeline
- Risk scoring engine
- Scenario generation
- Containment/revocation orchestration (beyond session revoke)
- Recovery procedures beyond Raft

**Gap**: The defensive loop (Threat → Evidence → Risk → Protection Twin → Scenario → Decision Candidate → Simulation → AI Assurance → Authority Gate → Containment → Outcome → Defense Memory) does not exist at all.

### Section 11 — Security Compiler / Security IR
**Gap**: Not implemented. No `SecurityIR` type exists. No typed intermediate representation for AI reasoning output. This is a major missing component that must precede any AI model integration.

### Section 12 — Vardhan-Owned AI
**Gap**: The `vardhan_model` crate in the workspace is named ambiguously — it appears to be the enterprise data model, not an AI model runtime. No `vardhan_slm`, `vardhan_security_model`, or internal inference runtime exists. This is Layer 5 — not started.

### Section 14 — Model Foundry
**Gap**: No training infrastructure, model registry, signed model artifact pipeline, or evaluation framework exists. Not started.

### Section 15 — AI Assurance G0–G4
**Current state**: Fully specified in Constitution Section 21, with explicit `AssuranceResult` and `PolicyEvaluation` object schemas.

**Gap**: No implementation. G0–G4 pipeline has zero Rust code. This is the most critical missing link between the intelligence plane and the execution plane.

### Section 17 — Blast-Radius Governance
**Current state**: `ha_cluster/src/drain.rs` implements node drain as a bounded state machine. This is proto-blast-radius governance for infrastructure operations.

**Gap**: No formal blast-radius model that calculates affected assets, dependency impact, tenant impact, reversibility, or required authority level based on scope.

### Section 19 — Adaptive Security Compute
**Gap**: No economic governor, no hot/warm/cold routing, no compute-sufficiency analysis. All decisions currently treated identically with no differentiation.

### Section 22 — Evidence System (F7 Verification Required)
**Gap**: Need to read `audit_ledger/src/lib.rs` (1663 lines) fully to verify Merkle leaf commitment policy. Per the known F7 finding, leaves may not commit to canonical complete evidence entries.

### Section 28 — PAYG / VCU
**Current state**: `saas_metering` has a `UsageMeter` producing BLAKE3-signed receipts.

**Gap**: Not constitutional. No `VCU` type. No `UsageLedger`. No `WalletState`. No `PricingEngine`. No budget alerts. No emergency protection override. The existing metering is bytes+requests only — not the multi-dimensional VCU model.

### Section 24–25 — Global Cell Architecture / Cell Autonomy
**Current state**: `ha_cluster` implements a 3-node Raft cluster. This is proto-cell autonomy.

**Gap**: No formal cell concept. No region concept. No global control fabric. No cell-local Authority Gate. No batching, sharding, or horizontal partitioning beyond Raft replication. This is significant missing infrastructure for global scale.

---

## PART 5 — INVARIANT AUDIT AGAINST CONSTITUTION

| Invariant | Status |
|-----------|--------|
| I1: No unauthenticated Raft RPC changes state | ✅ ML-KEM/ML-DSA transport enforces this |
| I2: No stale term can modify current state | ✅ Raft term checks in `raft.rs` |
| I3: No non-leader can commit client writes | ✅ Leader election enforced |
| I4: Committed state survives restart | ✅ Raft log persistence + snapshots |
| I5: Cryptographic identity cannot silently change | ✅ `rotate_signing_key()` + `KeyTransitionRecord` |
| I6: Replay cannot produce second state transition | ✅ Idempotency keys in evidence model |
| I7: Key rotation cannot invalidate committed historical evidence | ✅ Pre/post-rotation signature marking |
| I8: Network partition cannot create two valid histories | ✅ Raft quorum guarantees |
| I9: Failed cryptographic verification is fail-closed | ✅ `core_crypto` fails closed |
| I10: Evidence corresponds to exact committed state | ⚠️ F7 OPEN — Merkle leaf completeness unverified |
| CONST-1: No unverified probabilistic output may directly execute | ❌ **VIOLATED** by `orchestration_ai` |
| CONST-2: Every decision attributable to state snapshot + evidence + policy | ❌ NOT IMPLEMENTED — no Decision Twin runtime |
| CONST-3: Security/intelligence/execution separately enforceable | ⚠️ PARTIAL — planes exist in spec, not fully in code |
| CONST-4: Three planes not conflated | ✅ Constitutionally correct in spec; `orchestration_ai` conflates them |
| CONST-5: TenantId mandatory on all authoritative state | ✅ `TenantScoped<T>` enforces this in `vardhan_state` |
| CONST-6: No authoritative state without committed transition record | ✅ `vardhan_state` state_machine enforces this |
| CONST-7: Every action_id has matching authorization_id via DecisionTwin | ❌ NO DECISION TWIN RUNTIME EXISTS |
| CONST-8: INDETERMINATE != PASS | ⚠️ Specified but not enforced (no AssuranceResult implementation) |
| A6: DecisionCandidate always speculative until G0–G4 + policy | ❌ `orchestration_ai` violates this |
| A7: One execution authority — Authority Gate | ❌ `orchestration_ai` bypasses this |
| A8: REVALIDATION_REQUIRED lifecycle state | ⚠️ Specified in `vardhan_state` state_machine, not tested end-to-end |
| A9: Fault-domain isolation | ⚠️ Structurally present via crate separation; circuit breakers not implemented |

---

## PART 6 — MASTER PROMPT vs. CONSTITUTION RECONCILIATION

The Master Prompt introduces several concepts not in the Constitution v1.1. These must be classified:

| Master Prompt Concept | Constitution Status | Action |
|-----------------------|--------------------|----|
| 3 logical layers (L1/L2/L3) | Compatible with 12-layer stack | Accept as logical grouping view |
| Security Twin (full) | Constitution has 3 Twins: Enterprise/Risk/Decision | Security Twin = Enterprise State Twin + Protection Twin extension. Accept. |
| Protection Twin | Not in Constitution v1.1 | New concept — add as Amendment A10 |
| Defense Genome | Not in Constitution v1.1 | New concept — add as Amendment A11 |
| Security IR / Security Compiler | Not in Constitution v1.1 | New concept — add as Amendment A12 |
| Vardhan Model Family (SLM/Security/Code/Reasoner/Planner/Research) | Not in Constitution v1.1 | New concept — add as Amendment A13 |
| Model Foundry | Not in Constitution v1.1 | New concept — add as Amendment A14 |
| Proof-Carrying Defense / ProofCarryingAction | Not in Constitution v1.1 | New concept — add as Amendment A15 |
| Blast-Radius Governance (explicit scopes) | Proto-exists in drain.rs | Formalize as Amendment A16 |
| Action Budget / Security Budget | Not in Constitution v1.1 | New concept — add as Amendment A17 |
| Adaptive Security Compute / Hot/Warm/Cold | Not in Constitution v1.1 | New concept — add as Amendment A18 |
| VCU / PAYG Economy | `saas_metering` partial | Formalize the VCU model — Amendment A19 |
| Defense Memory | Constitution has Decision Memory | Defense Memory = Decision Memory extension for defensive outcomes |
| Cell Autonomy | Not formalized | New architectural primitive — Amendment A20 |

---

## PART 7 — ORDERED IMPLEMENTATION PLAN

Following the Constitution's dependency rule: never reverse specification order.

### PHASE 0 — REMEDIATION (Do first, no new features until done)

**P0.1** [CRITICAL] Delete `orchestration_ai`'s autonomous execution loop. Replace with:
  - A pure `NodeHealthMonitor` that generates `Observation` objects into `vardhan_state`
  - `DecisionCandidate` generation based on thresholds
  - Submission to the not-yet-built Authority Gate (stub for now)

**P0.2** [HIGH] Remove `VARDHAN_ADMIN_PASSWORD` env var fallback from `secrets.rs`. File-based injection only.

**P0.3** [HIGH] Add `ZeroizeOnDrop` to `SessionToken` and `SessionEntry.current_token` / `previous_token`.

**P0.4** [HIGH] Verify F7 — read `audit_ledger/src/lib.rs` in full. Confirm Merkle leaves commit to canonical complete `EvidenceRecord` bytes. Add regression test.

**P0.5** [MEDIUM] Verify F24 — check `auth_service/src/api_key.rs` for non-atomic writes. Add regression test.

**P0.6** [MEDIUM] Verify `pq_shield/src/admin.rs` hardcoded passwords are test-only. If in production path, remove.

### PHASE 1 — CONSTITUTION AMENDMENTS (Write specs, not code)

Write Amendment documents A10–A20 (Protection Twin, Defense Genome, Security IR, Model Family, Model Foundry, Proof-Carrying Defense, Blast-Radius Governance, Action Budget, Adaptive Compute, VCU, Cell Autonomy).

Update `VARDHAN_CANONICAL_OBJECT_SPEC.md` with:
- `SecurityIR` typed structure
- `BlastRadiusScope` enum
- `DefenseGenome` record
- `ProofCarryingAction` record
- `VCURecord`, `WalletState`, `UsageLedger` objects
- `ProtectionTwin` object model
- `DefenseMemoryEntry` object

Update `VARDHAN_STATE_MACHINES.md` with state machines for each new object.

Update `VARDHAN_TEST_CONTRACTS.md` with test contracts for each new invariant.

### PHASE 2 — AUTHORITY GATE (L09/L11 skeleton)

Implement `authority_gate` crate:
- `AuthorityGate` struct with `validate_and_execute(action, authorization_evidence) -> Result<ExecutionReceipt>`
- Validates: `authorization_id`, `DecisionTwin` state, `AssuranceResult.final_status == PASS`, `config_hash`, `tenant_id`, blast-radius scope
- Initially: stub `AssuranceResult` (always PASS) — replace in Phase 4
- Produces `ActionExecutionRecord` with full evidence chain
- Every action — including drain, session revoke, key rotation — routes through this gate

### PHASE 3 — DECISION TWIN RUNTIME (L09)

Implement `decision_twin` crate:
- `DecisionTwin` record with full constitutional structure
- Lifecycle state machine: CREATED → ... → MEMORIZED, REVALIDATION_REQUIRED
- `DecisionTwinStore` backed by `vardhan_state` and `audit_ledger`
- `DecisionCandidateQueue` — submits candidates from intelligence components
- Integration with `AuthorityGate`

### PHASE 4 — AI ASSURANCE G0–G4 (L06)

Implement `ai_assurance` crate:
- `AssuranceResult` with explicit statuses (PASS/FAIL/REJECT/INDETERMINATE/TIMEOUT/NOT_APPLICABLE)
- G0: Schema validation, provenance check, malformed input rejection, config_hash binding
- G1: Semantic agreement (initially: schema-level structural equivalence; upgrade to SMT later)
- G2: Perturbation robustness (N randomized variants, stability check)
- G3: Utility / non-degeneracy (reject trivial reject-all behavior)
- G4: Policy evaluation → `PolicyEvaluation` with `proof_reference`
- **CONST-8 enforcement**: `INDETERMINATE != PASS` enforced by type

### PHASE 5 — SECURITY IR (L05)

Implement `security_ir` crate:
- Typed `SecurityIR` enum covering all reasoning outputs
- Schema validation
- Versioned, tenant-scoped, integrity-protected
- Serialization to canonical CBOR
- `SecurityCompiler` trait: `fn compile(observation: &Observation) -> Result<SecurityIR>`

### PHASE 6 — SECURITY TWIN (L04 extension)

Implement `security_twin` crate:
- Built on `vardhan_model` entity types
- Real-time graph of assets, identities, services, trust relationships, crypto dependencies
- `AttackPath` modeling
- `ExposureScore` computation
- `ProtectionTwin` — defensive state mirror
- Current state + speculative future state simulation

### PHASE 7 — RISK & SCENARIO ENGINE (L08)

Implement `risk_engine` and `scenario_engine` crates:
- `RiskProfile` from Security Twin state
- `Scenario` generation from current + speculative state
- Monte Carlo simulation for risk distributions
- Integration with Decision Twin candidate generation

### PHASE 8 — VCU / PAYG (Economic Layer)

Upgrade `saas_metering` to full VCU model:
- `VCU` type with multi-dimensional components
- `UsageLedger` backed by `audit_ledger`
- `WalletState`, `BudgetAlert`, `SpendControl`
- `PricingEngine`
- Emergency protection override (continue protection even at zero wallet balance if policy permits)
- Cryptographically signed usage records

### PHASE 9 — DEFENSE GENOME / DEFENSE MEMORY

Implement `defense_memory` crate:
- `DefenseMemoryEntry` with provenance, state refs, evidence refs, effectiveness
- `DefenseGenome` — reusable structured defensive strategy
- Memory does not promote uncertain information to authoritative
- Integration with scenario engine (genomes accelerate scenario generation)

### PHASE 10 — SELF-HEALING (Bounded)

Implement `self_healing` crate replacing `orchestration_ai`:
- Detect → Evidence → Risk → Scenario → Policy → Assurance → Authority Gate → Contain/Recover → Verify → Learn
- Action budget enforcement
- Rate limiting on autonomous actions
- Blast-radius-aware scope validation
- All actions through Authority Gate

### PHASE 11 — CELL AUTONOMY

Extend `ha_cluster` with formal cell concept:
- `CellId` type
- Cell-local Authority Gate
- Cell-local evidence production
- Cell-local Twin updates
- Bounded operation during upstream isolation
- Global coordination additive, not required for basic defense

### PHASE 12 — INTEGRATION ADAPTERS

Build `integration_adapters` crate family:
- AWS CloudTrail → VardhanEvent
- Kubernetes audit → VardhanEvent
- GitHub → VardhanEvent
- Generic SIEM → VardhanEvent
- All through G0 input boundary

---

## PART 8 — DOCUMENT PRODUCTION PLAN

Per Master Prompt Section 40, the following documents must be created:

| Document | Priority | Phase |
|----------|----------|-------|
| A. Master System Map | 1 | Now (update VARDHAN_SYSTEM_MAP.md) |
| B. Component/Service Map | 1 | Phase 0 |
| C. Trust Boundary Map | 1 | Phase 0 |
| D. Data Flow Map | 2 | Phase 1 |
| E. Control Flow Map | 2 | Phase 1 |
| F. State Flow Map | 2 | Phase 1 |
| G. Security Twin Model | 3 | Phase 6 |
| H. Decision Twin Model | 2 | Phase 3 |
| I. Security IR Specification | 3 | Phase 5 |
| J. Model Family Architecture | 4 | Phase 7+ |
| K. Model Foundry Architecture | 4 | Phase 7+ |
| L. AI Assurance Architecture | 3 | Phase 4 |
| M. Proof-Carrying Defense | 4 | Phase 9 |
| N. Authority Gate Architecture | 2 | Phase 2 |
| O. Evidence/Audit Architecture | 1 | Now (existing audit_ledger) |
| P. Event Envelope Specification | 1 | Now (vardhan_model has this) |
| Q. Global Region/Cell Architecture | 5 | Phase 11 |
| R. PAYG/VCU Economic Architecture | 3 | Phase 8 |
| S. Security Memory/Defense Genome | 4 | Phase 9 |
| T. Self-Healing Architecture | 4 | Phase 10 |
| U. Chaos/Adversarial Testing | 3 | Ongoing |
| V. Threat Model Traceability | 2 | Phase 1 |
| W. Test Contract Traceability | 2 | Phase 1 |
| X. Deployment Architecture | 3 | Phase 8 |
| Y. Disaster Recovery Architecture | 4 | Phase 11 |
| Z. Capacity/Performance Model | 5 | Phase 11+ |

---

## PART 9 — ARCHITECTURE DECISION RECORD

### ADR-001: Preserve Constitution v1.1 — No replacement

The existing Constitution v1.1 with A1–A9 is technically sound. The Master Prompt is additive to it, not a replacement. Amendments A10–A20 formalize new concepts. The 12-layer model and 3-layer model are compatible views of the same architecture.

### ADR-002: `orchestration_ai` is a prototype — quarantine and rebuild

The `orchestration_ai` crate violates CONST-1, CONST-7, A6, and A7. It must not be merged to any production path. Rebuild as `self_healing` with full Authority Gate integration.

### ADR-003: `vardhan_state` is the canonical L04 runtime

`vardhan_state` correctly implements A1–A5, A3's time model, A2's tenant scoping, and the state marker system. Future L04 extensions build on it, not around it.

### ADR-004: Authority Gate before AI

G0–G4 and the Decision Twin runtime must be implemented before any AI/model integration. Models produce candidates; the gate determines whether they execute.

### ADR-005: Security IR before model integration

No Vardhan model may produce output that directly maps to execution. All model output passes through the Security IR → Security Compiler → G0–G4 → Authority Gate chain.

### ADR-006: `saas_metering` upgrade, not replacement

The existing BLAKE3-signed receipt mechanism is the right skeleton. Build the VCU model on top of it.

### ADR-007: No microservices mandate

Per Constitution A9 Constraint: fault-domain isolation through process/thread isolation and circuit breakers, not mandatory microservices. Keep the current single-binary-per-role deployment model.

---

## SUMMARY: WHAT TO DO NEXT

**Immediate (this session)**:

1. Remediate F-C1: Quarantine `orchestration_ai` autonomous loop
2. Remediate F-C3: Remove `VARDHAN_ADMIN_PASSWORD` env var from secrets.rs
3. Remediate F-C4: Add `ZeroizeOnDrop` to `SessionToken`
4. Verify F-C2: Check if admin.rs hardcoded passwords are test-only
5. Read `audit_ledger/src/lib.rs` fully to verify F7 (Merkle leaf completeness)

**Next milestone** (Phase 1): Write Amendment documents A10–A20 updating the Constitution with the new Master Prompt concepts. No coding of L05–L12 until Amendment specs are frozen.

**Next coding milestone** (Phase 2): Authority Gate crate — the single most important missing infrastructure piece.

---

*This assessment was generated from direct inspection of 21 Rust crates, 40 documentation files, and the full text of `VARDHAN_ARCHITECTURE_CONSTITUTION.md` v1.1 (1503 lines). It is grounded in the actual repository, not speculative.*
