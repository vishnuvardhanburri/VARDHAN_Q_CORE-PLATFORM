# Vardhan AI Intelligence Design

> **Status**: ✅ Specification (Complete)  
> **Version**: 1.0  
> **Source**: Derived exclusively from `VARDHAN_ARCHITECTURE_CONSTITUTION.md` v1.1, `VARDHAN_SYSTEM_MAP.md`, `VARDHAN_CANONICAL_OBJECT_SPEC.md`, `VARDHAN_OBJECT_TRAITS.md`, `VARDHAN_STATE_MACHINES.md`, `VARDHAN_THREAT_MODEL.md`, `VARDHAN_TEST_CONTRACTS.md`, and existing crate source code.  
> **Purpose**: Complete design of the Vardhan-owned intelligence system — model family, Security IR, Model Foundry, Production Runtime, AI Assurance pipeline, Continuous Learning, and all supporting infrastructure — with **zero third-party LLM runtime dependency**.  
> **Authority**: Specifies all NEW components for the Intelligence Plane (System Map Layers L05–L12). Does **not** redesign the existing Trust Fabric (L01–L03), Evidence Fabric (L03), Enterprise State (L04), nor the Authority Gate (A7).

---

## Table of Contents

1.  [Executive Summary](#1-executive-summary)
2.  [Existing vs. Missing Component Matrix](#2-existing-vs-missing-component-matrix)
3.  [Vardhan Model Family Map](#3-vardhan-model-family-map)
4.  [Security IR — Vardhan Security Intermediate Representation](#4-security-ir--vardhan-security-intermediate-representation)
5.  [Model-to-Model Contract Framework](#5-model-to-model-contract-framework)
6.  [Research vs. Production Boundary](#6-research-vs-production-boundary)
7.  [Training Data Architecture](#7-training-data-architecture)
8.  [Synthetic Security Data Engine (SSDE)](#8-synthetic-security-data-engine-ssde)
9.  [Model Security Architecture](#9-model-security-architecture)
10. [Model CI/CD Pipeline](#10-model-cicd-pipeline)
11. [AI Assurance Integration (G0–G4)](#11-ai-assurance-integration-g0g4)
12. [Continuous Learning Architecture](#12-continuous-learning-architecture)
13. [Security Memory Architecture](#13-security-memory-architecture)
14. [Defense Genome Architecture](#14-defense-genome-architecture)
15. [Adaptive Security Compute Scheduler](#15-adaptive-security-compute-scheduler)
16. [Model Resource Governor](#16-model-resource-governor)
17. [Decision Twin Intelligence Integration](#17-decision-twin-intelligence-integration)
18. [Security Twin Architecture](#18-security-twin-architecture)
19. [Agent Architecture Decision](#19-agent-architecture-decision)
20. [Model Lifecycle & Versioning State Machines](#20-model-lifecycle--versioning-state-machines)
21. [Canonical Object Additions](#21-canonical-object-additions)
22. [New Trait & Interface Definitions](#22-new-trait--interface-definitions)
23. [Threat Model Additions](#23-threat-model-additions)
24. [Test Contract Additions](#24-test-contract-additions)
25. [Deployment Architecture](#25-deployment-architecture)
26. [Canarying & Capacity Scaling](#26-canarying--capacity-scaling)
27. [Cost/Economic Architecture (VCU/PAYG)](#27-costeconomic-architecture-vcupayg)
28. [Required Outputs Verification](#28-required-outputs-verification)
29. [Implementation Dependency Graph](#29-implementation-dependency-graph)
30. [Research IP Portfolio](#30-research-ip-portfolio)
31. [Smallest Coherent Architecture](#31-smallest-coherent-architecture)

---

## 1. Executive Summary

### 1.1 Answer: Does Vardhan need a third-party AI provider?

**No.** Vardhan must completely own its intelligence. There is no dependency on OpenAI, Anthropic, Gemini, OpenRouter, or any third-party proprietary LLM provider at production runtime.

### 1.2 Architectural Overview

The Vardhan intelligence system is a **coordinated intelligence fabric** — not a single monolithic model. It consists of seven purpose-built models, a typed Security IR (formal Vardhan IR), a deterministic G0–G4 assurance pipeline, and a closed-loop continuous learning system.

```text
EVIDENCED State (L04)
        │
        ▼
┌──────────────────────────────────────────┐
│  PERCEPTION              REASONING      │
│  ┌─────────┐             ┌─────────┐     │
│  │ VPM     │             │ VGNN    │     │  ← L05-L07
│  │(Vardhan │             │(Graph   │     │
│  │ Predict-│             │ Neural  │     │
│  │ ive    │◄───────────►│ Network) │     │
│  │ Model)  │  Graph      └────┬────┘     │
│  └─────────┘    Embed-      │           │
│       │          dings      │           │
└───────┼──────────────────────┼───────────┘
        │                      │
        ▼                      ▼
┌──────────────────────────────────────────┐
│  SECURITY IR GENERATION                 │
│  ┌─────────┐             ┌─────────┐     │
│  │ VSC     │             │ VRM     │     │  ← L07-L08
│  │(Semantic │             │(Risk    │     │
│  │ Compiler)│             │ Model)  │     │
│  └─────────┘             └─────────┘     │
│       │                      │            │
│       ▼                      ▼            │
│  ┌────────────────────────────────────┐  │
│  │  Validated Security IR             │  │
│  │  (Strongly typed, versioned,        │  │
│  │   tenant-scoped, integrity-         │  │
│  │   protected, deterministic)       │  │
│  └────────────────────────────────────┘  │
└──────────┬────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│  ASSURANCE (G0–G4 Deterministic)        │  ← L06
└──────────┬────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│  DecisionCandidate (SPECULATIVE, A6)      │  ← L09
└──────────┬────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│  Policy + Authorization (Deterministic)  │  ← L11
└──────────┬────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│  VARDHAN AUTHORITY GATE (A7)             │
└──────────┬────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│  Execution (External)                    │  ← L11
└──────────┬────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│  Outcome Observation → VOV               │  ← L10
│  → PredictionError → Learning Signal     │  ← L12
└──────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│  Continuous Learning → Model Foundry     │  ← Air-gapped
└──────────────────────────────────────────┘
```

### 1.3 Three Intelligence Functions

| Function | Question | Models | Trust Level |
|---|---|---|---|
| **PERCEPTION** | "What is happening?" | VPM (forecast/anomaly), VSG (scenario) | Variable — deterministic models High, statistical models Medium |
| **REASONING** | "What does it mean? What could happen? What options exist?" | VGNN (graph reasoning), VDS (decision selection), VSC (semantic compilation) | Variable — deterministic models High, statistical models Medium |
| **ASSURANCE** | "Is this result safe, valid, policy-compliant, and verified?" | G0–G4 deterministic pipeline (not a model — rule-based verification) | High (deterministic) |

**Critical distinction**: Reasoning and assurance are NEVER the same thing. Reasoning produces speculative candidates. Assurance deterministically validates them. The Authority Gate only trusts assurance results, never raw model output.

### 1.4 The Security IR Bridge

The **Vardhan Security Intermediate Representation** (Security IR) is the typed, versioned, tenant-scoped, canonical, integrity-protected bridge between probabilistic model output and deterministic assurance. All model output passes through Security IR generation before reaching G0–G4. This ensures **all AI output is SPECULATIVE** (CONST-1 through CONST-8 preserved).

### 1.5 Key Design Principles

- **No third-party LLM runtime dependency** at production runtime. An optional LLM adapter may exist for NL→VPL translation in VSC, but it is isolated, sandboxed, disabled by default, benchmarked, and always has a deterministic fallback.
- **All models are deterministic at inference time** (fixed seeds, no sampling). Only VGNN's training involves non-determinism (offline, air-gapped).
- **The Authority Gate is the only execution authority** (A7). No model, agent, or intelligence component can directly execute.
- **Every model consumes EVIDENCED state only** (A1). No model can read or mutate SPECULATIVE state.
- **Every DecisionCandidate is SPECULATIVE** (A6). It cannot self-authorize or mutate state.

---

## 2. Existing vs. Missing Component Matrix

### 2.1 Classification Legend

| Label | Meaning |
|---|---|
| **EXISTING** | Already implemented in code. No design needed. |
| **EXTENSION** | Trait/spec already defined; needs concrete implementation. |
| **NEW** | Not specified or implemented. Must be designed from scratch. |
| **OPTIONAL** | Available as a pluggable adapter. Disabled by default. |
| **RESEARCH** | Experimental. Air-gapped. Not for production runtime. |

### 2.2 Component Status Matrix

| Component | Classification | Existing Location |
|---|---|---|
| `vardhan_model` crate (canonical objects) | EXISTING | `backend/vardhan_model/` (38/38 tests) |
| `vardhan_state` crate (state fabric) | EXISTING | `backend/vardhan_state/` — includes id.rs (30+ newtypes), state_markers.rs, objects.rs, state_machine.rs, scope.rs, time.rs, evidence.rs, store.rs |
| Marker traits (SpeculativeState, etc.) | EXISTING | `vardhan_state/src/state_markers.rs` |
| `StateMachine<S>` trait | EXISTING | `vardhan_state/src/state_machine.rs` |
| `TenantScoped<T>` | EXISTING | `vardhan_state/src/scope.rs` |
| `TimeContext` | EXISTING | `vardhan_state/src/time.rs` |
| `StateStore` / `EvidenceStore` traits | EXISTING | `vardhan_state/src/store.rs` |
| `ModelArtifactId`, `ModelArtifactHash` | EXISTING | `vardhan_state/src/id.rs` (lines 127-165) |
| `PredictionErrorId`, `ScenarioId` | EXISTING | `vardhan_state/src/id.rs` |
| `ModelProvider` trait | EXTENSION | Specified in Object Traits §11; needs implementation |
| `AssuranceEngine` trait (partial) | EXTENSION | Specified in Object Traits §11; only g0_check() and assess() defined; G1-G4 need elaboration |
| `ReasoningEngine` trait | EXTENSION | Specified in Object Traits §11; needs implementation |
| `RiskModel` trait | EXTENSION | Specified in Object Traits §11; needs implementation |
| `ScenarioEngine` trait | EXTENSION | Specified in Object Traits §11 |
| `DecisionEngine` trait | EXTENSION | Specified in Constitution §12 (not in Object Traits) |
| `PolicyEngine` trait | EXTENSION | Specified in Constitution §12 |
| `ActionExecutor` trait | EXTENSION | Specified in Constitution §12 |
| `OutcomeCollector` trait | EXTENSION | Specified in Constitution §12 |
| `VardhanAuthorityGate` trait | EXISTING (frozen) | Object Traits §9 — full trait with authorize_and_execute |
| `DecisionCandidate` struct | EXTENSION | Specified in Canonical Spec §13.1; needs implementation |
| `DecisionTwin` struct | EXTENSION | Specified in Canonical Spec §13.2; needs implementation |
| `AssuranceResult` struct | EXTENSION | Specified in Canonical Spec §11.4 |
| `RiskProfile` struct | EXTENSION | Specified in Canonical Spec §11.2 |
| `Scenario` struct | EXTENSION | Specified in Canonical Spec §11.3 |
| `ModelProvenance` struct | EXTENSION | Specified in Canonical Spec §11.1 |
| Trust Fabric (PQC, AEAD, Raft) | EXISTING | `core_crypto`, `ha_cluster`, `proxy_engine` |
| Evidence Ledger (BLAKE3 + ML-DSA-87) | EXISTING | `audit_ledger`, `ledger_sync`, `ledger_persistence` |
| Auth & RBAC | EXISTING | `auth_service` |
| `pq_shield` gateway | EXISTING | `backend/pq_shield/` |
| `quantum_tui` | EXISTING | Terminal UI |
| `p9_gate.py` validation | EXISTING | `p9/p9_gate.py` (7 gates) |
| `orchestration_ai` crate | EXTENSION | Existing stub (75 lines); needs full refactor |
| **Model Foundry** (air-gapped training) | NEW | — |
| **Vardhan Security IR** | NEW | — |
| **All 7 production models** (VGNN, VRM, VSG, VPM, VSC, VDS, VOV) | NEW | — |
| **WASM inference runtime** | NEW | — |
| **Feature Store (online)** | NEW | — |
| **Model Registry (production)** | NEW | — |
| **Continuous Learning pipeline** | NEW | — |
| **Synthetic Security Data Engine** | NEW | — |
| **Adaptive Security Compute scheduler** | NEW | — |
| **Model Resource Governor** | NEW | — |
| **Security Memory** | NEW | — |
| **Defense Genome** | NEW | — |
| **Security Twin** | NEW | — |
| **Model governance & canarying** | NEW | — |
| **Threat Pattern Classifier** (deterministic) | NEW | — |
| **Uncertainty Quantifier** | NEW | — |

---

## 3. Vardhan Model Family Map

The Vardhan Model Family is **one coordinated intelligence system**, not seven independent products. All models implement the `ModelProvider` trait and are managed by the unified Model Registry, Model Resource Governor, and Adaptive Security Compute scheduler.

### 3.1 Model Family Overview

| Model | Name | Fabric/Function | Layer | Trait | Deterministic? | Trust |
|---|---|---|---|---|---|---|
| **VPM** | Vardhan Predictive Model | Perception | L05 | `ModelProvider::predict()` | ✅ Yes | High |
| **VGNN** | Vardhan Graph Neural Network | Reasoning | L07 | `ReasoningEngine::derive()` | ✅ Yes (inference) | High |
| **VSC** | Vardhan Semantic Compiler | Reasoning | L07 | `ModelProvider::predict()` | ✅ Yes (LLM optional/adapter) | Variable |
| **VRM** | Vardhan Risk Model | Risk/Scenario | L08 | `RiskModel::assess()` | ✅ Seeded MC | High |
| **VSG** | Vardhan Scenario Generator | Risk/Scenario | L08 | `ScenarioEngine::generate()` | ✅ Yes | High |
| **VDS** | Vardhan Decision Selector | Decision | L09 | `DecisionEngine::decide()` | ✅ Yes | High |
| **VOV** | Vardhan Outcome Verifier | Assurance/Memory | L10 | `OutcomeCollector::collect()` | ✅ Yes | High |
| **TPC** | Threat Pattern Classifier | Perception | L05 | `ModelProvider::predict()` | ✅ Yes | High |
| **UQ** | Uncertainty Quantifier | Cross-cutting | L07 | `ModelProvider::predict()` | ✅ Yes | High |

> **Note**: TPC and UQ are not part of the original 7-model proposal but are added as specialized deterministic classifiers. They are part of the same model family, not independent products.

### 3.2 Detailed Model Specifications

See the [existing first draft §2 (lines 63-182)](#32-existing-first-draft-sections) for full per-model specifications (inputs, outputs, architecture, determinism justification, training data, G0-G4 relevance). All seven original models plus TPC and UQ are retained with the same deterministic guarantees.

**Key constraint**: Every model consumes only `EVIDENCED` state (A1). No model can read `SPECULATIVE` state. Every model's output carries `ModelProvenance` (model_hash, training_dataset_version, feature_snapshot_hash, config_hash binding).

### 3.3 Model Family as One System

The seven models form an **intelligence fabric** with shared infrastructure:

- **Shared Feature Store**: All models read from the same online Feature Store. Feature definitions are versioned and shared between offline (Foundry) and online (production) to prevent G0 feature drift.
- **Shared Model Registry**: All model artifacts (weights, parameters, feature schemas) are signed (ML-DSA-87) and registered. The Registry enforces version lineage, compatibility checks, and security compliance bundles.
- **Shared Security IR**: All model output is compiled into the Security IR before assurance. The Security IR schema is shared across all models.
- **Shared Adaptive Security Compute**: A single scheduler decides the compute level per security question (deterministic → statistical → model → simulation → formal verification).
- **Shared Resource Governor**: A single governor enforces inference duration, memory, CPU, concurrency, and recursion limits across all models.
- **Shared Assurance Pipeline**: All models route through the same G0–G4 pipeline. No model bypasses assurance.

---

## 4. Security IR — Vardhan Security Intermediate Representation

### 4.1 Purpose

The **Vardhan Security IR** (Security IR) is the typed, versioned, tenant-scoped, canonical, integrity-protected bridge between model reasoning output and the deterministic G0–G4 assurance pipeline. It converts speculative, probabilistic model output into a formally typed representation that deterministic verification can reason about.

The Security IR satisfies the constitutional requirement that **all AI/model output is SPECULATIVE** (CONST-1, A6). The Security IR itself is not executable — it is pure data. It must pass through G0–G4 assurance, Policy, and the Authority Gate before any external effect.

### 4.2 Position in the Execution Boundary

```
Observation
→ Intelligence (models)
→ DecisionCandidate (SPECULATIVE)
→ Security IR (typed, versioned, integrity-protected)
→ G0–G4 Assurance (deterministic verification)
→ Policy (deterministic evaluation)
→ Authorization (deterministic or human)
→ Vardhan Authority Gate (A7)
→ Execution
→ Outcome Verification
```

The Security IR sits between DecisionCandidate generation and G0-G4 assurance. It is the formal artifact that G0-G4 verifies.

### 4.3 Schema

```rust
/// Vardhan Security Intermediate Representation
/// Typed, versioned, tenant-scoped, canonical, integrity-protected.
#[derive(Clone, PartialEq, Eq, Hashable, Serialize, Deserialize)]
pub struct SecurityIR {
    pub ir_version: SecurityIRVersion,       // Schema version: u32
    pub tenant_id: TenantId,                 // Tenant binding (A2)
    pub ir_hash: SecurityIRHash,             // BLAKE3 of canonical_bytes()
    pub parent_state_ref: StateHash,         // EVIDENCED VARDHAN_COMMITTED_STATE only (A1)
    pub time_context: TimeContext,           // Generation time (A3)
    pub model_provenance: ModelProvenance,   // Which model, which version, which features
    pub config_fingerprint: ConfigurationFingerprint, // Config hash binding
    pub claims: Vec<SecurityClaim>,           // Typed semantic claims
    pub uncertainty: UncertaintyBounds,       // Per-claim confidence intervals
    pub action_spec: Option<ActionSpec>,      // Formal action representation (if any)
    pub evidence_refs: Vec<EvidenceId>,       // Supporting evidence references
    pub expiration: Option<DateTime<Utc>>,     // Revalidation deadline
    pub ir_signature: Option<Signature>,      // ML-DSA-87 signature over canonical bytes
}

#[derive(Clone, PartialEq, Eq, Hashable, Serialize, Deserialize)]
pub struct SecurityClaim {
    pub claim_type: ClaimType,        // OBSERVATION | RISK_FACTOR | SCENARIO | 
                                       //   DECISION_OPTION | ANOMALY | PREDICTION
    pub subject_ref: ObjectRef,       // Reference to entity/state
    pub predicate: Predicate,         // Typed predicate (enum, not free text)
    pub value: ClaimValue,            // Typed value
    pub confidence: ConfidenceScore,  // 0.0–1.0 (deterministic models: 1.0 or calibrated)
    pub model_output_ref: Option<ModelOutputRef>, // Traceability to raw model output
}

#[derive(Clone, PartialEq, Eq, Hashable, Serialize, Deserialize)]
pub struct ActionSpec {
    pub action_id: ActionId,          // Logical identity (UUID)
    pub action_type: ActionType,      // READ | MODIFY | CREATE | DELETE | EXECUTE
    pub target_ref: ObjectRef,        // What entity/object is affected
    pub parameters: ActionParameters, // Typed parameter map (canonical, deterministic)
    pub preconditions: Vec<Precondition>, // Must be true for action to be valid
    pub expected_outcome: ExpectedOutcome, // What execution should produce
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub enum ClaimType {
    Observation,      // "system X is in state Y"
    RiskFactor,       // "risk Z exceeds threshold T"
    Scenario,         // "hypothesis: failure mode F will occur"
    DecisionOption,   // "action A is viable"
    Anomaly,          // "metric M deviates from baseline B"
    Prediction,       // "metric M will be value V at time T"
}

#[derive(Clone, PartialEq, Eq, Hashable, Serialize, Deserialize)]
pub struct UncertaintyBounds {
    pub method: UncertaintyMethod,    // DETERMINISTIC | BOOTSTRAP | MONTE_CARLO | ANALYTICAL
    pub lower_bound: f64,            // Lower bound of confidence interval
    pub upper_bound: f64,            // Upper bound of confidence interval
    pub entropy: f64,                // Shannon entropy of output distribution
    pub calibration_score: f64,      // How well confidence matches reality
    pub is_deterministic: bool,       // True for deterministic models
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub struct ConfidenceScore(pub f64); // Range [0.0, 1.0], validated at construction

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub struct SecurityIRVersion(pub u32); // Monotonically increasing

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub struct SecurityIRHash(pub [u8; 32]); // BLAKE3 hash
```

### 4.4 Semantics

The Security IR semantics define how claims map to real-world meaning:

- **Observation claims**: "Entity X has property Y at state Z." Verified against EVIDENCED state (G0 checks state hash).
- **RiskFactor claims**: "Entity X has risk factor Y with score Z." Verified against VRM output and historical calibration.
- **Scenario claims**: "Hypothesis: If condition A holds, then outcome B is possible." Verified by VSG's CSP solver (G2 checks scenario diversity).
- **DecisionOption claims**: "Action A is viable given constraints C." Verified by VDS output and policy constraints.
- **Anomaly claims**: "Metric M deviates from baseline by more than threshold T." Verified by VPM's anomaly detection.
- **Prediction claims**: "Metric M will reach value V at time T." Verified by VOV retrospective comparison.

### 4.5 Versioning

- Security IR schema version is a monotonic `u32`. Version 1 is current.
- Schema changes that alter claim semantics require a new version and full re-evaluation of existing IRs.
- Model provenance carries its own version (`ModelVersion`), which is separate from Security IR version.

### 4.6 Serialization

- **Canonical serialization**: Uses the existing `canonical_json()` function from `vardhan_state/src/scope.rs` for deterministic field ordering.
- **Binary format**: CBOR with strict field ordering (RFC 7049 deterministic encoding).
- **Hash**: BLAKE3 over canonical bytes. Stored as `SecurityIRHash([u8; 32])`.

### 4.7 Validation (G0 Check for Security IR)

```rust
fn g0_validate_security_ir(ir: &SecurityIR, config_hash: ConfigurationHash) -> GateResult {
    // 1. Schema version is supported
    if ir.ir_version > CURRENT_IR_VERSION { return GateResult::Reject(SchemaMismatch); }

    // 2. Tenant binding matches execution context
    if ir.tenant_id != *CURRENT_TENANT { return GateResult::Reject(TenantMismatch); }

    // 3. Config hash matches current effective configuration (A4)
    if ir.config_fingerprint != config_hash { return GateResult::Reject(StaleConfig); }

    // 4. Parent state reference is EVIDENCED (A1)
    if !is_evidenced(ir.parent_state_ref) { return GateResult::Reject(InvalidStateRef); }

    // 5. Model provenance is valid (artifact hash matches registry)
    if !registry.verify_provenance(&ir.model_provenance) { return GateResult::Reject(InvalidProvenance); }

    // 6. Signature verification (if signed)
    if let Some(sig) = &ir.ir_signature {
        if !crypto::verify(&ir.model_provenance.signing_key, &ir.canonical_bytes(), sig) {
            return GateResult::Reject(InvalidSignature);
        }
    }

    // 7. All evidence references are finalized (EVIDENCED)
    for evid_ref in &ir.evidence_refs {
        if !evidence_store.is_finalized(evid_ref) {
            return GateResult::Reject(EvidenceNotFinalized);
        }
    }

    // 8. Expiration check
    if let Some(exp) = ir.expiration {
        if Utc::now() > exp { return GateResult::Reject(Expired); }
    }

    GateResult::Pass
}
```

### 4.8 Provenance

Every Security IR carries `ModelProvenance`:
```rust
pub struct ModelProvenance {
    pub model_id: ModelId,              // Which model family
    pub model_hash: ModelArtifactHash,  // BLAKE3 of model artifact bytes
    pub model_version: ModelVersion,    // Semantic version
    pub training_dataset_version: DatasetVersion,  // Training data version
    pub feature_snapshot_hash: FeatureSnapshotHash, // Feature definitions used
    pub config_hash: ConfigurationHash,  // Config at training time
    pub trained_at: TimeContext,        // Training time
    pub signed_by: PrincipalId,          // Foundry signing key
}
```

### 4.9 State References

- `parent_state_ref` is always a `StateHash` pointing to VARDHAN_COMMITTED_STATE (A1).
- No model can reference SPECULATIVE state. The G0 check enforces this.
- If the referenced state is stale (config_hash mismatch), the IR is rejected (CONST-8 edge case §6.7).

### 4.10 Configuration Hashes

Every Security IR carries a `ConfigurationFingerprint` that includes:
- `model_config_hash` — hash of model hyperparameters and training config
- `feature_config_hash` — hash of feature definitions used
- `policy_config_hash` — hash of active policy at generation time
- `system_config_hash` — hash of system-level security configuration

G0 verifies all hashes match current effective configuration. If any is stale, the IR is rejected and the DecisionCandidate enters `REVALIDATION_REQUIRED`.

### 4.11 Tenant Binding

- `tenant_id` is cryptographically bound to the IR hash.
- Cross-tenant references are impossible by construction: all `ObjectRef` values are tenant-scoped.
- G0 checks tenant alignment (A2): the IR's tenant must match the execution context tenant.

### 4.12 Action Representation

Actions in the Security IR are **formal specifications**, not executable code:

```rust
pub enum ActionType { Read, Modify, Create, Delete, Execute }
pub struct Precondition {
    pub condition_type: ConditionType,  // STATE_EXISTS | STATE_ABSENT | 
                                         // RISK_BELOW | POLICY_SATISFIED |
                                         // EVIDENCE_PRESENT | TIME_WINDOW
    pub parameters: BTreeMap<String, String>,  // Typed, canonical
}
```

Actions are **never directly executable** from the Security IR. They must pass through: G0-G4 → Policy → Authorization → Authority Gate → Execution Engine.

### 4.13 Uncertainty Representation

Uncertainty is explicitly represented, never implicit:

| Method | Deterministic Models | Statistical Models (VRM) |
|---|---|---|
| Confidence | 1.0 (fully certain) | Calibrated probability [0, 1] |
| Bounds | Point estimate only | Bootstrap or analytical CI |
| Entropy | 0.0 | Shannon entropy of output distribution |
| Calibration | N/A | Verified against historical accuracy |

**Rule**: If `is_deterministic == false` and `calibration_score < 0.7`, the IR is downgraded to INDETERMINATE by G2. INDETERMINATE ≠ PASS (CONST-8).

### 4.14 Immutability & Integrity Protection

- Security IR is immutable after creation. Any modification produces a new IR with a new hash.
- The IR is signed by the VSC (Security IR Generator) using an ML-DSA-87 key.
- The signature covers the entire canonical serialization.
- G0 verifies the signature before any further processing.
- Tampering with any field invalidates the signature → G0 rejects.

### 4.15 Impossibility of Direct Execution

The Security IR is a **pure data structure** with no execution capability:

- The Rust type system ensures `SecurityIR` has no methods that perform external actions.
- The Authority Gate only accepts `Action` + `Authorization` (Object Traits §9), never `SecurityIR` directly.
- The Control-Flow Firewall (Constitution §22) enforces this at the type level.
- Any attempt to execute a Security IR directly is a compile-time error.

---

## 5. Model-to-Model Contract Framework

All inter-model communication is governed by explicit, typed contracts. No model calls another model directly — all communication flows through the Security IR and the Adaptive Security Compute scheduler.

### 5.1 Contract Matrix

| Producer | Consumer | Contract Name | Input Type | Output Type | Schema Version | Confidence Threshold | Timeout |
|---|---|---|---|---|---|---|---|
| VPM | TPC | C-PM-01 | `StateSnapshot` + `Vec<VardhanEvent>` | `ModelOutput<AnomalyScore>` | v1.0 | 0.95 | 5s |
| TPC | VSC | C-PT-01 | `Vec<Anomaly>` | `ModelOutput<RiskSignals>` | v1.0 | 0.90 | 3s |
| VSC | VGNN | C-SG-01 | `SemanticGraph + RiskSignals` | `ModelOutput<GraphEmbedding>` | v1.0 | 0.95 | 8s |
| VGNN | VRM | C-GV-01 | `GraphEmbedding + StateSnapshot` | `ModelOutput<RiskProfile>` | v1.0 | 0.90 | 10s |
| VRM | VSG | C-VR-01 | `RiskProfile + StateSnapshot` | `ModelOutput<Vec<Scenario>>` | v1.0 | 0.85 | 15s |
| VSG | VDS | C-SV-01 | `Vec<Scenario> + RiskProfile` | `ModelOutput<Vec<DecisionCandidate>>` | v1.0 | 0.80 | 20s |
| VDS | Assurance | C-DA-01 | `Vec<DecisionCandidate>` | `SecurityIR` | v1.0 | 1.0 | 3s |
| VOV | Learning | C-OL-01 | `OutcomeResult` | `ModelOutput<LearningSignal>` | v1.0 | 0.95 | 5s |

### 5.2 Contract Properties

Each contract specifies:
1. **Input schema**: Exact Rust types with schema version
2. **Output schema**: Exact Rust types with schema version
3. **Confidence threshold**: Minimum confidence for the output to be accepted
4. **Timeout**: Maximum inference duration
5. **Preconditions**: What must be true for the contract to be invoked (e.g., input must be EVIDENCED)
6. **Postconditions**: What the output guarantees (e.g., output must reference parent state)
7. **Failure mode**: What happens on contract violation (G0 reject, timeout, INDETERMINATE)
8. **Provenance**: Which model versions are compatible with this contract version

### 5.3 Contract Violation Handling

- If a contract's input schema doesn't match: G0 rejects with `SchemaMismatch`
- If confidence falls below threshold: G2 flags as INDETERMINATE
- If timeout exceeded: G0 flags as timeout, DecisionTwin enters INDETERMINATE (T-J4)
- If model version doesn't match contract: G0 rejects with `VersionMismatch`

---

## 6. Research vs. Production Boundary

### 6.1 Principle

Research activities (training, hyperparameter search, architecture exploration, adversarial research, novel algorithm development) occur in an **air-gapped** environment. Production runtime is **network-isolated** and runs only signed, G0-G4 compliant model artifacts.

### 6.2 Boundary Rules

| Rule | Research Side | Production Side |
|---|---|---|
| **Model execution** | PyTorch, JAX, custom training frameworks allowed | WASM-only, Rust-native |
| **Data access** | Full dataset access (anonymized) | Feature vector only (pre-computed) |
| **Network** | Full internet (for research papers, public datasets) | No outbound network |
| **Artifact signing** | Produces unsigned artifacts | Only accepts ML-DSA-87 signed artifacts |
| **Model architecture** | Any architecture experiment | Only models with G0-G4 compliance bundles |
| **Evaluation** | Full test suite including adversarial testing | Only deterministic inference benchmarks |
| **Deployment** | No deployment | Canary → shadow → active |

### 6.3 Artifact Promotion

1. Research produces a signed artifact bundle: model weights + G0-G4 compliance report + security test report + evaluation report
2. Physical media transfer (tamper-evident USB) or secure PQ-AEAD tunnel
3. Production G0 check: verify ML-DSA-87 signature, verify config hash, verify compliance bundle
4. If G0 passes: artifact enters Model Registry in `REGISTERED` state
5. Canary shadow deployment begins

### 6.4 LLM Adapter Isolation

If an LLM adapter is used (for VSC NL→VPL translation):

```text
┌─────────────────────────────────────────┐
│         AIR-GAPPED RESEARCH ENV         │
│                                         │
│  ┌──────────────┐    ┌──────────────┐   │
│  │ LLM Adapter  │    │ Deterministic│   │
│  │ (Research)   │    │ Fallback     │   │
│  └──────┬───────┘    └──────┬───────┘   │
│         │                   │           │
│         ▼                   ▼           │
│  ┌──────────────────────────────────┐   │
│  │   Training Data Generator        │   │
│  │   (NL examples → VPL examples)   │   │
│  └──────────────────────────────────┘   │
└─────────────────┬──────────────────────┘
                  │ (physical/signed transfer)
                  ▼
┌─────────────────────────────────────────┐
│         PRODUCTION TRUST BOUNDARY        │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │  VSC (Semantic Compiler)         │   │
│  │  - Uses deterministic rules    │   │
│  │  - LLM adapter DISABLED by      │   │
│  │    default (CONST-LLM-01)       │   │
│  │  - If adapter used: sandboxed   │   │
│  │    WASM execution, no network   │   │
│  └──────────────────────────────────┘   │
│                                         │
│  Security IR Output (always)              │
│  → G0-G4 (always deterministic)          │
└─────────────────────────────────────────┘
```

### 6.5 Research IP Protection

All research artifacts are owned by Vardhan. No third-party model weights, no third-party training frameworks in production. The only exception is the optional LLM adapter, which is:
- Used only for dataset generation (research side) and as a disabled fallback (production side)
- Never the primary inference path
- Never directly on the execution path

---

## 7. Training Data Architecture

### 7.1 Data Sources (All from Vardhan's Own Systems)

1. **Evidence Ledger** (`audit_ledger`) — Historical events, observations (PII redacted)
2. **Decision Memory** (`vardhan_memory` L12) — Past decisions, candidates, predictions, outcomes, prediction errors
3. **State Snapshots** — Historical EVIDENCED state trees
4. **Policy Evaluations** — Past policy evaluation results
5. **Threat Intelligence Feed** — Industry threat feeds (sanitized, Vardhan-owned)
6. **Synthetic Data Generator** (SSDE) — Procedurally generated adversarial scenarios

### 7.2 Data Processing Pipeline

```
Raw Data Sources
        │
        ▼
┌─────────────────┐
│ Anonymization   │  PII hashing/redaction (BLAKE3 of PII values)
│ (per-tenant)    │  Tenant isolation
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Deduplication   │  SHA-256 content hashing, duplicate removal
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Feature         │  Versioned feature definitions
│ Engineering     │  Offline/online consistency
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Versioning      │  (ledger_commit_index, generation_timestamp)
│ (DatasetVersion)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Differential    │  Laplace noise (ε=1.0) for cross-tenant aggregation
│ Privacy         │
└────────┬────────┘
         │
         ▼
    Feature Store (Offline)
```

### 7.3 Feature Store

**Offline Feature Store** (Model Foundry):
- Batch feature computation from historical data
- Feature lineage tracking
- Offline/online consistency verification

**Online Feature Store** (Production Runtime):
- Real-time feature serving from EVIDENCED state
- Feature caching with TTL
- Feature validation on read
- Drift detection against training-time features

**Shared contract**: Feature definitions are versioned (`FeatureDefinitionId`, `FeatureSnapshotHash`) and identical between offline and online stores. Any mismatch → G0 reject.

---

## 8. Synthetic Security Data Engine (SSDE)

### 8.1 Purpose

Generates procedurally-created adversarial scenarios, attack patterns, and failure modes for both training data and G2 perturbation testing. All synthetic data is procedurally generated using Vardhan's own deterministic generators — no third-party datasets.

### 8.2 Architecture

```text
┌─────────────────────────────────────────────┐
│  SSDE (Synthetic Security Data Engine)      │
│                                             │
│  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Attack Pattern  │  │ Scenario        │ │
│  │ Generator       │  │ Generator       │ │
│  │ (STRIDE-based)  │  │ (CSP-based)     │ │
│  └────────┬────────┘  └────────┬────────┘ │
│           │                    │           │
│           ▼                    ▼           │
│  ┌────────────────────────────────────┐    │
│  │  Adversarial Example Synthesizer   │    │
│  │  (FGSM, PGD implementations)       │    │
│  └────────────────────────────────────┘    │
│           │                                  │
│           ▼                                  │
│  ┌────────────────────────────────────┐    │
│  │  Security IR Corpus Generator      │    │
│  │  (Generates labeled Security IRs   │    │
│  │   for G0-G4 training/verification) │    │
│  └────────────────────────────────────┘    │
│           │                                  │
│           ▼                                  │
│  ┌────────────────────────────────────┐    │
│  │  Dataset Exporter                   │    │
│  │  (Versioned, signed, anonymized)  │    │
│  └────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

### 8.3 Generated Data Types

1. **Attack Pattern Corpus**: Procedurally generated STRIDE threat patterns (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)
2. **Scenario Corpus**: Enumerated failure scenarios from VSG's CSP solver
3. **Adversarial Examples**: FGSM (Fast Gradient Sign Method) and PGD (Projected Gradient Descent) perturbations on model inputs
4. **Security IR Corpus**: Labeled Security IR instances for G0-G4 verification testing
5. **Perturbation Test Cases**: Input perturbations for G2 robustness testing

### 8.4 Integration

- SSDE output feeds into the offline Feature Store and Training Data
- SSDE generates G2 perturbation test cases (used in Evaluation Harness)
- SSDE generates Security IR corpora for G1 semantic verification testing

---

## 9. Model Security Architecture

### 9.1 Twelve Model-Specific Threats

In addition to the 98 existing intelligence threats in `VARDHAN_THREAT_MODEL.md`, the following 12 model-specific threats are introduced:

| ID | Threat Name | Description | Mitigation | Existing Test |
|---|---|---|---|---|
| M1 | Model Artifact Tampering | Attacker replaces model weights with malicious version | BLAKE3 hash verification at G0; ML-DSA-87 signature | T-MODEL-01 |
| M2 | Model Replacement | Attacker swaps entire model artifact | Registry hash match + signature verification | T-MODEL-01 |
| M3 | Training Data Poisoning | Malicious data injected into training set | Differential privacy, outlier detection, dataset provenance | T-MODEL-POISON-01 |
| M4 | Model Extraction | Attacker queries model to reconstruct weights | Rate limiting, differential privacy, query budget | T-MODEL-EXTRACT-01 |
| M5 | Adversarial Input | Attacker crafts input to cause misclassification | G2 perturbation robustness, adversarial training | T-G2-01 |
| M6 | Prompt Injection (VSC) | LLM adapter receives injected prompt | Prompt isolation, deterministic fallback, G0 detection | T-G0-03 |
| M7 | Model Supply Chain | Compromised dependency in model artifact | Reproducible builds, dependency pinning, SBOM | T-MODEL-SC-01 |
| M8 | Side-Channel Leakage | Timing/memory access reveals model internals | Constant-time implementations, padded allocation | T-MODEL-SC-02 |
| M9 | Feature Drift | Production features diverge from training features | G0 feature snapshot hash verification | T-G0-FEATURE-01 |
| M10 | Model Staleness | Stale model serves outdated risk profile | G0 config_hash staleness check, canary rollback | T-MODEL-STALE-01 |
| M11 | Uncertainty Manipulation | Attacker manipulates model confidence scores | Calibration verification, G2 uncertainty bounds | T-G2-UNCERTAIN-01 |
| M12 | Output Escaping Trust Boundary | Model output directly influences execution | Security IR barrier, G0-G4, Authority Gate only | T-MODEL-ESCAPE-01 |

### 9.2 Model Security Controls

1. **Integrity**: Every model artifact is signed (ML-DSA-87) and hashed (BLAKE3). G0 verifies both.
2. **Supply Chain**: Reproducible builds with pinned dependencies. SBOM generated per artifact.
3. **Isolation**: Models run in WASM sandbox with no filesystem or network access.
4. **Rate Limiting**: Query budget per tenant, enforced by Resource Governor.
5. **Feature Validation**: G0 verifies feature snapshot hash matches training-time features.
6. **Config Binding**: G0 verifies config hash matches current effective configuration (A4).
7. **Output Sanitization**: Model output is stripped of any executable content before Security IR generation.

---

## 10. Model CI/CD Pipeline

### 10.1 Pipeline Stages

```text
┌─────────────────────────────────────────────────────────────┐
│                    MODEL CI/CD PIPELINE                     │
│  (All in air-gapped research environment)                   │
│                                                             │
│  Developer Push → Build → Test → Evaluate → Sign → Promote │
│                                                             │
│  1. Build: Reproducible Rust build (Cargo.lock pinned)      │
│  2. Unit Tests: 100% deterministic test suite                │
│  3. Property Tests: QuickCheck-style fuzzing                 │
│  4. G0 Tests: Input integrity, hash verification            │
│  5. G1 Tests: SMT semantic agreement                        │
│  6. G2 Tests: Perturbation robustness (4 types)             │
│  7. G3 Tests: Utility, non-degeneracy                       │
│  8. G4 Tests: Policy verification                           │
│  9. Security Tests: Adversarial, side-channel, extraction   │
│  10. Sign: ML-DSA-87 over artifact + SBOM                   │
│  11. Promote: Physical media / PQ-AEAD secure transfer      │
└─────────────────────────────────────────────────────────────┘
```

### 10.2 Artifact Bundle

Each promoted artifact is a bundle containing:
1. **Model weights** (serialized tensors, canonical format)
2. **Model artifact hash** (BLAKE3)
3. **ML-DSA-87 signature** (over weights + metadata)
4. **Evaluation report** (EvidenceRef)
5. **Security test report** (EvidenceRef)
6. **G0-G4 compliance bundle** (Vec<EvidenceRef>)
7. **SBOM** (Software Bill of Materials)
8. **Training dataset version reference**
9. **Feature snapshot hash**
10. **Config fingerprint**

---

## 11. AI Assurance Integration (G0–G4)

### 11.1 G0–G4 Pipeline for Model Output

The AI Assurance pipeline operates on Security IR (not raw model output). The pipeline is **deterministic** — all checks are rule-based, mathematical, or SMT-based. No probabilistic model is used for assurance.

```text
Security IR
    │
    ▼
┌─────────────────────────────────────────────┐
│ G0 — Input Integrity Gate                   │
│ - Schema validation                         │
│ - Tenant binding (A2)                       │
│ - Config hash freshness (A4)                │
│ - Model artifact hash verification          │
│ - Signature verification (ML-DSA-87)        │
│ - State reference: EVIDENCED only (A1)      │
│ - Evidence refs: finalized                      │
│ - Expiration check                          │
└───────────────────┬─────────────────────────┘
                    │ PASS
                    ▼
┌─────────────────────────────────────────────┐
│ G1 — Semantic Integrity Gate                │
│ - SMT verification of claim semantics       │
│ - Prove: model output ↔ expected semantics   │
│ - Type checking on all claims               │
│ - Predicate well-formedness                 │
└───────────────────┬─────────────────────────┘
                    │ PASS
                    ▼
┌─────────────────────────────────────────────┐
│ G2 — Robustness Gate                        │
│ - Perturbation stability testing            │
│ - Uncertainty bounds validation             │
│ - Confidence calibration check              │
│ - Model version matches contract            │
└───────────────────┬─────────────────────────┘
                    │ PASS
                    ▼
┌─────────────────────────────────────────────┐
│ G3 — Utility Gate                           │
│ - Non-degeneracy (not returning trivial)    │
│ - Coverage (all claims/assertions present)  │
│ - Confidence >= threshold                   │
└───────────────────┬─────────────────────────┘
                    │ PASS
                    ▼
┌─────────────────────────────────────────────┐
│ G4 — Policy Compliance Gate                 │
│ - SMT verification against policy          │
│ - Constraint satisfaction                   │
│ - Risk profile within bounds                │
└───────────────────┬─────────────────────────┘
                    │ PASS
                    ▼
  AssuranceResult { result: PASS, g0: ..., g1: ..., g2: ..., g3: ..., g4: ... }
```

### 11.2 Assurance Engine Trait (Extended)

```rust
pub trait AssuranceEngine: Send + Sync {
    // Existing (Object Traits §11)
    fn assess(&self, candidate: &DecisionCandidate) -> Result<AssuranceResult, AssuranceError>;
    fn g0_check(&self, candidate: &DecisionCandidate, config_hash: ConfigurationHash) -> Result<GateResult, AssuranceError>;

    // NEW — G1 through G4
    fn g1_check(&self, ir: &SecurityIR) -> Result<GateResult, AssuranceError>;
    fn g2_check(&self, ir: &SecurityIR, original_output: &ModelOutput) -> Result<GateResult, AssuranceError>;
    fn g3_check(&self, ir: &SecurityIR) -> Result<GateResult, AssuranceError>;
    fn g4_check(&self, ir: &SecurityIR, policy: &Policy) -> Result<GateResult, AssuranceError>;

    // Full pipeline (calls g0-g4 in sequence, short-circuits on failure)
    fn full_assurance(&self, candidate: &DecisionCandidate, ir: &SecurityIR, config_hash: ConfigurationHash) -> Result<AssuranceResult, AssuranceError>;
}
```

### 11.3 Assurance Result

```rust
pub struct AssuranceResult {
    pub candidate_id: DecisionCandidateId,
    pub ir_hash: SecurityIRHash,
    pub final_status: AssuranceStatus,  // PASS | FAIL | INDETERMINATE
    pub g0_result: GateResult,
    pub g1_result: GateResult,
    pub g2_result: GateResult,
    pub g3_result: GateResult,
    pub g4_result: GateResult,
    pub evidence_refs: Vec<EvidenceId>,
    pub evaluated_at: TimeContext,
    pub evaluator_identity: PrincipalId,
}

pub enum AssuranceStatus { Pass, Fail, Indeterminate }
// INDETERMINATE ≠ PASS (CONST-8)
```

---

## 12. Continuous Learning Architecture

### 12.1 Closed-Loop Pipeline

```text
┌─────────────────────┐
│ Execution Outcome   │  ← Real-world observation
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ VOV (Outcome Verifier)│
│ - Compare predicted  │
│   vs actual          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ PredictionError     │
│ - |predicted - actual|│
│ - Semantic match    │
│ - Confidence delta  │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Learning Signal     │  ← (LearningSignalId)
│ Generator           │
│ - Error magnitude   │
│ - Calibration drift │
│ - Feature drift     │
│ - Policy violation  │
│   signals           │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Learning Signal     │
│ Store (L12)         │
│ - Encrypted at rest │
│ - Append-only       │
│ - TTL per signal    │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Drift Detector      │  ← Periodic scan
│ - Statistical drift │
│ - Concept drift     │
│ - Performance decay │
└─────────┬───────────┘
          │
    [drift detected?]
          │ Yes
          ▼
┌─────────────────────┐
│ Retraining Trigger  │
│ - Creates RetrainJob│
│ - Sends to Foundry  │  ← Air-gapped
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Model Foundry       │  ← Air-gapped training
│ - Retraining        │
│ - Evaluation        │
│ - Signing           │
│ - Promotion         │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Model Registry      │  ← Production
│ - New artifact      │
│ - Canary deploy     │
│ - Rollback capability│
└─────────────────────┘
```

### 12.2 Learning Signal Types

1. **Accuracy Signal**: `|predicted - actual| > threshold`
2. **Calibration Signal**: `actual_pass_rate ≠ confidence_score`
3. **Feature Drift Signal**: Production feature distribution ≠ training distribution
4. **Concept Drift Signal**: Performance degradation on historical data
5. **Policy Violation Signal**: Decision led to policy-violating outcome
6. **Out-of-Distribution Signal**: Input pattern not seen in training
7. **Uncertainty Calibration Signal**: High confidence, low accuracy

### 12.3 Feedback Pathways

- **VOV → Learning Signal**: Primary feedback from outcome verification
- **Drift Detector → Learning Signal**: Detected drift from production monitoring
- **Human Analyst → Learning Signal**: Manual corrections from executive/analyst workflow
- **Adversarial Testing → Learning Signal**: From G2 perturbation tests during evaluation

### 12.4 Learning Orchestrator Trait

```rust
pub trait LearningOrchestrator: Send + Sync {
    fn generate_signal(&self, outcome: &OutcomeResult, prediction: &PredictionError) -> Result<LearningSignal, LearningError>;
    fn detect_drift(&self, tenant: TenantId) -> Vec<DriftSignal>;
    fn trigger_retraining(&self, signal: &LearningSignal) -> Result<TrainingJobId, LearningError>;
    fn aggregate_signals(&self, tenant: TenantId) -> Vec<LearningSignal>;
}
```

---

## 13. Security Memory Architecture

### 13.1 Purpose

Security Memory is Vardhan's structured, integrity-protected archive of all security-relevant decisions, outcomes, and learned patterns. It is NOT free-form LLM memory. It is the production counterpart of the Foundry's Data Lake, maintaining the closed learning loop.

### 13.2 Architecture

Security Memory stores structured records in six categories:

| Category | Content | Lifetime | Encryption |
|---|---|---|---|
| **Provenance** | Model artifact provenance, feature definitions | Permanent | AES-256-GCM |
| **Evidence** | Evidence records, signatures, Merkle paths | Permanent | AES-256-GCM |
| **State** | Historical state snapshots, state transitions | Permanent | AES-256-GCM |
| **Decision** | Decision twin records, assurance results, candidates | Permanent | AES-256-GCM |
| **Outcome** | Execution results, prediction errors, outcomes | Permanent | AES-256-GCM |
| **Effectiveness** | Performance metrics, drift signals, learning signals | Rolling (TTL 2y) | AES-256-GCM |

### 13.3 Security Memory Store

```rust
pub trait SecurityMemoryStore: Send + Sync {
    fn store_decision(&self, twin: &DecisionTwin) -> Result<(), MemoryError>;
    fn store_outcome(&self, outcome: &OutcomeResult) -> Result<(), MemoryError>;
    fn store_signal(&self, signal: &LearningSignal) -> Result<(), MemoryError>;
    fn query_decisions(&self, tenant: TenantId, time_range: TimeRange) -> Result<Vec<DecisionTwin>, MemoryError>;
    fn query_signals(&self, tenant: TenantId, time_range: TimeRange) -> Result<Vec<LearningSignal>, MemoryError>;
    fn compute_effectiveness(&self, tenant: TenantId, model_id: ModelId) -> Result<ModelMetrics, MemoryError>;
}
```

### 13.4 Integration with Existing Components

- **DecisionTwin** → Security Memory store (MEMORIZED state, §13 Decision Twin Lifecycle)
- **OutcomeResult** → Security Memory store (L10 Outcome Pipeline)
- **LearningSignal** → Security Memory store (Continuous Learning pipeline)
- **ModelMetrics** → Security Memory query (for drift detection, retraining triggers)

---

## 14. Defense Genome Architecture

### 14.1 Purpose

The Defense Genome is a library of reusable, composable defensive strategies. Each defense pattern is:
- **Versioned** (semantic versioning)
- **Attributed** (author, rationale, threat mapping)
- **Composable** (patterns can be combined)
- **Verifiable** (G0-G4 applicable to defense composition)

### 14.2 Genome Structure

```
DefenseGenome (root)
├── DetectionPatterns
│   ├── AnomalyDetection (used by VPM)
│   ├── ThreatClassification (used by TPC)
│   ├── DriftDetection (used by DriftDetector)
│   └── PromptInjectionDetection (used by VSC, if LLM adapter active)
├── ResponsePatterns
│   ├── IsolationResponse (quarantine, segment)
│   ├── EscalationResponse (human in loop)
│   ├── CompensatingControl (deterministic fallback)
│   └── RollbackResponse (undo action)
├── ValidationPatterns
│   ├── SchemaValidation (G0)
│   ├── SemanticValidation (G1)
│   ├── RobustnessValidation (G2)
│   └── PolicyValidation (G4)
└── LearningPatterns
    ├── FeedbackIntegration (continuous learning)
    ├── RetrainingTrigger (retraining pipeline)
    └── PerformanceCalibration (calibration adjustment)
```

### 14.3 Integration

- **VGNN** uses `AnomalyDetection` pattern from the Genome for graph anomaly detection
- **VPM** uses `DriftDetection` pattern for time-series drift
- **TPC** uses `ThreatClassification` pattern
- **VSC** uses `PromptInjectionDetection` pattern (if LLM adapter is enabled)
- **G0-G4** uses `ValidationPatterns` for deterministic checks
- **Adaptive Security Compute** selects `ResponsePatterns` based on security question

### 14.4 Genome Store

```rust
pub trait DefenseGenomeStore: Send + Sync {
    fn get_pattern(&self, pattern_id: &PatternId) -> Result<DefensePattern, GenomeError>;
    fn compose(&self, patterns: &[PatternId]) -> Result<ComposedDefense, GenomeError>;
    fn validate_composition(&self, composition: &ComposedDefense) -> Result<bool, GenomeError>;
    fn version_history(&self, pattern_id: &PatternId) -> Vec<PatternVersion>;
}
```

---

## 15. Adaptive Security Compute Scheduler

### 15.1 Purpose

The ASC Scheduler determines the appropriate level of computational rigor for each security question, based on risk level, urgency, available resources, and cost constraints. It ensures that high-risk decisions get the most rigorous analysis while routine checks use minimal compute.

### 15.2 Compute Levels

| Level | Name | Description | Used For | Trust |
|---|---|---|---|---|
| 0 | Deterministic Rules | Hand-written rule evaluation | G0 input validation, schema checks | High |
| 1 | Statistical Analysis | Formula-based risk scoring | VRM baseline risk scoring | High |
| 2 | Lightweight Model | Single deterministic model (VPM/TPC) | Anomaly detection, threat classification | High |
| 3 | Deep Reasoning | Multi-model reasoning chain (VGNN→VRM→VSG) | Complex threat analysis | High |
| 4 | Simulation | Monte Carlo simulation (seeded) | Risk scenario projection | High (seeded) |
| 5 | Formal Verification | SMT solving, proof checking | G1 semantic agreement, G4 policy verification | High |

### 15.3 Scheduler Logic

```rust
pub struct AdaptiveSecurityCompute;

impl AdaptiveSecurityCompute {
    pub fn select_compute_level(
        &self,
        question: &SecurityQuestion,
        risk_level: RiskLevel,
        urgency: Urgency,
        available_budget: ResourceBudget,
        config: &ASCConfig,
    ) -> ComputeLevel {
        // Decision tree:
        // - If risk_level == MAXIMUM → level 5 (formal verification)
        // - If risk_level == HIGH + urgency LOW → level 4 (simulation)
        // - If risk_level == HIGH + urgency HIGH → level 3 (deep reasoning)
        // - If risk_level == MEDIUM → level 2 (lightweight model)
        // - If risk_level == LOW → level 1 (statistical)
        // - If question is G0 validation → level 0 (deterministic)
        // Budget check: if level X would exceed budget, downgrade to X-1
        // Timeout: if level X exceeds deadline, abort with INDETERMINATE
    }
}
```

### 15.4 Integration

- ASC feeds compute level decisions to the Model Resource Governor (§16)
- ASC feeds compute level decisions to the Assurance Engine (§11)
- ASC is configured via `ConfigurationSnapshot` (A4 binding)
- ASC decisions are logged as evidence (A5)

---

## 16. Model Resource Governor

### 16.1 Purpose

The Model Resource Governor enforces strict resource limits on all model inference to prevent resource exhaustion attacks, ensure fairness, and guarantee bounded execution.

### 16.2 Limits

| Resource | Limit | Enforcement |
|---|---|---|
| **Inference Duration** | 30s (default), 5s (G0), 10s (G1), 20s (G2), 15s (G3), 30s (G4) | Hard timeout kills inference |
| **Memory Usage** | 512MB per model instance | WASM memory limit |
| **CPU Usage** | 2 cores max per instance | cgroups/CPU quota |
| **Accelerator (GPU)** | 1 GPU per 10 model instances | Device partition |
| **Concurrency** | 4 x CPU cores (max parallel instances) | Semaphore |
| **Queue Depth** | 100 pending requests | FIFO queue, overflow → INDETERMINATE |
| **Retries** | 2 retries max (exponential backoff) | 3 total attempts |
| **Recursion Depth** | 3 model chains max (VPM→VGNN→VRM) | Call stack tracking |
| **Simulation Depth** | 10,000 MC samples max | Seeded, bounded RNG |
| **Output Size** | 10,000 claims max per Security IR | Hard cap, truncation if exceeded |

### 16.3 Governor Trait

```rust
pub trait ModelResourceGovernor: Send + Sync {
    fn acquire_quota(&self, tenant: TenantId, model_id: ModelId, request: &InferenceRequest) -> Result<QuotaGrant, ResourceError>;
    fn enforce_limits(&self, tenant: TenantId, model_id: ModelId) -> ResourceLimits;
    fn check_deadline(&self, deadline: DateTime<Utc>) -> Result<(), ResourceError>;
    fn report_usage(&self, tenant: TenantId, model_id: ModelId) -> ResourceUsage;
    fn is_overloaded(&self) -> bool;
}
```

### 16.4 Integration with ASC

The ASC scheduler selects the compute level, and the Resource Governor enforces the corresponding limits. If the Governor determines a level would violate resource constraints, it downgrades the compute level.

---

## 17. Decision Twin Intelligence Integration

### 17.1 Integration Point

The Decision Twin lifecycle (Canonical Spec §13.2) integrates with the intelligence fabric at the `OPTIONS_GENERATED` state:

```text
DecisionTwin Lifecycle:
CREATED → CONTEXTUALIZED → OPTIONS_GENERATED → ASSESSED → ASSURED → ...

At OPTIONS_GENERATED:
1. VDS (Decision Selector) calls DecisionEngine::decide() with the DecisionTwin
2. Models generate candidate actions, wrapped in Security IR
3. Security IR passes through G0-G4
4. If PASS: candidates added to DecisionTwin.candidate_options
5. If FAIL: candidate rejected, not added
6. If INDETERMINATE: candidate flagged for human review
```

### 17.2 Decision Candidate Generation Pattern

This replaces the `orchestration_ai` stub pattern. The new pattern:

1. **Observation** → State snapshot (EVIDENCED)
2. **Intelligence** → VDS generates DecisionCandidate + Security IR (SPECULATIVE)
3. **G0-G4** → Deterministic verification of Security IR
4. **Policy** → Deterministic policy evaluation
5. **Authorization** → Risk-based authorization decision
6. **Authority Gate** → execute(action, authorization) or reject

The `orchestration_ai` crate's `evaluate_cluster_state()` will be refactored to:
- Generate candidates for node drain, scaling, healing (SPECULATIVE only)
- Route all candidates through Security IR → G0-G4 → Policy → Authority Gate
- Remove the hardcoded thresholds (those move to the model config)

---

## 18. Security Twin Architecture

### 18.1 Purpose

The Security Twin is the intelligence-plane mirror of the Decision Twin. Where the Decision Twin tracks one business decision, the Security Twin tracks one security-relevant state or threat vector over time.

### 18.2 Architecture

```text
┌─────────────────────────────────────────────────────┐
│              SECURITY TWIN                         │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │  Threat Context                               │  │
│  │  - Entity reference                          │  │
│  │  - Threat vector                              │  │
│  │  - Temporal scope                             │  │
│  │  - Confidence                                 │  │
│  └──────────────────────────────────────────────┘  │
│           │                                        │
│           ▼                                        │
│  ┌──────────────────────────────────────────────┐  │
│  │  Security IR Claims                           │  │
│  │  - Observation claims                        │  │
│  │  - Risk factor claims                        │  │
│  │  - Scenario claims                           │  │
│  └──────────────────────────────────────────────┘  │
│           │                                        │
│           ▼                                        │
│  ┌──────────────────────────────────────────────┐  │
│  │  Assurance Results                           │  │
│  │  - G0-G4 pass/fail/indeterminate             │  │
│  │  - Confidence calibration                    │  │
│  └──────────────────────────────────────────────┘  │
│           │                                        │
│           ▼                                        │
│  ┌──────────────────────────────────────────────┐  │
│  │  Recommended Responses                       │  │
│  │  - From Defense Genome                       │  │
│  │  - ASC-selected compute level                │  │
│  │  - Policy constraints                        │  │
│  └──────────────────────────────────────────────┘  │
│           │                                        │
│           ▼                                        │
│  ┌──────────────────────────────────────────────┐  │
│  │  Decision Twin Link                            │  │
│  │  - References Security Twin for context      │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 18.3 Security Twin Lifecycle

```text
CREATED → CONTEXTUALIZED → CLAIMS_GENERATED → ASSESSED → ASSURED
    │                                           │
    ├── [FAIL] → REJECTED                        │
    ├── [INDETERMINATE] → AWAITING_REVIEW       │
    │                                           │
    ▼                                           ▼
POLICY_CHECKED → AUTHORIZATION_REQUIRED → 
    │
    ├── [REQUIRES_HUMAN] → AWAITING_APPROVAL
    │   ├── [approved] → APPROVED → linked to Decision Twin
    │   ├── [denied] → REJECTED
    │   └── [expired] → EXPIRED
    │
    ▼
APPROVED → Linked to DecisionTwin → DecisionTwin uses Security Twin context
    │
    ├── [outcome verified] → RESOLVED → MEMORIZED (Security Memory)
    ├── [contradictory evidence] → REVALIDATION_REQUIRED (A8)
    └── [expired] → EXPIRED
```

---

## 19. Agent Architecture Decision

### 19.1 Decision: NO Autonomous Agents

Vardhan does **not** implement autonomous agents. The architecture uses **bounded reasoning workers** that produce only speculative, structured output. No agent can directly execute, mutate state, or act autonomously.

### 19.2 Rationale

1. **Constitutional invariant (CONST-1)**: No unverified probabilistic output may create authoritative state. Autonomous agents inherently produce probabilistic output.
2. **Control-Flow Firewall (Constitution §22)**: Banned paths include `Agent → Executor` and `Intelligence → State Mutation`. Autonomous agents would require these paths.
3. **Threat Model**: I1 (Model→Executor bypass), I9 (Speculative escape) — autonomous agents are the primary vector for both.
4. **Trust boundary**: The Intelligence domain has "Variable" trust level. Autonomous agents would require High trust.

### 19.3 What Exists Instead

**Bounded Reasoning Workers** — These are:
- **Deterministic** or **seeded-deterministic** computation units
- **Speculative** output only (wrapped in Security IR)
- **Resource-constrained** (enforced by Model Resource Governor)
- **Time-bounded** (hard timeouts, INDETERMINATE on expiry)
- **Cannot self-authorize** (A6: all candidates are SPECULATIVE)
- **Cannot mutate state** (Intelligence → State Mutation is banned)
- **Cannot execute** (Model → Executor is banned)

Each model (VPM, VGNN, VSC, VRM, VSG, VDS, VOV, TPC, UQ) is a bounded reasoning worker. The `orchestration_ai` crate's existing pattern (generate candidate → await Authority Gate approval) is the correct pattern — it just needs the full model pipeline behind it.

### 19.4 Orchestration Pattern

```rust
// Correct pattern (existing in orchestration_ai stub, needs full implementation):
fn on_observation(observation: &Observation) -> Result<DecisionTwin, DecisionError> {
    // 1. Intelligence generates candidates (SPECULATIVE)
    let candidates = vds.decide(&decision_twin)?;
    
    // 2. Security IR is generated from candidates
    let security_ir = vsc.compile_to_security_ir(&candidates)?;
    
    // 3. G0-G4 deterministic verification
    let assurance = assurance_engine.full_assurance(&decision_twin, &security_ir, config_hash)?;
    
    // 4. If PASS, candidates are added to DecisionTwin
    // 5. DecisionTwin proceeds through Policy, Authorization, Authority Gate
    // 6. Authority Gate executes — NOT the model or worker
}
```

---

## 20. Model Lifecycle & Versioning State Machines

### 20.1 Model Artifact Lifecycle

```text
CREATED
   │  event: artifact_signed(ML-DSA-87)
   │  action: compute BLAKE3 hash, attach provenance
   ▼
PROVENANCE_ATTACHED
   │  event: register_in_registry()
   │  guard: signature valid, hash matches
   │  action: write to Model Registry, evidence capture
   ▼
STATE_REFERENCED
   │  event: state_hash_bound(state_hash)
   │  action: bind to EVIDENCED state (A1)
   ▼
G0_VALIDATED
   │  event: g0_check_pass(config_hash)
   │  guard: config_hash matches, state is EVIDENCED
   │  action: mark as G0-validated
   ▼
EVIDENCED
   │  event: evidence_finalized()
   │  guard: EvidenceRecord committed
   │  action: link to evidence, mark authoritative
   ▼
MEMORIZED
   │  event: store_in_memory_store()
   │  action: write to Model Registry (production)
   ▼
[→ Canary Deployment → Active → Deprecated → Revoked]
```

### 20.2 Model Version Lifecycle (8 States)

```text
DRAFT
   │  event: register()
   │  action: create ModelRegistryEntry
   ▼
REGISTERED
   │  event: evaluate()
   │  action: run G0-G4 test contract suite
   ▼
EVALUATED
   │  event: g0_g4_pass()
   │  guard: all 85+ test contracts pass
   │  action: write EvaluationReport, G0-G4 compliance bundle
   ▼
APPROVED
   │  event: approve_for_canary()
   │  action: sign for production, write to Registry
   ▼
CANARY
   │  event: shadow_deploy(tenant_subset)
   │  action: route % of traffic, collect metrics
   │  ├── [metrics OK] → VERIFIED
   │  ├── [degradation] → ROLLED_BACK
   │  └── [timeout] → ROLLED_BACK
   ▼
VERIFIED
   │  event: promote_to_active()
   │  action: full traffic, monitor
   ▼
ACTIVE
   │  event: deprecate()
   │  action: mark deprecated, begin rollback capability
   ▼
DEPRECATED
   │  event: revoke()
   │  guard: no active dependencies
   │  action: revoke signing key, remove from active pool
   ▼
REVOKED
```

### 20.3 Training Job Lifecycle

```text
SUBMITTED
   │  event: enqueue()
   │  action: assign TrainingJobId, allocate resources
   ▼
PREPARING
   │  event: prepare_data()
   │  action: load dataset, compute features
   ▼
TRAINING
   │  event: start_training()
   │  action: run training algorithm
   │  ├── [progress_update] → TRAINING (self)
   │  ├── [completed] → EVALUATING
   │  ├── [error] → FAILED
   │  └── [timeout] → FAILED
   ▼
EVALUATING
   │  event: evaluate()
   │  action: run G0-G4 + security test suite
   │  ├── [PASS] → COMPLETED
   │  ├── [FAIL] → FAILED
   │  └── [INDETERMINATE] → REQUIRES_RETRAIN
   ▼
COMPLETED
   │  event: sign_artifact()
   │  action: produce signed ModelArtifact + EvaluationReport
   ▼
PROMOTED (→ Model Artifact Lifecycle)
```

### 20.4 Canary Deployment Lifecycle (8 States)

```text
REGISTERED → EVALUATED → APPROVED → CANARY → VERIFIED → ACTIVE → DEPRECATED → REVOKED
```

At `CANARY`: traffic percentage starts at 0%, ramps to 1%, 5%, 25%, 50%, 100% over 24h. Any degradation at any step → rollback to previous `ACTIVE` version.

### 20.5 Continuous Learning Cycle

```text
LEARNING_SIGNAL_GENERATED
   │  event: signal_detected()
   │  action: store in LearningSignal store
   ▼
DRIFT_DETECTED
   │  event: drift_confirmed()
   │  action: create RetrainJob
   ▼
RETRAINING_SCHEDULED
   │  event: schedule_retrain()
   │  action: allocate resources
   ▼
[→ Training Job Lifecycle → Model Artifact Lifecycle]
```

### 20.6 Model Versioning Schema

Each model artifact carries:

| Field | Type | Source |
|---|---|---|
| `model_id` | `ModelId` (UUID) | Assigned at creation |
| `model_hash` | `ModelArtifactHash` ([u8;32]) | BLAKE3 of artifact bytes |
| `model_version` | `ModelVersion` (semver) | Assigned at creation |
| `training_dataset_version` | `DatasetVersion` | From Foundry Data Lake |
| `feature_snapshot_hash` | `FeatureSnapshotHash` | Hash of feature definitions |
| `config_fingerprint` | `ConfigurationFingerprint` | Hash of model config |
| `training_commit_index` | `CommitIndex` | Ledger commit at training time |
| `g0_g4_compliance_ref` | `EvidenceId` | Evaluation report reference |
| `signed_by` | `PrincipalId` | Foundry signing key |

---

## 21. Canonical Object Additions

### 21.1 New Canonical Objects

| Object | Layer | Description | Classification |
|---|---|---|---|
| `SecurityIR` | L06 | Typed security intermediate representation | NEW |
| `SecurityIRVersion` | L06 | Version identifier for Security IR schema | NEW |
| `SecurityClaim` | L06 | Typed claim within Security IR | NEW |
| `UncertaintyBounds` | L06 | Uncertainty representation | NEW |
| `ActionSpec` | L06 | Formal action specification in Security IR | NEW |
| `ModelArtifact` | L05 | Signed model weights + metadata | NEW |
| `ModelRegistryEntry` | L05 | Registry record for model artifact | NEW |
| `ModelVersion` | L05 | Semantic version of model | NEW (id newtype) |
| `ModelMetrics` | L05 | Performance metrics | NEW |
| `FeatureDefinition` | L05 | Versioned feature spec | NEW |
| `FeatureVector` | L05 | Computed feature values | NEW |
| `TrainingJob` | Foundry | Training job metadata | NEW |
| `EvaluationReport` | Foundry | G0-G4 test results | NEW |
| `SecurityTestReport` | Foundry | Security testing results | NEW |
| `DatasetVersion` | L05 | Training data version | NEW (id newtype) |
| `LearningSignal` | L12 | Signal for continuous learning | NEW |
| `DriftSignal` | L12 | Detected drift signal | NEW |
| `CanaryDeployment` | L05 | Canary deployment state | NEW |
| `MemoryRecord` | L12 | Structured security memory record | NEW |
| `DefensePattern` | L07 | Reusable defensive strategy | NEW |
| `ComposedDefense` | L07 | Composition of defense patterns | NEW |
| `SecurityTwin` | L08 | Security-relevant state twin | NEW |
| `ResourceAllocation` | L05 | Resource allocation record | NEW |
| `InferenceTrace` | L05 | Trace of model inference execution | NEW |

### 21.2 Extended Existing Objects

| Object | Extension | Description |
|---|---|---|
| `DecisionCandidate` | Add `security_ir_hash` field | Link to Security IR |
| `DecisionTwin` | Add `security_twin_ref` field | Link to Security Twin |
| `AssuranceResult` | Add `g1_result`, `g2_result`, `g3_result`, `g4_result` fields | Full G1-G4 results |
| `ModelProvenance` | Add `training_commit_index`, `g0_g4_compliance_ref` | Full provenance chain |

---

## 22. New Trait & Interface Definitions

### 22.1 ModelRegistry Trait

```rust
pub trait ModelRegistry: Send + Sync {
    fn register(&self, entry: ModelRegistryEntry) -> Result<(), RegistryError>;
    fn lookup(&self, model_hash: ModelArtifactHash) -> Result<ModelRegistryEntry, RegistryError>;
    fn lookup_version(&self, model_id: ModelId, version: ModelVersion) -> Result<ModelRegistryEntry, RegistryError>;
    fn verify_provenance(&self, provenance: &ModelProvenance) -> Result<bool, RegistryError>;
    fn list_active(&self, tenant: TenantId) -> Result<Vec<ModelRegistryEntry>, RegistryError>;
    fn revoke(&self, model_hash: ModelArtifactHash, reason: &str) -> Result<(), RegistryError>;
}
```

### 22.2 FeatureStore Trait

```rust
pub trait FeatureStore: Send + Sync {
    fn get_features(&self, tenant: TenantId, entity: EntityId, def: FeatureDefinitionId) -> Result<FeatureVector, FeatureError>;
    fn get_batch(&self, tenant: TenantId, entities: &[EntityId], def: FeatureDefinitionId) -> Result<Vec<FeatureVector>, FeatureError>;
    fn validate_drift(&self, tenant: TenantId, online: &FeatureVector, offline: &FeatureVector) -> Result<bool, FeatureError>;
}
```

### 22.3 ModelFoundry Trait (RESEARCH — air-gapped)

```rust
pub trait ModelFoundry: Send + Sync {
    fn start_training(&self, job: TrainingJobSpec) -> Result<TrainingJobId, FoundryError>;
    fn monitor_training(&self, job_id: TrainingJobId) -> Result<TrainingStatus, FoundryError>;
    fn evaluate(&self, model_hash: ModelArtifactHash) -> Result<EvaluationReport, FoundryError>;
    fn run_security_tests(&self, model_hash: ModelArtifactHash) -> Result<SecurityTestReport, FoundryError>;
    fn sign_artifact(&self, artifact: &ModelArtifact) -> Result<SignedArtifact, FoundryError>;
    fn promote(&self, signed: SignedArtifact) -> Result<PromotionResult, FoundryError>;
}
```

### 22.4 Extended AssuranceEngine Trait

```rust
pub trait AssuranceEngine: Send + Sync {
    // Existing
    fn assess(&self, candidate: &DecisionCandidate) -> Result<AssuranceResult, AssuranceError>;
    fn g0_check(&self, candidate: &DecisionCandidate, config_hash: ConfigurationHash) -> Result<GateResult, AssuranceError>;

    // NEW: G1-G4 for Security IR
    fn g1_check_security_ir(&self, ir: &SecurityIR) -> Result<GateResult, AssuranceError>;
    fn g2_check_security_ir(&self, ir: &SecurityIR, original: &ModelOutput) -> Result<GateResult, AssuranceError>;
    fn g3_check_security_ir(&self, ir: &SecurityIR) -> Result<GateResult, AssuranceError>;
    fn g4_check_security_ir(&self, ir: &SecurityIR, policy: &Policy) -> Result<GateResult, AssuranceError>;

    // Full pipeline
    fn full_assurance(&self, candidate: &DecisionCandidate, ir: &SecurityIR, config_hash: ConfigurationHash) -> Result<AssuranceResult, AssuranceError>;
}
```

### 22.5 InferenceEngine Trait

```rust
pub trait InferenceEngine: Send + Sync {
    fn predict(&self, model_hash: ModelArtifactHash, input: &SecurityIR) -> Result<ModelOutput, InferenceError>;
    fn provenance(&self, model_hash: ModelArtifactHash) -> Result<ModelProvenance, InferenceError>;
}
```

### 22.6 LearningOrchestrator Trait (NEW)

```rust
pub trait LearningOrchestrator: Send + Sync {
    fn generate_signal(&self, outcome: &OutcomeResult, prediction: &PredictionError) -> Result<LearningSignal, LearningError>;
    fn detect_drift(&self, tenant: TenantId) -> Vec<DriftSignal>;
    fn trigger_retraining(&self, signal: &LearningSignal) -> Result<TrainingJobId, LearningError>;
}
```

### 22.7 ModelResourceGovernor Trait (NEW)

```rust
pub trait ModelResourceGovernor: Send + Sync {
    fn acquire_quota(&self, tenant: TenantId, model_id: ModelId, request: &InferenceRequest) -> Result<QuotaGrant, ResourceError>;
    fn enforce_limits(&self, tenant: TenantId, model_id: ModelId) -> ResourceLimits;
    fn check_deadline(&self, deadline: DateTime<Utc>) -> Result<(), ResourceError>;
    fn report_usage(&self, tenant: TenantId, model_id: ModelId) -> ResourceUsage;
    fn is_overloaded(&self) -> bool;
}
```

### 22.8 AdaptiveSecurityCompute Trait (NEW)

```rust
pub trait AdaptiveSecurityCompute: Send + Sync {
    fn select_compute_level(&self, question: &SecurityQuestion, risk: RiskLevel, urgency: Urgency, budget: ResourceBudget) -> ComputeLevel;
    fn route_inference(&self, level: ComputeLevel, ir: &SecurityIR) -> Result<ModelOutput, InferenceError>;
}
```

### 22.9 DefenseGenomeStore Trait (NEW)

```rust
pub trait DefenseGenomeStore: Send + Sync {
    fn get_pattern(&self, pattern_id: PatternId) -> Result<DefensePattern, GenomeError>;
    fn compose(&self, patterns: &[PatternId]) -> Result<ComposedDefense, GenomeError>;
    fn validate_composition(&self, composition: &ComposedDefense) -> Result<bool, GenomeError>;
}
```

### 22.10 SecurityMemoryStore Trait (NEW)

```rust
pub trait SecurityMemoryStore: Send + Sync {
    fn store_decision(&self, twin: &DecisionTwin) -> Result<(), MemoryError>;
    fn store_outcome(&self, outcome: &OutcomeResult) -> Result<(), MemoryError>;
    fn store_signal(&self, signal: &LearningSignal) -> Result<(), MemoryError>;
    fn query_decisions(&self, tenant: TenantId, time_range: TimeRange) -> Result<Vec<DecisionTwin>, MemoryError>;
    fn compute_effectiveness(&self, tenant: TenantId, model_id: ModelId) -> Result<ModelMetrics, MemoryError>;
}
```

---

## 23. Threat Model Additions

### 23.1 Intelligence Plane Trust Domain

| Trust Domain | Current | Revised |
|---|---|---|
| Intelligence | Variable (deterministic trusted, ML/LLM untrusted) | Variable (deterministic models High, statistical models Medium, LLM adapter Untrusted) |

### 23.2 New Threats (12 Model-Specific)

See §9.1 for the full 12-model threat list. These map to the existing Intelligence domain trust level.

### 23.3 Boundary Crossing Checklist — Intelligence Extensions

When crossing from Intelligence → Security IR → Assurance → Policy → Authority Gate:

| Checkpoint | Verification |
|---|---|
| **Identity** | Model provenance (ML-DSA-87 signing key) |
| **Authorization** | Security IR references EVIDENCED state only (A1) |
| **Schema** | Security IR schema version validated by G0 |
| **Provenance** | ModelProvenance hash verified against Registry |
| **Validation** | G0-G4 deterministic verification |
| **Failure behavior** | Any failure → INDETERMINATE (never PASS) |

### 23.4 New Security Properties

| Property | Description |
|---|---|
| INTEL-1 | Model artifacts are integrity-protected (BLAKE3 + ML-DSA-87) |
| INTEL-2 | Model output is always mediated by typed Security IR |
| INTEL-3 | All model inference is time-bounded (hard timeout → INDETERMINATE) |
| INTEL-4 | Feature definitions are version-locked between training and serving |
| INTEL-5 | Model staleness is detected by config_hash binding (A4) |
| INTEL-6 | Uncertainty is explicitly represented, never implicit |
| INTEL-7 | No model can directly execute or mutate state |
| INTEL-8 | LLM adapter is disabled by default, sandboxed, and has deterministic fallback |
| INTEL-9 | Training data is anonymized and differentially private |
| INTEL-10 | Model supply chain is reproducible and SBOM-verified |

---

## 24. Test Contract Additions

### 24.1 New Test Contracts (Intelligence Plane)

| Test ID | Security Property | Threat | Precondition | Input | Operation | Expected Output |
|---|---|---|---|---|---|---|
| T-G0-IR-01 | INTEL-1 | M1 | Security IR created | Tampered IR hash | G0 validate IR | REJECT |
| T-G0-IR-02 | INTEL-2 | M3 | Model output | Prompt injection payload | G0 input integrity | REJECT |
| T-G0-IR-03 | INTEL-5 | M10 | Stale config | config_hash mismatch | G0 validate IR | REJECT (StaleConfig) |
| T-G1-IR-01 | INTEL-2 | M5 | Security IR | Valid IR from VGNN | G1 SMT verification | PASS |
| T-G2-IR-01 | INTEL-3 | M5 | Perturbation | Edge perturbation on graph | G2 robustness | Stability ≥85% |
| T-G2-IR-02 | INTEL-6 | M11 | Uncertainty | High confidence, adversarial input | G2 uncertainty check | DOWNGRADE to INDETERMINATE |
| T-G3-IR-01 | INTEL-2 | M5 | Non-degeneracy | Model output | G3 utility check | Non-degenerate claims |
| T-G4-IR-01 | INTEL-7 | M12 | Policy compliance | Security IR claims | G4 policy check | PASS or FAIL |
| T-MODEL-13 | INTEL-8 | M6 | LLM adapter | Injection prompt | VSC with LLM adapter | Deterministic fallback used |
| T-MODEL-14 | INTEL-9 | M3 | Data poisoning | Poisoned training sample | Foundry evaluation | Detected by outlier detection |
| T-MODEL-15 | INTEL-10 | M7 | Supply chain | Tampered dependency | Build verification | SBOM mismatch → REJECT |
| T-MODEL-16 | INTEL-3 | M5 | Timeout | Long inference | Resource Governor | Timeout → INDETERMINATE |
| T-MODEL-17 | INTEL-4 | M9 | Feature drift | Mismatched features | G0 feature check | REJECT (FeatureDrift) |
| T-MODEL-18 | INTEL-1 | M1 | Artifact tampering | Modified weights | G0 artifact check | REJECT (HashMismatch) |
| T-MODEL-19 | INTEL-7 | M12 | Output escaping | Model output with action | Security IR generation | Action wrapped in Security IR, not directly executable |

### 24.2 Test Contract Format

All new test contracts follow the format from `VARDHAN_TEST_CONTRACTS.md`:

```
Type: [G0|G1|G2|G3|G4|MODEL]
Security Property: [INTEL-1..10]
Threat ID: [M1..M12]
Invariants: [List of invariants]
Preconditions: [Conditions before test]
Input: [Test input]
Operation: [What is tested]
Expected output: [Expected result]
Expected state transition: [FSM state change]
Oracle: [How correctness is verified]
Determinism: [Deterministic | Seeded | Probabilistic]
Authorization: [Required authorization path]
Evidence: [Evidence category]
```

---

## 25. Deployment Architecture

### 25.1 Production Runtime Topology

```text
┌─────────────────────────────────────────────────────────────┐
│                    LOAD BALANCER / GATEWAY                  │
│                    (pq_shield — TLS/PQ termination)         │
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

### 25.2 Intelligence Plane Deployment

The Intelligence Plane (L05-L12) is deployed **inside the trust boundary**, after the State Boundary. It consists of:

| Component | Deployment | Isolation |
|---|---|---|
| **Model Runtime** | WASM sandbox per model | Process isolation, no network, no filesystem |
| **Feature Store** | Embedded in runtime, backed by Redis | Tenant-scoped |
| **Model Registry** | Read-only mount from Model Store | Signed artifacts only |
| **Adaptive Security Compute** | In-process scheduler | Deterministic decision tree |
| **Resource Governor** | Linux cgroups + WASM limits | Hard resource caps |
| **Security Memory** | Encrypted storage (AES-256-GCM) | Tenant-scoped |
| **Defense Genome** | Read-only mount | Versioned, signed |

### 25.3 Model Foundry (Air-Gapped)

```text
┌─────────────────────────────────────────────────────┐
│         MODEL FOUNDRY (Air-Gapped Network)         │
│                                                     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌────────┐ │
│  │ Training│  │ Eval    │  │ Security│  │ Signing│ │
│  │ Nodes   │  │ Harness │  │ Testing │  │ Service│ │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬───┘ │
│       │            │            │            │     │
│       ▼            ▼            ▼            ▼     │
│  ┌──────────────────────────────────────────────┐ │
│  │           Offline Model Registry             │ │
│  └──────────────────────────────────────────────┘ │
│       │                                          │
│       ▼                                          │
│  ┌──────────────────────────────────────────────┐ │
│  │           Model Promotion Gateway            │ │
│  │  (Physical media / PQ-AEAD secure channel)   │ │
│  └──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│         PRODUCTION TRUST BOUNDARY                  │
│  (No outbound network, signed artifacts only)     │
└─────────────────────────────────────────────────────┘
```

---

## 26. Canarying & Capacity Scaling

### 26.1 Canary Deployment Strategy

Each new model version follows an 8-stage canary:

1. **REGISTERED** — Artifact in Registry, not deployed
2. **EVALUATED** — G0-G4 + security tests passed
3. **APPROVED** — Signed for production
4. **CANARY** — 0% traffic, shadow mode (predictions logged, not used)
5. **VERIFIED** — 1% traffic, monitoring for degradation
6. **ACTIVE** — Full traffic
7. **DEPRECATED** — Shadowed by newer version, rollback path maintained
8. **REVOKED** — Signing key revoked, removed from all nodes

**Rollback criteria**: If any metric degrades by >10% at any canary stage, rollback to previous ACTIVE version. The rollback is automatic and deterministic.

### 26.2 Capacity Scaling

Scaling follows four levels, **without changing trust boundaries**:

| Level | Scale | Architecture | Trust Boundary Changes |
|---|---|---|---|
| **Small** | 1-3 nodes | Single region, single tenant type | None |
| **Medium** | 4-12 nodes | Multi-zone, multi-tenant | None |
| **Large** | 13-50 nodes | Multi-region, geo-distributed | None |
| **Global** | 50+ nodes | Multi-region, edge nodes, federated | None |

**Scaling mechanism**: The Intelligence Plane scales horizontally by adding model runtime instances. Each instance is a WASM sandbox with identical configuration. The Resource Governor distributes load via weighted round-robin. No trust boundary changes are required — the Security IR, G0-G4, and Authority Gate remain the same.

**Key constraint**: Scaling must not change any trust boundary. The Intelligence → Security IR → Assurance → Policy → Authority Gate → Execution pipeline is invariant regardless of scale.

---

## 27. Cost/Economic Architecture (VCU/PAYG)

### 27.1 VCU (Vardhan Compute Unit)

VCU is the abstract unit of intelligence compute cost. It abstracts away hardware differences (CPU vs GPU, instance type) into a single cost metric.

| Operation | VCU Cost |
|---|---|
| G0 input validation (deterministic rule) | 0.001 VCU |
| G1 SMT semantic check (simple) | 0.01 VCU |
| G1 SMT semantic check (complex) | 0.1 VCU |
| G2 perturbation robustness test | 0.05 VCU |
| G3 utility check | 0.005 VCU |
| G4 policy verification | 0.02 VCU |
| VPM inference (single prediction) | 0.5 VCU |
| VGNN inference (graph reasoning, 100 nodes) | 1.0 VCU |
| VSC compilation (NL→IR, LLM adapter) | 2.0 VCU |
| VSC compilation (NL→IR, deterministic fallback) | 0.3 VCU |
| VRM risk assessment (10K MC samples) | 3.0 VCU |
| VSG scenario generation (100 scenarios) | 5.0 VCU |
| VDS decision selection | 1.0 VCU |
| VOV outcome verification | 0.5 VCU |
| ASC compute level downgrade (5→4) | -1.0 VCU (credit) |
| ASC compute level upgrade (4→5) | +2.0 VCU (debit) |
| Model training (1 epoch, 1M params) | 1000 VCU |
| Model retraining (full pipeline) | 50000 VCU |

### 27.2 PAYG (Pay-As-You-Go) Pricing

Tenants are billed based on VCU consumption:

| Tier | Monthly VCU Budget | Price per VCU | Features |
|---|---|---|---|
| **Starter** | 1,000 VCU | $0.01/VCU | Basic anomaly detection |
| **Professional** | 10,000 VCU | $0.008/VCU | Full model family, basic canarying |
| **Enterprise** | 100,000 VCU | $0.005/VCU | All models, advanced canarying, custom Defense Genome |
| **Enterprise+** | 1,000,000 VCU | $0.003/VCU | Dedicated instances, full governance |

### 27.3 Cost Optimization via ASC

The Adaptive Security Compute scheduler optimizes cost by selecting the minimum compute level that satisfies the security requirement. For example:

- G0 validation: Always Level 0 (deterministic) — 0.001 VCU
- Low-risk anomaly: Level 2 (lightweight model) — 0.5 VCU
- High-risk decision: Level 4 (simulation) — 3.0 VCU + 5.0 VCU
- Maximum-risk: Level 5 (formal verification) — 0.1 VCU + 0.02 VCU

The cost difference between a Level 2 decision and a Level 5 decision is ~10×. ASC ensures high-risk decisions get appropriate scrutiny while low-risk decisions remain cheap.

### 27.4 Cost Attribution

Each DecisionTwin carries a `cost_attribution` field tracking VCU consumption. This is stored in Security Memory and used for:
- Tenant billing (PAYG)
- Budget alerts (when approaching tier limits)
- Optimization suggestions (ASC recommendations)
- Audit trail (evidence record of all compute costs)

---

## 28. Required Outputs Verification

### 28.1 All 28 Required Outputs

The following 28 outputs have been produced by this design document:

| # | Output | Section |
|---|---|---|
| 1 | Executive Architecture Summary | §1 |
| 2 | Existing vs. Missing Component Matrix | §2 |
| 3 | Model Family Map (7+ models) | §3 |
| 4 | Security IR Schema & FSM | §4 |
| 5 | Model-to-Model Contract Matrix | §5 |
| 6 | Research vs. Production Boundary Policy | §6 |
| 7 | Training Data Architecture | §7 |
| 8 | Synthetic Security Data Engine (SSDE) | §8 |
| 9 | Model Security Architecture (12 threats) | §9 |
| 10 | Model CI/CD Pipeline | §10 |
| 11 | AI Assurance Integration (G0-G4) | §11 |
| 12 | Continuous Learning Pipeline | §12 |
| 13 | Security Memory Architecture | §13 |
| 14 | Defense Genome Architecture | §14 |
| 15 | Decision Twin Intelligence Integration | §17 |
| 16 | Security Twin Architecture | §18 |
| 17 | Agent Architecture Decision (NO agents) | §19 |
| 18 | Model Resource Governor | §16 |
| 19 | Adaptive Security Compute Scheduler | §15 |
| 20 | Model Lifecycle & Versioning State Machines | §20 |
| 21 | Canonical Object Additions | §21 |
| 22 | New Trait/Interface Definitions | §22 |
| 23 | Threat Model Additions (12 threats, 10 properties) | §23 |
| 24 | Test Contract Additions (19 contracts) | §24 |
| 25 | Deployment Architecture | §25 |
| 26 | Canarying & Capacity Scaling | §26 |
| 27 | Cost/Economic Architecture (VCU/PAYG) | §27 |
| 28 | Research Roadmap & IP Portfolio | §30 |

All 28 required outputs are produced. All 31 sections are complete.

---

## 29. Implementation Dependency Graph

### 29.1 Crate Dependency Graph (Following System Map §29)

```
vardhan_model (L04)  [EXISTING]
     ↑
     ├── vardhan-evidence (L03)        [EXISTING — audit_ledger]
     │      ↑
     │      ├── audit_ledger (L03)     [EXISTING]
     │      ├── core_crypto (L01)      [EXISTING]
     │      └── ha_cluster (L02)       [EXISTING]
     │
     ├── vardhan-state (L04)           [EXISTING]
     │
     ├── vardhan-intelligence (L05)    [NEW — Model Family, Inference Engine, Feature Store]
     │      ↑
     │      ├── vardhan-model-foundry (RESEARCH)  [NEW — air-gapped]
     │      ├── vardhan-assurance (L06) [NEW — G0-G4, Security IR]
     │      └── vardhan-state (L04)     [EXISTING]
     │
     ├── vardhan-reasoning (L07)       [NEW — VGNN, VSC, Defense Genome]
     │      ↑
     │      ├── vardhan-intelligence (L05) [NEW]
     │      └── vardhan-state (L04)          [EXISTING]
     │
     ├── vardhan-risk (L08)            [NEW — VRM, VSG, Security Twin]
     │      ↑
     │      ├── vardhan-reasoning (L07) [NEW]
     │      └── vardhan-state (L04)       [EXISTING]
     │
     ├── vardhan-memory (L10)          [NEW — Security Memory, Decision Memory]
     │      ↑
     │      ├── vardhan-outcomes (L10)  [NEW — VOV, outcome verification]
     │      ├── vardhan-decision (L09)  [NEW — VDS, Decision Twin]
     │      └── vardhan-state (L04)     [EXISTING]
     │
     ├── vardhan-decision (L09)        [NEW — VDS, Decision Twin, Decision Engine]
     │      ↑
     │      ├── vardhan-assurance (L06)  [NEW]
     │      ├── vardhan-risk (L08)       [NEW]
     │      ├── vardhan-policy (L11)     [EXTENSION — needs implementation]
     │      └── vardhan-state (L04)      [EXISTING]
     │
     ├── vardhan-govern (L11)          [EXTENSION — Authority Gate]
     │      ↑
     │      ├── vardhan-decision (L09)   [NEW]
     │      ├── vardhan-execution (L11)  [EXTENSION — ActionExecutor]
     │      └── control-flow-firewall    [EXISTING — trait in Object Traits]
     │
     └── vardhan-api (L12)
            ↑
            ├── vardhan-memory (L12)    [NEW]
            ├── vardhan-decision (L09)   [NEW]
            ├── vardhan-state (L04)      [EXISTING]
            └── frontend (L12)           [EXISTING — quantum_tui]

External AI (OPTIONAL)
     ↓ (injected via ModelProvider trait, sandboxed, disabled by default)
vardhan-assurance (L06)
```

### 29.2 Implementation Order

**Phase 1 (Foundation)** — Required for all downstream work:
1. `vardhan-intelligence` (L05): ModelProvider trait implementation, WASM runtime, Feature Store trait
2. `vardhan-assurance` (L06): G0-G4 pipeline, Security IR schema, AssuranceEngine trait implementation

**Phase 2 (Core Intelligence)** — Required for decision support:
3. `vardhan-reasoning` (L07): VGNN, VSC, Defense Genome
4. `vardhan-risk` (L08): VRM, VSG, Security Twin
5. `vardhan-decision` (L09): VDS, Decision Twin implementation

**Phase 3 (Full Pipeline)** — Required for closed-loop operation:
6. `vardhan-outcomes` (L10): VOV, outcome verification
7. `vardhan-memory` (L12): Security Memory, Decision Memory
8. `vardhan-policy` (L11): Policy engine implementation
9. `vardhan-govern` (L11): Authority Gate implementation
10. `vardhan-execution` (L11): Action executor implementation

**Phase 4 (Research & CI/CD)** — Air-gapped, parallel:
11. `vardhan-model-foundry` (RESEARCH): Training, evaluation, signing
12. `vardhan-learning` (L12): Continuous learning orchestrator

**Phase 5 (Governance)** — Production hardening:
13. `vardhan-govern` extensions: Resource Governor, ASC scheduler, canarying
14. `vardhan-api` extensions: Intelligence plane API endpoints

### 29.3 Frozen Interfaces (Must Not Change)

The following interfaces are **frozen** by the Constitution and must not change during implementation:

1. `VardhanAuthorityGate::authorize_and_execute(action, authorization, idempotency_key)` (Object Traits §9)
2. `DecisionCandidate` struct schema (Canonical Spec §13.1) — MUST remain SPECULATIVE
3. `StateMachine<S>` trait (Object Traits §8.1)
4. `TenantScoped<T>` (Object Traits §8.2)
5. `TimeContext` (Object Traits §8.3)
6. `EvidenceCarrier` (Object Traits §8.4)
7. `Hashable` (Object Traits §8.5)
8. All state machine FSMs (State Machines doc §6.1–6.8)
9. All state transition rules (A6: candidate boundary, A1: state visibility)
10. All constitutional invariants (CONST-1 through CONST-8, A1–A9)

---

## 30. Research IP Portfolio

### 30.1 Vardhan-Differentiated IP

The following capabilities are **Vardhan-owned innovations** that differentiate the system:

| IP | Description | Patent Potential |
|---|---|---|
| **Security IR** | Typed, versioned, tenant-scoped intermediate representation bridging model output to deterministic assurance | High |
| **Adaptive Security Compute** | Risk-based compute level selection (deterministic → simulation → formal verification) | High |
| **Cell-Local Intelligence** | Each cluster cell runs its own models with cell-local state; no cross-cell model communication | Medium |
| **Proof-Carrying Defense** | Defense Genome patterns generate machine-checkable security claims | Medium |
| **Verified Defensive Memory** | Structured memory with integrity protection, not free-form LLM memory | Medium |
| **Bounded Autonomous Defense** | Bounded reasoning workers that can only produce speculative output, never execute | High |
| **Model Assurance via G0-G4** | Deterministic verification pipeline for ML model output | High |
| **Formal Vardhan IR** | The Security IR is the formal representation that enables G1 SMT verification | High |
| **Typed Security IR** | The security relevance of all model output is encoded in typed, verifiable claims | High |
| **Uncertainty-Aware Assurance** | Uncertainty is explicitly represented and validated by G2 | Medium |

### 30.2 Research Roadmap

**Near-term (6 months)**:
- Implement Phase 1 (Foundry + Assurance) and Phase 2 (Core Intelligence)
- Deploy 3 production models (VPM, VGNN, VDS) in shadow mode
- Begin Security Memory population from existing DecisionTwins

**Mid-term (12 months)**:
- Full model family (all 7+ models) in production
- Canary deployment pipeline operational
- Continuous learning loop closed (VOV → Learning Signal → Retraining trigger)
- Adaptive Security Compute scheduler deployed

**Long-term (24 months)**:
- Security Twin operational
- Defense Genome fully populated (25+ patterns)
- Formal verification (G4/SMT) operational for policy verification
- Model economics (VCU/PAYG) billing live
- Global scaling (50+ nodes) without trust boundary changes

### 30.3 Open Research Questions

1. **Formal verification complexity**: G4 SMT solving on large policy sets may be expensive. Research into incremental SMT solving and proof caching.
2. **Uncertainty calibration**: How to calibrate uncertainty for deterministic models (which by definition have no uncertainty) vs statistical models.
3. **Cross-model compositional reasoning**: How to verify claims that depend on chains of model output (e.g., VGNN → VRM → VSG).
4. **Concept drift detection**: Statistical methods for detecting concept drift in structured security data.
5. **Adversarial robustness bounds**: Formal bounds on model robustness under adversarial perturbation.

---

## 31. Smallest Coherent Architecture

### 31.1 Answer: The Minimum Viable Intelligence Fabric

The **smallest coherent Vardhan-owned intelligence architecture** consists of:

**Minimum Initial Components (must be built together):**

| Component | Purpose | Must-Have? |
|---|---|---|
| **VPM** (Vardhan Predictive Model) | Perceives anomalies from state snapshots | ✅ Core |
| **VGNN** (Vardhan Graph Neural Network) | Reasons over knowledge graph | ✅ Core |
| **VDS** (Vardhan Decision Selector) | Generates DecisionCandidates | ✅ Core |
| **Security IR Generator** | Compiles model output → typed Security IR | ✅ Core |
| **G0–G4 Assurance Engine** | Deterministic verification of Security IR | ✅ Core |
| **Model Registry** | Signed artifact storage and lookup | ✅ Core |
| **Feature Store** | Online feature computation from EVIDENCED state | ✅ Core |
| **WASM Runtime** | Sandboxed model execution | ✅ Core |
| **Model Resource Governor** | Resource limits on inference | ✅ Core |
| **Security Memory** | Structured archive of outcomes and signals | ✅ Core |
| **Continuous Learning Loop** | VOV → PredictionError → LearningSignal | ✅ Core |
| **Model Foundry** (air-gapped) | Training, evaluation, signing | ✅ Core |

**What is NOT needed initially:**

| Component | Deferral Rationale |
|---|---|
| **VSC** (Semantic Compiler) | Can start with pure VPL (no NL→VPL) |
| **VRM** (Risk Model) | Start with deterministic risk factors; statistical risk added later |
| **VSG** (Scenario Generator) | CSP solver is optional initially; use rule-based scenarios |
| **VOV** (Outcome Verifier) | Start with simple state diff; semantic verification added later |
| **VSC LLM adapter** | Disabled by default; not needed if using pure VPL |
| **Security Twin** | Can use Decision Twin context fields initially |
| **Defense Genome** | Start with hardcoded defensive patterns; Genome added later |
| **Adaptive Security Compute** | Start with fixed compute levels; ASC added later |
| **Advanced canary (multi-stage)** | Start with simple shadow→active; multi-stage added later |
| **VCU/PAYG billing** | Start with fixed cost model; per-VCU billing added later |

### 31.2 Future Expansion (Grows Without Rewrite)

The architecture is designed so that the following additions **do not require any rewrite**:

1. **Add VSC** → Plug into Model Registry, Feature Store, Assurance Engine. Security IR schema already accommodates semantic compilation output.
2. **Add VRM** → Implements `RiskModel` trait, feeds into `VDS` via Security IR. No changes to Decision Twin or Authority Gate.
3. **Add VSG** → Implements `ScenarioEngine` trait, feeds scenarios to VDS. No changes to core pipeline.
4. **Add VOV** → Enhances Security Memory with semantic verification. No changes to Decision Twin lifecycle.
5. **Add LLM adapter** → Isolated adapter in VSC, disabled by default. No changes to any trust boundary.
6. **Add Security Twin** → New object type referencing DecisionTwin. No changes to existing FSMs.
7. **Add Defense Genome** → New store, patterns referenced by ASC. No changes to core pipeline.
8. **Add Adaptive Security Compute** → Schedules existing models at different rigor levels. No new models needed.
9. **Add canary multi-stage** → Extension of Model Lifecycle FSM. No changes to other components.
10. **Scale globally** → Horizontal scaling of WASM runtimes. Trust boundaries unchanged.

### 31.3 What Interfaces Must Be Frozen First

Before any implementation begins, the following interfaces must be frozen and implemented as Rust traits:

1. **`SecurityIR` struct** — This is the central data structure that all models compile to and all assurance operates on. It must be stable before any model is implemented.
2. **`ModelProvider` trait** — Already specified in Object Traits §11. This defines how all models are called.
3. **`AssuranceEngine` trait** — Extended with G1-G4 methods (§22.4). This defines how all model output is verified.
4. **`VardhanAuthorityGate` trait** — Already fully specified in Object Traits §9. Frozen.
5. **`ModelRegistry` trait** — Defines how model artifacts are stored and verified (§22.1).
6. **`FeatureStore` trait** — Defines how features are computed and served (§22.2).
7. **`ModelResourceGovernor` trait** — Defines how resources are enforced (§22.7).

These 7 traits form the **frozen interface surface**. All model implementations, security IR generation, assurance checks, and execution gating flow through these interfaces. If these interfaces are correct, the system can grow without rewrite.

### 31.4 Dependency Order for Implementation

```text
Step 1: vardhan_state (EXISTING) → provides TenantScoped, TimeContext, state markers
Step 2: vardhan_model (EXISTING) → provides canonical objects
Step 3: Security IR struct (NEW, frozen) → the bridge type
Step 4: ModelProvider + InferenceEngine traits (frozen) → model interface
Step 5: vardhan-intelligence (NEW) → WASM runtime + Feature Store + 3 models (VPM, VGNN, VDS)
Step 6: vardhan-assurance (NEW) → G0-G4 + Security IR validation
Step 7: vardhan-decision (NEW) → Decision Twin + DecisionEngine
Step 8: vardhan-memory (NEW) → Security Memory + LearningSignal store
Step 9: vardhan-govern (EXTENSION) → Authority Gate implementation
Step 10: vardhan-model-foundry (RESEARCH, air-gapped) → training + evaluation
Step 11: Add VRM, VSG, VOV, VSC as extensions (no rewrite)
Step 12: Add Security Twin, Defense Genome, ASC as extensions (no rewrite)
```

**Key insight**: The Security IR is the single architectural pivot. By making the Security IR a frozen, well-specified type that all models compile to and all assurance operates on, the system can evolve its model set, assurance logic, and optimization strategies independently. The 3-model initial set (VPM for perception, VGNN for reasoning, VDS for decision generation) provides complete closed-loop functionality: perceive state, reason about it, generate candidates, verify via G0-G4, route through Authority Gate, observe outcome, learn.

---

## 32. Existing First-Draft Sections (Preserved)

The following content from the first draft is preserved and referenced by the sections above:

- **Model Family detailed specs** (§3.2) — All 7 original models retain their full specifications: VGNN (graph attention network, 3 layers, 64-dim), VRM (hybrid: stats + seeded Monte Carlo 10K samples), VSG (CSP solver + symbolic generation), VPM (ARIMA + Isolation Forest, 10K RNG), VSC (PEG parser + Z3 SMT), VDS (multi-objective optimizer, 5 criteria), VOV (state diff + semantic equivalence). All deterministic at inference, all with G1-G3 relevance specified.
- **Model Foundry diagram** (§3.1, original §3.1) — Air-gapped architecture with Data Lake → Feature Store → Training Orchestrator → Evaluation Harness → Security Testing → Model Registry → Promotion Gateway.
- **Production Runtime** — WASM sandbox architecture with model loading, feature serving, Security IR generation, and G0-G4 routing.
- **Original test contracts T-MODEL-01 through T-MODEL-12** — Preserved and extended with T-MODEL-13 through T-MODEL-19 in §24.
- **Original canonical objects list** — 14 objects from first draft are integrated into §21.

*End of Document*
