# VARDHAN PROOFMESH RECONCILIATION — PASS 2
## Specification Delta Analysis V2

**Document type**: Delta analysis. READ-ONLY against frozen specifications.  
**Supersedes**: `VARDHAN_PROOFMESH_RECONCILIATION.md` (Pass 1)  
**Baseline commits (frozen specs — unchanged)**:
- `VARDHAN_ARCHITECTURE_CONSTITUTION.md`
- `VARDHAN_CANONICAL_OBJECT_SPEC.md` (primary reference — all identity models drawn from here)
- `VARDHAN_STATE_MACHINES.md`
- `VARDHAN_OBJECT_TRAITS.md`
- `VARDHAN_TEST_CONTRACTS.md`
- `VARDHAN_AI_INTELLIGENCE_DESIGN.md`
- `VARDHAN_SYSTEM_MAP.md`

**Verification Target SHA**: 4711305797ccb68e19f55124384cf2272b5ff187  
**Phase**: 5 — ProofMesh Specification Reconciliation  
**Rule**: No frozen specification is modified until this document is reviewed, all contradictions closed, and freeze explicitly authorized.

---

## 0. Pass 1 Corrections Log

The following errors in Pass 1 are explicitly corrected in this document:

| # | Error | Correction |
|---|-------|-----------|
| 1 | Object count stated as 9 but 10 defined; `EvidenceLink` referenced but not defined | Audited: 8 canonical objects remain after model consolidation |
| 2 | `EvidenceObject` proposed as a new top-level object duplicating `EvidenceRecord` | Resolved: `EvidenceObject` is NOT a new canonical object; it is a named role applied to existing `EvidenceRecord` with `evidence_category = VERIFICATION` |
| 3 | New objects did not carry `TenantScoped<T>` wrapper or `scope_hash` | All retained objects now carry full `TenantScoped<T>` structural wrapper |
| 4 | New objects used bare `tenant_id: TenantId` instead of type-level wrapper | Corrected throughout |
| 5 | Objects did not carry `TimeContext`, `schema_version`, or `provenance: ProvenanceTrail` | All retained objects now carry full frozen identity model |
| 6 | `VerificationRun.start/end_logical_time` typed as `CommitIndex` | Corrected: pre-commit objects have `logical_time = None`; execution times are `event_time` / `system_time` |
| 7 | Ed25519 used as evidence signature algorithm | Corrected: **ML-DSA-87** is the frozen Vardhan PQ signing algorithm per spec §10.4, §12.5 |
| 8 | Parallel AI assurance chain proposed alongside G0-G4 | Corrected: no parallel chain; G0 is reused for evidence structural validation |
| 9 | A7 scope left unresolved | Resolved: see §9 |
| 10 | `FaultInjectionAuthorization.authorized_by: DecisionTwinId` | Corrected: reuses existing `Authorization` object with `action_type = FAULT_INJECTION` |
| 11 | EvidenceQuorum defined diversity but not independence | Strengthened: §11 introduces independence dimensions |
| 12 | `ReplayCapsule` did not define version compatibility semantics | Strengthened: §12 adds `executor_version`, compatibility rules |
| 13 | Failure classification was flat | Refactored into outcome × cause × confidence dimensions |
| 14 | Wall-clock invariant too broad | Narrowed: forbids synchronization-by-sleep; permits explicit temporal tests |
| 15 | Object set not minimized | Reduced from 10 proposed to 8 retained; `EvidenceLink` removed |
| 16 | No explicit taxonomy of object kinds | §16 adds taxonomy |
| 17 | No Non-Goals section | §17 added |

---

## 1. Scope and Baseline

ProofMesh is a verification control fabric. It is NOT a new application layer, NOT a parallel authority chain, and NOT a duplicate evidence system.

Every ProofMesh construct must either:
1. **Reuse** an existing frozen canonical object unchanged, or
2. **Extend** an existing frozen object through a new `evidence_category` value, a new subtype field, or a new `action_type`, or
3. **Add** a genuinely new canonical object where no existing object can be extended to serve the purpose.

This document applies those three categories systematically. The goal is the minimum coherent set.

---

## 2. Existing Vardhan Architectural Invariants Relevant to ProofMesh

All invariants from Pass 1 remain. Three additions based on direct spec reading:

### A3-Correction — `logical_time` is assigned at commit, not at dispatch
From `VARDHAN_CANONICAL_OBJECT_SPEC` §3:
> `logical_time: u64?` — *assigned when committed* (Raft commit_index). Pre-commit objects have `logical_time = None` and are NEVER authoritative.

**ProofMesh implication**: A `VerificationRun` dispatched for execution is pre-commit. Its `time` fields during execution are `event_time` and `system_time`. `logical_time` becomes final only when the resulting `EvidenceRecord` is Raft-committed. This is the same lifecycle as every other Vardhan object.

### Crypto-Correction — ML-DSA-87 is the frozen signature algorithm
From `VARDHAN_CANONICAL_OBJECT_SPEC` §10.4:
> **SIGNED**: ML-DSA-87 signature applied by the node.  
> **UNSIGNED**: No valid ML-DSA-87 signature → rejected.

From §12.5 (`ConfigurationSnapshot`):
> `signature: Signature ← ML-DSA-87`

From §11.4 (`AssuranceResult`):
> `validator_signature: Signature? ← ML-DSA-87 of the result`

**ProofMesh implication**: All ProofMesh `EvidenceRecord` entries must be signed with ML-DSA-87. Ed25519 is explicitly prohibited for any Vardhan evidence object.

### Auth-Model — `Authorization` already exists as a frozen canonical object
From `VARDHAN_CANONICAL_OBJECT_SPEC` §12.4:
> `Authorization` with `decision_id`, `action_id`, `policy_eval_ref`, `assurance_ref`, `authorized_by: EntityId`, `auth_level: HUMAN | AUTO`.

**ProofMesh implication**: `FaultInjectionAuthorization` is NOT a new object. ProofMesh must extend the existing `Authorization` object with `action_type = SYSTEMIC_FAULT_INJECTION`.

---

## 3. ProofMesh Architectural Placement

Unchanged from Pass 1. ProofMesh is a cross-cutting verification fabric alongside the Control Plane.

```
┌─────────────────────────────────────────────────────┐
│ Reality Plane    (external systems)                 │
│      ↑ VardhanAuthorityGate (A7)                    │
│ Control Plane    (Raft, G0-G4, Policy, Auth)        │
│      ↑ Security IR / TenantScoped<T>                │
│ Intelligence     (Models, Reasoning)                │
│      ↑ read-only                                    │
│ Data Plane       (Entities, Events, State)          │
│                                                     │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│ VERIFICATION FABRIC  (ProofMesh — alongside Control) │
│  Reads Data + Control Planes                        │
│  Produces EvidenceRecord (category = VERIFICATION)  │
│  Commits through Raft EvidenceStore                 │
│  Systemic fault execution routes through A7         │
└─────────────────────────────────────────────────────┘
```

