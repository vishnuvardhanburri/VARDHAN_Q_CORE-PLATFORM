# VARDHAN PROOFMESH RECONCILIATION
## Specification Delta Analysis — Phase 5 Entry Document

**Document type**: Delta analysis. READ-ONLY against frozen specifications.  
**Baseline commits (frozen specs)**:  
- `VARDHAN_ARCHITECTURE_CONSTITUTION.md` (as of 2026-09-22)  
- `VARDHAN_SYSTEM_MAP.md` (as of 2026-09-22)  
- `VARDHAN_CANONICAL_OBJECT_SPEC.md` (as of 2026-09-21)  
- `VARDHAN_STATE_MACHINES.md` (as of 2026-09-21)  
- `VARDHAN_OBJECT_TRAITS.md` (as of 2026-09-21)  
- `VARDHAN_TEST_CONTRACTS.md` (as of 2026-09-21)  
- `VARDHAN_AI_INTELLIGENCE_DESIGN.md` (as of 2026-09-23)  

**ProofMesh baseline** (initial design docs, created 2026-09-24):  
- `VARDHAN_PROOFMESH_DESIGN.md`  
- `VARDHAN_PROOFMESH_ARCHITECTURE.md`  
- `VARDHAN_PROOFMESH_THREAT_MODEL.md`  
- `VARDHAN_PROOFMESH_TEST_STRATEGY.md`  
- `VARDHAN_PROOFMESH_EVIDENCE_SPEC.md`  

**Verification Target SHA**: 4711305797ccb68e19f55124384cf2272b5ff187  
**Phase 0.2 Status**: CLOSED (EXIT_CODE=0)  
**Rule**: This document proposes changes. No frozen spec is modified until this analysis is reviewed and frozen changes are explicitly authorized.

---

## 1. Scope and Baseline

ProofMesh is a verification control fabric that must be inserted into the existing Vardhan architecture. It is NOT a new Vardhan logical layer, NOT a parallel authority chain, and NOT a replacement for any existing canonical object.

The existing frozen specs are mature and coherent. The reconciliation task is:

1. Identify where ProofMesh inserts into the existing architecture without contradiction.
2. Identify existing constructs that ProofMesh must extend rather than duplicate.
3. Identify genuine gaps where new canonical objects, traits, state machines, or contracts are required.
4. Identify conflicts that must be resolved before implementation.

---

## 2. Existing Vardhan Architectural Invariants Relevant to ProofMesh

The following invariants from the frozen specs directly constrain ProofMesh design. Each one is a hard constraint.

### A1 — State Authoritativeness
> No state visible as authoritative may exist without a committed state-transition record and evidence reference.

**ProofMesh implication**: ProofMesh verification outcomes (e.g., "claim SEC-018 is satisfied") cannot be treated as authoritative state until they are represented as committed `EvidenceRecord` objects with Raft backing. A passing test run in memory is NOT authoritative.

### A5 — Evidence Separation
> Decision evidence and Outcome evidence are committed to separate Merkle trees.

**ProofMesh implication**: ProofMesh generates a third category — Verification Evidence — distinct from both Decision Evidence and Outcome Evidence. This requires a third Merkle tree or an explicit sub-tree namespace. The frozen spec only acknowledges two evidence trees today. **This is a gap.**

### A7 — Authority Gate
> The Authority Gate is the universal execution gate. Direct execution bypassing it is structurally forbidden.

**ProofMesh implication**: ProofMesh orchestrates test execution. If test execution mutates state or triggers real system effects, it MUST route through A7. For verification-only runs (no state mutation), the question of whether A7 applies must be resolved explicitly. **This is an unresolved question.**

### CONST-1 — Deterministic Pipeline
> No probabilistic output may directly mutate state.

**ProofMesh implication**: ProofMesh's adaptive scheduler, heuristic test selection, and AI-assisted fault injection are probabilistic/heuristic. Their outputs (selected test plans, prioritized evidence) are speculative. Final certification of a security claim must remain deterministic and policy-controlled. This aligns with ProofMesh Rule 0.2 already adopted.

### Intelligence Plane Constraint
> Intelligence Plane produces only `DecisionCandidate` objects. Only Control Plane determines authoritative state.

**ProofMesh implication**: ProofMesh's AI/ML components (adaptive scheduler, heuristic selection, anomaly detection) are Intelligence Plane. Their output is a `VerificationCandidate` (new object — see §5), never a direct claim certification. The certification authority remains deterministic.

### Evidence Integrity Chain
> `EvidenceRecord` objects form a cryptographically linked chain via `predecessor`. Merkle roots are checkpointed at each `commit_index`.

**ProofMesh implication**: ProofMesh `EvidenceObject` must either BE an `EvidenceRecord` or produce `EvidenceRecord` entries. It must not create a parallel, uncoupled evidence chain.

---

## 3. ProofMesh Architectural Placement

