# 05 — Missing Components

**Status:** Complete
**Date:** 2026-08-07

---

## 1. Required vs. Present Inventory

Per the approved final architecture, twelve components are required. Greenfield state:
**zero present**. Full inventory of what must be built, with the milestone that creates it.

| # | Component | Required capability | Present | Built in |
|---|-----------|--------------------|---------|----------|
| 1 | ZK Proof Engine | circom compile pipeline, R1CS/WASM generation, Groth16 prove, key generation, PTau handling | NO | M1 |
| 2 | Witness Generator | circuit-specific witness computation from public+private inputs | NO | M2 |
| 3 | Proof Verifier | offline verification + on-chain verifier generation | NO | M3 |
| 4 | Smart Contracts | Groth16 verifier contract + registry contract | NO | M4 |
| 5 | Blockchain Registry | append-only on-chain proof ledger, event log, status model | NO | M4 |
| 6 | Backend API | REST API over engine+registry, schema validation, rate limits | NO | M5 |
| 7 | Developer CLI | `zk` commands: new, prove, verify, deploy, status | NO | M6 |
| 8 | GitHub Action | composite action `zk-verify` wrapping CLI | NO | M7 |
| 9 | CI/CD Gatekeeper | branch-protection-style gate: proof required before merge/deploy | NO | M8 |
| 10 | Dashboard | proof explorer, circuit health, registry viewer | NO | M9 |
| 11 | Documentation | user guides, API reference, security model, architecture | NO | M10 |
| 12 | End-to-End Tests | full journey prove→verify→deploy→registry→API→dashboard | NO | M11 |

## 2. Shared/Cross-Cutting Gaps (blocked by nothing, unblock everything)

| Gap | Detail |
|-----|--------|
| Monorepo scaffolding | npm workspaces, TS strict, lint/typecheck/build per package |
| Proof format package | versioned serialization + hashing used by engine, API, contracts, CLI |
| Circuit library | at least 2 production circuits (gatekeeper-flavored): `poseidon-preimage` (teaching) and `merkle-inclusion` (registry use case), certified pairs with committed hashes. (The originally named `sha256-preimage` was superseded — see ADR-0008 amendment 1, docs/13 §3.) |
| Test strategy | Vitest for TS, Foundry for Solidity, Playwright for dashboard, shell-based CLI tests |
| Reproducibility | PTau checksums, pinned toolchain versions, lockfile committed |

## 3. Gaps That Are *Intentional Deferrals* (see 03 §5)

- Community trusted-setup ceremony (DEBT-1)
- Multi-chain support (DEBT-2)
- Recursive proofs (DEBT-3)
- KMS-backed signing (DEBT-4)

## 4. Approval Ask

Confirm the two circuits in §2 (`poseidon-preimage`, `merkle-inclusion`, per
ADR-0008 amendment 1) as the v1 circuit set, or name alternatives before
Milestone 1 begins. (Resolution 2026-08-09: v1 is finalized as
`poseidon-preimage@1`, `merkle-inclusion@1`; implementation consistent with
docs/09.)