---

## 4. VerificationScope Model

Pass 1 omitted an explicit scope model. Cross-tenant infrastructure verification (Raft consensus, PQ handshake) does not fit the standard `TenantScoped<T>` model because those claims are platform-level.

Three scopes are defined:

```text
VerificationScope
├── TENANT     ← claim applies to a single tenant's data and behavior
├── PLATFORM   ← claim applies to shared infrastructure (Raft, PQ transport, Merkle ledger)
└── GLOBAL     ← claim applies to the system as a whole; no tenant isolation boundary applies
```

**Rules**:
- `TENANT` scope: object is wrapped in `TenantScoped<T>` normally.
- `PLATFORM` scope: object is wrapped in `TenantScoped<PlatformClaimMarker>` where `PlatformClaimMarker` is a zero-size type that satisfies the structural wrapper requirement without binding to business tenant data.
- `GLOBAL` scope: object is wrapped in `TenantScoped<GlobalClaimMarker>`. This is the only case where cross-tenant comparison is permitted in the evidence record.

This resolves the unresolved question Q3 from Pass 1.

---

## 5. Canonical Object Delta

### Taxonomy of ProofMesh Constructs

Before listing objects, each construct is classified:

| Construct | Kind |
|-----------|------|
| `VerificationClaim` | Canonical object (new) |
| `EvidenceRecord` with `category=VERIFICATION` | Extension of existing canonical object |
| `ExecutionPlan` | Canonical object (new) |
| `VerificationRun` | Canonical object (new) |
| `ReplayCapsule` | Canonical object (new) |
| `EvidenceQuorum` | Canonical object (new) |
| `EvidencePolicy` | Extension of existing `Policy` object (new subtype) |
| `VerificationFinding` | Canonical object (new) |
| `Authorization` with `action_type=SYSTEMIC_FAULT_INJECTION` | Extension of existing `Authorization` object |
| `FaultScenario` | Canonical object (new) |
| `VerificationGraph` | Graph relationship (not a canonical object — see §16) |
| `EvidenceLink` | REMOVED — replaced by `EvidenceRecord.related_object_refs` |
| `VerificationEvidenceProducer` | Trait (not a canonical object) |
| `VerificationPolicyEngine` | Runtime service (not a canonical object) |
| `VerificationScheduler` | Runtime service (not a canonical object) |
| `VerificationReplayEngine` | Runtime service (not a canonical object) |
| `ClaimRegistry` | Runtime service (not a canonical object) |

**Retained canonical objects: 7 new + 2 extensions = 9 constructs total.**  
(Pass 1 claimed 9 but had 10 + 1 undefined. Pass 2 is 7 new + 2 extensions, clearly categorized.)

---

### CANONICAL OBJECT 1: `VerificationClaim`

**Kind**: New canonical object  
**Purpose**: The fundamental assurance object. A typed, tenant-or-platform-scoped claim about a security or correctness property that ProofMesh must gather evidence to certify or falsify.

```text
VerificationClaim
├── logical_id       : Uuid                 ← LogicalId, stable, queryable
├── content_hash     : ContentHash          ← BLAKE3 of canonical bytes
├── schema_version   : SchemaVersion        ← semver
├── TenantScoped<VerificationClaim>
│   ├── tenant_id    : TenantId (or PlatformClaimMarker / GlobalClaimMarker)
│   └── scope_hash   : [u8; 32]            ← BLAKE3(tenant_id || canonical(inner))
├── scope            : VerificationScope    ← TENANT | PLATFORM | GLOBAL
├── claim_text       : String               ← human-readable statement
├── claim_type       : Enum:
│                      SECURITY | CORRECTNESS | PERFORMANCE | RESILIENCE
├── required_policy  : PolicyId             ← references existing Policy object
├── config_hash      : ConfigurationHash    ← A4: bound to config at registration
├── status           : Enum:
│                      OPEN | EVIDENCE_GATHERING | QUORUM_SATISFIED |
│                      CERTIFIED | FAILED | EXPIRED | INDETERMINATE
├── time             : TimeContext          ← A3: logical_time = None until committed
├── evidence_refs    : Vec<EvidenceId>      ← all contributing EvidenceRecords
└── provenance       : ProvenanceTrail
```

**Lifecycle**:
```
OPEN → EVIDENCE_GATHERING → QUORUM_SATISFIED → CERTIFIED
                          ↘ FAILED
     ↘ EXPIRED (deadline exceeded at any point)
     ↘ INDETERMINATE (quorum satisfied but VerificationFinding = INDETERMINATE)
```

**Transition authority**: `VerificationPolicyEngine` (deterministic service). No AI/model component may directly transition a claim.

**Invariant PM-001** (Rule 0.1 structural encoding):  
A `VerificationClaim` MUST NOT transition to `CERTIFIED` unless a Raft-committed `VerificationFinding` with `verdict = CERTIFIED` exists at a `commit_index` ≥ the claim's own `commit_index`. A human-readable report is NEVER sufficient.

**Config staleness**: If `config_hash` no longer matches the current effective `ConfigurationHash`, the claim transitions to `INDETERMINATE` pending revalidation (mirrors `DecisionTwin.REVALIDATION_REQUIRED`).

**Tenant scoping**: `TENANT` claims use standard `TenantScoped<VerificationClaim>`. `PLATFORM` and `GLOBAL` claims use scope marker types as defined in §4.

**Canonical serialization**: Canonical JSON field order: `logical_id`, `content_hash`, `schema_version`, `tenant_id`, `scope_hash`, `scope`, `claim_text`, `claim_type`, `required_policy`, `config_hash`, `status`, `time`, `evidence_refs`, `provenance`.

**Persistence**: Verification Evidence Ledger (see §11). Replicated via Raft.

**Failure states**:
- `CONFIG_STALE`: `config_hash` outdated → transition to `INDETERMINATE`
- `POLICY_NOT_FOUND`: `required_policy` no longer exists → `FAILED`

---

### EXTENSION 1: `EvidenceRecord` with `evidence_category = VERIFICATION`

**Kind**: Extension of existing canonical object — NOT a new object.  
**Purpose**: Verification-plane test execution outcomes are committed as `EvidenceRecord` entries. No new top-level evidence object is created.

The existing `EvidenceRecord` has:
```text
evidence_category : DECISION | OUTCOME  ← A5 (frozen)
```

**Proposed extension**: Add `VERIFICATION` as a third valid value for `evidence_category`.