Based on reading the frozen System Map and Constitution:

```
┌─────────────────────────────────────────────────────┐
│                   VARDHAN LAYERS                    │
│                                                     │
│  Reality Plane   (external systems, I/O)            │
│       ↑ A7 Gate (VardhanAuthorityGate)              │
│  Control Plane   (Raft, G0-G4, Policy, Auth)        │
│       ↑ Security IR                                 │
│  Intelligence    (Models, LLMs, Reasoning)          │
│       ↑ Read-only                                   │
│  Data Plane      (Entities, Events, State)          │
│                                                     │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─    │
│                                                     │
│  VERIFICATION / CONTROL PLANE  ← ProofMesh HERE    │
│  (orthogonal to the 4 layers above)                 │
│  Operates alongside Control Plane                   │
│  Produces Verification Evidence committed to Raft   │
│  Does NOT create a 5th application layer            │
└─────────────────────────────────────────────────────┘
```

ProofMesh is a **cross-cutting verification fabric** that sits alongside the Control Plane. It:
- Reads from Data Plane and Control Plane (read-only during verification)
- Produces `EvidenceRecord` entries committed through the existing Raft evidence path
- Routes any state-mutating test scenarios through A7
- Has its own intelligence sub-plane (adaptive scheduler) subject to the same CONST-1 constraint

---

## 4. Component Mapping

### VVG — Verification Verdict Graph

**Initial ProofMesh description**: A graph of claims and their supporting evidence relationships.

**Conflict with frozen specs**: The frozen `VARDHAN_CANONICAL_OBJECT_SPEC` does not define a graph-oriented relationship model for verification claims. However, it does define `Relationship` objects between `Entity` objects. VVG must NOT reuse the `Entity/Relationship` model (which is business-domain data), but may follow the same structural pattern.

**Resolution**: VVG is a new first-class construct in the Verification Plane. It is a DAG where:
- Nodes are `VerificationClaim` objects (new — see §5)
- Edges are `EvidenceLink` objects (new — see §5) connecting claims to supporting `EvidenceRecord` entries
- The graph itself is persisted as a set of committed `EvidenceRecord` entries (using the existing evidence chain infrastructure)

**Proposed canonical name**: `VerificationGraph` (more precise than VVG)

**Affected specs**: `VARDHAN_CANONICAL_OBJECT_SPEC`, `VARDHAN_SYSTEM_MAP`

---

### VAS — Verification Adaptive Scheduler

**Initial ProofMesh description**: Adaptive scheduler for parallelism, resource isolation, and intelligent test selection.

**Conflict with frozen specs**: The frozen `VARDHAN_AI_INTELLIGENCE_DESIGN` defines the Intelligence Plane. VAS uses heuristics and ML to select and schedule tests — this output is probabilistic and therefore constrained by CONST-1.

**Resolution**: VAS is an Intelligence Plane component for the Verification Fabric. Its outputs are `ExecutionPlan` objects (new — speculative, not authoritative). An `ExecutionPlan` must be validated by a deterministic `VerificationPolicy` before any test execution begins. This mirrors the `DecisionCandidate → G0-G4 → Policy → A7` chain.

**Proposed canonical name**: `VerificationScheduler` (executes `ExecutionPlan` objects under `VerificationPolicy` authority)

**Affected specs**: `VARDHAN_AI_INTELLIGENCE_DESIGN`, `VARDHAN_CANONICAL_OBJECT_SPEC`

---

### VEP — Verification Evidence Producer

**Initial ProofMesh description**: Produces cryptographically sealed evidence from test execution outcomes.

**Conflict with frozen specs**: The frozen `VARDHAN_CANONICAL_OBJECT_SPEC` already defines `EvidenceRecord`. VEP must NOT define a parallel evidence format.

**Resolution**: VEP is a role/trait (`VerificationEvidenceProducer`) that wraps `EvidenceRecord` creation. Every test execution produces exactly one `EvidenceRecord` of type `VERIFICATION_EVIDENCE` (a new subtype). The `EvidenceRecord` is committed through the existing Raft-backed `EvidenceStore`. VEP itself is NOT a canonical object — it is an operational role.

**Proposed canonical name**: `VerificationEvidenceProducer` (trait, not object)

**Affected specs**: `VARDHAN_OBJECT_TRAITS`, `VARDHAN_CANONICAL_OBJECT_SPEC` (new EvidenceRecord subtype)

---

### VRE — Verification Replay Engine

**Initial ProofMesh description**: Deterministic replay of test scenarios for classification and flake detection.

**Conflict with frozen specs**: The frozen `VARDHAN_STATE_MACHINES` defines that state ordering is governed by Raft `commit_index`. A replay scenario must be grounded to a specific `commit_index` snapshot, not wall-clock time.

