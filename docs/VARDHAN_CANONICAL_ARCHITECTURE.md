# VARDHAN PLATFORM — CANONICAL ARCHITECTURE

> **Engineering standard:** Think in decades. Implement one verified layer at a time.

---

## Status Legend

| Status | Meaning |
|---|---|
| ✅ IMPLEMENTED | Working code, tested, verified |
| 🔶 PARTIAL | Architecture exists, some parts stub/incomplete |
| 📐 DESIGNED | Specified but not yet implemented |
| ⚠️ GAP | Claimed or needed but not present |

---

## 1. Company Architecture

VARDHAN is the umbrella. Three deliberately distinct business systems exist under it. They must **not** be collapsed into a single product.

```
VARDHAN
├── VARDHAN INTELLIGENCE     — discover and establish real technical problems from evidence
├── VARDHAN TECH SOLUTIONS   — solve verified technical problems
└── VARDHAN QUANTUM          — high-assurance trust infrastructure
    └── Q-CORE               — cryptographic/proof/execution substrate
```

---

## 2. VARDHAN INTELLIGENCE

**Purpose:** Discover and establish real technical problems from evidence.

**Credibility rule (hard invariant):**
```
PROBLEM EXISTS → EVIDENCE → VERIFICATION → FINDING → ONLY THEN COMMERCIAL OPPORTUNITY
```

**Core flow:**
```
DISCOVER → UNDERSTAND → OBSERVE → COMPARE → REASON → VERIFY → FINDING
```