```text
evidence_category : DECISION | OUTCOME | VERIFICATION  ← A5-extended
```

When `evidence_category = VERIFICATION`, the following fields in `EvidenceRecord.related_object_refs` carry ProofMesh-specific references:
```text
related_object_refs[*]
├── object_type  : "VerificationRun" | "VerificationClaim" | "ReplayCapsule" | "FaultScenario"
├── logical_id   : Uuid
└── content_hash : ContentHash
```

**Verification-specific metadata** is embedded in `EvidenceRecord.payload` as a structured JSON subobject:
```json
{
  "pm_evidence_type": "UNIT | INTEGRATION | TCP_REAL | PQ_HANDSHAKE | ADVERSARIAL | REPLAY | FAULT_INJECTION",
  "pm_execution_mode": "ISOLATED | SYSTEMIC",
  "pm_verdict": "PASS | FAIL | INDETERMINATE | TIMEOUT",
  "pm_failure_class": "...",
  "pm_run_id": "uuid",
  "pm_claim_id": "uuid"
}
```

**Signature**: ML-DSA-87. Identical to all other `EvidenceRecord` entries. No exception.

**Merkle tree**: Written to a `VERIFICATION` sub-tree of the Audit Ledger (third category alongside `DECISION` and `OUTCOME`). This resolves the Merkle tree question from §11 of Pass 1.

**No new identity type**: The `EvidenceId` for verification evidence is still `BLAKE3 of EvidenceRecord bytes`, same as all other evidence.

---

### CANONICAL OBJECT 2: `ExecutionPlan`

**Kind**: New canonical object  
**Purpose**: A speculative, policy-gated set of `VerificationRun` specifications produced by the adaptive scheduler.

```text
ExecutionPlan
├── logical_id        : Uuid               ← LogicalId
├── content_hash      : ContentHash        ← BLAKE3 of canonical bytes
├── schema_version    : SchemaVersion
├── TenantScoped<ExecutionPlan>
│   ├── tenant_id     : TenantId (or scope marker)
│   └── scope_hash    : [u8; 32]
├── scope             : VerificationScope
├── target_claims     : Vec<Uuid>          ← logical_ids of VerificationClaims
├── scheduled_runs    : Vec<VerificationRunSpec>  ← specifications (not yet dispatched runs)
├── resource_budget   : ResourceBudget
├── status            : Enum:
│                       SPECULATIVE | POLICY_APPROVED | EXECUTING | COMPLETED | CANCELLED
├── generated_by      : SchedulerProvenance  ← which scheduler version + model artifact hash
├── config_hash       : ConfigurationHash   ← A4
├── time              : TimeContext          ← logical_time = None until committed
└── provenance        : ProvenanceTrail
```

**State rule**: An `ExecutionPlan` in `SPECULATIVE` status MUST NOT dispatch any `VerificationRun`. This is the CONST-1 equivalent for the verification plane. The scheduler (intelligence) proposes; the `VerificationPolicyEngine` (control) approves.

**`SchedulerProvenance`**: References a `ModelArtifactHash` (existing frozen type) of the scheduling heuristic. Not a free-form string. This resolves Pass 1 Q5.

---

### CANONICAL OBJECT 3: `VerificationRun`

**Kind**: New canonical object  
**Purpose**: A single dispatched test execution unit under an approved `ExecutionPlan`.

```text
VerificationRun
├── logical_id         : Uuid              ← LogicalId
├── content_hash       : ContentHash       ← BLAKE3 of canonical bytes
├── schema_version     : SchemaVersion
├── TenantScoped<VerificationRun>
│   ├── tenant_id      : TenantId (or scope marker)
│   └── scope_hash     : [u8; 32]
├── scope              : VerificationScope
├── plan_id            : Uuid              ← logical_id of parent ExecutionPlan
├── claim_id           : Uuid              ← logical_id of target VerificationClaim
├── test_spec          : TestSpec
│   ├── binary_hash    : ContentHash       ← BLAKE3 of test binary
│   ├── args           : Vec<String>
│   ├── env_hash       : ContentHash       ← BLAKE3 of environment parameters
│   └── resource_constraints : ResourceConstraints
├── state_snapshot_ref : StateSnapshotId   ← Raft-committed snapshot; MUST be VARDHAN_COMMITTED_STATE
├── status             : Enum:
│                        PENDING | RUNNING | COMPLETED | FAILED | TIMEOUT | CANCELLED
├── evidence_record_ref: EvidenceId?       ← set on completion; BLAKE3-id of resulting EvidenceRecord
├── time               : TimeContext
│   ├── event_time     : DateTime<Utc>     ← when run was dispatched (A3: event time)
│   ├── system_time    : DateTime<Utc>?    ← when Vardhan observed completion
│   ├── logical_time   : CommitIndex?      ← A3: None until evidence Raft-committed
│   └── deadline_time  : DateTime<Utc>?   ← run timeout deadline
├── config_hash        : ConfigurationHash  ← A4
└── provenance         : ProvenanceTrail
```

**Time semantics correction** (Pass 1 error fixed):  
- `event_time`: when the run was dispatched — known at creation.  
- `system_time`: when Vardhan observed completion — known at completion.  
- `logical_time`: `None` until the resulting `EvidenceRecord` is Raft-committed. A run object itself is never directly Raft-committed; only its evidence output is.  

`start_logical_time` and `end_logical_time` from Pass 1 are **removed**. They were a category error.

---

### CANONICAL OBJECT 4: `ReplayCapsule`

**Kind**: New canonical object  
**Purpose**: A determinism-sufficient description of a past `VerificationRun` that allows exact reproducible replay.

```text
ReplayCapsule
├── logical_id           : Uuid            ← LogicalId
├── content_hash         : ContentHash     ← BLAKE3 of canonical bytes; changes if ANY field changes
├── schema_version       : SchemaVersion
├── TenantScoped<ReplayCapsule>
│   ├── tenant_id        : TenantId (or scope marker)
│   └── scope_hash       : [u8; 32]
├── scope                : VerificationScope
├── original_run_id      : Uuid            ← logical_id of the VerificationRun being replayed
├── original_evidence_id : EvidenceId      ← BLAKE3-id of the original EvidenceRecord
├── state_snapshot_ref   : StateSnapshotId ← MUST match original run's snapshot
├── commit_index         : CommitIndex     ← logical anchor; the Raft commit_index of the snapshot
├── test_spec            : TestSpec        ← MUST be byte-identical to original
├── random_seed          : u64             ← fixed for determinism
├── executor_version     : String          ← semver of the test executor binary
├── executor_hash        : ContentHash     ← BLAKE3 of the executor binary
├── compatibility_policy : Enum:
│                          STRICT |        ← executor_hash must match exactly
│                          MINOR_OK |      ← semver minor version upgrade permitted
│                          PATCH_OK        ← semver patch version upgrade permitted
├── config_hash          : ConfigurationHash ← A4: must match original run's config_hash
├── time                 : TimeContext
└── provenance           : ProvenanceTrail
```