**Resolution**: Each replay is a `ReplayCapsule` (new object — see §5) containing: the `StateSnapshot` at the target `commit_index`, the exact test input parameters, the random seed, and environment constraints. Replay is deterministic with respect to logical time, not system clock. This structurally eliminates flake-by-timing as a valid replay failure.

**Proposed canonical name**: `ReplayCapsule`, `VerificationReplayEngine` (operational component)

**Affected specs**: `VARDHAN_CANONICAL_OBJECT_SPEC`, `VARDHAN_STATE_MACHINES`

---

### VFI — Verification Fault Injector

**Initial ProofMesh description**: Controlled fault injection for adversarial verification.

**Conflict with frozen specs**: Fault injection that mutates real system state MUST route through A7. Fault injection that mutates test-isolated state (in-memory, ephemeral) does not require A7 routing.

**Resolution**: VFI operates in two modes:
1. `ISOLATED_FAULT`: Operates only on ephemeral test state. No A7 gate required. Evidence produced is tagged `ISOLATED`.
2. `SYSTEMIC_FAULT`: Operates on real system state. MUST route through A7. Evidence tagged `SYSTEMIC`. This mode is structurally disabled unless an explicit `FaultInjectionAuthorization` (new object — see §5) has been issued through the full authority chain.

**Proposed canonical name**: `FaultScenario`, `FaultInjectionAuthorization`

**Affected specs**: `VARDHAN_CANONICAL_OBJECT_SPEC`, `VARDHAN_OBJECT_TRAITS`

---

### VEQ — Verification Evidence Quorum

**Initial ProofMesh description**: Quorum of diverse evidence sources required to certify a claim.

**Conflict with frozen specs**: The frozen assurance model (G0-G4) already defines a multi-level assurance chain for business decisions. VEQ must not create a parallel assurance chain that bypasses G0-G4.

**Resolution**: VEQ operates at a different level than G0-G4. G0-G4 assures the correctness of AI/model outputs. VEQ assures the completeness and diversity of raw verification evidence. They are complementary:

```
VerificationClaim
    ↓ VEQ: evidence quorum satisfied?
EvidenceQuorum object
    ↓ G0: structural integrity of evidence objects?
AssuranceResult (PASS/FAIL/INDETERMINATE)
    ↓ VerificationPolicy
VerificationFinding (authoritative)
```

**Proposed canonical name**: `EvidenceQuorum`, `EvidencePolicy`

**Affected specs**: `VARDHAN_CANONICAL_OBJECT_SPEC`, `VARDHAN_OBJECT_TRAITS`

---

## 5. Canonical Object Delta

The following new canonical objects are proposed. Each must be reviewed and explicitly authorized before being added to `VARDHAN_CANONICAL_OBJECT_SPEC`.

---

### NEW: `VerificationClaim`

| Field | Type | Notes |
|-------|------|-------|
| `id` | `ClaimId` (UUID) | Logical identity |
| `content_hash` | `ContentHash` (BLAKE3) | Cryptographic identity of claim text |
| `claim_text` | String | Human-readable security/system claim |
| `claim_type` | Enum: `SECURITY`, `CORRECTNESS`, `PERFORMANCE`, `RESILIENCE` | |
| `tenant_id` | `TenantId` | All claims are tenant-scoped |
| `required_evidence_policy` | `EvidencePolicyId` | Which `EvidencePolicy` must be satisfied |
| `status` | Enum: `OPEN`, `EVIDENCE_GATHERING`, `QUORUM_SATISFIED`, `CERTIFIED`, `FAILED`, `EXPIRED` | |
| `created_at` | `EventTime` | Wall clock |
| `commit_index` | `CommitIndex` | Logical time of claim registration |
| `config_hash` | `ConfigurationHash` | Bound to config at registration time |

**Owner**: Verification Plane  
**Trust level**: Control Plane (deterministic)  
**Lifecycle**: OPEN → EVIDENCE_GATHERING → QUORUM_SATISFIED → CERTIFIED | FAILED | EXPIRED  
**Mutation authority**: Verification Policy Engine only  
**Integrity protection**: Content hash + signature  
**Invariant**: A claim may NEVER transition to CERTIFIED without a fully committed `VerificationFinding` in the Raft evidence chain.

---

### NEW: `EvidenceObject`

Maps to and extends the existing `EvidenceRecord`. NOT a replacement.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `EvidenceId` (BLAKE3 of content) | |
| `evidence_record_ref` | `EvidenceRecordId` | Reference to the committed `EvidenceRecord` in the Raft chain |
| `claim_id` | `ClaimId` | Which `VerificationClaim` this supports |
| `evidence_type` | Enum: `UNIT`, `INTEGRATION`, `TCP_REAL`, `PQ_HANDSHAKE`, `ADVERSARIAL`, `REPLAY`, `FAULT_INJECTION` | Evidence diversity dimension |
| `execution_mode` | Enum: `ISOLATED`, `SYSTEMIC` | VFI mode |
| `verdict` | Enum: `PASS`, `FAIL`, `INDETERMINATE`, `TIMEOUT` | Never collapsed — `INDETERMINATE` ≠ `PASS` |
| `replay_capsule_ref` | `ReplayCapsuleId?` | Optional, present if produced by replay |
| `fault_scenario_ref` | `FaultScenarioId?` | Optional, present if produced under fault injection |
| `sha` | `ContentHash` | Cryptographic binding to test binary and inputs |
| `commit_index` | `CommitIndex` | Raft commit index when evidence was committed |

