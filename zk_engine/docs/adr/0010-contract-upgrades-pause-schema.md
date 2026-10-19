# ADR-0010 — Contract Upgrades, Schema Versioning & Emergency Pause

**Status:** Accepted
**Date:** 2026-08-08
**Companion docs:** ADR-0004 (registry design), ADR-0006 (proof format),
docs/16 (security analysis), contracts/scripts/README.deploy.md.

## Context

Milestone 4 ships the on-chain registry. Post-launch it will need bugfixes
and feature additions without breaking: (a) the deployed proxy address
consumed by the API/CLI/gatekeeper, (b) the append-only ledger guarantees,
(c) incident-response expectations.

## Decision

### 1. Upgrade strategy — UUPS (only the registry is mutable)

- `ZKVerifierRegistry` is deployed behind an ERC-1967 proxy and is the
  **only stateful, upgradeable contract**. Verifiers and adapters are
  immutable once deployed; circuit upgrades happen by deploying a new
  verifier/adapter and calling `registerCircuit` again (the existing
  entries stay untouched).
- Upgrades are authorized by the registry **owner** (`_authorizeUpgrade`,
  OZ `OwnableUpgradeable`). No timelock/DAO in v1 — the owner key is the
  trust root and documented in the runbook.
- `initialize` replaces the constructor (OZ initializer guard); `SCHEMA_VERSION`
  is a contract-level constant.
- The proxy address is the stable consumer contract: `ProofGatekeeper`
  instances and the API read client hold the proxy address forever.

### 2. Schema versioning

- `SCHEMA_VERSION` (currently 1) encodes the persisted layout of the
  registry (circuits, proofLeaves, proofStatus, totalProofs).
- `_authorizeUpgrade` **enforces** compatibility: the target implementation
  must expose `getSchemaVersion()` returning the current version
  (patch/bugfix) or exactly `current + 1` (migration). Downgrades and
  arbitrary targets revert.
- Migration policy: entries are append-only and never rewritten, so a
  schema bump may only *add* fields with defaults; no re-encoding, no
  deletes. A `reinitializer` step may run once per bump (OZ pattern).

### 3. Emergency pause

- Registry implements OZ `PausableUpgradeable`. `pause()`/`unpause()` are
  owner-only. **Only `registerProof` is pause-gated**; read paths
  (`getProofStatus`, `requireProved`) stay available, and the owner-facing
  emergency tools (`deactivateCircuit`, `unpause`, `registerCircuit`,
  upgrades) are deliberately NOT paused — they are the mitigation.
- `deactivateCircuit` remains the permanent, per-circuit kill switch
  (forward-only: entries stay, verification stops).

### 4. What this ADR does not change

- Ledger semantics (ADR-0004), proof format (ADR-0006), crypto freeze
  (ADR-0008). No on-chain use of Ed25519 (ADR-0009).

## Consequences

- `Deploy.s.sol` deploys impl + proxy + initialize + circuits; `Verify.s.sol`
  is the post-deploy functional check; full procedure in
  `contracts/scripts/README.deploy.md` (incl. Sepolia + Etherscan verify).
- Gas: registry deployment ≈ 1.08M (impl) — GAS-REPORT.md.
- Upgrading requires running the entire forge suite + re-running
  `Verify.s.sol`; documented in the runbook (M10).
