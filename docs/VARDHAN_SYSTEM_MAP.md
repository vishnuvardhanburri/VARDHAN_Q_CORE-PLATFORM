# Vardhan System Map

> **Purpose**: Executable architectural blueprint derived from the Vardhan Architecture Constitution. Answers: "How does information actually move through Vardhan?"
>
> **Status**: ✅ Derived from Constitution v1.1 (A1–A9 amendments applied)
> **Prerequisites**: Read `VARDHAN_ARCHITECTURE_CONSTITUTION.md`

---

## Table of Contents

1. [Global Architecture](#01-global-architecture)
2. [Five Fabrics](#02-five-fabrics)
3. [Three Planes](#03-three-planes)
4. [Twelve Layers](#04-twelve-layers)
5. [External Inputs](#05-external-inputs)
6. [Ingestion Pipeline](#06-ingestion-pipeline)
7. [Evidence Pipeline](#07-evidence-pipeline)
8. [Enterprise State Pipeline](#08-enterprise-state-pipeline) — **Amendment A1**: Authoritative vs Speculative State visibility
9. [Graph / Reasoning Pipeline](#09-graph--reasoning-pipeline)
10. [Intelligence Pipeline](#10-intelligence-pipeline)
11. [G0–G4 Assurance Pipeline](#11-g0g4-assurance-pipeline) — **Amendment A4**: Config hash binding; **Amendment A6**: Candidate boundary
12. [Risk / Scenario Pipeline](#12-risk--scenario-pipeline)
13. [Decision Twin Lifecycle](#13-decision-twin-lifecycle) — **Amendment A8**: REVALIDATION_REQUIRED
14. [Policy / Authorization Pipeline](#14-policy--authorization-pipeline)
15. [Execution Pipeline](#15-execution-pipeline) — **Amendment A7**: Universal Authority Gate
16. [Outcome Pipeline](#16-outcome-pipeline)
17. [Decision Memory Pipeline](#17-decision-memory-pipeline) — **Amendment A5**: Decision vs Outcome evidence
18. [Cryptographic Security Twin](#18-cryptographic-security-twin)
19. [Tenant Isolation](#19-tenant-isolation) — **Amendment A2**: Tenant-scoped semantic state
20. [Control-Flow Boundaries](#20-control-flow-boundaries) — **Amendment A7**: Universal execution gate
21. [Trust Boundaries](#21-trust-boundaries)
22. [Failure Paths](#22-failure-paths) — **Amendment A9**: Fault-domain isolation
23. [Data Ownership](#23-data-ownership)
24. [Canonical References](#24-canonical-references)
25. [Event Flow](#25-event-flow)
26. [State Flow](#26-state-flow)
27. [Decision Flow](#27-decision-flow)
28. [Evidence Flow](#28-evidence-flow)
29. [Dependency Graph](#29-dependency-graph)
30. [Runtime Deployment Map](#30-runtime-deployment-map)
31. [Time Model](#31-time-model) — **Amendment A3**: Logical / Event / System / Deadline time

---

## 01. Global Architecture

```text
                           VARDHAN QUANTUM
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
     TRUST FABRIC           REALITY FABRIC         INTELLIGENCE
          │                       │                       │
      PQC / ID                INGESTION              MODELS
      AEAD                    EVENTS                 REASONING
      RAFT                    STATE                  RISK
      HA                      GRAPH                  SCENARIO
          │                       │                       │
          └───────────────────────┼───────────────────────┘
                                  ▼
                           VERIFIED STATE
                                  │
                                  ▼
                          DECISION TWIN
                                  │
                                  ▼
                       AI ASSURANCE G0–G4
                                  │
                                  ▼
                         POLICY / AUTHORITY
                                  │
                                  ▼
                        GOVERNED EXECUTION
                                  │
                                  ▼
                           REAL WORLD
                                  │
                                  ▼
                         OUTCOME OBSERVATION
                                  │
                                  ▼
                         OUTCOME VERIFICATION
                                  │
                                  ▼
                          DECISION MEMORY
                                  │
                                  ▼
                              EVIDENCE
                                  │
                                  └────────────→ VERIFIED STATE
```

**Key crossing points**:
- Reality Fabric → Trust Fabric: ingestion boundary (G0 validation)
- Trust Fabric → Verified State: consensus commit
- Verified State → Intelligence: read-only state queries
- Intelligence → Decision Twin: candidate generation
- Decision Twin → Policy: authorization gate
- Policy → Execution: authorized action only
- Execution → Reality: external system call
- Reality → Outcome: observation ingestion

---

## 02. Five Fabrics

| Fabric | Layers | Responsibility |
|---|---|---|
| **Trust Fabric** | L01, L02 | PQC identity, AEAD transport, Raft consensus, HA |
| **Evidence Fabric** | L03 | Provenance, Merkle, ledger, attestation, checkpoint |
| **Enterprise Intelligence Fabric** | L04–L08 | State, graph, reasoning, AI, risk, scenario |
| **Decision & Execution Fabric** | L09–L11 | Decision twin, policy, authorization, actions, outcomes |
| **Memory Fabric** | L12 | Outcome verification, decision history, evidence archive |

---

## 03. Three Planes

```text
DATA PLANE:                Controls:    INTELLIGENCE PLANE:
  Enterprise State           Tenant ID,     Predictive Models
  Observation Events         Policy,       Reasoning Engine
  External Feeds             Authorization,Scenario Engine
  Documents                Consensus          Risk Models
                           Execution Control Optimization
```

**Crossing rules**:
- Data Plane → Control Plane: every event must carry tenant_id and source identity
- Data Plane → Intelligence Plane: state is read-only; intelligence cannot mutate state directly
- Intelligence → Control Plane: candidates only; never direct execution
- Control Plane → Execution: only authorized actions with evidence_ref

---

## 04. Twelve Layers (Bottom-Up)

| Layer | Name | Crate(s) | Role |
|---|---|---|---|
| L01 | Post-Quantum Trust Foundation | `core_crypto`, `proxy_engine` | Identity, PQC, secure transport |
| L02 | Distributed Trust | `ha_cluster` | Raft, HA, replication, cluster state |
| L03 | Evidence Fabric | `audit_ledger` | Ledger, Merkle, attestation, checkpoints |
| L04 | Enterprise State | `vardhan_model` | Canonical object model, event state, graph |
| L05 | Intelligence | _tbd_ | Models, features, predictive/semantic |
| L06 | AI Assurance | _tbd_ | G0–G4 gates, AssuranceResult |
| L07 | Reasoning | _tbd_ | State graph, knowledge graph, E-Graph |
| L08 | Risk & Scenario | _tbd_ | Risk engine, simulation, optimization |
| L09 | Decision Intelligence | _tbd_ | Decision twin, decision engine |
| L10 | Outcome & Memory | _tbd_ | Outcome verification, decision memory |
| L11 | Governed Execution | _tbd_ | Policy gate, authorization, actions |
| L12 | Experience & Command | `frontend`, `vardhan_api` | Executive/SOC/Auditor/Developer views |

**Note**: `vardhan_model` (L04) is already implemented (38/38 tests). It is the **constitutional baseline** for the Canonical Object Model. Future development must conform to it, not replace it.

---

## 05. External Inputs

```text
┌─────────────────────────────────────────────────────┐
│                  EXTERNAL SOURCES                   │
├────────────┬────────────┬──────────┬──────────────┤
│ Enterprise │  Third-     │  Human    │   Public     │
│ Systems    │  Party APIs│  Actors   │  Feeds       │
│ (DB, ERP,  │  (Vendor,   │  (Exec,   │  (News,     │
│  SaaS)     │  Partner)   │  Analyst, │  Market,    │
│            │             │  Operator)│  Threat)    │
└──────┬─────┴──────┬─────┴─────┬────┴──────┬───────┘
       │            │           │           │
       ▼            ▼           ▼           ▼
     INGESTION   INGESTION   HUMAN     INGESTION
     ADAPTERS    ADAPTERS    API       ADAPTERS
       │            │           │           │
       └────────────┼───────────┼───────────┘
                    ▼           │
               INGESTION        │
              GATEWAY           │
                    │           │
                    ▼           ▼
               ┌───────────┐
               │  G0       │  ← Input Integrity Gate
               │  VALIDATE │
               └───────────┘
                    │
                    ▼
               EVIDENCE CAPTURE LAYER
```

---

## 06. Ingestion Pipeline

```text
Step 1: Adapter Normalization
  Each source type → canonical ingestion adapter
  Raw input → SourceEvent (JSON envelope with source, schema_version, payload)

Step 2: G0 Input Integrity
  - Schema validation (JSON Schema per source schema_version)
  - Provenance verification (source signature check)
  - Malformed input rejection
  - Prompt injection detection (for LLM-sourced data)
  - OOD (out-of-distribution) detection
  - Ambiguity resolution (query clarification)

Step 3: Evidence Preparation
  - Canonicalize event to VardhanEvent
  - Hash payload (BLAKE3)
  - Create EvidenceRecord with predecessor chain
  - Sign evidence (ML-DSA-87 from ingestion node identity)
  - Write to audit_ledger

Step 4: State Delta Creation
  - Parse event payload → EnterpriseStateDelta
  - Validate against Canonical Object Model (vardhan_model)
  - Assign tentative delta_id
  - Set status = PROPOSED

Step 5: Raft Replication
  - Submit StateTransitionRecord to RaftNode
  - Raft replicates across cluster (L02)
  - Returns when majority ack

Step 6: Commit → Apply → Evidence Finalized
  - Raft commit_index assigned
  - State machine applies delta (status → APPLIED)
  - Evidence finalized with commit_index
  - Status → EVIDENCED
  - Visible as authoritative state
```

**Critical constraint**: Steps 1–3 happen at the ingestion boundary. Steps 4–6 happen inside the trust fabric. Intelligence plane can only observe state at step 6 (status = EVIDENCED).

---

## 07. Evidence Pipeline

```text
                    ┌──────────────────┐
  Event ──────────→ │ Evidence Capture │ ← Source signature
                    │  + A3 timestamps  │  (event_time, system_time, deadline_time)
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ Canonicalization │ ← Schema + G0
                    │  + A4 config_hash│
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ BLAKE3 Hash      │ ← payload_digest
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ Predecessor Link │ ← previous_state_hash
                    │  + A5 category    │  (DECISION | OUTCOME)
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ ML-DSA-87 Sign   │ ← node identity
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ Write to Ledger  │ ← audit_ledger
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ Merkle Commit    │ ← checkpoint
                    │  (separate trees │   for A5 categories)
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ Raft Commit      │ ← consensus_commit_index (Logical Time, A3)
                    │  (logical_time   │   assigned here, not at creation)
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ Evidence Finalized│ ← state_hash linked (A1)
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ VARDHAN COMMITTED │ ← authoritative internal state (A1)
                    │       STATE       │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ AUTHORITY GATE   │ ← A7: authorization check
                    │  (A7)             │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ EXECUTION        │ ← external system mutation
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ OBSERVED EXTERNAL │ ← outcome evidence confirms
                    │       STATE       │   external world changed (A1)
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ Available for    │
                    │ Verification     │
                    └──────────────────┘
```

---

## 08. Enterprise State Pipeline

```text
VardhanEvent (EVIDENCED)
         │
         ▼
State Delta (PROPOSED)         ← SPECULATIVE (not visible to upper layers)
         │
         ▼
┌─────────────────────┐
│  Canonical Model    │ ← vardhan_model validation
│  (vardhan_model)    │
└─────────┬───────────┘
          │
          ▼
State Delta (VALIDATED)        ← SPECULATIVE
          │
          ▼
┌─────────────────────┐
│    Apply to Graph   │ ← enterprise graph mutation
│  (Datalog / E-Graph)│
└─────────┬───────────┘
          │
          ▼
State Delta (APPLIED)          ← SPECULATIVE (evidence not yet finalized)
          │
          ▼
New State Hash
          │
          ▼
┌─────────────────────┐
│ Update commit_index │ ← Raft consensus
└─────────┬───────────┘
          │
          ▼
State Delta (EVIDENCED)        ← Evidence finalized, linked to commit_index
          │
          ▼
┌─────────────────────────────┐
│    Vardhan Committed State  │ ← authoritative internal state (A1)
│    (not yet external)       │
└─────────┬───────────────────┘
          │
          ▼
┌─────────────────────────────┐
│    Authority Gate (A7)      │ ← authorization check
└─────────┬───────────────────┘
          │
          ▼
┌─────────────────────────────┐
│    Execution                │ ← external system mutation
└─────────┬───────────────────┘
          │
          ▼
┌─────────────────────────────┐
│    Observed External State  │ ← confirmed by outcome observation (A1)
└─────────┬───────────────────┘
          │
          ▼
Authoritative State

**Amendment A1 — Authoritative vs. Speculative State**:

- **SPECULATIVE** states (`PROPOSED`, `VALIDATED`, `APPLIED`): Not visible to Intelligence Plane, Decision Twin, Risk Engine, or any upper-layer query/API. Only `EVIDENCED` state is addressable above the State Store.
- **VARDHAN_COMMITTED_STATE** (Raft committed + evidence finalized + applied): Authoritative **to Vardhan**. This is the internal truth of the state machine.
- **OBSERVED_EXTERNAL_STATE** (post-execution confirmation): Authoritative **externally**. Only established after execution succeeded AND outcome evidence confirms the external world changed.

**Rule**: A Raft commit proves Vardhan committed an authoritative command. It does **not** prove the external world changed. `OBSERVED_EXTERNAL_STATE` requires separate outcome evidence (A5).

---

## 09. Graph / Reasoning Pipeline

```text
Enterprise State (EVIDENCED)
         │
         ▼
┌─────────────────────┐
│  Knowledge Graph    │ ← entities, relationships
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Rule Engine         │ ← Datalog rules
│ (Datalog)           │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ E-Graph             │ ← equality saturation
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Constraint Graph    │ ← from policy + risk
└─────────┬───────────┘
          │
          ▼
   Derived Facts
          │
          ▼
┌─────────────────────┐
│ Risk Factors        │
└─────────┬───────────┘
          │
          ▼
Risk Distribution
```

---

## 10. Intelligence Pipeline

```text
Derived Facts + Risk
         │
         ▼
┌─────────────────────┐
│ Predictive Models   │ ← forecasting, anomaly
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Feature Engineering │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Semantic Compilation│ ← probabilistic + deterministic
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ LLM/SLM Reasoning   │ ← probabilistic
│ (optional, replaceable)
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Optimization        │ ← scenario optimization
└─────────┬───────────┘
          │
          ▼
Candidate Decision (SPECULATIVE, A6)
   │  ← Cannot mutate state, issue actions, or self-authorize (A6)
   │  ← References: state_hash (EVIDENCED only), config_hash (A4), tenant_id (A2)
```

**All output is `DecisionCandidate` (SPECULATIVE)** — nothing is authoritative until it passes through AI Assurance (G0–G4) + Policy + Authorization. See Amendment A6 for the canonical candidate boundary.

---

## 11. G0–G4 Assurance Pipeline

```text
DecisionCandidate (SPECULATIVE)
         │  ← Must reference: state_hash, config_hash, evidence_window
         │  ← Tenant-scoped (A2), config-version-checked (A4)
         │  ← Cannot mutate state, issue actions, or self-authorize (A6)
         ▼
┌─────────────────────┐
│ G0: Input Integrity │ ← schema, provenance, OOD, config_version check
└─────────┬───────────┘
          │ PASS
          ▼
┌─────────────────────┐
│ G1: Semantic Agree. │ ← SMT: prove(A ↔ B)
└─────────┬───────────┘
          │ PASS
          ▼
┌─────────────────────┐
│ G2: Perturbation    │ ← stability analysis
│    Robustness        │
└─────────┬───────────┘
          │ PASS
          ▼
┌─────────────────────┐
│ G3: Utility / Non-  │ ← quality + utility + coverage
│    Degeneracy       │
└─────────┬───────────┘
          │ PASS
          ▼
┌─────────────────────┐
│ G4: Formal Policy   │ ← SMT solver, proof artifact
│    Verification      │
│    ← config_hash referenced │
└─────────┬───────────┘
          │
          ▼
AssuranceResult
  ├── final_status: PASS | FAIL | REJECT | INDETERMINATE | TIMEOUT
  ├── g4_result: PolicyEvaluation (with proof_reference, config_hash)
  ├── g0_result: InputIntegrityResult (with config_version)
  └── evidence_refs
```

**Amendment A4 — Config binding**: G0 checks that the candidate's `config_hash` matches the current effective `ConfigurationState`. G4's `PolicyEvaluation` records `config_hash`. If the configuration has changed since the candidate was generated, G0 rejects with `REJECT`.

**Amendment A6 — Canonical candidate boundary**: A `DecisionCandidate` may never directly mutate `EnterpriseState`, issue an `Action`, authorize itself, or write to the evidence ledger. It is visible to external APIs only as a "candidate" — never as a "decision" — until it passes through G0–G4 + policy + authorization.

**Statuses**:
| Status | Meaning | Downstream Action |
|---|---|---|
| PASS | All gates passed | → Decision Twin selection |
| FAIL | Gate failed | → Decision Twin rejected |
| REJECT | Deliberate rejection | → Decision Twin rejected, evidence recorded |
| INDETERMINATE | Cannot determine | → Conservative fallback (policy-defined) |
| TIMEOUT | Gate exceeded budget | → Conservative fallback (policy-defined) |

**Constitutional rule**: `INDETERMINATE` and `TIMEOUT` are **not** `PASS`. They trigger safe-mode decision policies.

---

## 12. Risk / Scenario Pipeline

```text
Enterprise State
         │
         ▼
┌─────────────────────┐
│ Risk Model          │ ← multi-dimensional risk
│ (financial, cyber,  │   financial/operational/cyber/...
│  supply chain, etc) │
└─────────┬───────────┘
          │
          ▼
Risk Profile
          │
          ▼
┌─────────────────────┐
│ Scenario Engine     │ ← generates stress scenarios
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Simulation          │ ← Monte Carlo / numerical
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Optimization        │ ← trade-off space
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Constraint Graph    │ ← bottlenecks + interventions
└─────────┬───────────┘
          │
          ▼
Candidate Interventions
```

---

## 13. Decision Twin Lifecycle

```text
CREATED
   │
   ▼
CONTEXTUALIZED  ← state_snapshot + evidence_refs attached
   │  ← References: state_hash (EVIDENCED only, A1), config_hash (A4), tenant_id (A2)
   ▼
OPTIONS_GENERATED  ← candidate_actions from reasoning
   │  ← Candidates are SPECULATIVE (A6): cannot mutate state or self-authorize
   ▼
ASSESSED  ← risk / scenario analysis on each option
   │
   ▼
ASSURED  ← G0–G4 pipeline on each option
   │  ← G0 checks config_hash staleness (A4, A6)
   │
   ├── [FAIL/REJECT/INDETERMINATE] → REJECTED
   ├── [timeout] → INDETERMINATE
   │
   ▼
POLICY_CHECKED  ← policy engine evaluates authorization
   │  ← PolicyEvaluation carries config_hash (A4)
   │
   ├── [policy deny] → REJECTED
   │
   ▼
AUTHORIZED  ← human or automated authorization
   │  ← Decision evidence written (A5)
   │
   ├── [requires human] → awaits human approval
   │   ├── [approved] → AUTHORIZED
   │   ├── [denied] → REJECTED
   │   └── [expired] → EXPIRED
   │
   ▼
EXECUTING  → action submitted to execution pipeline
   │
   ▼
EXECUTED  ← action completed (success or failure)
   │  ← Decision evidence finalized (A5)
   │
   ├── [failure] → ABORTED
   │
   ▼
OUTCOME_PENDING  → outcome observation initiated
   │
   ▼
OUTCOME_VERIFIED  ← predicted vs actual comparison
   │
   ▼
MEMORIZED  ← DecisionTwin + outcome stored in Decision Memory
   │  ← Outcome evidence written (A5)
   │
   ▼
REVALIDATION_REQUIRED  ← NEW (A8)
   │  Triggers: config change, contradictory evidence, stale-term,
   │            risk reassessment, external mandate
   │
   ├── [re-validated] → OUTCOME_PENDING
   ├── [expired]      → EXPIRED
   ├── [cancelled]    → CANCELLED
   └── [failed]       → FAILED
```

**Failure transitions**:
- Any stage can transition to `REJECTED`, `CANCELLED`, `ABORTED`, `FAILED`, `EXPIRED`, or `INDETERMINATE`
- All failure transitions produce an `EvidenceRecord` explaining the failure

**Amendment A8 — REVALIDATION_REQUIRED**: When the DecisionTwin's underlying assumptions become stale (configuration change, contradictory evidence, stale-term detection, risk reassessment, external mandate), it enters `REVALIDATION_REQUIRED`. In this state, it cannot initiate new actions and is visible only as "awaiting re-verification."

---

## 14. Policy / Authorization Pipeline

```text
DecisionTwin (PASSED assurance)
         │
         ▼
┌─────────────────────┐
│ Risk Class Lookup   │ ← from risk profile
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Policy Engine       │ ← deterministic policy evaluation
│ (SMT-based)         │
└─────────┬───────────┘
          │
          ▼
PolicyEvaluation
  ├── result: PASS | FAIL | INDETERMINATE | TIMEOUT
  ├── proof_reference
  ├── constraints_evaluated
  └── policy_hash + policy_version
          │
          ▼
┌─────────────────────┐
│ Authority Requirement│ ← risk_class → required_actor
└─────────┬───────────┘
          │
          ├── [requires human] → Human Authorization Gateway
          │
          ▼
AuthorizationEvidence
  ├── authorization_id
  ├── required_actor
  ├── actual_actor
  ├── approval_timestamp
  ├── authorization_signature
  └── policy_evaluation_ref
          │
          ▼
DecisionTwin (AUTHORIZED)
```

**Authorization rules are deterministic**:
```text
decision_risk = HIGH + reversibility = LOW + exposure > threshold → HUMAN_AUTH_REQUIRED
decision_risk = LOW + reversibility = HIGH + exposure < threshold → AUTO_AUTH
decision_risk = HIGH + reversibility = HIGH → HUMAN_AUTH_REQUIRED
```

No `if requires_human { ask_human(); }` — only policy-driven resolution.

---

## 15. Execution Pipeline

```text
DecisionTwin (AUTHORIZED)
         │
         ▼
┌─────────────────────┐
│ Action Planning     │ ← convert to executable action plan
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ VARDHAN AUTHORITY   │ ← Universal Authority Gate (A7)
│       GATE          │   Validates:
│                     │   1. authorization_id matches
│                     │   2. traces to completed DecisionTwin
│                     │   3. AssuranceResult.final_status = PASS
│                     │   4. PolicyEvaluation.result = PASS
│                     │   5. config_hash matches current
│                     │   6. tenant_id matches context
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Action Executor     │ ← external system call
│ (transactional)     │
└─────────┬───────────┘
          │
          ├── [success] → EXECUTED
          ├── [failure] → ABORT → compensation
          └── [timeout] → INDETERMINATE → policy fallback
          │
          ▼
ActionId recorded in
DecisionTwin.execution
```

---

## 16. Outcome Pipeline

```text
Real World (after action)
         │
         ▼
┌─────────────────────┐
│ Outcome Observer    │ ← sensors, API polls, event feed
└─────────┬───────────┘
          │
          ▼
OutcomeEvent (VardhanEvent)
         │
         ▼
┌─────────────────────┐
│ Outcome Verification │ ← compare predicted vs actual
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Prediction Error    │ ← |predicted - actual|
└─────────┬───────────┘
          │
          ▼
OutcomeResult
  ├── outcome_id
  ├── decision_id
  ├── predicted_value
  ├── actual_value
  ├── prediction_error
  ├── evidence_ref
  └── verified_at
```

---

## 17. Decision Memory Pipeline

```text
DecisionTwin (MEMORIZED + OutcomeResult)
         │
         ▼
┌─────────────────────┐
│ Decision Memory     │ ← structured archive
│ Store               │
└─────────┬───────────┘
          │
          ▼
MemoryRecord
  ├── decision_id
  ├── tenant_id
  ├── context
  ├── state_snapshot
  ├── evidence_refs
  │     ├── decision_evidence_refs   ← A5: from decision pipeline
  │     └── outcome_evidence_refs    ← A5: from outcome pipeline
  ├── assurance_result
  ├── policy_evaluation
  ├── authorization_evidence
  ├── action_plan
  ├── outcome_result
  ├── prediction_error
  └── full_provenance
          │
          ▼
┌─────────────────────┐
│ Queryable Archive   │ ← available for:
│                     │   replay, learning,
│                     │   audit, compliance
└─────────┬───────────┘
          │
          ▼
Learning Signal
  → Models (L05)
  → Risk Models (L08)
  → Policy tuning (L11)
```

**Amendment A5 — Decision evidence vs. outcome evidence**: MemoryRecord separates `decision_evidence_refs` (from the decision pipeline: DecisionTwin creation, G0–G4, policy, authorization, execution initiation) from `outcome_evidence_refs` (from the outcome pipeline: execution result, observation, prediction vs. actual). These are written to separate Merkle trees in the ledger for independent verification.

---

## 18. Cryptographic Security Twin

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

**PQC Migration Flow**:

```text
Asset
 ↓
Cryptographic Dependency (mapped from service inventory)
 ↓
Migration Status (pre-migration → migrating → post-migration)
 ↓
Business Impact (from enterprise graph: process → system → cert)
 ↓
Priority (high impact + high exposure → immediate)
 ↓
Migration Decision (DecisionTwin)
 ↓
Verified Outcome (certificate rotated, traffic migrated)
```

**Crypto Security Twin Model**:
```rust
struct CryptoSecurityTwin {
    asset_id: EntityId,
    dependency_id: DependencyId,
    protocol: String,        // e.g., "TLS 1.3 + X25519 + ML-KEM-1024"
    algorithm: String,       // e.g., "ML-DSA-87"
    pqc_exposure: ExposureLevel,  // NONE | PARTIAL | FULL
    migration_status: MigrationStatus,
    business_impact: RiskLevel,
    priority: Priority,
}
```

---

## 19. Tenant Isolation

**Isolation applies to all of**:
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

### Isolation Architecture

```text
┌─────────────────────────────────────────┐
│            VARDHAN CONTROL PLANE         │
│  (cluster management, key management,   │
│   policy distribution)                  │
└───────────┬───────────────────┬──────────┘
            ▼                   ▼
     Tenant A               Tenant B
┌───────────────────┐  ┌───────────────────┐
│ State DB          │  │ State DB          │
│ Evidence Store    │  │ Evidence Store    │
│ Model Store       │  │ Model Store       │
│ Decision Memory   │  │ Decision Memory   │
│ Policy Store      │  │ Policy Store      │
│ Encryption Context│  │ Encryption Context│
└────────┬──────────┘  └────────┬──────────┘
         │                      │
         ▼                      ▼
┌───────────────────┐  ┌───────────────────┐
│ Tenant-scoped     │  │ Tenant-scoped     │
│ Execution         │  │ Execution         │
│ (isolated runtime)│  │ (isolated runtime)│
└───────────────────┘  └───────────────────┘
```

**Rule**: `TenantId` is present on every `EvidenceRecord`, `StateTransitionRecord`, `DecisionTwin`, `PolicyEvaluation`, `AuthorizationEvidence`, and all semantic state objects (DecisionCandidate, OutcomeResult, Scenario, RiskProfile, ModelOutput).

**Amendment A2 — Tenant-scoped semantic state**: Cross-tenant references in semantic state are structurally forbidden at the type level. A `DecisionTwin`'s `state_snapshot` may only reference `EntityId` values within the same `TenantId`. The state store validates tenant scoping on every write.

---

## 20. Control-Flow Boundaries

### Permitted flows

```text
Intelligence Plane
   ↓ (candidate decisions only, A6)
AI Assurance (G0–G4)
   ↓ (AssuranceResult: PASS only)
Policy / Authorization
   ↓ (PolicyEvaluation: PASS + AuthorizationEvidence, A4)
VARDHAN AUTHORITY GATE (A7)
   ↓ (authorized ActionId only)
Execution
```

### Prohibited flows

```text
Model → Executor                (BANNED)
Agent → Executor                (BANED)
UI → Executor                   (BANNED)
Webhook → Executor              (BANNED)
Intelligence → State Mutation   (BANNED)
Policy → Direct Execution       (BANNED, must go through Authorization)
```

### Control-Flow Firewall → VARDHAN AUTHORITY GATE (A7)

**Amendment A7**: There is exactly **one** execution authority in the system. All action invocations — from AI, rule engine, human, API, webhook, or event — must pass through the Vardhan Authority Gate. This is the **Universal Authority Gate**, not just a "firewall":

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

**Constitutional invariant**: Every `action_id` must have a matching `authorization_id` tracing back to a `DecisionTwin` with a finalized `AssuranceResult` and `PolicyEvaluation`.

---

## 21. Trust Boundaries

```text
                 UNTRUSTED WORLD
                       │
            ┌──────────┴──────────┐
            │ INGESTION ADAPTERS  │
            └──────────┬──────────┘
                       │
            ┌──────────▼──────────┐
            │   INGESTION BOUNDARY │ ← G0 validation
            └──────────┬──────────┘
                       │
            ┌──────────▼──────────┐
            │  EVIDENCE BOUNDARY  │ ← sign + hash + ledger write
            └──────────┬──────────┘
                       │
            ┌──────────▼──────────┐
            │   TRUST FABRIC      │ ← Raft consensus
            └──────────┬──────────┘
                       │
            ┌──────────▼──────────┐
            │   STATE BOUNDARY    │ ← EVIDENCED state only
            └──────────┬──────────┘
                       │
            ┌──────────▼──────────┐
            │   INTELLIGENCE      │
            └──────────┬──────────┘
                       │
            ┌──────────▼──────────┐
            │   POLICY BOUNDARY   │ ← deterministic policy eval
            └──────────┬──────────┘
                       │
            ┌──────────▼──────────┐
            │ EXECUTION BOUNDARY  │ ← control-flow firewall
            └──────────┬──────────┘
                       │
            ┌──────────▼──────────┐
            │   REAL WORLD        │
            └─────────────────────┘
```

**Boundary crossing checklist**:
```text
identity          → verified at boundary
authorization     → PolicyEvaluation + AuthorizationEvidence
schema            → JSON Schema validation
provenance        → EvidenceRecord chain
validation        → G0–G4 gates
failure behavior  → fail-closed / safe-mode
```

---

## 22. Failure Paths

| Component | Failure Mode | Behavior |
|---|---|---|
| **PQC Crypto** | Key/encap failure | fail closed |
| **Identity** | Unverifiable signature | reject |
| **Transport** | AEAD decryption fails | reject frame, no state change |
| **Transport** | Connection loss | RaftPeerManager retries (exponential backoff) |
| **Raft** | No quorum | no commit, no write |
| **Raft** | Stale term | reject, no state change |
| **Evidence** | Ledger write failure | no commit acknowledgement |
| **State** | Corruption detected | quarantine, reconstruct from ledger |
| **Model** | Inference failure | deterministic fallback |
| **SLM** | Ambiguity / OOD | INDETERMINATE → safe-mode policy |
| **Solver** | Timeout | INDETERMINATE → safe-mode policy |
| **Policy** | Evaluation failure | deny |
| **Execution** | Action failure | rollback / compensate |
| **Execution** | Timeout | INDETERMINATE → safe-mode |
| **Outcome** | Unobservable | mark uncertain |
| **Telemetry** | Loss | DATA NOT AVAILABLE (no silent fallback) |

### Amendment A9: Fault-Domain Isolation

Runtime failures are contained within bounded fault domains. No single component failure causes cascading failure across planes.

**Fault domains**:
```text
┌─────────────────────────────────────────────┐
│  TRUST FABRIC (L01-L02)                     │
│  PQC, AEAD Transport, Raft, HA              │
├─────────────────────────────────────────────┤
│  EVIDENCE FABRIC (L03)                       │
│  Ledger, Merkle, Attestation                │
├─────────────────────────────────────────────┤
│  ENTERPRISE STATE (L04-L07)                  │
│  State store, Graph, Canonical Model        │
├─────────────────────────────────────────────┤
│  INTELLIGENCE (L05-L06)                      │
│  Models, Reasoning, AI Assurance             │
├─────────────────────────────────────────────┤
│  DECISION & EXECUTION (L09, L11)             │
│  Decision Twin, Policy, Authorization         │
├─────────────────────────────────────────────┤
│  MEMORY (L10)                                │
│  Outcome Verification, Decision Memory        │
└─────────────────────────────────────────────┘
```

**Isolation rules**:
1. Failure in INTELLIGENCE domain does **not** affect TRUST FABRIC or EVIDENCE FABRIC — system falls back to deterministic baselines.
2. Failure in DECISION & EXECUTION does **not** stop ingestion or evidence capture — pending decisions are held until recovery.
3. Failure in TRUST FABRIC halts all authoritative writes but allows read-only access to already-EVIDENCED state.
4. Each fault domain has independent circuit breakers, health checks, and recovery procedures.
5. Cross-domain references use asynchronous messaging with explicit retry and failure semantics.

**Implementation note**: Fault-domain isolation is achieved through in-process thread pools with bounded channels, circuit breakers on trait calls, and asynchronous message passing — **not** by mandating microservices or separate daemon processes.

---

## 23. Data Ownership

```text
EXTERNAL SOURCES → VARDHAN INGESTION LAYER → TENANT-OWNED STATE
```

- Vardhan does **not** claim ownership of customer data
- Customer owns: all data in their TenantId namespace
- Vardhan owns: the evidence records about what happened to that data, the decision memory about processing it, and the cryptographic attestation of system behavior
- Cross-tenant data sharing requires explicit customer authorization recorded as evidence

---

## 24. Canonical References

All references use one of two systems:

**Logical identity** (queryable, typed):
```text
TenantId         = Uuid
EntityId         = Uuid
RelationshipId   = Uuid
DecisionId       = Uuid
PolicyId         = Uuid
ActionId         = Uuid
EventId          = Uuid
```

**Cryptographic identity** (immutable, verifiable):
```text
StateHash        = [u8; 32]     (BLAKE3 of canonical state)
EvidenceId       = [u8; 32]     (BLAKE3 of evidence record)
ContentHash      = [u8; 32]     (BLAKE3 of payload)
CommitmentId     = [u8; 32]     (Merkle root of checkpoint)
```

**Pattern**:
```text
CompanyId (logical, stable)
  ↓
CompanyVersion (immutable state version)
  ↓
StateHash (cryptographic identity of that version)
  ↓
EvidenceId (evidence object identity)
```

---

## 25. Event Flow

```text
External Source
     │
     ▼
SourceEvent
     │
     ▼
G0 Validation
     │
     ▼
VardhanEvent (EVIDENCED)
     │
     ▼
State Delta (PROPOSED)
     │
     ▼
Raft Consensus (COMMITTED)
     │
     ▼
State Applied (APPLIED)
     │
     ▼
Authoritative State
     │
     ├──→ Intelligence Plane (read-only)
     ├──→ Decision Twin (context)
     └──→ Risk Engine (assessment)
```

---

## 26. State Flow

```text
Input State
     │
     ▼
State Delta (PROPOSED)         ← SPECULATIVE (A1)
     │
     ▼
Canonical Model Validation
     │
     ▼
State Delta (VALIDATED)        ← SPECULATIVE (A1)
     │
     ▼
┌─────────────────────────┐
│ Tenant Scope Check (A2) │ ← all objects validated for tenant_id
└─────────┬───────────────┘
          │
          ▼
Graph Update (L07)
          │
          ▼
State Delta (APPLIED)          ← SPECULATIVE (A1) — evidence not yet finalized
          │
          ▼
Raft Commit Index              ← Logical Time (A3)
          │
          ▼
Evidence Finalize
          │
          ▼
State Delta (EVIDENCED)        ← AUTHORITATIVE (A1, A3)
          │
          ▼
Authoritative State (queryable by Intelligence Plane)
```

**Amendment A1**: Only `EVIDENCED` state is visible to the Intelligence Plane, Decision Twin, and all upper layers. `PROPOSED`, `VALIDATED`, and `APPLIED` states are internal to the State Fabric and are never exposed via API, query results, or candidate decision inputs.

**Amendment A2**: Tenant scope check validates that all semantic objects within the delta reference only `EntityId` values within the same `TenantId`. Cross-tenant references are structurally rejected.

**Amendment A3**: `Raft commit_index` is the sole Logical Time coordinate for state ordering. `EventTime` and `SystemTime` are preserved in evidence records but never used for state ordering.

---

## 27. Decision Flow

```text
Enterprise State
     │
     ▼
Reasoning Engine → DecisionCandidate (SPECULATIVE, A6)
     │  ← Candidate references: state_hash (EVIDENCED only, A1), config_hash (A4), tenant_id (A2)
     ▼
G0–G4 Assurance → AssuranceResult
     │  ← G0 rejects candidates with stale config_hash (A4, A6)
     ├── PASS → Decision Twin (ASSESSED → ASSURED)
     └── FAIL/REJECT/INDETERMINATE → Decision Twin (REJECTED)
     │
     ▼
Policy Engine → PolicyEvaluation
     │  ← Carries config_hash (A4), proof_reference
     ├── PASS → Authority Gate (A7)
     └── FAIL → Decision Twin (REJECTED)
     │
     ▼
Authorization (Human or Auto, policy-driven A7) → AuthorizationEvidence
     │
     ▼
VARDHAN AUTHORITY GATE → Authorized Action
     │
     ▼
Execution → ActionResult
     │
     ▼
Outcome Observation → OutcomeResult
     │
     ▼
Decision Memory ← DecisionEvidence (A5) + OutcomeEvidence (A5)
```

---

## 28. Evidence Flow

```text
Input Event
     │
     ▼
EvidenceRecord (created, signed)
     │
     ▼
Audit Ledger (written)
     │
     ▼
Merkle Checkpoint (batched)
     │
     ▼
Raft Replica (consensus_commit_index)
     │
     ▼
State Delta (linked to evidence_ref)
     │
     ▼
Decision Twin (decision_evidence_refs / outcome_evidence_refs, A5)
     │
     ▼
AssuranceResult (evidence_refs)
     │
     ▼
PolicyEvaluation (evidence_reference, config_hash, A4)
     │
     ▼
AuthorizationEvidence (evidence_ref)
     │
     ▼
OutcomeResult (evidence_ref)
     │
     ▼
Decision Memory (full provenance chain)
```

**Rule**: Every piece of authoritative data must trace back to an EvidenceRecord with a Merkle checkpoint, a `consensus_commit_index` (Logical Time, A3), a `config_hash` (A4), and an `evidence_category` (A5).

---

## 29. Dependency Graph

```text
vardhan_model (L04)
     ↑
     ├── vardhan-evidence (L03)
     │      ↑
     │      ├── audit_ledger (L03)
     │      ├── core_crypto (L01)
     │      └── ha_cluster (L02)
     │
     ├── vardhan-reasoning (L07)
     │      ↑
     │      ├── vardhan-intelligence (L05)
     │      └── vardhan-state (L04, above)
     │
     ├── vardhan-assurance (L06)
     │      ↑
     │      ├── vardhan-intelligence (L05)
     │      └── vardhan-state (L04)
     │
     ├── vardhan-risk (L08)
     │      ↑
     │      ├── vardhan-reasoning (L07)
     │      └── vardhan-state (L04)
     │
     ├── vardhan-decision (L09)
     │      ↑
     │      ├── vardhan-assurance (L06)
     │      ├── vardhan-risk (L08)
     │      ├── vardhan-policy (L11)
     │      └── vardhan-state (L04)
     │
     ├── vardhan-execution (L11)
     │      ↑
     │      ├── vardhan-decision (L09)
     │      └── control-flow-firewall (trait)
     │
     ├── vardhan-outcomes (L10)
     │      ↑
     │      ├── vardhan-execution (L11)
     │      └── vardhan-decision (L09)
     │
     ├── vardhan-memory (L12)
     │      ↑
     │      ├── vardhan-outcomes (L10)
     │      └── vardhan-decision (L09)
     │
     └── vardhan-api (L12)
            ↑
            ├── vardhan-memory (L12)
            ├── vardhan-decision (L09)
            ├── vardhan-state (L04)
            └── frontend (L12)

External AI (L05)
     ↓ (injected via ModelProvider trait)
vardhan-assurance (L06)
```

---

## 30. Runtime Deployment Map

```text
┌─────────────────────────────────────────────────────────────┐
│                    LOAD BALANCER / GATEWAY                   │
│                    (TLS termination, PQ handshake)           │
└───────────────┬─────────────────────────────────────────────┘
                │
    ┌───────────┼───────────┐
    │           │           │
    ▼           ▼           ▼
  Node A      Node B      Node N
  ┌─────┐     ┌─────┐     ┌─────┐
  │L01-3│     │L01-3│     │L01-3│  ← Trust + Evidence Fabric
  │Raft │     │Raft │     │Raft │
  │Lgc  │     │Lgc  │     │Lgc  │  ← Log / Checkpoint / Auth
  └─────┘     └─────┘     └─────┘
     │           │           │
     └──────┬────┴───────────┘
            │
            ▼
     SHARED STATE STORE
      (Enterprise State)
            │
     ┌──────┴──────┐
     │             │
     ▼             ▼
INTELLIGENCE    DECISION
PLANE           FABRIC
     │             │
     ▼             ▼
  VARDHAN
  AUTHORITY GATE
  (A7)
     │
     ▼
EXECUTION
(Runtime isolation per tenant)
```

---

## 31. Time Model

**Amendment A3 — Four distinct time domains**:

```text
┌─────────────────────────────────────────────────────────┐
│                VARDHAN TIME MODEL                      │
├────────────────────────┬────────────────────────────────┤
│ Logical Time           │ Consensus ordering             │
│                        │ Raft commit_index (u64 monotonic)│
├────────────────────────┼────────────────────────────────┤
│ Event Time             │ When event occurred (real world)│
│                        │ DateTime<Utc>, from source     │
├────────────────────────┼────────────────────────────────┤
│ System Time            │ When Vardhan observed it        │
│                        │ DateTime<Utc>, Vardhan clock    │
├────────────────────────┼────────────────────────────────┤
│ Deadline Time          │ Human-defined decision deadline │
│                        │ DateTime<Utc>, from policy      │
└────────────────────────┴────────────────────────────────┘
```

**Relationships**:
```text
EventTime ≤ SystemTime     (Vardhan observes events after they occur)
LogicalTime ≠ EventTime    (consensus order ≠ real-world time)
LogicalTime ≠ SystemTime   (commit order ≠ wall-clock order)
DeadlineTime is independent (may be future relative to SystemTime)
```

**Usage rules**:
- `commit_index` (Logical Time) is the **only** ordering coordinate for state transitions
- `EventTime` is preserved for analytical queries but never used for ordering
- `LogicalTime` is **assigned at commit**, not at event creation. Pre-commit events carry `logical_time = None`
- All `EvidenceRecord` carries all four timestamps where available
- `DecisionTwin` carries `deadline` (Deadline Time) for all decisions with reversal requirements
- Cross-node time synchronization is best-effort; Logical Time is the source of truth

**Lifecycle semantics**:
```text
EventTime      → known at creation
SystemTime     → known at observation
LogicalTime    → assigned when committed (Raft commit_index)
```

An event can exist in Vardhan's log **before** it is committed. `LogicalTime` is not final until the Raft entry containing the event is committed. Pre-commit events have `logical_time = None` and are never authoritative.

---

*This System Map is derived exclusively from the Vardhan Architecture Constitution (v1.1, A1–A9). Any implementation that cannot be mapped onto one of the thirty-one sections above is out of architectural scope.*