**Determinism rules** (strengthening Pass 1):
- A replay with a different `state_snapshot_ref` is NOT a replay — it is a new `VerificationRun`.
- A replay with a different `random_seed` is NOT a replay.
- A replay with a different `executor_hash` and `compatibility_policy = STRICT` is NOT a replay.
- If `compatibility_policy = MINOR_OK` and `executor_version` semver minor incremented, the replay is valid but produces a `ReplayComparison` tagged `VERSION_UPGRADED`.
- A `VERSION_UPGRADED` replay that changes verdict produces a `VerificationFinding` with `verdict = INDETERMINATE` pending root cause analysis.

**Cross-version replay**: Resolves Pass 1 Q6. Version compatibility is explicit, not assumed.

---

### CANONICAL OBJECT 5: `EvidenceQuorum`

**Kind**: New canonical object  
**Purpose**: Tracks the accumulation state of diverse, independent evidence toward satisfying an `EvidencePolicy` for a given `VerificationClaim`.

```text
EvidenceQuorum
├── logical_id           : Uuid            ← LogicalId
├── content_hash         : ContentHash     ← BLAKE3 of canonical bytes
├── schema_version       : SchemaVersion
├── TenantScoped<EvidenceQuorum>
│   ├── tenant_id        : TenantId (or scope marker)
│   └── scope_hash       : [u8; 32]
├── scope                : VerificationScope
├── claim_id             : Uuid            ← logical_id of VerificationClaim
├── policy_ref           : PolicyId        ← references existing Policy object
├── collected_evidence   : Vec<QuorumEntry>
│   └── QuorumEntry
│       ├── evidence_id          : EvidenceId    ← BLAKE3-id of contributing EvidenceRecord
│       ├── pm_evidence_type     : EvidenceTypeEnum
│       ├── pm_execution_mode    : ExecutionModeEnum
│       ├── independence_axis    : Vec<IndependenceAxis>   ← see below
│       └── verdict              : PASS | FAIL | INDETERMINATE | TIMEOUT
├── quorum_status        : Enum:
│                          INSUFFICIENT | SATISFIED | CONTRADICTED
├── satisfied_at_commit  : CommitIndex?    ← A3: logical time quorum was satisfied
├── config_hash          : ConfigurationHash ← A4
├── time                 : TimeContext
└── provenance           : ProvenanceTrail
```

**Evidence diversity vs. independence** (strengthening Pass 1):

These are distinct dimensions:

```text
Diversity:     Different evidence TYPES (UNIT vs TCP_REAL vs ADVERSARIAL)
Independence:  Different SOURCES that cannot have the same correlated failure mode
```

`IndependenceAxis` defines the independence dimension each piece of evidence contributes:

```text
IndependenceAxis (enum)
├── EXECUTION_ENVIRONMENT  ← different OS/runtime/container
├── EXECUTION_MODE         ← ISOLATED vs SYSTEMIC
├── CODE_PATH              ← different code path exercised (unit vs integration)
├── THREAT_MODEL           ← adversarial vs non-adversarial injection
├── NETWORK_TOPOLOGY       ← different cluster/node configuration
└── CRYPTO_KEY_MATERIAL    ← different PQ key pairs used
```

**Quorum invariants**:
- `SATISFIED` requires: (a) minimum PASS count per `EvidencePolicy`, AND (b) minimum independence axis coverage per `EvidencePolicy`. Counting passes alone is insufficient.
- `CONTRADICTED` if any `QuorumEntry.verdict = FAIL`.
- `INSUFFICIENT` if PASS count < minimum OR independence axes < required OR any required type missing.
- An `EvidenceRecord` with `pm_verdict = INDETERMINATE` contributes to no axis and does not count toward the quorum minimum.

---

### EXTENSION 2: `Policy` with `policy_type = EVIDENCE_POLICY`

**Kind**: Extension of existing frozen `Policy` canonical object — NOT a new object.  
**Purpose**: Define the quorum requirements for certifying a `VerificationClaim`.

Rather than introducing a new `EvidencePolicy` object, ProofMesh extends the existing `Policy` object (§12.2 of the frozen spec) with a new `policy_type` value: `EVIDENCE_POLICY`.

When `policy_type = EVIDENCE_POLICY`, the `rules: Vec<PolicyRule>` encodes:
```json
{
  "minimum_quorum": 3,
  "required_evidence_types": ["UNIT", "INTEGRATION", "ADVERSARIAL"],
  "required_independence_axes": ["CODE_PATH", "THREAT_MODEL"],
  "requires_replay": true,
  "requires_fault_injection": false,
  "min_systemic_evidence": 0
}
```

This keeps the Policy versioning, `policy_hash`, `effective_from/to`, and Raft persistence model without duplication.

---

### CANONICAL OBJECT 6: `VerificationFinding`

**Kind**: New canonical object  
**Purpose**: The authoritative, Raft-committed certification result for a `VerificationClaim`. The ONLY object that may transition a claim to `CERTIFIED`.

```text
VerificationFinding
├── logical_id         : Uuid              ← LogicalId
├── content_hash       : ContentHash       ← BLAKE3 of canonical bytes
├── schema_version     : SchemaVersion
├── TenantScoped<VerificationFinding>
│   ├── tenant_id      : TenantId (or scope marker)
│   └── scope_hash     : [u8; 32]
├── scope              : VerificationScope
├── claim_id           : Uuid              ← logical_id of VerificationClaim
├── quorum_ref         : Uuid              ← logical_id of EvidenceQuorum
├── quorum_content_hash: ContentHash       ← BLAKE3 of EvidenceQuorum at certification time
├── verdict            : Enum: CERTIFIED | FAILED | INDETERMINATE
├── failure_class      : VerificationOutcome?  ← populated when verdict != CERTIFIED
├── certified_by       : PolicyId          ← the Policy that governed certification
├── policy_eval_ref    : EvidenceId        ← evidence of the PolicyEvaluation (reuses existing object)
├── commit_index       : CommitIndex       ← A3: Raft commit index; assigned at commit
├── evidence_tree_root : CommitmentId      ← Merkle root of VERIFICATION evidence sub-tree at this commit
├── signatures         : Vec<Signature>    ← ML-DSA-87
├── config_hash        : ConfigurationHash ← A4
├── time               : TimeContext
└── provenance         : ProvenanceTrail
```

