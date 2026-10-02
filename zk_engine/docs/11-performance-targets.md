# 11 — Performance Targets

**Status:** Complete (revision per architecture review)
**Date:** 2026-08-07

Normative targets. Measured in the Cryptographic Design Review benchmark suite (M–1) and
re-asserted per milestone gate. Environment for reference numbers:

- Hardware: Apple Silicon M2-class (2026 baseline) / GitHub-hosted `ubuntu-latest`
  runner; single core unless noted.
- Node 20 LTS, snarkjs 0.7.x, circom_witnesscalc 1.x.
- Reference circuits (implemented v1 set): `poseidon-preimage@1`
  (240 constraints, Poseidon-2 preimage) and `merkle-inclusion@1`
  (974 constraints, height-4 Poseidon-2 Merkle membership).

---

## 1. Proving Performance

| Metric | Target | Measure method |
|--------|--------|----------------|
| poseidon-preimage witness generation | **< 100 ms** | witnesscalc timer |
| poseidon-preimage full prove (Groth16) | **< 1.0 s** | snarkjs `prove` wall |
| merkle-inclusion witness generation | **< 250 ms** | same |
| merkle-inclusion full prove | **< 3.0 s** | same |
| key-generation (dev zkey, per CI) | **< 60 s**, cached | setup artifact cache |
| PTau dev load + hash verify | **< 5 s** | engine `--check-ptau` |

## 2. Verification Performance

| Metric | Target |
|--------|--------|
| Offline verify (snarkjs, any v1 circuit) | **< 500 ms** |
| On-chain Groth16 verify (Verifier.sol) | **≤ 250 k gas** |
| Registry `registerProof` (verify + store) | **≤ 350 k gas** total |
| Gatekeeper verify (API read of on-chain status) | **< 1 s** p95 |

## 3. On-Chain Cost Budget (gas)

| Operation | Budget (gas) |
|-----------|--------------|
| Verifier.sol (Groth16, BN254 pairing) | ≤ 210 k |
| `registerProof` (that happens the verifier, event + storage) | ≤ 350 k |
| `getProofStatus` (read) | ≤ 20 k |
| Gatekeeper check (registry query) | ≤ 30 k |

Rationale: keeps transactions *below* standard free-market mainnet gas limits even at
2× spikes, and under typical block gas for a single-user app.

## 4. Supported Repository / Input Sizes

"Repository" = the VLCD ledger of proofs registered on-chain (see adr-0004) and the
offline artifacts store.

| Dimension | Support target | Enforced by |
|-----------|----------------|-------------|
| Constraints per circuit | **up to 2<sup>20</sup> (≈1 M)** in v1 | engine compressor + wasm wc calc limit |
| Circuits (`circuitId`) registered | **unbounded** (app-based) | registry mapping + allow-list |
| Registry entries per circuit | **unbounded** (append-only log) | registry design; no caps |
| Offline artifact store | **≤ 2 GiB** dev cache; per-circuit ≤ 500 MiB | artifact cache eviction |
| CLI input file payload | **≤ 4 MiB** per prove invocation | CLI schema validation |
| API request body (publicInputs list) | **≤ 1 MiB** | API size limit (Zod) |

## 5. Measurement Gates

- M4 gate: gas budget table §3 — assert via `forge script` gas snapshots in CI.
- M11 e2e gate: witness/prove numbers inside §1, verified on ubuntu-latest, budget-compliant.
- Cubic degradation (e.g., +20% per bump in `circuitVersion`) is **flagged** in PR
  comments by the gatekeeper.

## 6. Budgets on the Dashboard

- Dashboard dashboard never runs proving online (mainline memory/traffic) — it only
  reads registry. For UX demos, optional "demo prove" with a ≥ 1-circuit dev
  environment toggle.

## 7. Divergence/escalation rule

If a gate fails a target, milestone blocks to **M-BENCHMEASURE** (micro-bench, flame-graph)
before any code merge. ADRs decide re-budgeting if the target is physically wrong
requirement (e.g., ZZ-level recursion target or L2-specific precompiles alter costs).