**Owner**: VEP (VerificationEvidenceProducer trait)  
**Trust level**: Control Plane  
**Integrity protection**: BLAKE3 hash + Merkle tree entry + ed25519 signature  
**Replay semantics**: An `EvidenceObject` is fully deterministically replayable given its `ReplayCapsule`.  
**Invariant**: An `EvidenceObject` with `verdict = INDETERMINATE` MUST NOT contribute to `EvidenceQuorum` satisfaction.

---

### NEW: `ExecutionPlan`

| Field | Type | Notes |
|-------|------|-------|
| `id` | `PlanId` (UUID) | |
| `claim_ids` | `Vec<ClaimId>` | Claims this plan targets |
| `scheduled_runs` | `Vec<VerificationRun>` | Ordered/parallel execution units |
| `resource_budget` | `ResourceBudget` | CPU/time/isolation constraints |
| `status` | Enum: `SPECULATIVE`, `POLICY_APPROVED`, `EXECUTING`, `COMPLETED`, `CANCELLED` | |
| `generated_by` | `SchedulerProvenance` | Which scheduler version produced this |

**State**: Always begins as `SPECULATIVE`. Cannot proceed to `EXECUTING` without `POLICY_APPROVED`.  
**Invariant**: An `ExecutionPlan` in `SPECULATIVE` state must NEVER be presented to a user or external system as a committed plan.

---

### NEW: `VerificationRun`

| Field | Type | Notes |
|-------|------|-------|
| `id` | `RunId` (UUID) | |
| `plan_id` | `PlanId` | Parent plan |
| `claim_id` | `ClaimId` | Target claim |
| `test_spec` | `TestSpec` | Binary, args, environment |
| `state_snapshot_ref` | `StateSnapshotId` | Raft-grounded state snapshot |
| `status` | Enum: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `TIMEOUT`, `CANCELLED` | |
| `evidence_object_ref` | `EvidenceObjectId?` | Set on completion |
| `start_logical_time` | `CommitIndex` | When run was dispatched |
| `end_logical_time` | `CommitIndex?` | When evidence was committed |

---

### NEW: `ReplayCapsule`

| Field | Type | Notes |
|-------|------|-------|
| `id` | `ReplayCapsuleId` (BLAKE3 of inputs) | |
| `original_run_id` | `RunId` | The run being replayed |
| `state_snapshot_ref` | `StateSnapshotId` | Exact state at `commit_index` |
| `commit_index` | `CommitIndex` | Logical time anchor |
| `test_spec` | `TestSpec` | Must match original byte-for-byte |
| `random_seed` | `u64` | Fixed for determinism |
| `environment_hash` | `ContentHash` | Hash of env vars, binary versions |

**Invariant**: A replay using a different `state_snapshot_ref` or `random_seed` is NOT a replay of the original run. It is a new independent `VerificationRun`.

---

### NEW: `EvidenceQuorum`

| Field | Type | Notes |
|-------|------|-------|
| `id` | `QuorumId` | |
| `claim_id` | `ClaimId` | |
| `policy_ref` | `EvidencePolicyId` | Which policy defines quorum requirements |
| `collected_evidence` | `Vec<EvidenceObjectId>` | All contributing evidence objects |
| `quorum_status` | Enum: `INSUFFICIENT`, `SATISFIED`, `CONTRADICTED` | |
| `satisfied_at_commit` | `CommitIndex?` | Logical time quorum was satisfied |

**Invariant**: `quorum_status = SATISFIED` requires all contributing `EvidenceObject.verdict = PASS`. A single `FAIL` transitions to `CONTRADICTED`. A quorum with only `INDETERMINATE` entries remains `INSUFFICIENT`.

---

### NEW: `EvidencePolicy`

| Field | Type | Notes |
|-------|------|-------|
| `id` | `EvidencePolicyId` | |
| `claim_type` | `ClaimType` | Which type of claim this policy governs |
| `required_evidence_types` | `Vec<EvidenceType>` | Diversity requirements |
| `minimum_quorum` | `u32` | Minimum passing evidence count |
| `requires_replay` | `bool` | Must at least one pass be a deterministic replay? |
| `requires_fault_injection` | `bool` | Must adversarial evidence be present? |
| `config_hash` | `ConfigurationHash` | Policy is config-bound |

---

### NEW: `VerificationFinding`