**Invariant PM-001**: A `VerificationFinding` is the ONLY trigger for `VerificationClaim → CERTIFIED`. A report, log, or console output is NEVER authoritative.

**Note on `policy_eval_ref`**: This references an `EvidenceRecord` produced by `PolicyEvaluation` (existing frozen object §12.3). ProofMesh reuses the existing policy evaluation infrastructure rather than creating a parallel one.

---

### CANONICAL OBJECT 7: `FaultScenario`

**Kind**: New canonical object  
**Purpose**: A typed, auditable description of a fault condition to be injected during verification.

```text
FaultScenario
├── logical_id        : Uuid              ← LogicalId
├── content_hash      : ContentHash       ← BLAKE3 of canonical bytes
├── schema_version    : SchemaVersion
├── TenantScoped<FaultScenario>
│   ├── tenant_id     : TenantId (or scope marker)
│   └── scope_hash    : [u8; 32]
├── scope             : VerificationScope
├── fault_type        : Enum:
│                       NETWORK_PARTITION | NODE_CRASH | BYZANTINE_MESSAGE |
│                       RESOURCE_EXHAUSTION | TIMING_STARVATION |
│                       CRYPTO_KEY_SUBSTITUTION | REPLAY_ATTACK |
│                       STATE_CORRUPTION | LEADER_ELECTION_DISRUPTION
├── execution_mode    : Enum: ISOLATED | SYSTEMIC
├── authorization_ref : Uuid?             ← logical_id of Authorization object (required if SYSTEMIC)
├── target_component  : String
├── parameters        : JsonValue
├── config_hash       : ConfigurationHash ← A4
├── time              : TimeContext
└── provenance        : ProvenanceTrail
```

**Invariant**: A `FaultScenario` with `execution_mode = SYSTEMIC` MUST reference a valid, unexpired `Authorization` object (existing canonical object, §12.4) with `action_type = SYSTEMIC_FAULT_INJECTION`. The `Authorization` itself must have completed the full `PolicyEvaluation` → `AssuranceResult` → authorization chain.

---

### EXTENSION 3: `Authorization` with `action_type = SYSTEMIC_FAULT_INJECTION`

**Kind**: Extension of existing frozen `Authorization` canonical object — NOT a new object.  
**Purpose**: Authorize systemic fault injection through the existing authorization chain.

The existing `Authorization` object (§12.4) has `action_id: ActionId`. ProofMesh adds:
- A new `action_type` value: `SYSTEMIC_FAULT_INJECTION`
- A new constraint: if `action_type = SYSTEMIC_FAULT_INJECTION`, `assurance_ref` must reference an `AssuranceResult` that evaluated the specific `FaultScenario.content_hash`.

This resolves Pass 1 error #10 (removing `DecisionTwinId` as authorization authority). ProofMesh systemic fault injection uses the same `PolicyEvaluation → AssuranceResult → Authorization` chain as any other privileged action. No new authority model is needed.

---

## 6. State Machine Delta

### New: `VerificationClaim` lifecycle

```
OPEN
  ── [ExecutionPlan POLICY_APPROVED for this claim] ──► EVIDENCE_GATHERING
  ── [deadline exceeded without plan] ──────────────────► EXPIRED

EVIDENCE_GATHERING
  ── [EvidenceQuorum.quorum_status = SATISFIED] ────────► QUORUM_SATISFIED
  ── [EvidenceQuorum.quorum_status = CONTRADICTED] ─────► FAILED
  ── [deadline exceeded] ───────────────────────────────► EXPIRED
  ── [config_hash stale] ───────────────────────────────► INDETERMINATE (revalidation)

QUORUM_SATISFIED
  ── [VerificationFinding committed, verdict=CERTIFIED] ─► CERTIFIED   [terminal]
  ── [VerificationFinding committed, verdict=FAILED] ────► FAILED      [terminal]
  ── [VerificationFinding committed, verdict=INDETERMINATE] ► INDETERMINATE
  ── [deadline exceeded] ───────────────────────────────► EXPIRED      [terminal]

INDETERMINATE
  ── [new ExecutionPlan approved, revalidation] ────────► EVIDENCE_GATHERING
  ── [deadline exceeded] ───────────────────────────────► EXPIRED      [terminal]
```

**Guard**: Every state transition of `VerificationClaim` is guarded by `VerificationPolicyEngine` (deterministic service). No intelligence component may directly trigger a state transition.

### New: `ExecutionPlan` lifecycle

```
SPECULATIVE
  ── [VerificationPolicyEngine.approve_plan() = PASS] ──► POLICY_APPROVED
  ── [claim expired or cancelled] ──────────────────────► CANCELLED [terminal]

POLICY_APPROVED
  ── [first VerificationRun dispatched] ────────────────► EXECUTING
  ── [claim cancelled] ─────────────────────────────────► CANCELLED [terminal]

EXECUTING
  ── [all VerificationRuns terminal] ───────────────────► COMPLETED [terminal]
  ── [resource exhaustion, manual cancellation] ────────► CANCELLED [terminal]
```

---

## 7. Trait Delta

Four new traits for `VARDHAN_OBJECT_TRAITS`. All follow existing trait conventions in the frozen spec.

### `VerificationEvidenceProducer`

Role: Produces `EvidenceRecord` entries (category=VERIFICATION) from `VerificationRun` outcomes.

```text
fn produce_evidence_record(
    run: &VerificationRun,
    outcome: RawOutcome,
    signing_key: &ML_DSA_87_PrivateKey,
) -> EvidenceRecord

fn commit_to_ledger(
    record: &EvidenceRecord,
    store: &dyn EvidenceStore,
) -> Result<EvidenceId, EvidenceError>
```

**Constraint**: `produce_evidence_record` is deterministic with respect to the same `run.logical_id` and `outcome`. No wall-clock timestamps are embedded in the evidence payload (only in `time.system_time`).

### `VerificationPolicyEngine`

Role: Deterministic authority for plan approval and claim certification. Analogous to `PolicyEngine` for business decisions.

```text
fn approve_plan(
    plan: &ExecutionPlan,
    policy: &Policy,
) -> PolicyDecision

fn evaluate_quorum(
    quorum: &EvidenceQuorum,
    policy: &Policy,  // policy_type = EVIDENCE_POLICY
) -> PolicyEvaluation  // reuses existing canonical object

fn certify_claim(
    claim: &VerificationClaim,
    policy_eval: &PolicyEvaluation,
    quorum: &EvidenceQuorum,
) -> VerificationFinding
```

**Constraint**: Purely deterministic. No ML inference. Every output is `EvidenceRecord`-backed.

### `ReplayEngine`