**Boundary rules:**
- Intelligence must never manufacture problems to create work for Tech Solutions.
- A Q-Core acceptance must **never** automatically make a Finding "verified." *(Invariant #11)*
- Intelligence owns intelligence semantics entirely.
- Intelligence must not directly depend on private Rust Q-Core internals. *(Invariant #17)*

**Current status:** ✅ IMPLEMENTED (core research and verification engines)

**Integration boundary with Q-Core:** ✅ IMPLEMENTED
- Schema: `QCoreValidationRequest` → `QCoreReceipt`
- Transport: JSON over STDIN/STDOUT to the compiled `vardhan-receipt` binary
- Location: `intelligence_plane/src/server/integration/QCoreAdapter.ts`

> [!IMPORTANT]
> Intelligence submitting a Finding to Q-Core does NOT verify the finding semantically.
> Q-Core validates schema, tenant, provenance, authority, and policy only.
> Intelligence remains responsible for the truth of the finding.

---

## 3. VARDHAN TECH SOLUTIONS

**Purpose:** Solve verified technical problems.

**Core flow:**
```
FINDING → DIAGNOSTIC → ROOT CAUSE → IMPLEMENTATION → MEASURED OUTCOME
```

**Boundary rules:**
- Must not weaken the evidence standards of Vardhan Intelligence.
- Operates on verified findings only — not on raw signals.

**Current status:** 📐 DESIGNED (architecture defined; not yet implemented as a separate system)

---

## 4. VARDHAN QUANTUM

**Purpose:** High-assurance trust infrastructure for environments requiring:
identity, state, evidence, policy, authority, decisions, transactions, execution, outcomes, proof, auditability, cryptographic integrity, and operational trust.

**Defining characteristic:** The **requirement for high assurance** — not company size.

**Quantum is its own category.** It is NOT "Vardhan Intelligence for bigger companies."

**Current status:** 🔶 PARTIAL (Q-Core substrate implemented; Transaction/Receipt model strengthening in progress)

---

## 5. VARDHAN Q-CORE — The Trust Substrate

Q-Core is the trusted execution substrate underneath Vardhan Quantum.

**Conceptual assurance chain:**
```
IDENTITY
  → VERIFIED STATE
  → EVIDENCE
  → POLICY
  → AUTHORITY
  → DECISION
  → TRANSACTION
  → EXECUTION
  → OUTCOME
  → CRYPTOGRAPHIC RECEIPT / PROOF
```

**Security model:** AI/LLM output may become an **input** to a governed decision. It is NOT authority. It is NOT proof. It is NOT automatically verified evidence. *(Invariants #9, #10)*

---

## 6. Transaction Lifecycle ✅ IMPLEMENTED

**Location:** `backend/vardhan_transaction/src/lib.rs`

A Transaction is a **consequential governed operation.** It is NOT a Receipt.

```
REQUESTED
  → VALIDATING
    → AUTHORITY_EVALUATION
      → AUTHORIZED   ── (happy path)
      → REJECTED     ── (policy/authority denied — terminal)
    → VALIDATION_FAILED ── (terminal — malformed, tenant mismatch, replay)
  → EXECUTING
    → EXECUTED       ── (success)
    → FAILED         ── (execution error — terminal)
  → OUTCOME_RECORDED
  → RECEIPTED        ── (terminal success — Receipt sealed)
```

**Key properties enforced:**
- Terminal states: `ValidationFailed`, `Rejected`, `Failed`, `Receipted`
- Invalid transitions return `Err` — the transaction state is never corrupted
- Tenant ID is set at creation and never mutated
- Policy version is set at creation — historical decisions are immutable *(Invariant #7)*
- `idempotency_key` field exists for replay protection *(Invariant #19)*
- Every transaction has a UUID v4 `transaction_id` — no static IDs *(Invariant #14)*
- `correlation_id` supports cross-system transaction linking

**TransactionKind variants:** `PrivilegedAccessChange`, `SecurityPolicyChange`, `InfrastructureDeployment`, `ConfigurationChange`, `DatabaseOperation`, `KeyRotation`, `WorkloadMigration`, `AutomatedAuthorization`, `AiAgentAction`, `IncidentResponseAction`, `ComplianceDecision`, `ActiveDefenseAction`, `IntelligenceFindingSealing`, `Custom(String)`

---

## 7. The Vardhan Receipt ✅ PARTIALLY IMPLEMENTED

> **The central distinction:** Transaction = what happened. Receipt = verifiable proof of what happened and the authority/evidence/state chain behind it.

A Receipt is a **cryptographic attestation** around a completed Transaction lifecycle.

**Canonical Receipt fields (target model):**

| Field | Status | Notes |
|---|---|---|
| `receipt_id` | ✅ UUID v4 | Fixed — was timestamp-based (collision risk) |
| `transaction_id` | 📐 DESIGNED | Links Receipt to Transaction |
| `tenant_id` | ✅ IMPLEMENTED | Present in QCoreReceipt |
| `finding_id` / `subject_id` | ✅ IMPLEMENTED | |
| `actor_identity` | ✅ IMPLEMENTED | Via provenance |
| `authority_reference` | 🔶 PARTIAL | Present in AuthorityGate but not in Receipt |
| `policy_id` + `policy_version` | 📐 DESIGNED | In Transaction, not yet in Receipt |
| `state_hash` | 🔶 PARTIAL | `state_hash_at_decision` in Transaction |
| `evidence_references` | 🔶 PARTIAL | `evidence_refs` in Transaction |
| `signatures.ed25519` | ✅ IMPLEMENTED | Real Ed25519 signing |
| `signatures.ml_dsa_87` | ✅ IMPLEMENTED | Real ML-DSA-87 (FIPS 204) signing |
| `ledger_commit_index` | ✅ IMPLEMENTED | |
| `schema_version` | 📐 DESIGNED | Needed for cryptographic algorithm agility |
| `issuer_identity` | 📐 DESIGNED | Needed for independent verification |
| `parent_receipt_reference` | 📐 DESIGNED | For chained receipts |

> [!NOTE]
> **IMPORTANT:** Receipt must not be conflated with Audit Log. The Audit Ledger (`backend/audit_ledger`) records all events. The Receipt is a specific cryptographic commitment about a completed Transaction lifecycle.

---

## 8. Evidence Model 🔶 PARTIAL

Every evidence object must have:
- `source_identity` — who/what produced it
- `acquisition_context` — how it was collected
- `timestamp` — when it was observed
- `content` / `reference` — the actual data or a hash commitment
- `integrity_information` — hash to detect tampering
- `provenance` — chain back to original source
- `tenant_id` — tenant scoping
- `schema_version` — for future evolution

**Evidence states must be explicitly distinct:**
```
OBSERVED → SUPPORTED → VALIDATED → VERIFIED
```

**Current status:**
- ✅ `EvidenceRecord` with BLAKE3 canonical hash exists in `backend/vardhan_state/src/evidence.rs`
- ✅ Deterministic canonical serialization implemented
- 📐 OBSERVED/SUPPORTED/VALIDATED/VERIFIED state distinction not yet explicit in code

> [!IMPORTANT]
> Evidence entering Q-Core is NOT automatically "verified." Q-Core validates structural integrity only. Intelligence owns semantic truth. *(Invariant #2, #3, #11)*

---

## 9. Authority Model 🔶 PARTIAL

**Location:** `backend/authority_gate/src/lib.rs`

**Identity ≠ Authority** *(Invariant #1)*

Knowing who an actor is does not mean they are authorized to perform an operation.

Authority evaluation considers: subject, actor, resource, requested action, policy, context, tenant, time, constraints.

**Current implementation:**
- ✅ `VardhanGate` and `SystemicAuthorityGate` traits
- ✅ Tenant mismatch returns `Err` (hard failure)
- ✅ Receipt IDs now UUID v4 (was static hardcoded — fixed)
- ✅ Configuration hash binding (prevents stale-config actions)
- 📐 Full RBAC (roles, delegated authority, revocation) — not yet implemented
- 📐 Explicit `actor_identity` vs `subject_id` distinction in authority evaluation

---

## 10. Policy Model 🔶 PARTIAL

**Policies must be versioned.** *(Invariant #6)*

A Receipt must identify the policy and version that governed the decision.

A later policy update must **never** silently rewrite historical decisions.

**Current status:**
- ✅ `policy_id` and `policy_version` fields exist in `VardhanTransaction`
- ✅ Policy version is set at Transaction creation and immutable
- 📐 Policy versioning registry — not yet implemented as a standalone module
- 📐 Historical policy version lookup for Receipt verification — not yet implemented

---

## 11. Decision Twin 🔶 PARTIAL

**Location:** `backend/decision_twin/src/lib.rs`

The Decision Twin represents the decision context and allows reconstruction of:
relevant state, evidence, policy, authority, candidate decision, final decision, execution, outcome.

**NOT** a second source of truth — a reconstruction aid only.

**Current status:**
- ✅ `TwinState` state machine (Created → AssurancePending → Authorized → Executing → Executed → Expired/Cancelled/Failed)
- ✅ `created_at` now uses real wall clock (was `0` — fixed)
- ✅ `authorization_id` now UUID v4 (was fake `auth-{candidate_id}` — fixed)
- 📐 Relationship between `DecisionTwin` and `VardhanTransaction` not yet formalized
- 📐 DecisionTwin should be subordinate to Transaction, not independent

---

## 12. Audit Ledger ✅ IMPLEMENTED

**Location:** `backend/audit_ledger/src/`

**The Audit Ledger is NOT a Receipt. It is NOT a Transaction.**

```
TRANSACTION
  → EVENTS / STATE CHANGES
  → AUDIT LEDGER    (append-only, Merkle-chained)
  → RECEIPT         (cryptographic commitment)
  → VERIFICATION
```

**Current status:**
- ✅ `LedgerWriter` with Merkle hash chaining
- ✅ Torn-write recovery
- ✅ Tamper detection
- ✅ `SegmentedLedgerWriter` and `CheckpointWriter`
- ✅ Comprehensive unit tests
- This is the strongest module in the current codebase — **preserve it.**

---

## 13. Cryptography / PQC ✅ IMPLEMENTED

**Location:** `backend/core_crypto/src/` and `backend/vardhan_receipt/src/main.rs`

| Primitive | Algorithm | Status |
|---|---|---|
| Post-Quantum Signature | ML-DSA-87 (NIST FIPS 204) | ✅ Real signing |
| Classical Signature | Ed25519 | ✅ Real signing |
| Hash/Commitment | BLAKE3 | ✅ Real |
| Symmetric Encryption | AES-256-GCM | ✅ Real |
| Key Derivation | HKDF | ✅ Real |
| Anti-Tamper | BLAKE3 binary self-hash + debugger detection | ✅ Real |

**Algorithm agility (needed for long-horizon):** 📐 DESIGNED
- Receipt format should include `algorithm_id` and `key_version` so historical receipts remain verifiable when algorithms evolve

> [!WARNING]
> Do NOT claim cryptographic guarantees beyond what the implementation demonstrates. ML-DSA-87 keys are ephemeral per-call (not persisted). Key rotation mechanism not yet implemented.

---

## 14. Tenant Isolation ✅ IMPLEMENTED

- `TenantScopedObject` trait enforced at compile time
- Tenant mismatch in `authority_gate` returns `Err` — hard failure *(Invariant #8)*
- Tenant ID propagated through: Transaction, Evidence refs, Receipt, Q-Core validation
- 📐 Cross-tenant query protection at database/persistence layer — not yet verified

---

## 15. HA / Raft ✅ IMPLEMENTED (separate concern)

**Location:** `backend/ha_cluster/src/`

- Raft-based consensus for cluster state
- Transaction ordering via Raft log
- 📐 Receipt ordering relative to Raft commit index — relationship not yet formalized

---

## 16. Intelligence → Q-Core Contract ✅ IMPLEMENTED

**Schema:** `QCoreValidationRequest` → `QCoreReceipt`

**Transport:** JSON over STDIN/STDOUT

**Integration tests:** 5 tests (happy path + 4 negative cases) — all passing

**Validated at boundary:**
- Schema structural integrity
- Tenant ID (non-null, non-zero UUID)
- Provenance timestamp (non-empty)
- Action type against authority gate

---

## 17. Architectural Invariants — Current Enforcement Status

| # | Invariant | Status |
|---|---|---|
| 1 | Identity ≠ Authority | 🔶 PARTIAL |
| 2 | Evidence ≠ Finding | 🔶 PARTIAL |
| 3 | Finding ≠ Verified Finding | 🔶 PARTIAL |
| 4 | Transaction ≠ Receipt | ✅ ENFORCED |
| 5 | Receipt ≠ Audit Log | ✅ ENFORCED |
| 6 | Policy must be versioned | ✅ ENFORCED (in Transaction) |
| 7 | Historical decisions not rewritten | ✅ ENFORCED (policy_version immutable) |
| 8 | Tenant boundaries mandatory | ✅ ENFORCED (hard Err) |
| 9 | AI output is not authority | ✅ ENFORCED (architecture boundary) |
| 10 | AI output is not evidence | ✅ ENFORCED (architecture boundary) |
| 11 | Q-Core acceptance ≠ finding verified | ✅ ENFORCED (code + docs) |
| 12 | Every consequential action traceable | 🔶 PARTIAL |
| 13 | Every Receipt has uniqueness strategy | ✅ ENFORCED (UUID v4) |
| 14 | No static/fake receipt IDs | ✅ ENFORCED (fixed) |
| 15 | No unsupported cryptographic claims | ✅ ENFORCED |
| 16 | No hidden cross-tenant state | ✅ ENFORCED |
| 17 | No direct Intelligence coupling to Q-Core internals | ✅ ENFORCED |
| 18 | Active defense requires policy/authority | ✅ ENFORCED |
| 19 | Critical transactions require replay protection | 🔶 PARTIAL (field exists, not enforced) |
| 20 | Every source of truth explicitly identified | 🔶 PARTIAL |

---

## 18. Known Limitations (Honest)

1. **Ephemeral signing keys:** ML-DSA-87 and Ed25519 keys are generated per-call. A Receipt cannot be cryptographically re-verified independently after the fact because the key is gone. **Fix needed:** persistent key identity and key version in Receipt.

2. **Idempotency not enforced at runtime:** `idempotency_key` field exists in Transaction but there is no store that rejects duplicate keys at runtime. **Fix needed:** idempotency registry.

3. **Independent verification incomplete:** A verifier cannot currently reconstruct all fields (policy version, state hash, evidence hashes) from a Receipt alone. **Fix needed:** Receipt must embed or reference all decision inputs.

4. **Decision Twin and Transaction are separate, not linked:** `DecisionTwin` and `VardhanTransaction` are independent modules. The Twin should be subordinate to the Transaction.

5. **TypeScript test suite fragmented:** Many Intelligence Plane tests use old `process.exit()` pattern incompatible with Vitest. Needs systematic migration.

6. **`Sovereign` branding in ZKSyncAgent:** `SovereignComplianceCircuit` naming is legacy. Not renamed yet — inventory complete, migration pending.

---

## 19. Next Implementation Sequence

```
Stage 2 (current):  Transaction abstraction          ✅ DONE
Stage 3:            Persistent signing key identity  📐 Next
Stage 4:            Idempotency registry             📐 Next
Stage 5:            Receipt ↔ Transaction linkage    📐 Next
Stage 6:            Sovereign→Vardhan rename (ZK)    📐 Next
Stage 7:            TypeScript test migration         📐 Next
Stage 8:            Independent Receipt verification  📐 Next
```

---

*Architecture document version: 1.0 — October 2026*
*Implements: Vardhan Architecture Specification (32-point)*
*Status: Living document — updated with each implementation stage*
