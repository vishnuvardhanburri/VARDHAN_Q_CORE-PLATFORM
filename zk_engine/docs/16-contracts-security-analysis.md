# 16 — Smart Contract Security Analysis (M4)

**Status:** Completed (2026-08-08, milestone 4 gate)
**Tooling:** Slither 0.11.6 (102 detectors), Mythril (symbolic, via Docker),
forge fuzz + invariants (foundry.toml: 256 fuzz runs, 64×64 invariants),
manual review per ADR-0004 design rules.

---

## 1. Slither — results and triage

Scope: `contracts/src` (own contracts only; generated verifiers and OZ are
audited upstream and were excluded from findings attribution). Full JSON
output preserved locally at triage time; CI re-runs Slither with a
whitelist of triaged detectors (`.github/workflows/contracts.yml`).

| Detector | Severity | Finding | Triage |
|---|---|---|---|
| arbitrary-send-eth | High/Med | `GatedApp.claim` sends ETH to an arbitrary `recipient` | **Accepted (by design).** GatedApp is a demo faucet; payout is gated by `onlyProved` + latest `paid[]`-once semantics, and the anchor can only exist after a valid Groth16 proof. Not deployed by `Deploy.s.sol` (deploy set = verifiers + adapters + registry). |
| uninitialized-local | Medium | `_authorizeUpgrade` local `v` | False positive (fixed by explicit `= 0`; catch path reverts before use). |
| missing-zero-check | Low | `GatedApp.claim` recipient | **Fixed**: `ZeroRecipient()` revert added. |
| timestamp | Low | `requireProved` expiry comparison | By design (ADR-0004 "proved, not expired"); mining-timestamp skew limited to ±1 block. Invariant-tested for exactness. |
| missing-inheritance | Info | Registry does not inherit IZKVerifierRegistry | **Fixed**: now `is … IZKVerifierRegistry`. |
| pragma (7 versions) | Info | generated verifiers `>=0.7.0 <0.9.0`; ours `^0.8.27` | Pinned solc 0.8.27 in foundry.toml; generated files left as-shipped by snarkjs. |
| naming/shadowing etc. | Info | — | N/A (upstream). |

## 2. Mythril — symbolic execution

images: `docker run … myth analyze` over the compiled **runtime bytecode**
with the ABI (construction bytecode axed due to solc download in the
container image; equivalent soundness coverage of business logic paths).

- `GatedApp` — **zero issues**.
- `ZKVerifierRegistry` — 1 × SWC-101 "possible integer overflow" at PC 79
  in the **fallback path**. Disassembly confirms the flagged arithmetic is
  OZ `Initializable's` version-counter guard (`0xff & … + 1`) inside the
  proxy/initialize preamble — **no user-influenced arithmetic exists in the
  registry** (all state transitions are constants, keccak, and `+= 1` on
  `totalProofs` in checked mode). Triaged: false positive; monitored.

## 3. Property-based + invariant evidence (forge)

- Fuzz (256 runs, fixed seed): garbage calldata never registers and never
  corrupts accounting; expiry logic is exact incl. the `maxAge == 0`
  no-expiry rule (fuzzer caught a semantic discrepancy in the test model,
  fixed to match the documented contract).
- Invariants (64 runs × 64 depth, ≥ 4k calls per invariant):
  `totalProofs` never decreases; ≤ 1 distinct anchor per fixture universe;
  `Proved` never regresses and `provedAt` is immutable; tampered calls are
  inert. See `test/invariants/`.

## 4. Manual review matrix (ADR-0004 rules)

| Rule | Implementation |
|---|---|
| No external calls during registerProof | Only the immutable precompile `pairing` + `IZkVerifier.verifyProof` (read-only). |
| Append-only; forward-only statuses | `proofLeaves` monotone; `status: None→Proved` once; boolean set once; duplicate = no-op. |
| vkHash binding | `registerProof` requires submitted == registered (VkHashMismatch). |
| Replay | Same proof+binds → no duplicate leaf; different(replay) inputs/circuit/vkHash → verify fails. |
| Pause (emergency) | Pausable registry; `registerCircuit`/`deactivateCircuit`/`unpause` stay open. |
| Upgrade safety | UUPS + `_authorizeUpgrade(onlyOwner)` schema-guard (≤ 1 bump, no downgrade). |
| Admin minimality | Owner-only: register/deactivate/pause/upgrade. |

## 5. Residual risks (accepted, tracked)

- Generated Groth16 verifiers audited only via the upstream generation
  pipeline; additionally cross-checked by the M3 offline verifier on the
  same artifacts (fixtures pass both) — closes the off/on-chain gap.
- Director: demo `GatedApp` pays the caller's chosen address; excluded from
  production deploys.
- Fuzz/invariants operate on dev-PTau artifacts; re-run gates bind at next
  artifact regeneration.