```text
fn build_capsule(
    run: &VerificationRun,
    compatibility_policy: CompatibilityPolicy,
) -> ReplayCapsule

fn execute_replay(
    capsule: &ReplayCapsule,
) -> (VerificationRun, EvidenceRecord)

fn compare_runs(
    original: &EvidenceRecord,
    replay: &EvidenceRecord,
) -> ReplayComparison
```

### `ClaimRegistry`

```text
fn register(claim: TenantScoped<VerificationClaim>) -> Result<Uuid, ClaimError>
fn get(id: Uuid) -> Option<TenantScoped<VerificationClaim>>
fn transition(id: Uuid, new_status: ClaimStatus, authority: &VerificationFinding) -> Result<()>
```

---

## 8. Test Contract Delta

Eight new test contracts. All must be added to `VARDHAN_TEST_CONTRACTS`.

### T-PM-CERT-001: Claim certification requires committed finding
> A `VerificationClaim` MUST NOT reach `status = CERTIFIED` unless a `VerificationFinding` with `verdict = CERTIFIED` and a valid `commit_index` exists in the Raft-committed VERIFICATION evidence tree. Enforcement: the `ClaimRegistry.transition()` method structurally requires a `&VerificationFinding` argument — the transition is compile-time impossible without one.

### T-PM-CERT-002: INDETERMINATE blocks certification
> A `VerificationFinding` with `verdict = INDETERMINATE` MUST NOT trigger `CERTIFIED`. `INDETERMINATE` is NOT `PASS`. This mirrors CONST-8 from the frozen spec.

### T-PM-EVID-001: Security claim diversity requirement
> A `VerificationClaim` with `claim_type = SECURITY` requires an `EvidencePolicy` specifying at minimum two distinct `evidence_type` values AND two distinct `independence_axis` values in its quorum. Enforcement: `VerificationPolicyEngine.evaluate_quorum()` rejects single-type quorums for SECURITY claims at evaluation time.

### T-PM-EVID-002: Evidence chain integrity
> Every `QuorumEntry.evidence_id` MUST resolve to a Raft-committed `EvidenceRecord` with `evidence_category = VERIFICATION`. Orphaned evidence IDs MUST be rejected by `EvidenceQuorum` evaluation.

### T-PM-REPLAY-001: Deterministic replay contract
> A `ReplayCapsule` executed with `compatibility_policy = STRICT` against the same inputs MUST produce a `VerificationRun` with the same `EvidenceRecord.payload.pm_verdict`. Any verdict divergence with STRICT policy is classified as `PRODUCT_FAILURE`, not `FLAKY`.

### T-PM-FI-001: Systemic fault injection requires authorization
> A `FaultScenario` with `execution_mode = SYSTEMIC` and no valid `Authorization` reference MUST be rejected before dispatch. The `VerificationRun` type system MUST make it impossible to construct a `SYSTEMIC` run without a resolved `Authorization.logical_id`. Enforcement: type-state pattern where possible, runtime check otherwise.

### T-PM-AI-001: Scheduler output is speculative
> An `ExecutionPlan` with `status = SPECULATIVE` MUST NOT trigger dispatch of any `VerificationRun`. Enforcement: `VerificationRun` construction requires `ExecutionPlan.status = POLICY_APPROVED`.

### T-PM-REPORT-001: Report is not evidence (INVARIANT-PM-001)
> A human-readable report file (Markdown, JSON, HTML, console output) MUST NOT be used as the basis for a `VerificationClaim` certification. Certification requires a Raft-committed `VerificationFinding`. The `ClaimRegistry` does not accept string inputs as certification evidence.

---

## 9. A7 Scope Resolution

Pass 1 left this unresolved. Resolution:

**Isolated verification execution** (`execution_mode = ISOLATED`):
- Operates entirely on ephemeral test state, not on Raft-committed authoritative state.
- Does NOT require A7 gate routing.
- Evidence produced is tagged `pm_execution_mode = ISOLATED`.

**Systemic fault injection** (`execution_mode = SYSTEMIC`):
- Mutates real, Raft-committed authoritative state.
- MUST route through the existing `VardhanAuthorityGate` (A7).
- Requires a valid `Authorization` object (extended with `action_type = SYSTEMIC_FAULT_INJECTION`).
- Evidence produced is tagged `pm_execution_mode = SYSTEMIC`.

**Certification of `VerificationClaim`**:
- `VerificationFinding` production is a Control Plane action (deterministic policy engine).
- It does NOT route through A7 (A7 is for Reality Plane execution, not for internal state transitions).
- `VerificationFinding` is committed through Raft evidence, not through A7.
- This is consistent with how `PolicyEvaluation` and `AssuranceResult` are committed — they are Control Plane objects committed to Raft, not Reality Plane mutations gated by A7.

This resolves Pass 1 Q1.

---

## 10. G0-G4 Alignment

Pass 1 proposed a parallel AI assurance chain. This is removed.

**Correct model**:

G0-G4 exists to assure AI/model outputs (Intelligence Plane crossing into Control Plane). ProofMesh does not re-run G0-G4 for verification evidence. Instead:

| Situation | Mechanism |
|-----------|-----------|
| AI scheduler produces `ExecutionPlan` (SPECULATIVE) | `VerificationPolicyEngine.approve_plan()` — deterministic structural validation. NOT G0-G4 (no AI model output being validated) |
| `EvidenceRecord` (category=VERIFICATION) committed | Existing `EvidenceStore` write path — G0 structural validation applies (schema, tenant scope, signature) |
| `EvidenceQuorum` evaluated | `VerificationPolicyEngine.evaluate_quorum()` — deterministic. NOT G0-G4 |
| `VerificationFinding` produced | `VerificationPolicyEngine.certify_claim()` — deterministic. Reuses existing `PolicyEvaluation` object |

G0 is reused for structural validation of `EvidenceRecord` entries when they are written to the ledger. G1-G4 are NOT reused for ProofMesh — they are specific to AI/model semantic validation, not test evidence validation.

---

## 11. Evidence Integrity Model

**Third Merkle tree**: `VERIFICATION` is added as a third `evidence_category` alongside `DECISION` and `OUTCOME`. It occupies a dedicated sub-tree in the Audit Ledger (L03), namespaced by `evidence_category`.

```text
Audit Ledger (L03)
├── Decision Evidence Merkle Tree
├── Outcome Evidence Merkle Tree
└── Verification Evidence Merkle Tree  [NEW]
    ├── EvidenceRecord (category=VERIFICATION)
    ├── VerificationFinding evidence records
    └── EvidenceQuorum evaluation records
```

The `CommitmentId` (Merkle root) for the VERIFICATION tree is checkpointed at each `commit_index`, identically to the other two trees.

