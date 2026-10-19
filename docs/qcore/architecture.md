# Vardhan Q Core — Architecture

**Pillar:** Vardhan Q Core
**Tagline:** BE DIFFERENT

## Purpose

**VERIFY → PROTECT → GOVERN → AUTHORIZE → EXECUTE → PROVE**

Q Core is the trusted security control plane. It receives verified intelligence
from Vardhan Intelligence and controls what may happen next.

## Core Principle

> Intelligence may discover. Only Q Core may authorize trusted execution.

## Architecture

```
VerifiedFindingContract
        ↓
   [TRUST BOUNDARY]
   22-check validator
        ↓
   Q-Core Gateway
   (vardhan-receipt)
        ↓
   [AUTHORITY]
   GatewayAuthorityEvaluator
   (config-driven RBAC)
        ↓
   [POLICY ENGINE]
   PolicyRegistry / TenantRegistry
   (externalized from JSON config)
        ↓
   [TRANSACTION ENGINE]
   VardhanTransaction state machine
        ↓
   [CRYPTOGRAPHIC PROTECTION]
   PQ/Hybrid signing (ML-DSA-87 + Ed25519)
        ↓
   [INDUSTRY PLANE]
   7 industry execution planes
        ↓
   [TRANSACTION STATE MACHINE]
   Requested → Validating → AuthorityEvaluation → Authorized → Executing → Executed → OutcomeRecorded → Receipted
        ↓
   [SECURE EXECUTION]
   Signed Receipt
        ↓
   [AUDIT]
   Ledger (append-only)
        ↓
   [INDEPENDENT VERIFICATION]
   VardhanVerifier
```

## Components

| Component | Crate/Bin | Language | Purpose |
|---|---|---|---|
| Q-Core Gateway | `vardhan_receipt` (bin `vardhan-receipt`) | Rust | HTTP ingress at `/api/v1/seal`, runs trust boundary + authority |
| Transaction Engine | `vardhan_transaction` | Rust | State machine: 10 allowed transitions, terminal states enforced |
| Trust Validator | `trust_boundary.rs` | Rust | 22-check contract validation |
| Authority Engine | `authority_gate` | Rust | RBAC, tenant isolation, actor authorization |
| Policy Engine | `policy_authority.rs` | Rust | Config-driven policy evaluation |
| Receipt Sealer | `VardhanSealedReceipt` | Rust | ML-DSA-87 + Ed25519 dual signature |
| Ledger | `audit_ledger`, `ledger_sync` | Rust | Append-only JSONL + Merkle ledger |
| Verifier | `vardhan_verifier`, `verifier` | Rust | Independent receipt re-verification |
| Idempotency | `vardhan_idempotency` | Rust | Persistent idempotency (file-backed) |
| Enterprise | `enterprise_tenant` | Rust | Enterprise control plane, RBAC |
| HA Cluster | `ha_cluster` | Rust | Raft-based HA |

## Security Boundaries

### Trust Boundary (22 checks)

1. Schema version valid
2. Finding ID present
3. Organization ID present
4. Canonical URL present
5. Evidence refs non-empty
6. Evidence resolvable
7. Temporal status current
8. Not a context artifact
9. Content hash matches (full SHA-256)
10. Contradictory evidence IDs explicit
11. Differential state is CONFIRMED_MISMATCH
12. Materiality is HIGH/MEDIUM/LOW
13. Provenance chain complete
14. Authorization context present
15. Engine ID present
16. Canonical domain present
17. Entry point ID present
18. Evidence origin specified
19. Observation IDs present
20. Verification contract ID present
21. Decision candidate authorized (action whitelist)
22. Policy reference registered (config-driven)

### Transaction State Machine

```
Requested → Validating → AuthorityEvaluation → Authorized → Executing → Executed → OutcomeRecorded → Receipted
                    ↓               ↓               ↓           ↓          ↓
                  ValidationFailed  Rejected      Failed
```

All transitions enforced through `transition()`. `reject()` routes through
`transition()` — no bypass.

### Canonical Payload (10 fields, F-014)

`canonical_payload()` covers:
1. `tenant_id`
2. `transaction_id`
3. `proposed_action`
4. `policy_id`
5. `policy_version`
6. `state_hash_at_decision`
7. `evidence_commitments` (canonical, sorted)
8. `authority_reference`
9. `decision`
10. `outcome_code`

## Industry Planes

Q Core hosts 7 industry execution planes:
1. Banking / Financial Services
2. Healthcare
3. Government / Public Sector
4. Telecom
5. Energy / Critical Infrastructure
6. Insurance
7. Education / Research

Each plane uses Common Q Core services. None duplicates cryptographic
primitives, state machine, trust boundary, receipt signing, or ledger.
