# Vardhan Architecture Constitution

> **Status**: ✅ Frozen  
> **Version**: 1.1 (A1–A9 amendments)  
> **Purpose**: Root architectural specification for the Vardhan Quantum platform — a vertically integrated, post-quantum enterprise intelligence system.  
> **Authority**: This document is the single source of architectural truth. Any implementation, crate, interface, or design decision that conflicts with this Constitution must be resolved by amendment to this document.

---

## Table of Contents

1. [Architectural Thesis](#1-the-architectural-thesis)
2. [The 12-Layer Stack](#2-the-12-layer-stack)
3. [The Five Strategic Fabrics](#3-the-five-strategic-fabrics)
4. [The Three Planes](#4-the-three-planes)
5. [Trust Boundaries](#5-trust-boundaries)
6. [Deterministic vs. Probabilistic Architecture](#6-deterministic-vs-probabilistic-architecture)
7. [Canonical Object Model](#7-canonical-object-model)
8. [Event Model](#8-event-model)
9. [Evidence Model](#9-evidence-model)
10. [State Transition Model](#10-state-transition-model)
11. [Decision Twin Model](#11-decision-twin-model)
12. [Rust Trait Boundaries](#12-rust-trait-boundaries)
13. [Multi-Tenancy Model](#13-multi-tenancy-model)
14. [Failure Semantics](#14-failure-semantics)
15. [Formal Architecture Invariants](#15-formal-architecture-invariants)
16. [Dependency Direction Rules](#16-dependency-direction-rules)
17. [External AI / LLM Boundary](#17-external-ai--llm-boundary)
18. [Three Twins](#18-three-twins)
19. [Cryptographic / Quantum Security Twin](#19-cryptographic--quantum-security-twin)
20. [Constraint Intelligence](#20-constraint-intelligence)
21. [AI Assurance G0–G4 Contract](#21-ai-assurance-g0–g4-contract)
22. [Mapping: What We Have vs. What Is New](#22-mapping-what-we-have-vs-what-is-new)
23. [Implementation Derivation Order](#23-implementation-derivation-order)
24. [Amendments A1–A9](#24-amendments-a1–a9)
25. [Amendment Version History](#25-amendment-version-history

---

## 1. The Architectural Thesis

Vardhan is **not**:

> “an enterprise dashboard with AI on top.”

Vardhan **is**:

> **A cryptographically evidenced representation of enterprise reality that can be reasoned over, simulated, constrained, acted upon, and measured against its outcome.**

The central product primitive is the **closed-loop decision system**:

```text
                 TRUSTED REALITY
                       │
                       ▼
                 VERIFIED STATE
                       │
                       ▼
                DECISION TWIN
                       │
            ┌──────────┼──────────┐
            ▼          ▼          ▼
          RISK      SCENARIOS   REASONING
            │          │          │
            └──────────┼──────────┘
                       ▼
                 DECISION
                       │
                       ▼
                    POLICY
                       │
                       ▼
                    ACTION
                       │
                       ▼
                   OUTCOME
                       │
                       ▼
                    MEMORY
                       │
                       ▼
                   EVIDENCE
                       │
                       └──────────→ STATE
```

---

## 2. The 12-Layer Stack

```text
L12  ┌───────────────────────────────────────────────┐
     │              EXPERIENCE & COMMAND             │
     │ Executive / Security / SOC / Auditor / APIs   │
L11  ├───────────────────────────────────────────────┤
     │              DECISION INTELLIGENCE             │
     │ Decision Twin / Decision Engine / BI          │
L10  ├───────────────────────────────────────────────┤
     │              OUTCOME & MEMORY                  │
     │ Outcome Verification / Decision Memory         │
L09  ├───────────────────────────────────────────────┤
     │              GOVERNED EXECUTION                │
     │ Policy Gate / Authorization / Actions          │
L08  ├───────────────────────────────────────────────┤
     │              RISK & SCENARIO                   │
     │ Risk Engine / Simulation / Optimization        │
L07  ├───────────────────────────────────────────────┤
     │              REASONING                         │
     │ State Graph / Knowledge Graph / E-Graph        │
L06  ├───────────────────────────────────────────────┤
     │              AI ASSURANCE                      │
     │ G0 / G1 / G2 / G3 / G4                        │
L05  ├───────────────────────────────────────────────┤
     │              INTELLIGENCE                      │
     │ Models / Features / Predictive / Semantic      │
L04  ├──────────────────────────────────────────────┤
     │              ENTERPRISE STATE                  │
     │ Canonical Model / Event State / Graph          │
L03  ├───────────────────────────────────────────────┤
     │              EVIDENCE FABRIC                    │
     │ Provenance / Merkle / Ledger / Attestation     │
L02  ├───────────────────────────────────────────────┤
     │              DISTRIBUTED TRUST                  │
     │ Consensus / HA / Replication / Cluster State   │
L01  ├──────────────────────────────────────────────┤
     │              POST-QUANTUM TRUST FOUNDATION      │
     │ Identity / PQC / Secure Transport / Keys      │
     └───────────────────────────────────────────────┘
```

**Dependency rule**: Layer N may depend on Layer M only if M ≤ N. Lower layers must never import, link, or depend on higher layers.

---

## 3. The Five Strategic Fabrics

```text
┌────────────────────────────────────────────────────────┐
│                    VARDHAN QUANTUM                      │
├────────────────────────────────────────────────────────┤
│                                                        │
│  1. TRUST FABRIC                                      │
│     PQC • Identity • Transport • Consensus            │
│                                                        │
│  2. EVIDENCE FABRIC                                   │
│     Ledger • Provenance • Merkle • Attestation        │
│                                                        │
│  3. ENTERPRISE INTELLIGENCE FABRIC                    │
│     State • Graph • Reasoning • AI • Risk • Scenario  │
│                                                        │
│  4. DECISION & EXECUTION FABRIC                       │
│     Decision Twin • Policy • Authorization • Action   │
│                                                        │
│  5. MEMORY FABRIC                                     │
│     Outcomes • Replay • Learning • Evidence           │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 4. The Three Planes

### Data Plane
Handles actual enterprise data and events:
```text
telemetry
transactions
business data
events
documents
external feeds
```

### Control Plane
Determines what the system is allowed to do:
```text
identity
policy
authorization
consensus
configuration
tenant boundaries
execution control
```

### Intelligence Plane
Determines what the system can infer or recommend:
```text
models
reasoning
simulation
optimization
decision twins
risk
forecasting
```

Crossing between planes requires:
```text
┌───────────────────────────────┐
│       Stable Vardhan Traits   │
├───────────────────────────────┤
│ EvidenceStore                 │
│ StateStore                    │
│ ReasoningEngine               │
│ RiskModel                     │
│ ScenarioEngine                │
│ PolicyEngine                  │
│ DecisionEngine                │
│ ActionExecutor                │
│ OutcomeCollector              │
│ ModelProvider                 │
└───────────────────────────────┘
```

---

## 5. Trust Boundaries

```text
                 UNTRUSTED WORLD
                       │
                       ▼
               [ INGESTION BOUNDARY ]
                       │
                       ▼
                 SANITIZATION
                       │
                       ▼
                [ EVIDENCE BOUNDARY ]
                       │
                       ▼
                [ TRUST FABRIC ]
                       │
                       ▼
             [ STATE BOUNDARY ]
                       │
                       ▼
              [ INTELLIGENCE ]
                       │
                       ▼
            [ POLICY BOUNDARY ]
                       │
                       ▼
             [ EXECUTION BOUNDARY ]
                       │
                       ▼
                 EXTERNAL WORLD
```

Every boundary crossing requires explicit:
```text
identity
authorization
schema
provenance
validation
evidence
failure behavior
```

---

## 6. Deterministic vs. Probabilistic Architecture

| Capability                     | Nature                                        |
| ------------------------------ | --------------------------------------------- |
| PQ cryptography                | Deterministic                                 |
| Secure transport               | Deterministic                                 |
| Raft consensus                 | Deterministic protocol behavior               |
| Evidence hashing               | Deterministic                                 |
| Merkle/checkpoint verification | Deterministic                                 |
| Canonical state model          | Deterministic                                 |
| Policy evaluation              | Deterministic                                 |
| SMT verification               | Deterministic relative to encoded constraints |
| Datalog derivation             | Deterministic                                 |
| E-graph rewriting              | Deterministic relative to rewrite theory      |
| Risk simulation                | Statistical / numerical                       |
| Forecasting                    | Probabilistic                                 |
| Semantic compilation           | Probabilistic + deterministic validation      |
| LLM/SLM reasoning              | Probabilistic                                 |
| Optimization                   | Algorithm-dependent                           |
| Decision selection             | Governed deterministic policy over candidates |
| Execution                      | Deterministic / transactional where possible  |
| Outcome measurement            | Observational                                 |

**Architectural rule**:
```text
Probabilistic
      ↓
candidate
      ↓
deterministic verification
      ↓
policy
      ↓
authorized action
```

---

## 7. Canonical Object Model

### Two Reference Systems

Every Vardhan object has **two** identity systems:

```text
Logical identity
    ↓
EntityId / DecisionId / PolicyId / ActionId / CompanyId

Cryptographic identity
    ↓
ContentHash / EvidenceId / StateHash
```

**Do not make everything addressable only by content digest.**

Example pattern:

```text
CompanyId = stable logical identity
CompanyVersion = immutable state version
StateHash = cryptographic identity of that version
EvidenceId = evidence object identity
```

Then:

```text
DecisionTwin
  company_id → logical relationship
  state_hash → exact state snapshot
  evidence_refs → cryptographic provenance
```

This gives both **queryability** (by logical ID) and **immutability** (by content hash).

**Rule**: Cross-object references use logical identity (EntityId, etc.) for navigable relationships, and cryptographic identity (StateHash, EvidenceId) for verifiable provenance. Every object must carry a `tenant_id` (for isolation).

### Object Set

```text
Tenant
   │
   ├── Entity
   ├── Relationship
   ├── Event
   ├── Observation
   ├── Evidence
   ├── Risk
   ├── Constraint
   ├── Policy
   ├── Scenario
   ├── DecisionTwin
   ├── Decision
   ├── Action
   └── Outcome
```

---

## 8. Event Model

```text
VardhanEvent
├── event_id          : Uuid (v4 or v7)
├── tenant             : TenantId
├── actor              : EntityId (optional)
├── entity             : EntityId (optional)
├── event_type        : String
├── occurred_at       : DateTime<Utc>     ← A3: Event Time
├── observed_at       : DateTime<Utc>     ← A3: System Time
├── logical_time      : u64?              ← A3: Logical Time (optional — assigned at commit)
├── deadline_time     : DateTime<Utc>     ← A3: Deadline Time (optional)
├── config_hash       : [u8; 32]          ← A4
├── evidence_category : DECISION | OUTCOME ← A5
├── schema_version    : SchemaVersion
├── source            : String
├── payload           : JsonValue
├── evidence_ref      : EvidenceId (optional)
├── previous_state     : StateHash (optional)
├── resulting_state    : StateHash (optional)
```

**A2 — Tenant scoping**: All core objects carry a `TenantId` as the primary scoping field. Tenant isolation is enforced structurally via `TenantScoped<T>` typed boundaries in the State Store and Evidence Store. The enforcement happens **before** an object enters an authoritative state — a Boolean field is not the protection mechanism.

For high-assurance events:
```text
event
 ↓
canonical bytes
 ↓
hash
 ↓
signature / attestation
 ↓
replication
 ↓
commit
```

---

## 9. Evidence Model

```text
EvidenceRecord
├── event_id
├── tenant_id
├── entity_id
├── source
├── timestamp
├── logical_time    : u64?      ← A3: Raft commit_index (optional — assigned at commit)
├── event_time      : DateTime<Utc>  ← A3: when event occurred
├── system_time     : DateTime<Utc>  ← A3: when observed
├── deadline_time   : DateTime<Utc> (optional) ← A3: human deadline
├── schema_version
├── payload_digest          : [u8; 32] (BLAKE3)
├── predecessor             : EvidenceId (optional)
├── provenance             : Vec<ProvenanceEntry>
├── authorization_context   : AuthContext
├── signatures/attestations : Vec<Signature>
├── evidence_category       : DECISION | OUTCOME  ← A5
├── config_hash             : [u8; 32]           ← A4
├── state_hash              : [u8; 32] (optional) ← A1, A2
└── logical_logical_time    : u64  (deprecated, kept for migration compatibility)
```

**A2 — Tenant scoping**: `TenantId` is a required structural field in `EvidenceRecord`. Enforcement via `TenantScoped<T>` typed boundaries in the store layer. A boolean field is not used as the primary protection mechanism.

**Evidence must answer**:
1. What happened?
2. Who/what produced it?
3. When?
4. From which source?
5. What state did it create?
6. What did the system know at the time?
7. What rule was applied?
8. What decision followed?
9. What action happened?
10. What happened afterward?
11. Can the record be independently verified?

---

## 10. State Transition Model

### Lifecycle States

A state delta passes through **five** distinct states before becoming authoritative:

```text
PROPOSED
   ↓
VALIDATED
   ↓
COMMITTED
   ↓
APPLIED
   ↓
EVIDENCED
```

Independently, `EVIDENCE_PREPARED` can occur before or concurrently with `COMMITTED`.

### Full Pipeline

```text
INPUT
  ↓
VALIDATE
  ↓
CREATE STATE DELTA
  ↓
EVIDENCE PREPARED
  ↓
RAFT REPLICATED
  ↓
RAFT COMMITTED
  ↓
STATE APPLIED
  ↓
EVIDENCE FINALIZED
  ↓
VARDHAN COMMITTED STATE
  ↓
AUTHORIZATION (A7 Gate)
  ↓
EXECUTION
  ↓
OBSERVED EXTERNAL STATE
```

### State Definitions

| State | Description | Authoritative? |
|---|---|---|
| **PROPOSED** | Delta created from validated input | No |
| **VALIDATED** | All G0 checks passed; schema/provenance verified | No |
| **EVIDENCE_PREPARED** | EvidenceRecord created, signed, referenced | No |
| **COMMITTED** | Raft consensus committed the delta; `commit_index` assigned | No |
| **APPLIED** | State machine has applied the delta to canonical state | No |
| **EVIDENCED** | Evidence finalized and linked to `commit_index` | No |
| **VARDHAN_COMMITTED_STATE** | Raft-committed + evidence-finalized + applied — Vardhan's authoritative internal state | **Yes** (to Vardhan) |
| **OBSERVED_EXTERNAL_STATE** | Confirmed by post-execution observation that the external world reflects the intended transition | **Yes** (externally verified) |

**A1 — Committed vs. Observed distinction**:

```text
VardhanCommittedState
        ↓
    Execution
        ↓
ObservedExternalState
```

`COMMITTED` (Raft `commit_index`) proves Vardhan committed an authoritative command. It does **not** prove the external enterprise world changed. `OBSERVED_EXTERNAL_STATE` is only established after successful execution AND outcome observation confirms the external system reflects the intended transition.

The constitutional invariant (below) applies to `VARDHAN_COMMITTED_STATE` — the authoritative internal state. `OBSERVED_EXTERNAL_STATE` is a separate evidence category (see Evidence Model A5).

### Constitutional Invariant

> **No state visible as authoritative may exist without a corresponding committed state-transition record and evidence reference. This applies to `VARDHAN_COMMITTED_STATE`. `OBSERVED_EXTERNAL_STATE` requires additional outcome evidence.**

Formally:
```text
∀ s ∈ AuthoritativeState:
  ∃ δ ∈ StateTransitionRecord:
    δ.status = EVIDENCED
    ∧ δ.applied = true
    ∧ ∃ e ∈ EvidenceRecord:
      e.commit_index = δ.commit_index
      ∧ e.state_hash = hash(s)

∀ o ∈ ObservedExternalState:
  ∃ a ∈ ActionExecutionRecord:
    a.execution_status = SUCCESS
    ∧ ∃ oe ∈ OutcomeEvidence:
      oe.action_id = a.action_id
      ∧ oe.observed_state_hash = hash(o)
```

### StateTransitionRecord

```text
StateTransitionRecord
├── delta_id            : Uuid
├── tenant_id           : TenantId
├── previous_state_hash : [u8; 32]
├── resulting_state_hash: [u8; 32]
├── transition_type     : String
├── status              : PROPOSED | VALIDATED | COMMITTED | APPLIED | EVIDENCED | VARDHAN_COMMITTED_STATE | OBSERVED_EXTERNAL_STATE
├── evidence_ref        : EvidenceId
├── commit_index        : u64
├── proposer_identity   : EntityId
├── validator_signatures: Vec<Signature>
├── consensus_commit_index : u64
├── applied_at          : DateTime<Utc> (optional)
├── created_at          : DateTime<Utc>
└── finalized_at        : DateTime<Utc> (optional)
```

---

## 11. Decision Twin Model

### Lifecycle State Machine

```text
CREATED
   ↓
CONTEXTUALIZED
   ↓
OPTIONS_GENERATED
   ↓
ASSESSED
   ↓
ASSURED
   ↓
POLICY_CHECKED
   ↓
AUTHORIZED
   ↓
EXECUTING
   ↓
EXECUTED
   ↓
OUTCOME_PENDING
   ↓
OUTCOME_VERIFIED
   ↓
MEMORIZED
```

Failure branches:

```text
REJECTED
EXPIRED
CANCELLED
ABORTED
FAILED
INDETERMINATE
```

### DecisionTwin Record

```text
DecisionTwin
├── decision_id
├── tenant_id
├── context
├── state_snapshot        ← references StateHash (Authoritative, A1)
├── evidence_refs
│     ├── decision_evidence_refs  ← A5: from decision pipeline
│     └── outcome_evidence_refs   ← A5: from outcome pipeline
├── assumptions
├── constraints
├── candidate_options     ← SPECULATIVE until ASSURED (A6)
├── predicted_outcomes
├── risk_distribution
├── selected_action
├── authorization
├── execution
├── actual_outcome
├── prediction_error
├── config_hash           ← A4: bound at creation, revalidated at G0
├── lifecycle_state       ← A8: CREATED | ... | MEMORIZED | REVALIDATION_REQUIRED
└── provenance
```

A Decision Twin preserves the **why, what was known, what was chosen, and what actually happened** for every significant business decision.

**Amendment A5**: `evidence_refs` is split into `decision_evidence_refs` (from the decision pipeline: creation, G0–G4, policy, authorization, execution initiation) and `outcome_evidence_refs` (from the outcome pipeline: execution result, observation, prediction vs. actual). These map to separate Merkle trees in the ledger.

**Amendment A8**: `lifecycle_state` tracks the Decision Twin's current state through the full lifecycle, including `REVALIDATION_REQUIRED` for staleness detection.

---

## 12. Rust Trait Boundaries

Cross-plane and cross-layer boundaries must be expressed as stable traits, not concrete types:

```rust
trait EvidenceStore {
    fn append(&self, record: &EvidenceRecord) -> Result<EvidenceId>;
    fn verify(&self, id: &EvidenceId) -> Result<()>;
    fn get(&self, id: &EvidenceId) -> Result<EvidenceRecord>;
}

trait StateStore {
    fn current_state(&self, tenant: TenantId, entity: EntityId) -> Result<StateSnapshot>;
    fn apply(&self, delta: &StateTransitionRecord) -> Result<StateHash>;
}

trait ReasoningEngine {
    fn derive(&self, state: &EnterpriseState) -> Result<Vec<DerivedFact>>;
}

trait RiskModel {
    fn assess(&self, state: &EnterpriseState) -> Result<RiskProfile>;
}

trait ScenarioEngine {
    fn generate(&self, state: &EnterpriseState, constraints: &[Constraint]) -> Result<Vec<Scenario>>;
}

trait PolicyEngine {
    fn evaluate(&self, context: &PolicyContext) -> Result<PolicyDecision>;
}

trait DecisionEngine {
    fn decide(&self, twin: &DecisionTwin) -> Result<Vec<DecisionCandidate>>;
}

trait ActionExecutor {
    fn execute(&self, action: &Action) -> Result<ExecutionResult>;
}

trait OutcomeCollector {
    fn collect(&self, action_id: &ActionId) -> Result<Outcome>;
}

trait ModelProvider {
    fn predict(&self, input: &ModelInput) -> Result<ModelOutput>;
    fn provenance(&self) -> ModelProvenance;
}
```

**Rule**: No layer may depend on a concrete implementation of a trait defined in a higher layer. Traits flow downward; implementations flow upward via dependency injection.

---

## 13. Multi-Tenancy Model

Tenant isolation must apply to:
```text
identity
state
graph
evidence
policies
models
decisions
memory
execution
API access
encryption context
```

**Rule**: `TenantId` is a first-class component of all authoritative state and evidence records. Cross-tenant data access requires explicit authorization at the control-plane boundary.

---

## 14. Failure Semantics

| Failure Mode | Behavior |
|---|---|
| Crypto failure | fail closed |
| Identity failure | reject |
| Transport failure | retry / isolate |
| Consensus failure | no authoritative write |
| Evidence failure | no authoritative commit |
| State corruption | quarantine / recover |
| Model failure | deterministic fallback |
| SLM ambiguity | reject / request clarification |
| Solver timeout | deny or policy-defined fallback |
| Policy failure | deny |
| Execution failure | rollback / compensate |
| Outcome uncertainty | mark uncertain |
| Telemetry loss | DATA NOT AVAILABLE |

---

## 15. Formal Architecture Invariants

1. **I1**: No unauthenticated Raft RPC changes state.
2. **I2**: No stale term can modify current state.
3. **I3**: No non-leader can commit client writes.
4. **I4**: Committed state survives restart.
5. **I5**: Cryptographic identity cannot silently change.
6. **I6**: Replay cannot produce a second state transition.
7. **I7**: Key rotation cannot invalidate committed historical evidence.
8. **I8**: A network partition cannot create two valid committed histories.
9. **I9**: Failed cryptographic verification is fail-closed.
10. **I10**: Evidence corresponds to the exact committed state.

**Platform-level invariants**:
- **CONST-1**: No unverified probabilistic output may directly create an authoritative enterprise state transition or execute an irreversible action.
- **CONST-2**: Every authoritative decision affecting enterprise state must be attributable to a defined state snapshot, evidence set, policy context, authorization context, and execution outcome.
- **CONST-3**: Security, intelligence, and execution remain separately enforceable trust domains.
- **CONST-4**: The data plane, control plane, and intelligence plane must never be conflated.
- **CONST-5**: Tenant ID is mandatory on all authoritative state and evidence.
- **CONST-6**: No state visible as authoritative may exist without a corresponding committed state-transition record and evidence reference.
- **CONST-7**: Every action_id must have a matching authorization_id tracing back to a completed DecisionTwin with a finalized AssuranceResult and PolicyEvaluation.
- **CONST-8**: INDETERMINATE is not PASS.

---

## 16. Dependency Direction Rules

```text
Experience
   ↓
Decision
   ↓
Execution
   ↓
Policy
   ↓
Intelligence
   ↓
Reasoning
   ↓
State
   ↓
Evidence
   ↓
Consensus
   ↓
Transport
   ↓
Crypto
```

Cross-cutting infrastructure is injected through the trait boundaries in Section 12. Lower layers provide traits; upper layers provide implementations.

---

## 17. External AI / LLM Boundary

```text
              VARDHAN INTELLIGENCE
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
      VARDHAN MODELS         OPTIONAL EXTERNAL
            │                 MODEL PROVIDER
            │                     │
            └──────────┬──────────┘
                       ▼
                AI ASSURANCE
                       ▼
               FORMAL VARDHAN IR
```

An external LLM may be:
- optional
- replaceable
- disabled
- benchmarked
- isolated

It must **never** own:
- canonical enterprise state
- authoritative evidence
- security policy
- consensus
- authorization
- irreversible execution

---

## 18. Three Twins

### Enterprise State Twin
> What exists and what is happening?
```text
assets
systems
people
relationships
events
dependencies
```

### Risk Twin
> What can happen and what are the consequences?
```text
exposures
dependencies
scenarios
probability
impact
uncertainty
```

### Decision Twin
> Given this state and risk, what decision was considered, authorized, executed, and what happened?
```text
facts
assumptions
options
constraints
decision
action
outcome
```

Together:
```text
Enterprise Twin
      +
Risk Twin
      +
Decision Twin
      ↓
VARDHAN INTELLIGENCE
```

---

## 19. Cryptographic / Quantum Security Twin

```text
Business Process
      ↓
Application
      ↓
Service
      ↓
Certificate / Key
      ↓
Protocol / Algorithm
      ↓
Cryptographic Dependency
      ↓
PQC Exposure
```

Chain:
```text
asset
 ↓
cryptographic dependency
 ↓
migration status
 ↓
business impact
 ↓
priority
 ↓
migration decision
 ↓
verified outcome
```

This connects Vardhan's PQC expertise (Layer 1) to the broader enterprise intelligence architecture.

---

## 20. Constraint Intelligence

```text
          Enterprise Graph
                 │
        ┌────────┼────────┐
        ▼        ▼        ▼
     Resource Dependency Policy
        │        │        │
        └────────┼────────┘
                 ▼
          Constraint Graph
                 │
                 ▼
        Bottleneck analysis
                 │
                 ▼
       Candidate interventions
                 │
                 ▼
            Simulation
```

---

## 21. AI Assurance G0–G4 Contract

```text
                 AI / SEMANTIC INPUT
                         │
                         ▼
                ┌────────────────┐
                │ G0 Input Integrity │
                └───────┬────────┘
                        ▼
                ┌────────────────┐
                │ G1 Semantic Agreement │
                └───────┬────────┘
                        ▼
                ┌────────────────┐
                │ G2 Perturbation Robustness │
                └───────┬────────┘
                        ▼
                ┌────────────────┐
                │ G3 Utility / Non-Degeneracy │
                └───────┬────────┘
                        ▼
                ┌────────────────┐
                │ G4 Formal Policy Verification │
                └───────┬────────┘
                        ▼
                  valid candidate
```

### G0 — Input Integrity
- schema validation
- provenance verification
- malformed input rejection
- adversarial content detection
- prompt injection detection
- ambiguity resolution
- OOD condition detection
- missing fact detection

### G1 — Semantic Agreement
The requirement is **not**:
```text
AST_A == AST_B
```
Instead:
```text
AST_A
   │
   ├── equivalence theory ──→ semantic equivalence
   │
AST_B
```

Or:
```text
SMT:
prove(A ↔ B)
```

### G2 — Perturbation Robustness
```text
Input
 ├─ perturbation A → result
 ├─ perturbation B → result
 ├─ perturbation C → result
 └─ perturbation D → result
             ↓
       stability analysis
```

### G3 — Utility / Non-Degeneracy
```text
Quality
 +
Utility
 +
Coverage
 +
Robustness
 +
Non-degeneracy
```

### G4 — Formal Policy Verification
> The policy solver verifies that the candidate satisfies the encoded policy constraints.

### G4 Proof Artifact

G4 must produce a `PolicyEvaluation` with a verifiable proof reference, not a Boolean:

```text
PolicyEvaluation
├── policy_version         : String
├── policy_hash            : [u8; 32]
├── config_hash            : [u8; 32]          ← A4
├── input_state_hash       : [u8; 32]
├── candidate_hash         : [u8; 32]
├── constraints_evaluated  : Vec<ConstraintRef>
├── result                 : PASS | FAIL | INDETERMINATE | TIMEOUT
├── solver_metadata        : JsonValue
├── proof_reference        : ProofRef
├── evidence_reference     : EvidenceId
└── tenant_id              : TenantId          ← A2
```

### AssuranceResult

The collective output of G0–G4 must produce an `AssuranceResult` with explicit statuses:

```text
AssuranceResult
├── assurance_id
├── input_ref
├── candidate_ref
├── g0_result
├── g1_result
├── g2_result
├── g3_result
├── g4_result            : PolicyEvaluation (see above)
├── policy_context
├── evidence_refs
├── model_provenance
├── evaluator_versions
├── created_at
└── final_status
```

**Explicit statuses**:

| Status | Meaning | Action |
|---|---|---|
| **PASS** | All gates passed | Proceed |
| **FAIL** | At least one gate failed | Reject |
| **REJECT** | Deliberate rejection (e.g., G0 schema failure) | Deny |
| **INDETERMINATE** | Cannot determine outcome | Policy-defined safe behavior |
| **TIMEOUT** | G2/G3/G4 exceeded time budget | Policy-defined safe behavior |
| **NOT_APPLICABLE** | Gate was not relevant for this candidate | Excluded from final_status |

**Constitutional rule**: `INDETERMINATE` is **not** `PASS`. The decision system must treat it as a distinct status that triggers conservative fallback behavior defined by policy.

---

## 22. Control-Flow Firewall

Every executable action must converge through a single authority gate. There is **no alternative path**.

```text
                       ┌──────────────┐
AI ───────────────────→│              │
Rule Engine ──────────→│              │
Human ────────────────→│  AUTHORITY   │
API ──────────────────→│    GATE      │
Event ────────────────→│              │
                       └──────┬───────┘
                              ▼
                          EXECUTOR
```

**Prohibited paths**:
```text
Model → Executor
Agent → Executor
UI → Executor
Webhook → Executor
```

**Architectural invariant**:
> Every action_id must have a matching authorization_id that traces back to a completed DecisionTwin with a finalized AssuranceResult and PolicyEvaluation.

---

## 23. Human Authorization as Deterministic Policy

Never use vague code like:

```rust
if requires_human {
    ask_human();
}
```

Instead, resolve through deterministic policy:

```text
Policy
 ↓
Risk Class
 ↓
Authority Requirement
 ↓
Required Actor / Role
 ↓
Approval Rules
 ↓
Authorization Evidence
```

Example:
```text
decision_risk = HIGH
        +
action_reversibility = LOW
        +
financial_exposure > policy_threshold
        ↓
HUMAN_AUTH_REQUIRED
```

Thresholds remain deployment-configurable. The policy engine emits `AuthorizationEvidence` that is recorded in the Decision Twin.

---

## 22. Mapping: What We Have vs. What Is New

```text
ALREADY STRONG
──────────────────────────────
PQC
Identity
AEAD Transport
Raft
HA
Durable Ledger
Evidence
Checkpointing
Verification
Container baseline
Security testing
         │
         ▼
FOUNDATION
```

```text
TO BUILD
──────────────────────────────
Enterprise Common Model
State Fabric
Enterprise Graph
Reasoning Fabric
AI Assurance
Risk Fabric
Scenario Engine
Decision Twin
Policy Intelligence
Governed Execution
Outcome Verification
Decision Memory
         │
         ▼
VARDHAN INTELLIGENCE PLATFORM
```

**This means existing work is not discarded.** It is given its proper architectural position as Layers 1–3 (trust fabric, distributed trust, evidence fabric).

---

## 23. Implementation Derivation Order

1. **Architecture Constitution** (this document)
2. **System Map** (the master data flow diagram)
3. **Canonical Objects** (Section 7, 8, 9, 10, 11)
4. **Interfaces / Traits** (Section 12)
5. **State Machines** (Section 2, 6)
6. **Threat Model** (Section 14, 15)
7. **Integration Test Plan** (existing PQC↔Consensus suite, extended per layer)
8. **Implementation** (bottom-up within trait boundaries)

**Never reverse this order.**

---

## 24. Amendments A1–A9

The following amendments refine and strengthen existing sections. When an amendment contradicts an earlier section, the amendment takes precedence.

### A1: Authoritative vs. Speculative State

**Refines**: Section 10 (State Transition Model)

The five lifecycle states (PROPOSED, VALIDATED, COMMITTED, APPLIED, EVIDENCED) must be interpreted through a two-tier visibility model:

```text
SPECULATIVE STATE (not visible to Intelligence or Decision layers)
   ├── PROPOSED    (delta created, not yet G0-validated)
   ├── VALIDATED   (G0 passed, not yet Raft-committed)
   ├── EVIDENCE_PREPARED (evidence written, not yet consensus-committed)
   ├── COMMITTED   (Raft committed, not yet applied)
   └── APPLIED     (applied to state machine, evidence not yet finalized)

AUTHORITATIVE STATE (visible to Intelligence and Decision layers)
   └── EVIDENCED   (Raft-committed AND evidence finalized AND applied)
```

**Constitutional invariant (strengthened from CONST-6)**:
> Intelligence Plane components, Decision Twin construction, Risk assessment, and Scenario generation may **only** observe state at the `EVIDENCED` tier. `SPECULATIVE` state is not addressable by any upper-layer query, API response, or candidate decision input.

**Failure behavior**: If Raft commits a delta but evidence finalization fails, the delta is rolled back to `APPLIED` (reverted) and the failure is recorded. The state does not become authoritative.

### A2: Tenant-Scoped Semantic State

**Refines**: Section 13 (Multi-Tenancy Model), Section 11 (Decision Twin Model)

All **semantic** state objects — DecisionTwin, DecisionCandidate, AuthorizationEvidence, PolicyEvaluation, OutcomeResult, Scenario, RiskProfile, ModelOutput — must carry `TenantId` as a primary, non-nullable field.

**Rule**: Cross-tenant references in semantic state are **structurally forbidden** at the type level. A `DecisionTwin` record's `state_snapshot` must only reference `EntityId` values within the same `TenantId`.

**Enforcement**: The state store validates tenant scoping on every write. Cross-tenant queries require a cross-tenant policy evaluation at the control-plane boundary, which itself produces tenant-scoped evidence.

### A3: Vardhan Time Model

**Adds**: A unified temporal model across all layers.

Four distinct time domains:

| Time Domain | Meaning | Source | Format |
|---|---|---|---|
| **Logical Time** | Consensus ordering (Raft commit_index) | Raft cluster | `u64` monotonic |
| **Event Time** | When the event occurred in the real world | External source | `DateTime<Utc>` |
| **System Time** | When the event was ingested/processed by Vardhan | Vardhan clock | `DateTime<Utc>` |
| **Deadline Time** | Human-defined decision/action deadline | Policy | `DateTime<Utc>` |

**Model**:
```text
EventTime ≤ SystemTime
LogicalTime ≠ EventTime ≠ SystemTime
DeadlineTime is independent (may be in future relative to SystemTime)
```

**Rule**: All `EvidenceRecord` must carry all four timestamps where available. `StateTransitionRecord.commit_index` is the only time coordinate used for consensus ordering. `DecisionTwin` must carry `deadline` for all decisions with reversal requirements.

**Ordering guarantee**: Within a tenant, events are processed in `LogicalTime` order. `EventTime` is preserved for analytical queries but never used for ordering.

### A4: Versioned Configuration State

**Adds**: Configuration that affects system behavior must be treated as part of the state model.

```text
ConfigurationState
├── config_id          : ConfigId (logical)
├── tenant_id          : TenantId
├── version            : u64
├── config_hash        : [u8; 32]  (BLAKE3 of canonical config bytes)
├── effective_from     : LogicalTime (commit_index)
├── effective_to       : LogicalTime (commit_index, optional)
├── parent_version     : ConfigId (optional, for rollback)
├── config_payload     : JsonValue (canonicalized)
├── signature          : Signature (ML-DSA-87)
├── author_identity    : EntityId
└── change_reason      : String
```

**Rules**:
- Configuration changes are `StateTransitionRecord`s with `transition_type = "CONFIG_UPDATE"`
- Configuration changes must be Raft-committed and evidence-finalized before becoming effective
- Configuration changes are tenant-scoped (A2)
- The system **never** uses configuration that has not been evidence-finalized
- Rollback to a previous configuration version is a new `CONFIG_UPDATE` transition

**Impact**: AI Assurance gates (G0–G4), policy evaluation, and authorization all consume `ConfigurationState` as input. They must reference the `config_hash` at the time of their evaluation, producing `PolicyEvaluation.config_hash` and `AssuranceResult.config_hash`.

### A5: Decision Evidence vs. Outcome Evidence

**Refines**: Section 9 (Evidence Model)

Two distinct evidence categories, never conflated:

```text
DECISION EVIDENCE (produced by the decision pipeline)
   ├── DecisionTwin creation
   ├── candidate option generation
   ├── G0–G4 assurance results
   ├── policy evaluation
   ├── authorization
   └── execution initiation

OUTCOME EVIDENCE (produced by the outcome verification pipeline)
   ├── action execution result
   ├── real-world observation
   ├── prediction vs. actual comparison
   ├── prediction error calculation
   └── decision memory finalization
```

**Rule**: A `DecisionTwin` must have at least one `DECISION_EVIDENCE` record before it can reach `AUTHORIZED` state. It must have at least one `OUTCOME_EVIDENCE` record before it can reach `MEMORIZED` state. The evidence type is recorded in `EvidenceRecord.evidence_category`.

**Separation**: Decision evidence and outcome evidence are written to separate Merkle trees within the ledger, enabling independent verification of the decision pipeline vs. the outcome pipeline.

### A6: Canonical Candidate Boundary

**Refines**: Section 17 (External AI / LLM Boundary), Section 10 (State Transition Model)

A `DecisionCandidate` produced by the Intelligence Plane is **always** a speculative, non-authoritative object. It may never:

1. Directly mutate `EnterpriseState`
2. Directly issue an `Action`
3. Directly authorize itself
4. Directly write to the evidence ledger
5. Be visible to external APIs as "decision" output before passing through G0–G4 + policy + authorization

**Canonical candidate boundary**:
```text
Intelligence Plane
   ↓
DecisionCandidate (SPECULATIVE, tenant-scoped, config-version-referenced)
   │  ← MUST reference: state_hash, config_hash, evidence_window
   ↓
AI Assurance G0–G4
   ↓
AssuranceResult
   │  ← final_status = PASS required to proceed
   ↓
Policy + Authorization
   ↓
DecisionTwin (CREATED → ... → AUTHORIZED)
   ↓
Execution (only after AUTHORIZED)
```

**Constraint**: A `DecisionCandidate` that references a `StateHash` from before the last `CONFIG_UPDATE` within its validity window is automatically `REJECTED` by G0.

### A7: Universal Authority / Execution Gate

**Reinforces**: Section 22 (Control-Flow Firewall)

There is exactly **one** execution authority in the system: the **Vardhan Authority Gate**. All action invocations — whether from AI, rule engine, human, API, webhook, or event — must pass through it.

```text
                       ┌──────────────────────┐
                       │  VARDHAN AUTHORITY   │
                       │       GATE           │
                       │                      │
AI ──────────────────→│                      │
Rule Engine ──────────→│  Validates:          │
Human ────────────────→│  1. authorization_id │
API ──────────────────→│  2. policy eval ref  │
Webhook ──────────────→│  3. assurance result │
Event ────────────────→│  4. config version   │
                       │  5. tenant scope     │
                       └──────────┬───────────┘
                                  ▼
                           ACTION EXECUTOR
```

**Validation performed by the Gate**:
1. `action_id` has matching `authorization_id`
2. `authorization_id` traces to a completed `DecisionTwin` in `EXECUTED` state
3. `DecisionTwin` has a `final_status = PASS` from G0–G4
4. `PolicyEvaluation.result = PASS` within the validity window
5. `config_hash` matches the current effective configuration
6. `tenant_id` matches the execution context

**Failure**: Any validation failure → action rejected, evidence recorded, `INDETERMINATE` outcome.

### A8: Decision Twin REVALIDATION_REQUIRED

**Adds**: A Decision Twin can enter a `REVALIDATION_REQUIRED` state when its underlying assumptions or constraints become stale.

Triggers for `REVALIDATION_REQUIRED`:
- Configuration change (A4) since the DecisionTwin was last evaluated
- New evidence contradicting an assumption
- Stale-term detection (I2): the state snapshot used by the DecisionTwin is older than a newer commit
- Risk re-assessment outside tolerance band
- External mandate (e.g., regulatory change)

Lifecycle additions:
```text
... (existing states)
AUTHORIZED
   ↓
EXECUTING
   ↓
EXECUTED
   ↓
REVALIDATION_REQUIRED   ← NEW
   │
   ├── [re-validated] → OUTCOME_PENDING
   ├── [expired]      → EXPIRED
   ├── [cancelled]    → CANCELLED
   └── [failed]       → FAILED
```

**Rule**: A DecisionTwin in `REVALIDATION_REQUIRED` state cannot initiate new actions. It is visible in the UI only as "awaiting re-verification."

### A9: Fault-Domain Isolation

**Adds**: Runtime failures must be contained within bounded fault domains. No single component failure may cause cascading failure across planes.

**Fault domains**:
```text
┌─────────────────────────────────────────────┐
│  TRUST FABRIC fault domain                  │
│  (PQC, transport, Raft, HA)                  │
├─────────────────────────────────────────────┤
│  EVIDENCE FABRIC fault domain                │
│  (ledger, Merkle, attestation)               │
├─────────────────────────────────────────────┤
│  ENTERPRISE STATE fault domain               │
│  (state store, graph, canonical model)       │
├─────────────────────────────────────────────┤
│  INTELLIGENCE fault domain                     │
│  (models, reasoning, risk, scenarios)        │
├─────────────────────────────────────────────┤
│  DECISION & EXECUTION fault domain             │
│  (decision twin, policy, authorization)      │
├─────────────────────────────────────────────┤
│  MEMORY fault domain                           │
│  (outcome verification, decision memory)     │
└─────────────────────────────────────────────┘
```

**Isolation rules**:
1. Failure in INTELLIGENCE domain (e.g., model crash) does **not** affect TRUST FABRIC or EVIDENCE FABRIC. The system falls back to deterministic baselines.
2. Failure in DECISION & EXECUTION domain (e.g., policy engine crash) does **not** stop ingestion or evidence capture. Pending decisions are held until recovery.
3. Failure in TRUST FABRIC (e.g., consensus outage) halts all authoritative writes but allows read-only access to already-EVIDENCED state.
4. Each fault domain has independent circuit breakers, health checks, and recovery procedures.
5. Cross-domain references use asynchronous, eventually-consistent messaging with explicit retry and failure semantics.

**Implementation note**: Fault-domain isolation is achieved through process/thread isolation, circuit breakers, and bounded channel semantics — **not** by mandating microservices or separate daemon processes (see Constraint below).

### Constraint: No Microservices Mandate

The architecture does not mandate microservices, separate daemons, or three-daemon deployment. Fault-domain isolation (A9) can be achieved through:
- In-process thread pools with bounded channels
- Circuit breakers on trait calls
- Asynchronous message passing within a single binary
- Process-level isolation where deployment requires it

The architectural contracts (traits, fault domains, time model) are **implementation-independent**.

---

## 25. Amendment Version History

| Version | Amendment | Date | Description |
|---|---|---|---|
| 1.1 | A1 | 2026-09-19 | Authoritative vs. Speculative State |
| 1.1 | A2 | 2026-09-19 | Tenant-Scoped Semantic State |
| 1.1 | A3 | 2026-09-19 | Vardhan Time Model |
| 1.1 | A4 | 2026-09-19 | Versioned Configuration State |
| 1.1 | A5 | 2026-09-19 | Decision Evidence vs Outcome Evidence |
| 1.1 | A6 | 2026-09-19 | Canonical Candidate Boundary |
| 1.1 | A7 | 2026-09-19 | Universal Authority / Execution Gate |
| 1.1 | A8 | 2026-09-19 | Decision Twin REVALIDATION_REQUIRED |
| 1.1 | A9 | 2026-09-19 | Fault-Domain Isolation |

| Foundation Artifact | Layer | Status |
|---|---|---|
| `core_crypto` (ML-KEM-1024, ML-DSA-87, identity, rotation) | L01 | ✅ Complete, 65/65 tests |
| `proxy_engine` (PQ handshake, AES-256-GCM AEAD transport) | L01 | ✅ Complete, 60/60 integration tests |
| `ha_cluster` (Raft, HA, durable state, MockRpcClient) | L02 | ✅ Complete, 65/65 P8 tests |
| `audit_ledger` (ledger, checkpoints) | L03 | ✅ Complete |
| `vardhan_model` (enterprise common model) | L04 | ✅ Complete, 38/38 tests — **Constitutional baseline; must not be reinvented** |
| `pqc_consensus_integration.rs` (trust boundary tests) | L01→L02 | ✅ Complete, 60/60 tests |
| `PQC_CONSENSUS_INTEGRATION_TEST_PLAN.md` | L01→L02 | ✅ Updated to match implementation |

**Next step**: Create `VARDHAN_SYSTEM_MAP.md` — the executable architectural blueprint derived from this Constitution. No feature coding until this is complete.

**Next layer in the dependency chain**: Enterprise State Fabric (L04–L07) → AI Assurance (L06) → Risk & Scenario (L08) → Decision Twin (L09) → Governed Execution (L10) → Decision Memory (L11) → Experience & Command (L12).

---

*This Constitution supersedes any conflicting design documents. Amendments require review of all tenets in Sections 1, 14, 15, and 22.*

### A10: The Protection Twin

**Adds**: Symmetrical mapping of Vardhan's own defensive capabilities.

While the Security Twin models the enterprise state, the **Protection Twin** models Vardhan's own deployed capabilities: agents, firewalls, proxies, honeypots, policy enforcement points, and available network routes. 
Before Vardhan takes any action, it simulates the interaction between the Protection Twin and the Security Twin to compute the exact expected outcome. A proposed action is invalid if the Protection Twin lacks the active components to enforce it.

### A11: The Defense Genome

**Adds**: Standardized catalog of defensive behaviors.

The **Defense Genome** is the structured library of all possible defensive actions Vardhan can take. Every action (e.g., "Isolate Host", "Rotate Key", "Block IP") is defined with explicit preconditions, postconditions, failure modes, and required execution authorities. Intelligence models do not invent free-form actions; they select and parameterize traits from the Defense Genome.

### A12: Security IR (Intermediate Representation)

**Adds**: The lingua franca for all Vardhan components.

All inputs to Vardhan (logs, alerts, API calls) and all outputs (policies, actions) must be compiled down to **Security IR** before processing. This ensures that the reasoning engine, the authority gate, and the execution engine all operate on mathematically precise, unambiguous structures (like ASTs) rather than natural language or vendor-specific JSON.

### A13: The Model Family

**Adds**: Explicit categorization of reasoning models.

Models are organized into a strict **Model Family** hierarchy based on their operational scope:
- *Generative/Semantic Models*: For intent parsing and Security IR synthesis.
- *Deterministic/Graph Models*: For blast-radius calculation and pathfinding.
- *Probabilistic Models*: For risk scoring and anomaly detection.
- *Policy Synthesis Models*: For generating actionable constraints.
A model may only be used for the tasks explicitly allowed for its family.

### A14: The Model Foundry

**Adds**: Pluggable, isolated intelligence architecture.

Vardhan does not rely on a single monolithic AI. The **Model Foundry** orchestrates an ensemble of specialized models (from the Model Family). Each model receives a canonical state snapshot and emits Security IR. The foundry handles model isolation, resource bounding, output parsing, and hardware acceleration routing. No model has direct access to the state store or execution engine.

### A15: Proof-Carrying Defense

**Reinforces**: A5 (Decision Evidence vs Outcome Evidence)

Every defensive action generated by the intelligence layer must be accompanied by a cryptographic proof of why the action was chosen. This proof includes the state of the Security Twin at the time of decision, the exact policy evaluated, the risk calculation, and the deterministic rule trace. The Authority Gate (A7) verifies this proof before execution.

### A16: Blast-Radius Governance

**Adds**: Pre-execution risk bounding.

Before any action passes the Authority Gate, a deterministic graph model computes the maximum possible collateral damage (**Blast Radius**) of the action using the Security Twin. If the calculated blast radius exceeds the tenant's predefined risk tolerance for autonomous action, the action is automatically downgraded to "Human Approval Required" or blocked entirely.

### A17: Action Budget

**Adds**: Rate-limiting for autonomous mitigations.

Every autonomous action consumes a configurable **Action Budget**. This budget is replenished on a sliding window. If the Action Budget is depleted, the system degrades safely to an advisory mode (human-in-the-loop) to prevent AI-driven Denial of Service (DoS) loops or runaway mitigation chains.

### A18: Adaptive Compute

**Adds**: Dynamic resource scaling based on threat level.

The system dynamically allocates compute resources (threads, memory, model complexity) based on the current aggregate risk score. Under high threat, the system degrades background tasks, increases polling frequency for the Security Twin, and routes high-priority events to larger, more accurate models within the Model Foundry.

### A19: The Vardhan Compute Unit (VCU)

**Adds**: Usage-based economic and resource model.

All operations in Vardhan—from ingesting a log to evaluating a complex LLM prompt to executing a mitigation—consume **Vardhan Compute Units (VCUs)**. The VCU is the fundamental unit of accounting, rate-limiting, and billing. The system must deterministically meter VCU consumption across all fault domains.

### A20: Cell Autonomy

**Adds**: Decentralized execution and local state.

Vardhan deployments are divided into **Cells**. A Cell is a localized execution environment (e.g., a specific cloud region or on-premise datacenter). Cells operate autonomously. If a Cell loses connectivity to the global control plane, it continues to enforce policies, execute local Defense Genome actions, and protect its Security Twin segment using its locally EVIDENCED state and models.
| 1.2 | A10 | 2026-09-22 | The Protection Twin |
| 1.2 | A11 | 2026-09-22 | The Defense Genome |
| 1.2 | A12 | 2026-09-22 | Security IR |
| 1.2 | A13 | 2026-09-22 | The Model Family |
| 1.2 | A14 | 2026-09-22 | The Model Foundry |
| 1.2 | A15 | 2026-09-22 | Proof-Carrying Defense |
| 1.2 | A16 | 2026-09-22 | Blast-Radius Governance |
| 1.2 | A17 | 2026-09-22 | Action Budget |
| 1.2 | A18 | 2026-09-22 | Adaptive Compute |
| 1.2 | A19 | 2026-09-22 | Vardhan Compute Unit (VCU) |
| 1.2 | A20 | 2026-09-22 | Cell Autonomy |