The authoritative certification object. Analogous to `StateTransitionRecord` for business decisions.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `FindingId` | |
| `claim_id` | `ClaimId` | |
| `quorum_ref` | `QuorumId` | The satisfied quorum |
| `verdict` | Enum: `CERTIFIED`, `FAILED`, `INDETERMINATE` | Final deterministic outcome |
| `certified_by` | `PolicyEngineId` | The deterministic authority that certified |
| `commit_index` | `CommitIndex` | Raft commit index of this finding |
| `evidence_tree_root` | `MerkleRoot` | Root of verification evidence sub-tree |
| `signature` | `Signature` | ed25519 signature over content |

**Invariant**: A `VerificationFinding` with `verdict = CERTIFIED` is the ONLY object that may transition a `VerificationClaim` to `CERTIFIED`. A human-readable report, a passing test log, or a ProofMesh console output is NEVER sufficient. This is INVARIANT-PM-001 (Rule 0.1 structural encoding).

---

### NEW: `FaultScenario`

| Field | Type | Notes |
|-------|------|-------|
| `id` | `FaultScenarioId` | |
| `fault_type` | Enum: `NETWORK_PARTITION`, `NODE_CRASH`, `BYZANTINE_MESSAGE`, `RESOURCE_EXHAUSTION`, `TIMING_STARVATION`, `CRYPTO_KEY_SUBSTITUTION`, ... | |
| `execution_mode` | Enum: `ISOLATED`, `SYSTEMIC` | |
| `authorization_ref` | `FaultInjectionAuthorizationId?` | Required if `SYSTEMIC` |
| `target_component` | String | |
| `parameters` | `Map<String, Value>` | |

---

### NEW: `FaultInjectionAuthorization`

| Field | Type | Notes |
|-------|------|-------|
| `id` | `FaultInjectionAuthorizationId` | |
| `scenario_id` | `FaultScenarioId` | |
| `authorized_by` | `DecisionTwinId` | Must trace to a completed authority chain |
| `valid_until` | `EventTime` | Expires |
| `scope` | `TenantId` | Tenant-scoped |

**Invariant**: A `SYSTEMIC` `FaultScenario` without a valid, unexpired `FaultInjectionAuthorization` MUST be rejected at the VFI layer. This is the A7 gate equivalent for fault injection.

---

## 6. State Machine Delta

### New state machine: `VerificationClaim` lifecycle

```
OPEN
  → EVIDENCE_GATHERING   [trigger: ExecutionPlan POLICY_APPROVED]
  → EXPIRED              [trigger: deadline exceeded, no quorum]

EVIDENCE_GATHERING
  → QUORUM_SATISFIED     [trigger: EvidenceQuorum.quorum_status = SATISFIED]
  → FAILED               [trigger: EvidenceQuorum.quorum_status = CONTRADICTED]
  → EXPIRED              [trigger: deadline exceeded]

QUORUM_SATISFIED
  → CERTIFIED            [trigger: VerificationFinding.verdict = CERTIFIED, Raft committed]
  → FAILED               [trigger: VerificationFinding.verdict = FAILED]
  → INDETERMINATE        [trigger: VerificationFinding.verdict = INDETERMINATE]
```

**Constraint**: The transition `QUORUM_SATISFIED → CERTIFIED` requires a Raft-committed `VerificationFinding`. No other trigger is valid. This maps to existing state model: speculative → committed → authoritative.

### New state machine: `ExecutionPlan` lifecycle

```
SPECULATIVE
  → POLICY_APPROVED    [trigger: VerificationPolicy approval, deterministic]
  → CANCELLED          [trigger: claim expired or cancelled]

POLICY_APPROVED
  → EXECUTING          [trigger: first VerificationRun dispatched]
  → CANCELLED          [trigger: claim cancelled]

EXECUTING
  → COMPLETED          [trigger: all VerificationRuns terminated]
  → CANCELLED          [trigger: manual cancellation, resource exhaustion]

COMPLETED    [terminal]
CANCELLED    [terminal]
```

---

## 7. Trait Delta

The following new traits are required in `VARDHAN_OBJECT_TRAITS`:

### `VerificationEvidenceProducer`
```
fn produce_evidence(run: &VerificationRun, outcome: RawOutcome) -> EvidenceObject
fn seal_evidence(evidence: &EvidenceObject) -> SignedEvidenceRecord
fn commit_evidence(record: &SignedEvidenceRecord, store: &dyn EvidenceStore) -> EvidenceId
```
**Implementation constraint**: `produce_evidence` must be deterministic with respect to the same `RunId` and `RawOutcome`. No timestamps, wall-clock jitter, or probabilistic sampling in the output.

### `VerificationPolicyEngine`
```
fn approve_plan(plan: &ExecutionPlan) -> PolicyDecision
fn certify_quorum(quorum: &EvidenceQuorum, policy: &EvidencePolicy) -> VerificationFinding
```
**Implementation constraint**: Purely deterministic. No model inference allowed inside this trait.

