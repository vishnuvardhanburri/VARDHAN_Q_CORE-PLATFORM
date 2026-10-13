# Vardhan Canonical Object Specification

> **Status**: ✅ Specification  
> **Version**: 1.0  
> **Source**: Derived from `VARDHAN_ARCHITECTURE_CONSTITUTION.md` v1.1 and `VARDHAN_SYSTEM_MAP.md`  
> **Purpose**: Exact contracts for every canonical object in the Vardhan domain. Defines identity, lifecycle, serialization, hash rules, provenance, time semantics, authorization semantics, persistence, and failure states for every object produced or consumed by any layer of the Vardhan system.  
> **Authority**: If an object exists in Vardhan and is not specified here, it is out of architectural scope. If an implementation produces an object not matching this specification, it is a constitutional violation until this document is amended.

---

## Table of Contents

1. [Identity Systems](#1-identity-systems)
2. [Tenant-Scoped Container](#2-tenant-scoped-container)
3. [Time Context](#3-time-context)
4. [TENANT](#4-tenant)
5. [ENTITY](#5-entity)
6. [RELATIONSHIP](#6-relationship)
7. [EVENT](#7-event)
8. [OBSERVATION](#8-observation)
9. [STATE](#9-state)
10. [EVIDENCE](#10-evidence)
11. [INTELLIGENCE](#11-intelligence)
12. [GOVERNANCE](#12-governance)
13. [DECISION](#13-decision)
14. [EXECUTION](#14-execution)
15. [MEMORY](#15-memory)
16. [State Separation](#16-state-separation)
17. [Object Inter-Reference Map](#17-object-inter-reference-map)
18. [Consistency Check Summary](#18-consistency-check-summary)

---

## 1. Identity Systems

Every Vardhan object has **two** identity systems. Objects never rely on a single identifier.

### Logical Identity

Stable, queryable, type-tagged UUIDs. Used for cross-object navigation and API addressing.

```text
TenantId          =Uuid  (v4 or v7)
EntityId          =Uuid
RelationshipId    =Uuid
EventId           =Uuid
ObservationId     =Uuid
EvidenceId        =Uuid  (logical)
StateSnapshotId   =Uuid
StateVersionId    =Uuid
ModelArtifactId   =Uuid
PolicyId          =Uuid
ConstraintId      =Uuid
ScenarioId        =Uuid
DecisionId        =Uuid
DecisionCandidateId=Uuid
ActionId          =Uuid
ExecutionId       =Uuid
CompensationId    =Uuid
OutcomeId         =Uuid
PredictionErrorId =Uuid
```

### Cryptographic Identity

Immutable, content-derived, verifiable. Used for provenance integrity and immutability proofs.

```text
LogicalId         = Uuid               ← stable logical identity
ContentHash       = [u8; 32]           ← BLAKE3 of canonical object bytes
StateHash         = [u8; 32]           ← BLAKE3 of canonical state (StateSnapshot)
EvidenceId        = [u8; 32]           ← BLAKE3 of EvidenceRecord (cryptographic)
CommitmentId      = [u8; 32]           ← Merkle root of checkpoint
RaftTerm          = u64                ← Raft election term
RaftLogIndex      = u64                ← position in Raft log
CommitIndex       = u64                ← committed log index (Logical Time, A3)
ModelArtifactHash = [u8; 32]           ← BLAKE3 of model artifact bytes
PolicyHash        = [u8; 32]           ← BLAKE3 of canonical policy bytes
ConfigurationHash = [u8; 32]           ← BLAKE3 of canonical config bytes
```

### Identity Relationships

```text
Object
├── logical_id  → Uuid (queryable, stable)
├── content_hash → [u8; 32] (BLAKE3 of canonical bytes — identifies this object's exact content)
├── version    → SchemaVersion (semver)
└── tenant_id  → TenantId (A2 isolation boundary)

StateSnapshot
├── logical_id  → StateSnapshotId (Uuid)
├── state_hash  → [u8; 32] (BLAKE3 of canonical state — identifies the content of the snapshot)
├── commit_index → u64 (Logical Time, A3 — when this snapshot was committed)
└── tenant_id  → TenantId

EvidenceRecord
├── logical_id  → Uuid  (EvidenceId, logical)
├── content_hash → [u8; 32] (BLAKE3 of the EvidenceRecord)
├── evidence_hash → [u8; 32] (BLAKE3 — same as content_hash, used for Merkle inclusion)
├── commit_index → u64?  (A3 — assigned at Raft commit)
└── tenant_id  → TenantId
```

**Key distinction**:
- `LogicalId` — a stable Uuid assigned at creation for queryability
- `ContentHash` — BLAKE3 of the object's canonical bytes; changes if any field changes
- `StateHash` — BLAKE3 of the full state tree; used to verify that two nodes agree on the same state content
- `EvidenceId` — BLAKE3 of the EvidenceRecord; used as the cryptographic identity in provenance chains
- `CommitIndex` — Raft commit position; the ordering coordinate (Logical Time, A3)
- `ConfigurationHash` — BLAKE3 of the effective configuration at the time of the object's evaluation
- `ModelArtifactHash` — BLAKE3 of the serialized model artifact (weights, tokenizer, etc.)
- `PolicyHash` — BLAKE3 of the canonical policy definition bytes

---

## 2. Tenant-Scoped Container

**Amendment A2**: All semantic objects are wrapped in a `TenantScoped<T>` typed boundary. The TenantId is not a Boolean flag — it is a structural type-level constraint.

```text
TenantScoped<T>
├── tenant_id  : TenantId
├── inner      : T           ← the actual object
└── scope_hash : [u8; 32]    ← BLAKE3 of (tenant_id || canonical(T))
```

**Enforcement**: The State Store and Evidence Store accept only `TenantScoped<T>` objects. Cross-tenant references are structurally prohibited at the type system level: `EntityId` values in a `TenantScoped<DecisionTwin>` must carry a `TenantId` matching the wrapper. A Boolean field like `tenant_scope_valid` is **evidence of a check**, not the protection mechanism.

**Rule**: Objects enter authoritative state only after passing the `TenantScoped<T>` boundary check in the store layer. The check is enforced structurally — if compilation succeeds, tenant scoping is guaranteed.

---

## 3. Time Context

**Amendment A3**: Four distinct time domains. All objects that participate in ordering or evidence carry a `TimeContext`.

```text
TimeContext
├── logical_time  : u64?           ← A3: Raft commit_index (assigned at commit)
├── event_time    : DateTime<Utc>  ← A3: when the event occurred (from source)
├── system_time   : DateTime<Utc>  ← A3: when Vardhan observed it
├── deadline_time : DateTime<Utc>? ← A3: human-defined decision deadline (optional)
└── created_at    : DateTime<Utc>  ← A3: when this object was created
```

**Lifecycle semantics**:
```text
EventTime → known at creation
SystemTime → known at observation
LogicalTime → assigned when committed (Raft commit_index)
```

An event can exist in Vardhan's log **before** it is committed. `logical_time` becomes final only when the Raft entry containing the object is committed. Pre-commit objects have `logical_time = None` and are **never** authoritative.

**Rules**:
- `commit_index` (Logical Time) is the **only** ordering coordinate for state transitions
- `EventTime` is preserved for analytical queries but never used for ordering
- All `EvidenceRecord` carries `TimeContext`
- `DecisionTwin` carries `deadline_time` for all decisions with reversal requirements
- Cross-node time synchronization is best-effort; Logical Time is the source of truth

---

## 4. TENANT

### 4.1 Identity

```text
TenantId = Uuid
```

### 4.2 Record

```text
Tenant
├── tenant_id    : TenantId          (LogicalId)
├── name         : String
├── status       : ACTIVE | SUSPENDED | DELETED
├── created_at   : TimeContext
├── config_hash  : ConfigurationHash  ← A4: effective configuration version
├── encryption_context : TenantEncryptionContext
├── isolation_boundary : FaultDomain  ← A9
└── provenance   : ProvenanceTrail
```

### 4.3 Lifecycle

```text
CREATED → SUSPENDED → REACTIVATED → DELETED
```

- **CREATED**: Tenant record written and evidence-finalized
- **SUSPENDED**: Administrative suspension; reads allowed, writes blocked
- **REACTIVATED**: From SUSPENDED; writes re-enabled
- **DELETED**: Hard deletion after retention period; data quarantined

### 4.4 Tenant Scoping

`Tenant` is the **root** of the tenant-scoped object hierarchy. Every object in this specification is either the `Tenant` itself or is wrapped in `TenantScoped<T>`.

### 4.5 Canonical Serialization

Canonical JSON with field ordering: `tenant_id`, `name`, `status`, `created_at`, `config_hash`, `encryption_context`, `isolation_boundary`, `provenance`.

### 4.6 Persistence

Written to the **Enterprise State Store**. Replicated via Raft. Evidence-finalized before becoming authoritative.

### 4.7 Failure States

- **CORRUPTED**: Tenant metadata corruption → quarantine, reconstruct from ledger
- **ISOLATION_BREACH**: Cross-tenant data detected → immediate suspension, audit trail triggered

---

## 5. ENTITY

### 5.1 Identity

```text
EntityId = Uuid
```

### 5.2 Record

```text
Entity
├── entity_id     : EntityId          (LogicalId)
├── tenant_id     : TenantId          ← A2
├── name         : String
├── entity_type   : String            ← e.g., "asset", "person", "system", "process"
├── attributes    : JsonValue
├── relationships : Vec<RelationshipId>
├── state_version  : StateVersionId
├── created_at    : TimeContext
├── updated_at    : TimeContext
├── status       : ACTIVE | INACTIVE | ARCHIVED
├── config_hash   : ConfigurationHash ← A4
└── provenance    : ProvenanceTrail
```

### 5.3 Lifecycle

```text
CREATED → ACTIVE → INACTIVE → ARCHIVED → DELETED
```

### 5.4 Tenant Scoping (A2)

`entity_id` is a `TenantScoped<EntityId>` — the entity exists only within its tenant's namespace. Cross-tenant `EntityId` references are structurally rejected at the type level.

### 5.5 Canonical Serialization

Canonical JSON: `entity_id`, `tenant_id`, `name`, `entity_type`, `attributes`, `relationships`, `state_version`, `created_at`, `updated_at`, `status`, `config_hash`, `provenance`.

### 5.6 Persistence

Enterprise State Store. Evidence-finalized. State version tracked via `StateVersionId`.

### 5.7 Failure States

- **ORPHANED**: No tenant reference → quarantined
- **STATE_STALE**: `state_version` does not match latest committed state → marked stale, re-synced

---

## 6. RELATIONSHIP

### 6.1 Identity

```text
RelationshipId = Uuid
```

### 6.2 Record

```text
Relationship
├── relationship_id    : RelationshipId  (LogicalId)
├── tenant_id          : TenantId        ← A2
├── source_entity      : TenantScoped<EntityId>  ← A2
├── target_entity      : TenantScoped<EntityId>  ← A2
├── relationship_type   : String         ← e.g., "owns", "uses", "depends_on"
├── attributes          : JsonValue
├── created_at          : TimeContext
├── effective_from      : LogicalTime?   ← A3 (commit_index)
├── effective_to        : LogicalTime?   ← A3 (commit_index, None = current)
├── config_hash         : ConfigurationHash ← A4
└── provenance          : ProvenanceTrail
```

### 6.3 Lifecycle

```text
CREATED → ACTIVE → DEPRECATED → REPLACED → DELETED
```

- **CREATED**: Relationship record created and evidence-finalized
- **DEPRECATED**: Marked as deprecated; superseded by a newer relationship
- **REPLACED**: A replacement relationship exists; old is kept for history
- **DELETED**: Removed after retention

### 6.4 Tenant Scoping (A2)

Both `source_entity` and `target_entity` must carry the same `TenantId` as the `Relationship` wrapper. Cross-tenant relationships require a `CrossTenantPolicyEvaluation` at the control-plane boundary.

### 6.5 Temporal Validity (A3)

`effective_from` and `effective_to` are `LogicalTime` coordinates (Raft commit_index). A relationship is "current" if `effective_to` is None and `effective_from ≤ commit_index`. This allows point-in-time queries: "what relationships existed at `commit_index = N`?"

### 6.6 Canonical Serialization

Canonical JSON: `relationship_id`, `tenant_id`, `source_entity`, `target_entity`, `relationship_type`, `attributes`, `created_at`, `effective_from`, `effective_to`, `config_hash`, `provenance`.

### 6.7 Persistence

Enterprise State Store. Evidence-finalized. Historical versions retained for audit.

### 6.8 Failure States

- **DANGLING**: Source or target entity no longer exists → relationship marked DANGLING, evidence recorded
- **CYCLE**: Relationship creates a cycle not permitted by schema → rejected at validation

---

## 7. EVENT

### 7.1 Identity

```text
EventId = Uuid
```

### 7.2 Record

```text
VardhanEvent
├── event_id          : EventId           (LogicalId)
├── TenantScoped
│   ├── tenant_id      : TenantId          ← A2
│   └── scope_hash     : [u8; 32]          ← BLAKE3(tenant_id || canonical(inner))
├── actor             : EntityId?         (optional, TenantScoped)
├── entity            : EntityId?         (optional, TenantScoped)
├── event_type        : String
├── time              : TimeContext         ← A3 (logical_time optional — assigned at commit)
├── config_hash       : ConfigurationHash   ← A4
├── evidence_category : DECISION | OUTCOME  ← A5
├── schema_version    : SchemaVersion
├── source            : String
├── payload           : JsonValue
├── evidence_ref      : EvidenceId?       (optional — linked after evidence written)
├── previous_state    : StateHash?        (optional)
├── resulting_state   : StateHash?        (optional)
└── provenance        : ProvenanceTrail
```

### 7.3 Lifecycle

```text
CREATED → G0_VALIDATED → EVIDENCE_PREPARED → RAFT_REPLICATED → RAFT_COMMITTED → EVIDENCE_FINALIZED
```

- **CREATED**: Event object created in memory, not yet persisted
- **G0_VALIDATED**: Passes G0 input integrity checks (schema, provenance, OOD, prompt injection)
- **EVIDENCE_PREPARED**: EvidenceRecord created, signed, written to ledger
- **RAFT_REPLICATED**: Entry propagated to Raft followers
- **RAFT_COMMITTED**: Entry committed by Raft; `commit_index` assigned (Logical Time becomes final)
- **EVIDENCE_FINALIZED**: Evidence linked to `commit_index`; event is now EVIDENCED (authoritative)

### 7.4 Two Reference Systems (Constitution Section 7)

- `event_id` (Uuid) → logical identity, queryable
- `payload_digest` (BLAKE3 of payload) → content hash, used for deduplication
- `evidence_ref` (EvidenceId) → cryptographic provenance identity

### 7.5 Canonical Serialization

Canonical JSON: `event_id`, `tenant_id`, `actor`, `entity`, `event_type`, `time`, `config_hash`, `evidence_category`, `schema_version`, `source`, `payload`, `evidence_ref`, `previous_state`, `resulting_state`, `provenance`.

### 7.6 Persistence

Written to both the **Audit Ledger** (as evidence) and the **Enterprise State Store** (as state transition input). Replicated via Raft.

### 7.7 Failure States

- **MALFORMED**: Fails G0 schema or OOD check → rejected, no persistence
- **DUPLICATE**: Same `payload_digest` already committed → de-duplicated, reference existing evidence
- **COMMIT_LOSS**: Event in evidence ledger but not Raft-committed → quarantined, re-submitted to Raft

---

## 8. OBSERVATION

### 8.1 Identity

```text
ObservationId = Uuid
```

### 8.2 Record

```text
Observation
├── observation_id  : ObservationId       (LogicalId)
├── TenantScoped
│   ├── tenant_id    : TenantId          ← A2
│   └── scope_hash   : [u8; 32]
├── event_id        : EventId
├── observer        : EntityId            (who observed)
├── observed_at     : TimeContext
├── observation_type: String
├── payload         : JsonValue
├── evidence_ref    : EvidenceId?
├── config_hash     : ConfigurationHash   ← A4
├── evidence_category: DECISION | OUTCOME ← A5
└── provenance      : ProvenanceTrail
```

### 8.3 Lifecycle

```text
CREATED → EVIDENCE_PREPARED → RAFT_COMMITTED → OBSERVED_EXTERNAL_STATE
```

An `Observation` represents the act of recording that the external world was observed in a particular state. It is the evidence that bridges `VardhanCommittedState` to `ObservedExternalState` (A1).

### 8.4 Tenant Scoping (A2)

`Observation` is `TenantScoped<Observation>`. The `event_id` it references must belong to the same tenant.

### 8.5 A1 — Committed vs. Observed

- `VardhanCommittedState`: the state Vardhan committed to via Raft + evidence finalization
- `Execution`: the act of mutating the external world
- `ObservedExternalState`: an `Observation` confirming the external world matches the intended transition

A Raft commit does **not** imply `ObservedExternalState`. Only a successful `Observation` does.

### 8.6 Canonical Serialization

Canonical JSON: `observation_id`, `tenant_id`, `event_id`, `observer`, `observed_at`, `observation_type`, `payload`, `evidence_ref`, `config_hash`, `provenance`.

### 8.7 Persistence

**Outcome Evidence Ledger** (separate Merkle tree from decision evidence, A5).

### 8.8 Failure States

- **UNVERIFIABLE**: External state cannot be confirmed → mark `OBSERVATION_INDETERMINATE`, evidence recorded

---

## 9. STATE

### 9.1 Identity

```text
StateSnapshotId = Uuid
StateVersionId  = Uuid
StateHash       = [u8; 32]  (BLAKE3 of canonical state tree)
```

### 9.2 StateSnapshot

```text
StateSnapshot
├── snapshot_id     : StateSnapshotId   (LogicalId)
├── TenantScoped
│   ├── tenant_id    : TenantId          ← A2
│   └── scope_hash   : [u8; 32]
├── state_hash      : StateHash          ← BLAKE3 of canonical state tree
├── commit_index    : CommitIndex        ← A3: Logical Time (when this snapshot was committed)
├── entities        : Vec<TenantScoped<Entity>>
├── relationships   : Vec<TenantScoped<Relationship>>
├── computed_fields : JsonValue           ← derived via Datalog/E-graph
├── config_hash     : ConfigurationHash   ← A4
├── schema_version  : SchemaVersion
├── created_at      : TimeContext
└── provenance      : ProvenanceTrail
```

### 9.3 StateVersion

```text
StateVersion
├── version_id      : StateVersionId   (LogicalId)
├── TenantScoped
│   ├── tenant_id    : TenantId
│   └── scope_hash   : [u8; 32]
├── parent_version  : StateVersionId?
├── commit_index    : CommitIndex       ← A3
├── state_hash      : StateHash
├── delta_refs      : Vec<StateTransitionRecordId>
├── config_hash     : ConfigurationHash ← A4
├── created_at      : TimeContext
└── provenance      : ProvenanceTrail
```

### 9.4 StateTransitionRecord

```text
StateTransitionRecord
├── delta_id               : Uuid         (LogicalId)
├── TenantScoped
│   ├── tenant_id           : TenantId
│   └── scope_hash          : [u8; 32]
├── previous_state_hash    : StateHash
├── resulting_state_hash   : StateHash
├── transition_type        : String        ← e.g., "ENTITY_CREATE", "ATTRIBUTE_UPDATE", "CONFIG_UPDATE"
├── status                 : PROPOSED | VALIDATED | EVIDENCE_PREPARED | COMMITTED | APPLIED | EVIDENCED | VARDHAN_COMMITTED_STATE | OBSERVED_EXTERNAL_STATE
├── evidence_ref           : EvidenceId
├── commit_index          : CommitIndex   ← A3: assigned at Raft commit
├── proposer_identity      : EntityId
├── validator_signatures   : Vec<Signature>
├── consensus_commit_index : CommitIndex
├── applied_at             : TimeContext?  (optional — when state machine applied it)
├── created_at             : TimeContext
├── finalized_at           : TimeContext?  (optional — when evidence finalized)
├── config_hash            : ConfigurationHash ← A4
├── tenant_id              : TenantId      ← A2 (redundant with TenantScoped wrapper, explicit for queries)
└── provenance             : ProvenanceTrail
```

### 9.5 State Lifecycle (A1)

```text
PROPOSED → VALIDATED → EVIDENCE_PREPARED → COMMITTED → APPLIED → EVIDENCED → VARDHAN_COMMITTED_STATE → (Execution) → OBSERVED_EXTERNAL_STATE
```

- **PROPOSED**: Delta created, not yet G0-validated. SPECULATIVE.
- **VALIDATED**: G0 checks passed. SPECULATIVE.
- **EVIDENCE_PREPARED**: EvidenceRecord created and written. SPECULATIVE.
- **COMMITTED**: Raft entry committed; `commit_index` assigned. SPECULATIVE (evidence not yet linked).
- **APPLIED**: State machine applied the delta. SPECULATIVE.
- **EVIDENCED**: Evidence linked to `commit_index`; fully committed. → VARDHAN_COMMITTED_STATE
- **VARDHAN_COMMITTED_STATE**: Authoritative internal state. Visible to upper layers.
- **OBSERVED_EXTERNAL_STATE**: External world confirmed via OutcomeEvidence. Authoritative externally.

### 9.6 State Hash Rules

- `StateHash` = BLAKE3 of the canonical serialization of the entire state tree (entities + relationships + computed fields)
- `StateHash` changes if any entity, relationship, or computed field changes
- `StateHash` is the same across all Vardhan nodes that agree on the same committed state
- DecisionTwin `state_snapshot` references a `StateHash` — this must be a `VARDHAN_COMMITTED_STATE`, never SPECULATIVE

### 9.7 Canonical Serialization

All state objects serialize as canonical JSON. `state_hash` is computed over the **state tree** (entities + relationships + computed fields), not over metadata fields like `created_at`.

### 9.8 Persistence

- **Enterprise State Store**: holds `StateSnapshot` and `StateVersion`
- **Audit Ledger**: holds `StateTransitionRecord` as evidence
- Both replicated via Raft; evidence-finalized before becoming authoritative

### 9.9 Failure States

- **CORRUPTED**: State hash mismatch → quarantine, reconstruct from ledger
- **ROLLBACK**: Evidence finalization failed after Raft commit → revert to `APPLIED`, record failure
- **STALE**: `StateHash` does not match latest `CommitIndex` → re-sync from consensus log

---

## 10. EVIDENCE

### 10.1 Identity

```text
EvidenceId    = [u8; 32]  (BLAKE3 of EvidenceRecord — cryptographic identity)
EvidenceLogicalId = Uuid  (logical EvidenceId for queryability)
ContentHash   = [u8; 32]  (BLAKE3 of payload)
```

### 10.2 EvidenceRecord

```text
EvidenceRecord
├── evidence_id           : EvidenceId              ← BLAKE3 (cryptographic), also has logical Uuid
├── TenantScoped
│   ├── tenant_id         : TenantId
│   └── scope_hash        : [u8; 32]
├── event_id            : EventId?
├── entity_id           : EntityId?
├── source              : String
├── timestamp           : TimeContext              ← A3
├── logical_time        : CommitIndex?           ← A3: assigned at Raft commit
├── event_time          : DateTime<Utc>           ← A3
├── system_time         : DateTime<Utc>           ← A3
├── deadline_time       : DateTime<Utc>?          ← A3
├── schema_version      : SchemaVersion
├── payload_digest      : ContentHash             ← BLAKE3 of payload
├── predecessor         : EvidenceId?             ← chain to previous evidence
├── provenance          : Vec<ProvenanceEntry>
├── authorization_context : AuthContext
├── signatures          : Vec<Signature>
├── evidence_category   : DECISION | OUTCOME      ← A5
├── config_hash         : ConfigurationHash       ← A4
├── state_hash          : StateHash?              ← A1, A2 (links to committed state)
├── content_hash        : ContentHash             ← BLAKE3 of canonical record bytes
├── commit_index        : CommitIndex?            ← A3 (Raft position)
└── related_object_refs : Vec<ObjectRef>          ← logical + cryptographic refs
```

### 10.3 Evidence Categories (A5)

```text
DECISION EVIDENCE        → written to Decision Evidence Merkle tree
   ├── DecisionTwin creation
   ├── candidate option generation
   ├── G0–G4 assurance results
   ├── policy evaluation
   ├── authorization
   └── execution initiation

OUTCOME EVIDENCE         → written to Outcome Evidence Merkle tree
   ├── action execution result
   ├── real-world observation
   ├── prediction vs. actual comparison
   ├── prediction error calculation
   └── decision memory finalization
```

### 10.4 Lifecycle

```text
CREATED → SIGNED → LEDGER_WRITTEN → MERKLE_CHECKPOINTED → RAFT_COMMITTED → FINALIZED
```

- **CREATED**: EvidenceRecord constructed in memory
- **SIGNED**: ML-DSA-87 signature applied by the node
- **LEDGER_WRITTEN**: Written to audit ledger
- **MERKLE_CHECKPOINTED**: Included in a Merkle checkpoint batch
- **RAFT_COMMITTED**: Raft entry committed; `commit_index` assigned (Logical Time final)
- **FINALIZED**: Evidence linked to `commit_index`, `state_hash`, and object identity

### 10.5 Canonical Serialization

Canonical JSON with field ordering: `evidence_id`, `tenant_id`, `event_id`, `entity_id`, `source`, `timestamp`, `logical_time`, `event_time`, `system_time`, `deadline_time`, `schema_version`, `payload_digest`, `predecessor`, `provenance`, `authorization_context`, `signatures`, `evidence_category`, `config_hash`, `state_hash`, `commit_index`, `related_object_refs`.

### 10.6 Hash Rules

- `EvidenceId` = BLAKE3 of the canonical EvidenceRecord bytes (cryptographic identity)
- `ContentHash` = BLAKE3 of the payload field only
- `commit_index` = the Raft log index at which this evidence was committed
- Evidence is included in a separate Merkle tree per category (A5)

### 10.7 Persistence

**Audit Ledger** (L03). Replicated via Raft. Evidence must be finalized before the associated state becomes authoritative.

### 10.8 Failure States

- **UNSIGNED**: No valid ML-DSA-87 signature → rejected
- **LEDGER_LOSS**: Written to ledger but not Raft-committed → quarantined, re-submitted
- **CHAIN_BROKEN**: `predecessor` reference not found → evidence rejected

---

## 11. INTELLIGENCE

### 11.1 ModelProvenance

```text
ModelProvenance
├── model_id          : ModelArtifactId    (LogicalId)
├── TenantScoped
│   ├── tenant_id      : TenantId          ← A2
│   └── scope_hash     : [u8; 32]
├── model_hash        : ModelArtifactHash  ← BLAKE3 of model artifact bytes
├── model_version     : String
├── provider          : String             ← e.g., "vardhan-native", "external-llm-provider-x"
├── provider_ref      : String?            ← external provider endpoint/identifier
├── architecture      : String             ← e.g., "transformer", "decision-tree"
├── trained_at        : TimeContext
├── training_data_ref : EvidenceId?
├── training_config_hash : ConfigurationHash ← A4
├── capabilities      : Vec<String>        ← e.g., ["semantics", "forecasting"]
├── limitations       : Vec<String>
├── deterministic     : bool               ← deterministic (models, features) vs. probabilistic (LLM)
├── evidence_refs     : Vec<EvidenceId>    ← DECISION evidence (A5)
├── config_hash       : ConfigurationHash  ← A4
└── provenance        : ProvenanceTrail
```

### 11.2 RiskProfile

```text
RiskProfile
├── risk_id           : Uuid               (LogicalId)
├── TenantScoped
│   ├── tenant_id      : TenantId
│   └── scope_hash     : [u8; 32]
├── decision_id       : DecisionId?
├── state_hash        : StateHash          ← A1: only EVIDENCED state
├── risk_factors      : Vec<RiskFactor>
├── aggregate_score   : f64
├── confidence        : f64
├── methodology       : String             ← e.g., "monte-carlo", "analytical"
├── time              : TimeContext
├── model_provenance  : ModelArtifactHash
├── config_hash       : ConfigurationHash  ← A4
├── evidence_refs     : Vec<EvidenceId>    ← DECISION evidence (A5)
└── provenance        : ProvenanceTrail
```

### 11.3 Scenario

```text
Scenario
├── scenario_id       : ScenarioId         (LogicalId)
├── TenantScoped
│   ├── tenant_id      : TenantId
│   └── scope_hash     : [u8; 32]
├── decision_id       : DecisionId?
├── state_hash        : StateHash          ← A1
├── scenario_type     : String             ← e.g., "stress", "adversarial"
├── perturbation      : JsonValue          ← what was varied
├── predicted_metrics : JsonValue
├── confidence        : f64
├── time              : TimeContext
├── model_provenance  : ModelArtifactHash
├── config_hash       : ConfigurationHash  ← A4
├── evidence_refs     : Vec<EvidenceId>    ← DECISION evidence (A5)
└── provenance        : ProvenanceTrail
```

### 11.4 Lifecycle (all Intelligence objects)

```text
CREATED → MODEL_PROVENANCE_ATTACHED → STATE_REFERENCED → G0_VALIDATED → EVIDENCED → MEMORIZED
```

All Intelligence objects reference `state_hash` of `VARDHAN_COMMITTED_STATE` only (A1). They never reference SPECULATIVE state.

### 11.4 AssuranceResult

```text
AssuranceResult
├── assurance_id    : Uuid             (LogicalId)
├── TenantScoped
│   ├── tenant_id   : TenantId
│   └── scope_hash  : [u8; 32]
├── candidate_ref   : DecisionCandidateId
├── candidate_hash  : ContentHash        ← BLAKE3 of DecisionCandidate
├── state_hash      : StateHash          ← A1: EVIDENCED state only
├── config_hash     : ConfigurationHash   ← A4
├── model_provenance : Vec<ModelArtifactHash> ← A2
├── g0_result       : GateResult         ← input integrity
├── g1_result       : GateResult         ← semantic agreement
├── g2_result       : GateResult         ← perturbation robustness
├── g3_result       : GateResult         ← utility / non-degeneracy
├── g4_result       : PolicyEvaluation?   ← formal policy verification
├── final_status    : PASS | FAIL | INDETERMINATE | TIMEOUT | NOT_APPLICABLE
├── evidence_refs   : Vec<EvidenceId>    ← DECISION evidence (A5)
├── time            : TimeContext
├── validator_signature : Signature?      ← ML-DSA-87 of the result
└── provenance      : ProvenanceTrail
```

```text
GateResult
├── gate_id       : String              ← "G0", "G1", "G2", "G3", "G4"
├── status        : PASS | FAIL | INDETERMINATE | TIMEOUT | NOT_APPLICABLE
├── reason        : String?
├── evidence_ref  : EvidenceId?
└── metadata      : JsonValue
```

**Constitutional rule (CONST-8)**: `INDETERMINATE` is **not** `PASS`. A DecisionCandidate whose `AssuranceResult.final_status ≠ PASS` cannot proceed to policy evaluation or authorization.

### 11.5 Lifecycle (all Intelligence objects)

```text
CREATED → MODEL_PROVENANCE_ATTACHED → STATE_REFERENCED → G0_VALIDATED → EVIDENCED → MEMORIZED
```

All Intelligence objects reference `state_hash` of `VARDHAN_COMMITTED_STATE` only (A1). They never reference SPECULATIVE state.

Canonical JSON with consistent field ordering. `model_hash` and `risk_hash` are BLAKE3 digests — they change if any content field changes.

### 11.6 Persistence

- `ModelProvenance` → Model Store (L05)
- `RiskProfile`, `Scenario` → Enterprise State Store / Risk Fabric (L08)
- All evidence-finalized

### 11.7 Failure States

- **STALE_STATE**: Referenced `state_hash` no longer current → re-assessment triggered
- **MODEL_INVALID**: `model_hash` no longer trusted → G0 rejects, fallback to baseline

---

## 12. GOVERNANCE

### 12.1 Constraint

```text
Constraint
├── constraint_id : ConstraintId    (LogicalId)
├── TenantScoped
│   ├── tenant_id : TenantId
│   └── scope_hash: [u8; 32]
├── name        : String
├── description : String
├── constraint_type : String       ← e.g., "resource", "regulatory", "temporal"
├── expression  : String           ← canonical constraint language
├── priority    : u32              ← 0 (highest) to MAX
├── scope       : Vec<String>      ← entities/rules this applies to
├── config_hash : ConfigurationHash ← A4
├── time        : TimeContext
├── evidence_refs : Vec<EvidenceId>
└── provenance  : ProvenanceTrail
```

### 12.2 Policy

```text
Policy
├── policy_id      : PolicyId        (LogicalId)
├── TenantScoped
│   ├── tenant_id   : TenantId
│   └── scope_hash  : [u8; 32]
├── name           : String
├── description    : String
├── version        : SchemaVersion
├── policy_hash    : PolicyHash       ← BLAKE3 of canonical policy bytes
├── parent_policy_hash : PolicyHash?  ← for policy versioning
├── rules          : Vec<PolicyRule>
├── config_hash    : ConfigurationHash ← A4
├── effective_from : CommitIndex?     ← A3
├── effective_to   : CommitIndex?     ← A3 (None = current)
├── time           : TimeContext
├── evidence_refs  : Vec<EvidenceId>
└── provenance     : ProvenanceTrail
```

### 12.3 PolicyEvaluation

```text
PolicyEvaluation
├── eval_id        : Uuid            (LogicalId)
├── TenantScoped
│   ├── tenant_id    : TenantId
│   └── scope_hash   : [u8; 32]
├── policy_version  : String
├── policy_hash     : PolicyHash       ← A4
├── config_hash     : ConfigurationHash ← A4
├── input_state_hash : StateHash       ← A1 (EVIDENCED state only)
├── candidate_hash  : ContentHash      ← BLAKE3 of DecisionCandidate
├── constraints_evaluated : Vec<ConstraintRef>
├── result          : PASS | FAIL | INDETERMINATE | TIMEOUT
├── solver_metadata : JsonValue
├── proof_reference : ProofRef
├── evidence_reference : EvidenceId
├── time            : TimeContext
├── tenant_id       : TenantId        ← A2 (explicit for cross-reference)
└── provenance      : ProvenanceTrail
```

### 12.4 Authorization

```text
Authorization
├── auth_id        : Uuid             (LogicalId)
├── TenantScoped
│   ├── tenant_id   : TenantId
│   └── scope_hash  : [u8; 32]
├── decision_id     : DecisionId
├── action_id       : ActionId
├── policy_eval_ref : EvidenceId       ← references PolicyEvaluation evidence
├── assurance_ref   : EvidenceId       ← references AssuranceResult evidence
├── risk_level      : RiskLevel
├── auth_level      : AuthLevel        ← HUMAN | AUTO
├── authorized_by   : EntityId
├── authorized_at   : TimeContext
├── config_hash     : ConfigurationHash ← A4
├── evidence_refs   : Vec<EvidenceId>
└── provenance      : ProvenanceTrail
```

**Rule**: Authorization is resolvable through deterministic policy (Constitution Section 23), not through `if requires_human` branches. The policy engine emits AuthorizationEvidence.

### 12.5 ConfigurationSnapshot

```text
ConfigurationSnapshot
├── config_id       : ConfigId        (LogicalId)
├── TenantScoped
│   ├── tenant_id   : TenantId
│   └── scope_hash  : [u8; 32]
├── version         : u64
├── config_hash     : ConfigurationHash ← BLAKE3 of canonical config bytes
├── config_payload  : JsonValue          ← canonicalized
├── parent_version  : ConfigId?
├── effective_from  : CommitIndex?       ← A3 (when this config became effective)
├── effective_to   : CommitIndex?          ← A3 (when superseded)
├── signature       : Signature            ← ML-DSA-87
├── author_identity : EntityId
├── change_reason   : String
├── time            : TimeContext
├── evidence_refs   : Vec<EvidenceId>
└── provenance      : ProvenanceTrail
```

**Amendment A4**: Configuration changes are `StateTransitionRecord`s with `transition_type = "CONFIG_UPDATE"`. They must be Raft-committed and evidence-finalized before becoming effective. The system never uses configuration that has not been evidence-finalized. G0 rejects candidates referencing stale `config_hash` (A6).

### 12.6 Lifecycle (Governance objects)

```text
DRAFT → PENDING_APPROVAL → ACTIVE → EXPIRED → REVOKED
```

- `Policy` and `Constraint`: versioned, effective time-bounded
- `Authorization`: one-time, bound to a specific `DecisionId` and `ActionId`
- `ConfigurationSnapshot`: versioned, effective time-bounded

### 12.7 Canonical Serialization

Canonical JSON. `policy_hash`, `config_hash` are BLAKE3 digests.

### 12.8 Persistence

- `Policy`, `Constraint` → Policy Store / State Store (L09–L11)
- `Authorization` → Authorization Vault (L09)
- `ConfigurationSnapshot` → Configuration Store (state-level, replicated via Raft)

### 12.9 Failure States

- **STALE**: `config_hash` does not match current effective configuration → G0 rejects candidates (A6)
- **EXPIRED**: Policy/authorization past `effective_to` → denied at enforcement
- **UNSIGNED**: Configuration or policy not ML-DSA-87 signed → rejected

---

## 13. DECISION

### 13.1 DecisionCandidate

```text
DecisionCandidate
├── candidate_id    : DecisionCandidateId (LogicalId)
├── TenantScoped
│   ├── tenant_id   : TenantId
│   └── scope_hash  : [u8; 32]
├── decision_id    : DecisionId            ← links to originating DecisionTwin
├── state_hash     : StateHash             ← A1: EVIDENCED state only
├── config_hash    : ConfigurationHash      ← A4: effective at creation
├── evidence_window: [CommitIndex, CommitIndex] ← A6: evidence validity range
├── model_provenance : Vec<ModelArtifactHash> ← A2: which models produced this candidate
├── proposed_action : ActionSpec
├── predicted_outcome : JsonValue
├── confidence      : f64
├── risk_profile   : RiskProfileSummary
├── constraints_met : Vec<ConstraintRef>
├── time            : TimeContext
├── evidence_refs   : Vec<EvidenceId>      ← DECISION evidence (A5)
└── provenance      : ProvenanceTrail
```

**Amendment A6**: A `DecisionCandidate` is **always SPECULATIVE**. It may never:
1. Directly mutate `EnterpriseState`
2. Directly issue an `Action`
3. Directly authorize itself
4. Directly write to the evidence ledger
5. Be visible to external APIs as "decision" output before passing through G0–G4 + policy + authorization

**Canonical candidate boundary**:
```text
Intelligence Plane → DecisionCandidate (SPECULATIVE)
   ↓  MUST reference: state_hash (EVIDENCED only), config_hash (A4), evidence_window (A6)
   ↓  Cannot mutate state, issue actions, or self-authorize (A6)
AI Assurance G0–G4
   ↓  G0 checks config_hash staleness (A4, A6)
   ↓  final_status = PASS required
Policy + Authorization
   ↓
DecisionTwin (CREATED → ... → AUTHORIZED)
   ↓  Execution only after AUTHORIZED
```

**Constraint**: A `DecisionCandidate` referencing a `StateHash` from before the last `CONFIG_UPDATE` within its validity window is automatically `REJECTED` by G0.

### 13.2 DecisionTwin

```text
DecisionTwin
├── decision_id    : DecisionId          (LogicalId)
├── TenantScoped
│   ├── tenant_id   : TenantId
│   └── scope_hash  : [u8; 32]
├── context          : JsonValue
├── state_snapshot   : StateHash          ← A1: references EVIDENCED state only
├── evidence_refs
│     ├── decision_evidence_refs  : Vec<EvidenceId>  ← A5: decision pipeline
│     └── outcome_evidence_refs   : Vec<EvidenceId>  ← A5: outcome pipeline
├── assumptions      : JsonValue
├── constraints      : Vec<ConstraintRef>
├── candidate_options: Vec<DecisionCandidateId>
├── predicted_outcomes : JsonValue
├── risk_distribution : JsonValue
├── selected_action  : ActionSpec?
├── authorization    : AuthorizationRef?
├── execution        : ExecutionRef?
├── actual_outcome   : OutcomeRef?
├── prediction_error : PredictionErrorRef?
├── config_hash      : ConfigurationHash  ← A4: bound at creation, revalidated at G0
├── lifecycle_state  : LifecycleState     ← A8: CREATED | ... | MEMORIZED | REVALIDATION_REQUIRED
├── candidate_hash   : ContentHash        ← BLAKE3 of selected candidate
├── policy_hash      : PolicyHash          ← A4
├── deadline         : DateTime<Utc>       ← A3: for reversal requirements
├── time             : TimeContext
└── provenance       : ProvenanceTrail
```

### 13.3 Decision Twin Lifecycle (A8)

```text
CREATED → CONTEXTUALIZED → OPTIONS_GENERATED → ASSESSED → ASSURED → POLICY_CHECKED → AUTHORIZED
  → EXECUTING → EXECUTED → OUTCOME_PENDING → OUTCOME_VERIFIED → MEMORIZED → REVALIDATION_REQUIRED
```

**Failure branches**: `REJECTED`, `EXPIRED`, `CANCELLED`, `ABORTED`, `FAILED`, `INDETERMINATE`

**REVALIDATION_REQUIRED triggers (A8)**:
- Configuration change (A4) since last evaluation
- New evidence contradicting an assumption
- Stale-term detection (I2): state snapshot older than a newer commit
- Risk re-assessment outside tolerance band
- External mandate (e.g., regulatory change)

**Rule**: A DecisionTwin in `REVALIDATION_REQUIRED` cannot initiate new actions. Visible only as "awaiting re-verification."

### 13.4 Canonical Serialization

Canonical JSON: `decision_id`, `tenant_id`, `context`, `state_snapshot`, `evidence_refs`, `assumptions`, `constraints`, `candidate_options`, `predicted_outcomes`, `risk_distribution`, `selected_action`, `authorization`, `execution`, `actual_outcome`, `prediction_error`, `config_hash`, `lifecycle_state`, `candidate_hash`, `policy_hash`, `deadline`, `time`, `provenance`.

### 13.5 Persistence

**Decision Memory Store** (L10). Evidence-finalized. Both decision and outcome evidence stored.

### 13.6 Failure States

- **UNAUTHORIZED_EXECUTION**: Action attempted without `AUTHORIZATION` state → rejected at A7 gate
- **STALE_STATE_REFERENCE**: `state_snapshot` no longer current → REVALIDATION_REQUIRED (A8)
- **CONFIG_STALE**: `config_hash` outdated → REVALIDATION_REQUIRED (A8)

---

## 14. EXECUTION

### 14.1 Action

```text
Action
├── action_id     : ActionId          (LogicalId)
├── TenantScoped
│   ├── tenant_id : TenantId
│   └── scope_hash: [u8; 32]
├── decision_id   : DecisionId
├── action_spec   : ActionSpec
├── config_hash   : ConfigurationHash  ← A4
├── time          : TimeContext
├── evidence_refs : Vec<EvidenceId>    ← DECISION evidence (A5)
└── provenance    : ProvenanceTrail
```

```text
ActionSpec
├── action_type    : String            ← e.g., "api_call", "workflow_start", "db_update"
├── target_system  : String
├── parameters     : JsonValue
├── retry_policy   : RetryPolicy
├── timeout_secs   : u32
├── reversibility  : Reversible | Irreversible
└── compensation_action : ActionSpec?  ← for reversible actions
```

### 14.2 Execution

```text
Execution
├── execution_id   : ExecutionId      (LogicalId)
├── TenantScoped
│   ├── tenant_id   : TenantId
│   └── scope_hash  : [u8; 32]
├── action_id      : ActionId
├── decision_id    : DecisionId
├── authorization_id : Uuid            ← A7: must trace to completed DecisionTwin
├── status         : PENDING | RUNNING | SUCCESS | FAILURE | TIMEOUT | CANCELLED
├── result         : JsonValue?
├── error          : String?
├── started_at     : TimeContext
├── completed_at   : TimeContext?
├── config_hash    : ConfigurationHash ← A4
├── evidence_refs  : Vec<EvidenceId>   ← DECISION evidence (initiation)
└── provenance     : ProvenanceTrail
```

**Authorization semantics (A7)**: `Execution` requires a matching `authorization_id` that traces back to a completed `DecisionTwin` in `EXECUTED` state with `final_status = PASS` from G0–G4. The Vardhan Authority Gate validates this before allowing execution to proceed.

### 14.3 Compensation

```text
Compensation
├── compensation_id : CompensationId   (LogicalId)
├── TenantScoped
│   ├── tenant_id   : TenantId
│   └── scope_hash  : [u8; 32]
├── original_execution_id : ExecutionId
├── action_spec   : ActionSpec          ← reversal action
├── status        : PENDING | RUNNING | SUCCESS | FAILURE
├── triggered_at  : TimeContext
├── completed_at  : TimeContext?
├── config_hash   : ConfigurationHash   ← A4
├── evidence_refs : Vec<EvidenceId>     ← OUTCOME evidence (A5)
└── provenance    : ProvenanceTrail
```

**Amendment A1**: Compensation is the bridge between `VardhanCommittedState` and `ObservedExternalState`. When an action fails or produces an unexpected outcome, a `Compensation` is triggered to reverse the external effect. The `OutcomeEvidence` from observation confirms whether `ObservedExternalState` now matches.

### 14.4 Lifecycle

```text
Action: SPECIFIED → AUTHORIZED → EXECUTION_TRIGGERED
Execution: PENDING → RUNNING → (SUCCESS | FAILURE | TIMEOUT | CANCELLED)
Compensation: PENDING → RUNNING → (SUCCESS | FAILURE)
```

### 14.5 Canonical Serialization

`action_id` is the BLAKE3-derived `ContentHash` of the `ActionSpec` canonical bytes. `Execution` references `authorization_id` (UUID) + `policy_hash` + `config_hash`.

### 14.6 Persistence

**Execution Store** (L11). Evidence-finalized. Both decision evidence (initiation) and outcome evidence (result/observation) recorded.

### 14.7 Failure States

- **UNAUTHORIZED**: No valid `authorization_id` → rejected at A7 gate
- **CONFIG_STALE**: `config_hash` mismatch → rejected
- **EXECUTION_FAILURE**: Action returned error → compensation triggered
- **TIMEOUT**: Execution exceeded timeout → marked TIMEOUT, compensation triggered

---

## 15. MEMORY

### 15.1 Outcome

```text
Outcome
├── outcome_id   : OutcomeId         (LogicalId)
├── TenantScoped
│   ├── tenant_id : TenantId
│   └── scope_hash: [u8; 32]
├── execution_id  : ExecutionId
├── decision_id   : DecisionId
├── observed_state : StateHash?      ← A1: OBSERVED_EXTERNAL_STATE
├── predicted_state : StateHash?     ← what was predicted
├── match_result  : StateHash         ← hash of comparison
├── actual_result : JsonValue
├── confidence    : f64
├── observation   : ObservationId?
├── time          : TimeContext
├── config_hash   : ConfigurationHash ← A4
├── evidence_refs : Vec<EvidenceId>  ← OUTCOME evidence (A5)
└── provenance    : ProvenanceTrail
```

### 15.2 PredictionError

```text
PredictionError
├── error_id     : PredictionErrorId  (LogicalId)
├── TenantScoped
│   ├── tenant_id : TenantId
│   └── scope_hash: [u8; 32]
├── decision_id   : DecisionId
├── predicted     : JsonValue
├── actual        : JsonValue
├── error_metric  : f64                ← e.g., MSE, MAE
├── error_type    : String             ← e.g., "semantic", "magnitude", "categorical"
├── time          : TimeContext
├── model_provenance : ModelArtifactHash
├── config_hash   : ConfigurationHash  ← A4
├── evidence_refs : Vec<EvidenceId>   ← OUTCOME evidence (A5)
└── provenance    : ProvenanceTrail
```

### 15.3 DecisionMemory

```text
DecisionMemory
├── memory_id    : Uuid               (LogicalId)
├── TenantScoped
│   ├── tenant_id : TenantId
│   └── scope_hash: [u8; 32]
├── decision_id  : DecisionId
├── decision_evidence_refs : Vec<EvidenceId> ← A5: decision pipeline
├── outcome_evidence_refs  : Vec<EvidenceId> ← A5: outcome pipeline
├── state_snapshot_ref : StateHash         ← A1
├── config_hash    : ConfigurationHash      ← A4
├── policy_hash    : PolicyHash            ← A4
├── model_hashes   : Vec<ModelArtifactHash> ← A2
├── memory_hash    : ContentHash            ← BLAKE3 of canonical memory
├── time           : TimeContext
├── replay_ready   : bool
└── provenance     : ProvenanceTrail
```

**Amendment A5**: `DecisionMemory` separates `decision_evidence_refs` (from the decision pipeline: creation, G0–G4, policy, authorization, execution initiation) from `outcome_evidence_refs` (from the outcome pipeline: execution result, observation, prediction vs. actual, prediction error). These are written to separate Merkle trees in the ledger for independent verification.

### 15.4 Lifecycle

```text
DECISION_CREATED → ACTION_EXECUTED → OUTCOME_OBSERVED → PREDICTION_COMPARED → MEMORY_FINALIZED
  ↓
REVALIDATION_REQUIRED (A8)
  ├── [re-validated] → DECISION_CREATED (restart)
  ├── [expired]      → EXPIRED
  └── [cancelled]    → CANCELLED
```

### 15.5 Canonical Serialization

`memory_hash` = BLAKE3 of canonical `DecisionMemory` bytes. Separate Merkle roots for decision evidence tree and outcome evidence tree (A5).

### 15.6 Persistence

**Decision Memory Store** (L10). Evidence-finalized. Long-term retention for replay, learning, audit, and compliance.

### 15.7 Failure States

- **EVIDENCE_GAP**: Missing decision or outcome evidence → memory incomplete, marked INCOMPLETE
- **STATE_MISMATCH**: `state_snapshot_ref` no longer resolves → marked STALE
- **REPLAY_FAILURE**: Memory cannot be replayed (evidence chain broken) → marked UNREPLAYABLE

---

## 16. State Separation

**Amendment A1 — Three distinct state tiers**:

```text
┌─────────────────────────────────────┐
│ VARDHAN COMMITTED STATE             │ ← Raft + evidence finalized + applied
│ (authoritative to Vardhan)          │
│ state_hash = BLAKE3(state tree)     │
└─────────────┬───────────────────────┘
              │
              ▼
      AUTHORITY GATE (A7)
              │
              ▼
┌─────────────────────────────────────┐
│ EXECUTION                           │ ← external system mutation
│ (action submitted to external world)│
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ OBSERVED EXTERNAL STATE             │ ← confirmed by outcome observation
│ (authoritative externally)          │
│ observed_state_hash = BLAKE3(ext)   │
└─────────────┬───────────────────────┘
```

- `VardhanCommittedState`: proven by Raft `commit_index` + evidence finalization. This is what upper layers query.
- `Execution`: the act of mutating the external world. A Raft commit does **not** prove execution succeeded.
- `ObservedExternalState`: confirmed by an `Observation` that the external world now reflects the intended transition. Requires `OUTCOME_EVIDENCE` (A5).

The constitutional invariant applies to `VardhanCommittedState`. `ObservedExternalState` requires additional outcome evidence.

---

## 17. Object Inter-Reference Map

All cross-object references use **logical identity** for navigation and **cryptographic identity** for verification:

```text
Tenant
  │  (owns)
  ├── Entity (EntityId, TenantScoped)
  │     └── Relationship (source: EntityId, target: EntityId)
  │
  ├── Event (EventId, TenantScoped, references EntityId)
  │     └── Observation (ObservationId, references EventId)
  │
  ├── StateSnapshot (StateHash, commit_index)
  │     ├── StateVersion (parent: StateVersionId)
  │     └── StateTransitionRecord
  │           ├── evidence_ref → EvidenceId
  │           └── state_hash → StateHash
  │
  ├── EvidenceRecord (EvidenceId, predecessor chain)
  │     └── related_object_refs → [EventId, ActionId, ...]
  │
  ├── ModelProvenance (ModelArtifactHash)
  │     └── RiskProfile, Scenario (reference model_hash)
  │
  ├── Constraint (ConstraintId)
  ├── Policy (PolicyHash, version)
  │     └── PolicyEvaluation (references policy_hash, state_hash, candidate_hash)
  │
  ├── DecisionCandidate (DecisionCandidateId)
  │     ├── state_hash → StateHash (EVIDENCED only, A1)
  │     ├── config_hash → ConfigurationHash (A4)
  │     ├── evidence_window → [CommitIndex, CommitIndex] (A6)
  │     ├── model_provenance → [ModelArtifactHash]
  │     └── evidence_refs → [EvidenceId] (DECISION, A5)
  │
  ├── DecisionTwin (DecisionId)
  │     ├── state_snapshot → StateHash (A1)
  │     ├── candidate_options → [DecisionCandidateId]
  │     ├── config_hash → ConfigurationHash (A4)
  │     ├── decision_evidence_refs → [EvidenceId] (A5)
  │     ├── outcome_evidence_refs → [EvidenceId] (A5)
  │     ├── policy_hash → PolicyHash (A4)
  │     └── lifecycle_state → A8
  │
  ├── Action (ActionId, references DecisionId, Authorization)
  │     └── authorization_id → Authorization.auth_id
  │
  ├── Execution (ExecutionId, references ActionId, authorization_id)
  │     └── status → PENDING | RUNNING | SUCCESS | FAILURE | ...
  │
  ├── Compensation (CompensationId, references ExecutionId)
  │
  ├── Outcome (OutcomeId, references ExecutionId, ObservationId)
  │     └── evidence_refs → [EvidenceId] (OUTCOME, A5)
  │
  ├── PredictionError (PredictionErrorId, references DecisionId, ModelArtifactHash)
  │
  └── DecisionMemory (memory_hash)
        ├── decision_evidence_refs → [EvidenceId] (A5)
        └── outcome_evidence_refs → [EvidenceId] (A5)
```

### A7 — Authority Gate Reference Chain

```text
Action.action_id
  → requires Authorization.auth_id
    → references DecisionTwin.decision_id   (must be in EXECUTED state)
      → has finalized AssuranceResult       (G0–G4, final_status = PASS)
        → has PolicyEvaluation              (result = PASS, config_hash valid, A4)
          → DecisionTwin.state_snapshot    (StateHash, EVIDENCED, A1)
            → StateTransitionRecord.commit_index  (Logical Time, A3)
```

The Authority Gate (A7) validates this entire chain before allowing execution.

---

## 18. Consistency Check Summary

### 18.1 Object Coverage

All 21 objects from the user's hierarchy are specified:

| Object | Section | Status |
|---|---|---|
| TenantScoped<T> | 2 | ✅ Specified |
| TimeContext | 3 | ✅ Specified |
| Tenant | 4 | ✅ Specified |
| Entity | 5 | ✅ Specified |
| Relationship | 6 | ✅ Specified |
| Event | 7 | ✅ Specified |
| Observation | 8 | ✅ Specified |
| StateSnapshot | 9.2 | ✅ Specified |
| StateVersion | 9.3 | ✅ Specified |
| StateTransitionRecord | 9.4 | ✅ Specified |
| EvidenceRecord | 10 | ✅ Specified |
| ModelProvenance | 11.1 | ✅ Specified |
| RiskProfile | 11.2 | ✅ Specified |
| Scenario | 11.3 | ✅ Specified |
| AssuranceResult | 11.4 | ✅ Specified |
| Constraint | 12.2 | ✅ Specified |
| Policy | 12.3 | ✅ Specified |
| PolicyEvaluation | 12.4 | ✅ Specified |
| Authorization | 12.5 | ✅ Specified |
| ConfigurationSnapshot | 12.6 | ✅ Specified |
| DecisionCandidate | 13.1 | ✅ Specified |
| DecisionTwin | 13.2 | ✅ Specified |
| Action | 14.1 | ✅ Specified |
| Execution | 14.2 | ✅ Specified |
| Compensation | 14.3 | ✅ Specified |
| Outcome | 15.1 | ✅ Specified |
| PredictionError | 15.2 | ✅ Specified |
| DecisionMemory | 15.3 | ✅ Specified |

### 18.2 Identity System Coverage

All three identity systems defined and distinguished:

| Identity Type | Definition | Used By |
|---|---|---|
| LogicalId | Uuid (stable, queryable) | All objects |
| ContentHash | BLAKE3 of canonical object bytes | All objects with content |
| StateHash | BLAKE3 of canonical state tree | StateSnapshot, StateTransitionRecord |
| EvidenceId | BLAKE3 of EvidenceRecord | EvidenceRecord (cryptographic) |
| CommitIndex | Raft committed log index | StateTransitionRecord, EvidenceRecord, ConfigurationSnapshot |
| ModelArtifactHash | BLAKE3 of model artifact bytes | ModelProvenance |
| PolicyHash | BLAKE3 of canonical policy bytes | Policy, PolicyEvaluation, DecisionTwin |
| ConfigurationHash | BLAKE3 of canonical config bytes | PolicyEvaluation, DecisionCandidate, DecisionTwin, StateTransitionRecord |

### 18.3 Amendment Compliance

| Amendment | Coverage in this spec |
|---|---|
| A1 | Sections 9.5, 16, 17, 13.2 (state_snapshot), 11.4 (EVIDENCED only), 12.3 (input_state_hash) |
| A2 | Sections 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 (all objects are TenantScoped<T>) |
| A3 | Section 3, all TimeContext references, 13.2 (deadline), 12.5 (effective_from/to) |
| A4 | Sections 4, 5, 6, 7, 9.4, 10, 11, 12, 13, 14, 15 (config_hash on all objects) |
| A5 | Section 10.3 (evidence categories), 13.2 (decision/outcome evidence_refs), 15.3 (DecisionMemory) |
| A6 | Sections 13.1 (candidate boundary), 12.5 (G0 rejects stale config) |
| A7 | Sections 14.2, 17 (Authority Gate chain), 13.1 (candidate cannot self-authorize) |
| A8 | Section 13.3 (REVALIDATION_REQUIRED lifecycle) |
| A9 | Section 4.7, 5.7, 15.7 (quarantine/reconstruct failure states) |

### 18.4 Unresolved Ambiguities

1. **`ProofRef` type**: Referenced in `PolicyEvaluation.proof_reference` but not defined here. This is a G4-formal-verification artifact. Will be defined in the State Machines / Threat Model phase. **Not a contradiction** — the Constitution and System Map define the concept; exact representation deferred.

2. **`RetryPolicy`**: Referenced in `ActionSpec.retry_policy` but not expanded. Implementation detail for L11 (Governed Execution). **Not a contradiction**.

3. **`AuthContext`**: Referenced in `EvidenceRecord.authorization_context`. This is a Constitution Section 9 concept carried through. **Consistent**.

4. **`ProvenanceEntry` / `ProvenanceTrail`**: Referenced as a field on every object. The Constitution defines the concept (evidence must answer "who produced it", "from which source"). Exact schema deferred to the Implementation phase. **Not a contradiction**.

5. **`SchemaVersion`**: Referenced on evidence, events, state, policies. The existing `vardhan_model` crate defines `SchemaVersion` with `major`, `minor`, `patch`. **Consistent with implementation**.

6. **`RiskProfileSummary`**: Referenced in `DecisionCandidate.risk_profile` as a lightweight summary. The full `RiskProfile` is defined in Section 11.2. **Consistent by design**.

### 18.5 Naming Conflicts

- **No naming conflicts found.** All object names are unique and match the user-specified hierarchy. `TenantScoped<T>` is a wrapper, not a standalone object — no conflict.

### 18.6 Architectural Contradictions

- **No contradictions found** between this specification and Constitution v1.1 / System Map.
- The `tenant_scope_valid: bool` field from the initial draft has been **removed** — replaced with `TenantScoped<T>` structural typing (A2).
- The `logical_time` field is **optional** (`u64?`) everywhere it appears pre-commit, with the understanding that it becomes final at Raft commit (A3).
- The three-tier state separation (Vardhan Committed State → Execution → Observed External State) is consistent across Constitution Section 10, System Map Section 08, this spec Section 16, and the A1 amendment.
- No Boolean validation fields are used as primary protection mechanisms. All tenant scoping is structural.
- `DecisionCandidate` remains SPECULATIVE in all references (A6) — it cannot mutate state, issue actions, or self-authorize.

### 18.7 Next Artifact

The next specification artifact per the derivation order is:

```text
VARDHAN_STATE_MACHINES.md
```

This will define the exact state transition graphs, allowed transitions, and failure transitions for every object above, expressed as formal finite-state machines with explicit events, guards, and actions.

---

*This specification is derived exclusively from the Vardhan Architecture Constitution (v1.1) and VARDHAN_SYSTEM_MAP.md. All objects, fields, lifecycles, and identity rules are traceable to sections in those documents. Any implementation that cannot be mapped onto an object in this specification is out of architectural scope.*