This resolves Pass 1 Q2.

---

## 12. Failure Classification Model (Refactored)

Pass 1 used a flat enum. Refactored into three orthogonal dimensions:

### Outcome dimension
```text
VerificationOutcome
├── CLAIM_CERTIFIED       ← quorum satisfied, finding committed
├── CLAIM_FAILED          ← evidence contradicts claim
├── CLAIM_INDETERMINATE   ← evidence insufficient to certify or falsify
└── CLAIM_EXPIRED         ← deadline exceeded
```

### Cause dimension (proposed by AI, confirmed by policy engine)
```text
VerificationCause
├── PRODUCT_DEFECT         ← test reveals a real defect in production code
├── TEST_DEFECT            ← test itself has a defect (wrong assertion, wrong setup, synchronization error)
├── RESOURCE_STARVATION    ← test logic correct but timed out under load
├── RESOURCE_COLLISION     ← port conflict, file lock, shared state contamination
├── INFRASTRUCTURE_FAULT   ← OS, network, disk failure outside system under test
├── VERSION_INCOMPATIBILITY← binary version changed between runs; verdict divergence
└── UNKNOWN                ← cannot classify with available evidence
```

### Confidence dimension
```text
VerificationConfidence
├── HIGH          ← same verdict across ≥3 independent replay attempts
├── MEDIUM        ← same verdict across ≥2 independent replay attempts
├── LOW           ← single execution, not replayed
└── NONE          ← conflicting verdicts across replays
```

**Rules**:
- `UNKNOWN` cause is the initial state. AI/ML may propose a cause (producing a `SpeculativeCause` annotation in the evidence payload). The `VerificationPolicyEngine` confirms or overrides.
- `FLAKY` is NOT a valid final cause. It was a colloquial shorthand. A finding must have one of the defined causes or remain `UNKNOWN`.
- `VerificationConfidence = NONE` with conflicting replays produces `VerificationOutcome = CLAIM_INDETERMINATE`.

---

## 13. Replay Model

Determinism requirements for `ReplayCapsule`:

A replay is valid if and only if:
1. `state_snapshot_ref` is identical — same Raft `commit_index`, same `StateHash`.
2. `test_spec` is byte-identical (binary hash, args, env hash all match).
3. `random_seed` is identical.
4. `executor_hash` matches OR `compatibility_policy` permits the observed version delta.

A replay that changes verdict with `compatibility_policy = STRICT` is `VerificationCause = PRODUCT_DEFECT` (the product behaves non-deterministically under identical inputs).

A replay that changes verdict with `compatibility_policy = MINOR_OK` or `PATCH_OK` is `VerificationCause = VERSION_INCOMPATIBILITY` (the executor change introduced behavioral divergence).

A `ReplayCapsule` for a run that produced `INDETERMINATE` is required even for INDETERMINATE runs — this enables future replay when root cause analysis is complete.

---

## 14. Wall-Clock Invariant (Corrected)

Pass 1 stated: "Wall-clock sleeps as synchronization mechanisms in test code are `TEST_FAILURE`."

This was too broad. Corrected:

**Prohibited**: `sleep(duration)` as the SOLE synchronization mechanism — i.e., sleeping and then asserting that an asynchronous operation has completed without polling or awaiting a completion signal. This is `VerificationCause = TEST_DEFECT`.

**Permitted**: 
- Explicit temporal tests where wall-clock time IS the subject under test (e.g., testing that a deadline-triggered behavior fires within a time window).
- `sleep` inside a bounded polling loop where the sleep is the poll interval (as implemented in the C22 fix).
- Timeout values attached to `deadline_time` in `TimeContext` — these are legitimate temporal boundaries.

**Test contract addition**:
> **T-PM-WALL-001**: Test synchronization MUST NOT use bare `sleep(fixed_duration)` as a substitute for observing completion of an asynchronous operation. The correct pattern is: `invoke_operation() → poll_until(condition, interval, deadline) → assert`.

---

## 15. Object Set Minimization

Pass 1 arrived at 10 objects + 1 undefined (`EvidenceLink`). Pass 2 audit:

| Pass 1 Object | Pass 2 Decision | Reason |
|---------------|----------------|--------|
| `VerificationClaim` | RETAINED | Genuinely new; no existing object serves this purpose |
| `EvidenceObject` | REMOVED | Absorbed into `EvidenceRecord` with `category=VERIFICATION` |
| `ExecutionPlan` | RETAINED | Genuinely new; no existing object maps to a speculative test plan |
| `VerificationRun` | RETAINED | Genuinely new; distinct from `ExecutionPlan` (spec vs. dispatch) |
| `ReplayCapsule` | RETAINED | Genuinely new; captures determinism inputs |
| `EvidenceQuorum` | RETAINED | Genuinely new; no existing quorum model |
| `EvidencePolicy` | CHANGED to Policy extension | Existing `Policy` + `policy_type=EVIDENCE_POLICY` is sufficient |
| `VerificationFinding` | RETAINED | Genuinely new; the authoritative certification object |
| `FaultScenario` | RETAINED | Genuinely new; typed fault descriptor |
| `FaultInjectionAuthorization` | REMOVED | Absorbed into existing `Authorization` + `action_type` |
| `EvidenceLink` | REMOVED | Was undefined; replaced by `EvidenceRecord.related_object_refs` |

**Final count**: 7 new canonical objects + 3 extensions of existing objects.

---

## 16. Construct Taxonomy

Explicitly distinguishing all ProofMesh constructs:

### Canonical Objects (new, to be added to `VARDHAN_CANONICAL_OBJECT_SPEC`)
1. `VerificationClaim`
2. `ExecutionPlan`
3. `VerificationRun`
4. `ReplayCapsule`
5. `EvidenceQuorum`
6. `VerificationFinding`
7. `FaultScenario`

### Extensions of Existing Canonical Objects
1. `EvidenceRecord` — new `evidence_category = VERIFICATION`
2. `Policy` — new `policy_type = EVIDENCE_POLICY`
3. `Authorization` — new `action_type = SYSTEMIC_FAULT_INJECTION`

### New Traits (to be added to `VARDHAN_OBJECT_TRAITS`)
1. `VerificationEvidenceProducer`
2. `VerificationPolicyEngine`
3. `ReplayEngine`
4. `ClaimRegistry`

### Runtime Services (implementation, NOT canonical objects, NOT traits)
1. `VerificationScheduler` (adaptive scheduler — Intelligence Plane component)
2. `VerificationReplayEngine` (concrete implementation of `ReplayEngine` trait)
3. `FaultInjector` (concrete implementation dispatching `FaultScenario`)

