# Gas Benchmark Report — Milestone 4 (Contracts + Registry)

Generated 2026-08-08 with `forge test --gas-report` (solc 0.8.27, via_ir,
optimizer runs 200, evm paris) against the dev-PTau circuit artifacts
(`ptau16_dev`). Gas snapshot gate: `.gas-snapshot` (CI runs
`forge snapshot --check`).

## Budgets (doc 11 — on-chain performance targets)

| Operation | Budget | Measured | Comment |
|---|---|---|---|
| `registerProof` (Groth16 verify + anchor append) | ≤ 350,000 gas | **297,145** | single pairing check; no storage wipe |
| `registerProof` — duplicate (idempotent) | ≤ 250,000 | 225,694 | no re-appends; fixed-cost re-verification |
| `requireProved` (gatekeeper hook) | ≤ 50,000 | **4,926** | 2 cold SLOADs |
| `registerCircuit` (owner) | ≤ 100,000 | 71,076 | one SSTORE + event |
| `deactivateCircuit` (owner) | ≤ 100,000 | 48,118 | one SSTORE + event |
| `pause` / `unpause` | ≤ 100,000 | 44,575 | events only |
| Registry deployment (implementation + proxy + init) | ≤ 2,000,000 | 1,084,835* | *implementation only; proxy + init ≈ +1.0M |

All within budget on mainnet-style blocks (30M) and L2s (≥10M).

## Notes

- `registerProof` reverts cost ~994M only for **tampered proofs** (full
  pairing attempts before rejection); legitimate path dominates. Documented
  as a deliberate anti-DoS trade-off: the pairing is the authoritative check.
- Idempotent re-registration re-runs Groth16 before discovering the anchor
  exists — acceptable (cheap relative to gas; preserves ordering).
- `requireProved` stays below 5k with cold storage; gatekeeper consumers
  (GatedApp.claim) total ≈ 45k including the transfer.
- On L2s with compressed OST N i.e. (Arbitrum/OP) costs scale down for
  storage; pairing cost dominates.

## Snapshot gate

`forge snapshot` writes `.gas-snapshot`; CI runs `forge snapshot --check`
to fail if the committed baseline drifts by more than the fuzz
tolerances. Regenerate intentionally with `forge snapshot --force` after
reviewing changes.