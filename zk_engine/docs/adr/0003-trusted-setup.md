# ADR-0003 — Trusted Setup Strategy

**Status:** Accepted (pending approval)
**Date:** 2026-08-07

## Context
Groth16 requires a trusted setup. Using a known-public weak PTau would let an attacker
forge proofs; using a developer-local one is fine for dev only.

## Decision
Two-tier setup:

1. **Dev/test environments**: automated setup with a pinned **weak** PTau
   (`powersOfTau28_hez_final_12`), generated per-CI-run, hash-verified, never used on
   mainnet. This unblocks all milestones including e2e.
2. **Production**: community Powers of Tau ceremony output (e.g. the standard
   `powersOfTau28_hez_final_28` used by major projects), plus a **phase-2 zkey ceremony**
   for each circuit, coordinated post-Milestone 8 (DEBT-1). zkey generation runs in a
   hermetic, network-disconnected step with published hash.

## Consequences
- Dev PTau file `~dev.ptau` is committed/verifiable by checksum; prod PTau checksum is in
  `docs/security/` and enforced by the engine.
- The registry stores the `vkHash`; the CI gatekeeper rejects proofs whose `vkHash` is not
  in the allowed list (T6 mitigation).
- `zk prove --env prod` refuses to run unless the prod zkey is present and hash-verified.

## Alternatives considered
- KZG-style transparent setup (PLONK): rejected in ADR-0002.
- Single ceremony for all: rejected — circuit churn would invalidate zkeys.

## Operational plan
The ceremony runbook (checksums, air-gap steps, attestations, prod keygen flow,
M12 acceptance) is tracked in `docs/21-trusted-setup-plan.md` (DEBT-1 closure plan).
