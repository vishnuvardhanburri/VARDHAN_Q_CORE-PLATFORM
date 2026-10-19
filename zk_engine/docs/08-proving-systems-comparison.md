# 08 — Proving Systems Comparison: Groth16 vs PLONK vs Halo2

**Status:** Complete (revision per architecture review)
**Date:** 2026-08-07

---

## 1. Purpose

This document records a structured comparison of the three serious candidates for the
system's proving system and the rationale for the selected scheme (per ADR-0002). It is a
living document: revised whenever a production decision touches the proof layer.

All cost figures are **order-of-magnitude for the same target circuit** (a Merkle-inclusion
circuit, ~2<sup>14</sup> constraints) on modern hardware and the EVM. Precise numbers are
measured in the Cryptographic Design Review milestone's benchmark suite and reported in
`11-performance-targets.md`.

## 2. Candidate Comparison

| Dimension | **Groth16** (selected) | **PLONK** (universal SNARK / KZG) | **Halo2** (transparent / IPA) |
|-----------|------------------------|-----------------------------------|-------------------------------|
| Proof system type | Pairing-based zk-SNARK | Pairing-based polynomial IOP | Halo-style polynomial commitment (acc.) |
| Trusted setup | Yes — per-circuit (phase 1 + phase 2) | Yes — universal & updatable (one-time per size) | **None** (transparent) |
| Proof size | **~128 bytes** (3 elements: G1, G2(×2), G1) | ~512 B–1.4 kB (curve & point-count dependent) | O(log n) elements; ~100 B–1.4 kB depending on config |
| EVM verify (BN254) | **~200–250 k gas** — single pairing check | ~330 k gas and up (2–3 pairings + commitments) | not EVM-native; heavy custom verifier |
| Prover time | fastest of the three | moderate | slowest |
| Prover memory | low–medium | medium | medium–high |
| Recursion / aggregation | possible but awkward | very natural (accumulation) | very natural |
| Zero-knowledge property | **perfect completeness/zero-knowledge, computational soundness** | zk-OK in standard configs (also has transparent variants) | default variants often dismissed; must enable per-circuit |
| Soundness | computational (ℓ-DLOG, SDH-family) | algebraic (DLP in AGM) | computational |
| EVM ecosystem | extremely mature: generated `Verifier.sol`, long audit history | mature (gnark, plonk verifiers) | poor for standard EVM |
| Dev tooling | circom2 / snarkjs / Foundry | circom2 plonkish, gnark, Plonky2/3 (different walls) | ZCash halo2 wasm, Rust-centric |
| Attack surface | extremely well understood & widely audited | well understood | more specialized |

## 3. Cryptographic Properties (relates to `09-proof-specification`)

- **Groth16**: proves knowledge of `w` s.t. `C(pub, w)=0`. Knowledge extractability;
  soundness under *ℓ-SDH* and *ℓ-DLOG*; perfect zero-knowledge. Trusted setup is an
  honest-participant multi-party protocol — sound if **at least one** participant is
  honest.
- **PLONK (KZG)**: sound in the algebraic group model; universal-updatable setup is
  safer under many-party ceremonies and never per-circuit.
- **Halo2**: no setup; stronger assumptions change; achieving ZK requires explicit
  blinding work.

## 4. Rationale for Selection

1. **EVM verification is the dominant cost.** Groth16's single-pairing check is
   ~3–5× cheaper than PLONK-KZG on-chain, and ships with a battle-tested
   `Verifier.sol` generator in snarkjs.
2. **Tiny proofs (128 B)** minimize calldata on the append-only registry.
3. **One toolchain end-to-end**: circom compile → witness → prove → contract generation →
   Foundry tests is a mature, audited path used by major projects.
4. **Per-circuit trusted setup is acceptable for v1**: exactly two curated circuits with
   strict setup-separation controls (ADR-0003); prod must use the community ceremony.
5. **The architecture remains scheme-extensible**: the Versioned Circuit Interface
   (ADR-0007) and the scheme-agnostic `proof-format` envelope (ADR-0006) mean a
   PLONK/Halo2 proving backend could be swapped in later without changing the API,
   registry schema, or contracts' call surface. Groth16 is the v1 choice, not a
   permanent essay.

## 5. Switching Triggers (documented now)

| Trigger | Action |
|---------|--------|
| A circuit where per-circuit ceremony is untenable (regulatory, key-loss risk), and transparent-setup criteria dominate | Intra-vote PLONK (universal updatable setup) |
| Required on-chain aggregated/recursive proofs become heavy for Groth16 | PLONK recursion or Halo2 accumulation |
| A partner ecosystem standardizes on a specific scheme | Engine adapter behind the Versioned Circuit Interface |

## 6. Relationship to Existing ADRs

- ADR-0002 (scheme) is frozen; this doc expands its rationale and switch conditions.
- ADR-0003 (trusted setup) governs dev/prod setup regimes.
- ADR-0006 (proof format) is intentionally scheme-agnostic.
- ADR-0007 (versioned circuit interface) isolates scheme changes from the rest of the
  architecture.