### Graph Relationships (NOT canonical objects)
1. `VerificationGraph` — a DAG view over `VerificationClaim` nodes and their `EvidenceRecord` edges; materialized from existing canonical objects, not separately persisted.

### Evidence Records (instances of the existing `EvidenceRecord` canonical object)
- All ProofMesh evidence is stored as `EvidenceRecord` with `category = VERIFICATION`.

---

## 17. Non-Goals / Rejected Duplications

This section explicitly documents which existing Vardhan objects and mechanisms ProofMesh intentionally reuses rather than duplicates.

| Temptation | Decision | Existing mechanism reused |
|------------|----------|--------------------------|
| New evidence record format | REJECTED | `EvidenceRecord` extended with `evidence_category = VERIFICATION` |
| New policy object for quorum requirements | REJECTED | Existing `Policy` with `policy_type = EVIDENCE_POLICY` |
| New authorization object for fault injection | REJECTED | Existing `Authorization` with `action_type = SYSTEMIC_FAULT_INJECTION` |
| New parallel G0-G4 assurance chain for evidence | REJECTED | G0 reused for structural validation; G1-G4 not applicable to test evidence |
| New Raft log for verification | REJECTED | Existing Raft + Audit Ledger (L03) with VERIFICATION sub-tree |
| New signature algorithm | REJECTED | ML-DSA-87 mandated by frozen spec |
| New identity type for evidence | REJECTED | `EvidenceId = BLAKE3(EvidenceRecord)` per frozen spec |
| New `TenantScoped` implementation | REJECTED | Existing `TenantScoped<T>` wrapper with `scope_hash` |
| `DecisionTwin` as authorization authority | REJECTED | Existing `Authorization` + `PolicyEvaluation` chain |
| Flat failure classification (`FLAKY`) | REJECTED | Three-dimensional outcome × cause × confidence model |
| Self-referential report attestation | REJECTED | Verification target SHA and attestation commit are always separate objects |

---

## 18. Unresolved Questions (Reduced from 6 to 2)

Pass 1 had 6 unresolved questions. 4 are now resolved:

| Q | Pass 1 | Pass 2 Status |
|---|--------|--------------|
| Q1 | A7 scope for certification | ✅ RESOLVED (§9): certification is Control Plane, not Reality Plane |
| Q2 | Verification Evidence Merkle tree topology | ✅ RESOLVED (§11): VERIFICATION sub-tree in L03 |
| Q3 | Tenant scoping for platform claims | ✅ RESOLVED (§4): `VerificationScope` model with scope markers |
| Q4 | INDETERMINATE type sharing | ✅ RESOLVED: distinct outcome dimension in §12; same semantic rule |
| Q5 | Scheduler provenance depth | ✅ RESOLVED (§5): `ModelArtifactHash` from frozen spec |
| Q6 | Replay across binary versions | ✅ RESOLVED (§4, §13): `compatibility_policy` field |

**Remaining unresolved questions**:

**RQ-1 — Verification Ledger write ordering under Raft**:  
When a `VerificationRun` completes and produces an `EvidenceRecord`, the `VerificationRun` object itself is not Raft-committed (it is ephemeral). Only the `EvidenceRecord` is committed. This means the `VerificationRun.evidence_record_ref` field is populated AFTER the evidence is committed. Is the `VerificationRun` object stored at all, or only its resulting `EvidenceRecord`? If it is stored, what store owns it and when does it become authoritative? This question requires a decision before `VARDHAN_CANONICAL_OBJECT_SPEC` is amended.

**RQ-2 — EvidenceQuorum mutability**:  
An `EvidenceQuorum` accumulates evidence over time as `VerificationRun` instances complete. Each accumulation changes `collected_evidence`, which changes `content_hash`. Does `EvidenceQuorum` follow the same append-only evidence pattern as other Vardhan objects (each mutation produces a new version in the Raft log), or is it an in-memory accumulator that only produces a single committed record when `quorum_status` transitions? The choice affects how `EvidenceQuorum` participates in the Raft evidence chain.

---

## 19. Proposed Specification Freeze Set

Unchanged from Pass 1 with corrected scope:

| Specification | Change Type | Change |
|---------------|-------------|--------|
| `VARDHAN_CANONICAL_OBJECT_SPEC` | Addition | 7 new canonical objects (§5) |
| `VARDHAN_CANONICAL_OBJECT_SPEC` | Extension | 3 existing objects extended (§5) |
| `VARDHAN_STATE_MACHINES` | Addition | 2 new state machines (§6) |
| `VARDHAN_OBJECT_TRAITS` | Addition | 4 new traits (§7) |
| `VARDHAN_TEST_CONTRACTS` | Addition | 8 new contracts T-PM-*, 1 updated T-PM-WALL-001 (§8, §14) |
| `VARDHAN_AI_INTELLIGENCE_DESIGN` | Extension | `VerificationScheduler` as Intelligence Plane component (§10) |
| `VARDHAN_ARCHITECTURE_CONSTITUTION` | Extension | INVARIANT-PM-001; `VerificationScope` model; VERIFICATION evidence tree (§2, §4, §11) |
| `VARDHAN_SYSTEM_MAP` | Extension | ProofMesh component placement diagram (§3) |

**No specification is modified until both RQ-1 and RQ-2 are resolved.**

---

## 20. Implementation Prerequisites

Before any implementation code is written:

1. **Resolve RQ-1**: `VerificationRun` storage and ownership.
2. **Resolve RQ-2**: `EvidenceQuorum` mutability model.
3. **Freeze** 7 new canonical objects in `VARDHAN_CANONICAL_OBJECT_SPEC`.
4. **Freeze** 3 object extensions in `VARDHAN_CANONICAL_OBJECT_SPEC`.
5. **Freeze** 2 new state machines in `VARDHAN_STATE_MACHINES`.
6. **Freeze** 4 new traits in `VARDHAN_OBJECT_TRAITS`.
7. **Freeze** 9 new/updated test contracts in `VARDHAN_TEST_CONTRACTS`.
8. **Freeze** INVARIANT-PM-001 in `VARDHAN_ARCHITECTURE_CONSTITUTION`.
9. **Instantiate** the first 3 `VerificationClaim` objects representing SEC-003, SEC-010, SEC-018 using the new canonical format as a smoke test of the model.
10. **Confirm** that the Phase 0.2 verified evidence (EXIT_CODE=0, target SHA `4711305`) is expressible as a `VerificationFinding` seeding the first committed `EvidenceQuorum`.

Only after all 10 prerequisites are satisfied may implementation of the ProofMesh runtime services begin.

---

*This document is a delta analysis only. No frozen specification has been modified.*  
*ProofMesh Phase 5 — Reconciliation Pass 2*  
*Analysis baseline: 2026-09-24*
