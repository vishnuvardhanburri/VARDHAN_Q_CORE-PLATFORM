# 12 — Cryptographic Design Review (CRD)

**Status:** Part A complete (design freeze recorded, ADR-0008); Part B in progress
(measurement gates at M3, M4, M11)
**Date:** 2026-08-07

---

## 1. Purpose & Placement

The Cryptographic Design Review is the **mandatory gate between architecture acceptance
and implementation of any crypto code** (roadmap `07`, row CRD). It freezes the
cryptographic decisions that everything else must obey, defines how they will be
*measured*, and records the trust assumptions with sign-off. It is reopened whenever a
frozen decision is proposed to change.

## 2. Inputs (normative documents)

| Doc | Subject |
|-----|---------|
| 02 — Architecture Review | system context & trust boundaries |
| 04 — Security Review | threat model T1–T10 |
| 08 — Proving Systems Comparison | Groth16 vs PLONK vs Halo2 rationale |
| 09 — Proof Specification | relation, guarantees G1–G5, trust assumptions |
| 10 — Circuit Interface Design | VCI contract |
| 11 — Performance Targets | numbers to be measured |
| ADR-0002 / 0003 / 0006 / 0007 | scheme, setup, format, interface |

## 3. Part A — Design Freeze (complete)

### A1. Frozen decisions (recorded in ADR-0008)

1. Scheme: **Groth16 on BN254** (`groth16`, curve `bn254`) for v1 circuits.
2. Setup: two regimes per ADR-0003 (dev weak-PTau 2<sup>12</sup>; prod community ceremony).
3. Format: `proof-format` envelope v1 (ADR-0006) — scheme-agnostic, keccak256-based.
4. Registry: append-only; status keyed on `(circuitId, publicInputHash)`, leaf
   `= keccak256(abi.encode(circuitId, vkHash, publicInputs, a, b, c))`, where
   `publicInputHash = keccak256(abi.encode(publicInputs))` (ADR-0008, 09 §6).
5. Circuit evolution: VCI per ADR-0007/10.
6. Performance targets: doc `11` (budgets fixed; measurement pending).
7. Hash functions: keccak256 (envelope/registry), SHA-256 (artifacts), Poseidon inside
   circuits (M1/M2 circuits).
8. v1 circuit set: `poseidon-preimage@1`, `merkle-inclusion@1` (ADR-0008
   amendment 1; `sha256-preimage` deferred to a future capability — see docs/13 §3).

### A2. Trust-assumption sign-off (from 09 §4)

| Assumption | Status | Owner |
|------------|--------|-------|
| T-SETUP honest ceremony (≥1 honest party) | Accepted — dev/prod separation enforced | Architect |
| T-VK vkHash authenticity via allow-lists | Accepted — gatekeeper + contracts | Architect |
| T-PT PTau checksums | Accepted — engine check in M1 | Architect |
| T-ENG pinned, source-compiled toolchain | Accepted — CI in M1 | Architect |
| T-RAND CSPRNG | Accepted — Node crypto; ops runbook M10 | Architect |
| T-PRIV private inputs stay on prover | Accepted — API boundary (ADR-0005) | Architect |

### A3. Threat-model re-evaluation (from 04)

Re-reviewed T1–T10 against the frozen design; no new threats introduced by the freeze.
T6 (setup poisoning) and T1 (artifact substitution) remain the highest-severity items and
have explicit mitigations scheduled at M1 and M4 gates.

## 4. Part B — Measurement Program (tracked at milestone gates)

| # | Measurement | Target doc | Gate |
|---|-------------|-----------|------|
| B1 | Benchmark harness spec (fixtures, method, hardware) | `11` §1–§2 | defined now; harness lands M1, baseline reported M3 |
| B2 | Offline verify baseline both circuits | `11` §2 | M3 gate |
| B3 | On-chain gas snapshot (Verifier.sol + registry) | `11` §3 | M4 gate |
| B4 | Witness/prove timings on ubuntu-latest | `11` §1 | M11 gate |
| B5 | Cross-check local vs on-chain verifier agreement | `09` §7 | M4 gate |
| B6 | Degradation flag on `circuitVersion` bumps | `11` §5 | gatekeeper (M8) |

## 5. Reopening Procedure

Any proposed change to Part A items opens a CRD re-review: new ADR, updated threat
model, re-benchmark of affected targets, and the gate restarts from Part A2.

## 6. Gate Checklist (used at review completion)

- [x] A1 decisions recorded as ADR-0008
- [x] A2 trust assumptions signed off
- [x] A3 threat model re-evaluated
- [x] B1 harness spec defined
- [x] Benchmark budgets documented (11)
- [x] Reviewer: Principal Architect — Vishnu (owner)