### `ClaimRegistry`
```
fn register_claim(claim: VerificationClaim) -> ClaimId
fn get_claim(id: ClaimId) -> Option<VerificationClaim>
fn update_claim_status(id: ClaimId, status: ClaimStatus) -> Result<()>
```

### `ReplayEngine`
```
fn build_capsule(run: &VerificationRun) -> ReplayCapsule
fn execute_replay(capsule: &ReplayCapsule) -> EvidenceObject
fn compare(original: &EvidenceObject, replay: &EvidenceObject) -> ReplayComparison
```

---

## 8. Test Contract Delta

The existing test contracts (`T-CHAIN-*`, `T-STATE-*`, `T-TENANT-*`, `T-TIME-*`, `T-EVID-*`) do not cover the verification fabric itself. New contracts required:

### `T-PM-CERT-001`: Claim certification requires committed finding
> A `VerificationClaim` MUST NOT reach status `CERTIFIED` unless a `VerificationFinding` with `verdict=CERTIFIED` exists in the committed Raft evidence chain at a `commit_index` ≥ when the claim transitioned.

### `T-PM-CERT-002`: INDETERMINATE blocks certification
> A `VerificationFinding` with `verdict=INDETERMINATE` MUST NOT transition a `VerificationClaim` to `CERTIFIED`. `INDETERMINATE` is not `PASS`.

### `T-PM-EVID-001`: Evidence diversity enforcement
> A `VerificationClaim` of type `SECURITY` MUST have at least two distinct `evidence_type` values in its satisfying quorum. Unit-test-only quorums are structurally rejected by `EvidencePolicy`.

### `T-PM-EVID-002`: Evidence chain integrity
> Every `EvidenceObject.evidence_record_ref` MUST resolve to a valid, Raft-committed `EvidenceRecord`. Orphaned evidence objects MUST be rejected at quorum evaluation.

### `T-PM-REPLAY-001`: Deterministic replay contract
> A `ReplayCapsule` executed against the same `state_snapshot_ref`, `test_spec`, and `random_seed` MUST produce the same verdict. Any deviation is classified as `PRODUCT_FAILURE`, not `FLAKY`.

### `T-PM-FI-001`: Systemic fault injection requires authorization
> A `FaultScenario` with `execution_mode=SYSTEMIC` without a valid `FaultInjectionAuthorization` MUST be rejected before any test dispatch. This is compile-time enforced via type state where possible.

### `T-PM-AI-001`: Scheduler output is speculative
> An `ExecutionPlan` in `SPECULATIVE` status MUST NOT trigger any `VerificationRun` dispatch. The scheduler heuristic output must pass `VerificationPolicyEngine.approve_plan()` first.

### `T-PM-REPORT-001`: Report is not evidence
> A human-readable report file (Markdown, JSON, HTML) MUST NOT be used as the basis for `VerificationClaim` certification. Only a committed `VerificationFinding` with Raft backing is authoritative. [INVARIANT-PM-001]

---

## 9. AI Intelligence Integration Delta

The frozen `VARDHAN_AI_INTELLIGENCE_DESIGN` defines the Intelligence Plane for business decisions. ProofMesh adds a second intelligence sub-plane scoped to verification:

| Concept | Business Intelligence (existing) | Verification Intelligence (new) |
|---------|----------------------------------|----------------------------------|
| Speculative output | `DecisionCandidate` | `ExecutionPlan` (SPECULATIVE) |
| Assurance chain | G0-G4 | `VerificationPolicyEngine.approve_plan()` |
| Authority gate | `VardhanAuthorityGate` (A7) | `VerificationPolicyEngine.certify_quorum()` |
| Outcome record | `DecisionTwin` EXECUTED | `VerificationFinding` CERTIFIED |
| Revalidation trigger | Config staleness, state change | New vulnerability disclosure, spec change |

**Critical constraint (inherited from CONST-1)**: The verification intelligence components (adaptive scheduler, fault scenario selector, anomaly detector) MUST NOT directly certify any `VerificationClaim`. Their output is always `SPECULATIVE`. Certification is deterministic.

---

## 10. Authority / Trust Boundary Delta

The frozen Constitution defines boundaries: Data → Intelligence → Control → Reality (via A7).

ProofMesh adds one new boundary:

```
Verification Fabric
       │
       ↓ (evidence commitment)
Control Plane (Raft EvidenceStore)
```

ProofMesh does NOT create a new path from Verification Fabric to Reality. Systemic fault injection routes through A7 via `FaultInjectionAuthorization`. Isolated fault injection stays within ephemeral test state.

**New boundary rule**: The `VerificationPolicyEngine` is a Control Plane component. Its deterministic outputs (`VerificationFinding`) are committed through Raft. Its inputs (from VAS/VEQ) are Control Plane inputs, not Intelligence Plane crossings.

---

## 11. Evidence Integrity Model

