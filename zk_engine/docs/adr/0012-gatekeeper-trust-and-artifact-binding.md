# ADR-0012 — Gatekeeper Trust Model & Proof-Artifact Binding

**Status:** Accepted
**Date:** 2026-08-09
**Companion docs:** ADR-0004 (registry), ADR-0005 (backend auth),
ADR-0006/ADR-0007 (proof format/circuit interface), ADR-0009 (envelope
signing keys), docs/19 (gatekeeper), CHANGELOG 0.7.0.

## Context

Milestones 7–8 ship the CI/CD gatekeeper: a required status check that
blocks merges without a valid proof envelope. The post-M8 review found six
release-blocking gaps: self-signed fixtures inside the gate job (the PR
could mint its own pass), no binding between the proof and the *deployed
artifact set*, no on-chain enforcement of registry state in the real gate,
an unsafe `pull_request` trust boundary (a malicious PR can rewrite the
workflow), no negative tests, and no documentation of the trust model.

## Decision

### 1. Artifact binding (proof ↔ artifact bundle)

- The proof envelope carries an optional `artifactHash`: sha256 of the
  canonical bundle `{r1cs, wasm, zkey, vk:{sha256, vkHash}}`
  (`circuit-lib/artifacts.computeArtifactBundleHash`).
- `cmdProve` always embeds it. The gate **recomputes** the bundle digest
  from (a) the certified circuit-lib manifest and (b) the on-disk deployed
  artifact directory, and rejects any mismatch. A proof is only valid for
  exactly one compiled artifact set; `vkHash` alone is no longer sufficient.

### 2. Trusted verification key (never derived in CI)

- The gate verifies the envelope signature against **one repo secret**:
  `ZK_GATEKEEPER_PUBLIC_KEY` (Ed25519 public JWK). No key is generated or
  stored in the repository; `gatekeeper-fixture.mjs` is a local dev helper
  only and is never invoked in production workflows.
- The gate is **fail-closed**: a missing or invalid key blocks.

### 3. On-chain enforcement in the real gate

- When configured with `rpc-url` + `registry-address` (repo `vars`), the
  gate calls `circuits(bytes32)`, `getProofStatus`, and
  `requireProved(circuitId, anchor, maxAge)` over JSON-RPC `eth_call` and
  requires: registered + active circuit, matching vkHash, `Proved` anchor
  (not `revoked`/`unregistered`), and no expiry revert.
- This supersedes the old "demo-only" `requireProved` probe in
  `e2e-flow.mjs`; the same checks power the PR gate.
- Contract support (registry v2, same schema): `ProofStatus.Revoked`
  enumerant, owner-only `revokeProof` (permanent tombstone), `ProofIsRevoked`
  error, `ProofRevoked` event. `SCHEMA_VERSION` stays 1 — persisted layout
  is unchanged.

### 4. PR trust boundary (`pull_request_target`)

- The workflow triggers on `pull_request_target`: workflow, action, scripts
  and allow-list resolve from the **base branch**; the PR head is checked
  out read-only into `runner.temp/zk-pr-head` and only its envelope is read;
  PR code is never executed and secrets never reach PR-derived steps.
- All gate parameters (envelope path, circuit, vk allow-list, registry
  endpoint, API URL, max age, key) come from secrets/repo vars — PR inputs
  cannot influence them.

### 5. Negative tests

- `packages/cli/test/gatekeeper.test.ts`: 14 negative cases (malformed
  envelope, wrong circuit, uncertified/allow-listed vkHash, missing/
  mismatched artifactHash, on-disk artifact difference, invalid proof,
  missing/forged/wrong-key/no-key signature, unregistered/revoked/expired
  on-chain states) + a positive control, run in CI by the `gate-negative`
  job on the trusted base.
- `packages/cli/scripts/gatekeeper-e2e.mjs`: the real gate against anvil —
  registered → pass; expired (maxAge) → block; revoked → block;
  unregistered → block.

## Consequences

- PR gate is only as strong as the secret + base branch (documented in
  docs/19 — production key is the trust root, matching ADR-0009/0010).
- `artifactHash` is a v3-compatible optional envelope field (v1/v2
  consumers ignore it); v2 signed envelopes that include it are
  self-validating via canonical serialization.
- Registration of a revoked anchor is impossible — revocation is
  permanent by design (append-only ledger, ADR-0004).