The frozen specs define two Merkle trees: Decision Evidence and Outcome Evidence.

ProofMesh requires a third: **Verification Evidence**.

| Tree | Contents | Committed by |
|------|----------|-------------|
| Decision Evidence | G0-G4 results, policy evaluations, authorizations | Authority Gate |
| Outcome Evidence | Execution results, observations, predictions vs actuals | OutcomeCollector |
| Verification Evidence (NEW) | EvidenceObjects, VerificationFindings, EvidenceQuorums | VerificationPolicyEngine |

**Proposed**: The Verification Evidence tree is a sub-tree of the existing Raft evidence chain, namespaced by `evidence_category = VERIFICATION`. This avoids structural changes to the Merkle tree topology while introducing logical separation.

---

## 12. Failure Classification Model

Inherited directly from Phase 0.2 experience and ProofMesh design docs. Formalized as a canonical enum:

```
enum VerificationFailureClass {
    PRODUCT_FAILURE,        // Test reveals a real defect in production code
    TEST_FAILURE,           // Test itself has a defect (wrong assertion, wrong setup)
    RESOURCE_STARVATION,    // Test logic is correct but timed out under load
    RESOURCE_COLLISION,     // Port conflict, file lock, shared state contamination
    INFRASTRUCTURE_FAILURE, // OS, network, disk below test, outside system under test
    FLAKY,                  // Non-deterministic without identified root cause
    INDETERMINATE,          // Cannot classify with available evidence
}
```

**Rule**: `FLAKY` is NOT a valid final classification for a `VerificationFinding`. A finding must be one of `CERTIFIED`, `FAILED`, or `INDETERMINATE`. The failure class is internal metadata for the evidence investigation path.

**Rule**: AI/ML components MAY propose a `VerificationFailureClass`. This proposal is `SPECULATIVE`. The deterministic `VerificationPolicyEngine` assigns the final classification.

---

## 13. Replay Model

**Invariant**: Every `VerificationRun` MUST produce enough information to construct a `ReplayCapsule`. Missing replay data is a `TEST_FAILURE`.

**Replay chain**: 
1. Original run produces `EvidenceObject` A.
2. Replay using `ReplayCapsule` produces `EvidenceObject` B.
3. If A.verdict ≠ B.verdict, this is a `PRODUCT_FAILURE` or `TEST_FAILURE` depending on whether the state snapshot differs.
4. If A.verdict = B.verdict = FAIL, the failure is confirmed and classified by the policy engine.
5. If A.verdict = FAIL, B.verdict = PASS with identical capsule, this is classified `INDETERMINATE` (not `FLAKY`) until root cause is identified.

---

## 14. Resource / Scheduling Invariants

VAS / `VerificationScheduler` must satisfy:

- **INV-PM-RES-001**: No `ExecutionPlan` may dispatch more `VerificationRun` instances than permitted by the `ResourceBudget`. Resource exhaustion results in `CANCELLED` plan, not silent skip.
- **INV-PM-RES-002**: Serialization (`--test-threads=1`) is the exception, not the default. ProofMesh's purpose is to eliminate serial fallback as the sole correctness strategy.
- **INV-PM-RES-003**: Any `VerificationRun` that modifies shared filesystem or network state MUST be scheduled with exclusive access declared in its `TestSpec`. Undeclared shared state access is a `TEST_FAILURE`.
- **INV-PM-RES-004**: Wall-clock sleeps as synchronization mechanisms in test code are `TEST_FAILURE`. Bounded deterministic polling (as implemented in C22 fix) is the required pattern.

---

## 15. Security Invariants

- **INV-PM-SEC-001**: ProofMesh evidence for `SECURITY` claims requires at minimum one `ADVERSARIAL` evidence type in the quorum. Pure unit/integration evidence is insufficient for security claim certification.
- **INV-PM-SEC-002**: A `VerificationClaim` about a cryptographic property must include evidence produced by the actual crypto implementation path, not a mock. Evidence type must be `TCP_REAL` or `PQ_HANDSHAKE` where applicable.
- **INV-PM-SEC-003**: The `VerificationPolicyEngine` must verify `config_hash` freshness on every `VerificationFinding`. A finding produced against a stale config is automatically `INDETERMINATE`.
- **INV-PM-SEC-004**: `FaultInjectionAuthorization` expires on wall-clock time AND on config hash change, whichever comes first.

---

## 16. Migration Impact

The existing test suites (`raft_l3_*`, `raft_p8_*`, `raft_p9_*`, etc.) are currently raw `cargo test` executions. Under ProofMesh:

1. Each existing test maps to one or more `VerificationRun` instances.
2. Each existing test file corresponds to one or more `VerificationClaim` objects.
3. The existing `PHASE_0_2_EXIT_REPORT.md` exit code is the seed for the first `VerificationFinding` in the Verification Evidence tree.

**Migration rule**: No existing test is deleted during migration. Tests are wrapped in `VerificationRun` descriptors. The raw cargo output becomes the `RawOutcome` input to `VerificationEvidenceProducer.produce_evidence()`.

---

## 17. Backward Compatibility

- The existing `EvidenceRecord` schema is unchanged. ProofMesh adds a new `evidence_category` field (nullable, defaults to `BUSINESS`). Existing records remain valid.
- The existing `EvidenceStore` trait is unchanged. `VerificationEvidenceProducer` calls the same trait.
- The existing G0-G4 assurance chain is unchanged. ProofMesh's `VerificationPolicyEngine` is a parallel, independent deterministic authority for the verification domain.
- The existing `VardhanAuthorityGate` (A7) is unchanged. `SYSTEMIC` fault injection routes through it.

---

## 18. Unresolved Questions

The following questions must be answered before contracts are frozen:

1. **Q1 — A7 scope**: Does ProofMesh `VerificationPolicyEngine.certify_quorum()` require an A7 gate authorization, or is it a parallel deterministic authority? The Constitution implies A7 is universal, but it was designed for business execution, not verification certification.

2. **Q2 — Verification Evidence tree**: Is the Verification Evidence Merkle tree a sub-tree of the existing Raft evidence chain, or a completely separate Raft log? A sub-tree is simpler but may complicate the existing checkpoint model.

3. **Q3 — Tenant scoping of claims**: Are `VerificationClaim` objects scoped to a `TenantId`? Security claims about shared infrastructure (e.g., Raft consensus, PQ handshake) are cross-tenant by nature.

4. **Q4 — `INDETERMINATE` handling**: The frozen spec says `INDETERMINATE` is NOT `PASS` for business assurance. The ProofMesh failure model also uses `INDETERMINATE`. Should they share the same type or be distinct?

5. **Q5 — Scheduler provenance**: The `ExecutionPlan.generated_by` references a `SchedulerProvenance`. Is this sufficient for reproducibility, or does it require a full `ModelProvenance` record as defined in the AI Intelligence spec?

6. **Q6 — Replay across versions**: If the `VerificationRun` binary version changes between original and replay, is the `ReplayCapsule` still valid? Current model says no (environment_hash differs). This must be explicitly documented.

---

## 19. Proposed Specification Freeze Set

The following specifications must be updated and re-frozen before any ProofMesh implementation begins:

| Specification | Change Type | New Sections |
|---------------|-------------|--------------|
| `VARDHAN_CANONICAL_OBJECT_SPEC` | Addition | 9 new objects (§5) |
| `VARDHAN_STATE_MACHINES` | Addition | 2 new state machines (§6) |
| `VARDHAN_OBJECT_TRAITS` | Addition | 4 new traits (§7) |
| `VARDHAN_TEST_CONTRACTS` | Addition | 8 new contracts T-PM-* (§8) |
| `VARDHAN_AI_INTELLIGENCE_DESIGN` | Extension | Verification intelligence sub-plane (§9) |
| `VARDHAN_ARCHITECTURE_CONSTITUTION` | Extension | Verification Plane boundary rule, INVARIANT-PM-001 (§10, §11) |
| `VARDHAN_SYSTEM_MAP` | Extension | ProofMesh component placement diagram (§3) |

**Unchanged** (no modifications required): None of the above specs are modified in this document. They are changed only after explicit authorization per the review process.

---

## 20. Implementation Prerequisites

Before any ProofMesh implementation code is written:

1. **Resolve** all 6 unresolved questions in §18.
2. **Freeze** the 9 new canonical objects in `VARDHAN_CANONICAL_OBJECT_SPEC`.
3. **Freeze** the 2 new state machines in `VARDHAN_STATE_MACHINES`.
4. **Freeze** the 4 new traits in `VARDHAN_OBJECT_TRAITS`.
5. **Freeze** the 8 new test contracts in `VARDHAN_TEST_CONTRACTS`.
6. **Freeze** INVARIANT-PM-001 (Rule 0.1) in `VARDHAN_ARCHITECTURE_CONSTITUTION`.
7. **Write** the first `VerificationClaim` objects for the existing Vardhan security claims (SEC-003, SEC-010, SEC-018) using the new canonical format.
8. **Confirm** that the existing `raft_l3_2_checkpoints` and `raft_p9_tcp_byzantine` tests map cleanly to `VerificationRun` instances under the new model.
9. **Confirm** the Phase 0.2 verified evidence (EXIT_CODE=0, target SHA `4711305`) can be expressed as a `VerificationFinding` seeding the first committed `EvidenceQuorum`.

Only after all 9 prerequisites are closed may implementation of VAS, VEP, VRE, VFI, VEQ, and the `VerificationGraph` begin.

---

*This document is a delta analysis only. No frozen specification has been modified.*  
*ProofMesh Phase 5 — Reconciliation Pass 1*  
*Analysis baseline: 2026-09-24*
