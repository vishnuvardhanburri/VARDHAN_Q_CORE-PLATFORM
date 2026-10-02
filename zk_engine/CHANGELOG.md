# Changelog

## [0.1.0] — 2026-08-11 — Security & Release Assurance (Final Base)

### Security
- **OpenSSF Best Practices**: Upgraded security controls to align with OpenSSF Best Practices baseline (Branch protection, dependency locking, CodeQL scanning).
- **Release Assurance**: Modernized CI runtime environment (`node22`) in the release workflow. Integrated native GitHub Artifact Attestations (SLSA L3 Provenance) and Sigstore/Cosign keyless OIDC signing for cryptographically verifiable artifacts.
- **Documentation**: Cleared up license assertions (strictly MIT) and added explicit release verification commands and versioning matrices to `SECURITY.md`.
## [0.8.2] — 2026-08-09 — Fresh-checkout CI green (release-blocking CI fixes)

The 0.8.0 push was the repo's first CI run; beyond the secret-scan range bug
(0.8.1), it exposed that CI ran against a checkout without the certified
circuit artifacts, the committed gate envelope, and a Windows-correct
dashboard build. All now fixed and verified locally before release.

### Fixed
- **Certified artifacts committed** (`packages/circuit-lib/build/`, minus
  the 72MB dev PTau): manifests, vkeys, r1cs/zkey/wasm + checksums are now
  in-repo (deterministic dev build, `.gitignore` scoped re-include). The
  gatekeeper negative suite, `loadManifest` paths and the live zk-verify
  gate all run on a fresh checkout now.
- **Gate envelope + trusted public key committed** (`.gitgate/`): the push
  gate previously failed with an unreadable envelope on CI. The zk-verify
  action gains a `public-key-file` fallback — the repo secret
  `ZK_GATEKEEPER_PUBLIC_KEY` wins when configured, else the committed
  `gate-key.pub.jwk` is used (docs/19).
- **`zk` CLI lazy-loads the proof engine**: help/env/registry/completions no
  longer import `@zkpe/engine` (snarkjs); cold-start spawns on CI runners no
  longer risk blowing the 5s vitest timeout. `packages/cli/vitest.config.ts`
  raises `testTimeout` to 30s for the production-validation spawn suite.
- **Windows dashboard build**: vite `outDir` uses `fileURLToPath` (the
  previous `.pathname` produced a POSIX path that broke `mkdir` on
  Windows) and duplicate imports were removed.
- **`gatekeeper-probe.mjs` precedence**: an explicit `--public-key` now
  wins over `--public-key-file`.
- **CI generates the dev PTau**: `build:ptau` now runs in both CI legs
  (deterministic power-16 beacon, skip-if-fresh) — the engine integration
  test's `verifyDevPtau` no longer fails on fresh checkouts. The ~72MB file
  is cached via `actions/cache` (checksum-verified on every restore; the
  regeneration is proven byte-identical: `9835ce04…`), and leg timeouts were
  raised to cover the one-time first generation. CI pushes now **queue**
  instead of cancelling in-flight runs — cancelling discards the cache
  post-step save and forces every leg to regenerate the PTau from scratch.

## [0.8.1] — 2026-08-09 — Secret scan hard gate (fixes failed gitleaks-action run)

The first run of 0.8.0 (push `46e2a20`) failed in `secret-scan`: the
`gitleaks-action` invocation passed the invalid revision range
`<root-commit>^..HEAD` to `git log` (exit 1), failing the job on the
resolver rather than on findings. This cutover removes `gitleaks-action`.

### Changed
- `secret-scan.yml` rewritten as a direct, pinned `gitleaks` 8.16.1 scan
  (`--exit-code=2`, SARIF report, `--config .gitleaks.toml`) — the hard
  gate now fails **only** on real findings.
- Scan range resolution moved to `scripts/scan-range.mjs`, self-tested
  (`node scripts/scan-range.mjs --selftest`, 9 cases, wired into the
  workflow as a regression guard): PR events scan `base..head`, pushes scan
  `base^..HEAD` (`--no-merges --first-parent`); any unresolvable input
  falls back to a full-history scan. An invalid revision range can no
  longer be emitted.
- `.gitleaks.toml` added: full default rule set (`[extend] useDefault`)
  plus a documented, scoped allowlist for the `@zkpe/keys` PEM test
  literals and the dashboard demo gatekeeper fixtures. Validated locally
  with a full-history scan (0 findings) before this release.

### Fixed
- Demo gatekeeper fixtures `2026-08-09-expired-blocked.json` /
  `2026-08-09-revoked-blocked.json` now use placeholder `keyId` values
  (`key-2` / `key-3`, consistent with the other fixtures) — their previous
  fabricated 64-hex ids tripped the generic-api-key rule.

## [0.8.0] — 2026-08-09 — Milestone 9 dashboard + release-preparation consistency audit

### Added
- `packages/dashboard` (`@zkpe/dashboard@0.1.0`) — read-only M9 observability
  BFF + React UI (docs/20): session-cookie auth (HMAC, HttpOnly,
  SameSite=Lax), CSP header, 8 read-only `/api/*` routes (registry,
  circuits, proof status, audit, gatekeeper reports), static SPA shell,
  13 vitest tests + repo-level smoke (`scripts/smoke-dashboard.mjs`).
- `ApiClient.auditLogs(limit)` in `@zkpe/api` (used by the dashboard BFF).

### Changed
- `docs/09-proof-specification.md` rewritten to match the **implemented**
  v1 circuits (`poseidon-preimage@1`, `merkle-inclusion@1`) and adds the
  explicit sections "What the current system proves" / "What the current
  system does **NOT** prove". v1 does **not** prove source→binary
  provenance; the `artifactHash` binding is scoped to the circuit artifact
  bundle only (docs/09 §2.1/§2.2/§6). Source→binary provenance is recorded
  as a future capability requiring a new circuit (docs/09 §7.3).
- Terminology audit: `proofHash` (envelope vs on-chain leaf),
  `publicInputHash`, `vkHash`, `artifactHash` and the registry leaf are
  now defined distinctly (docs/09 §6, docs/12, ADR-0008).
- Stale `sha256-preimage` documentation references removed/renamed
  (docs/05, 07, 09, 11, 12); the deferral reason is documented (docs/13 §3).
- Dashboard packaging fixes: `main`/`types`/`start` point at the actual
  `dist/server/server/…` layout, `tsconfig.build.json` emits server+shared
  only, `smoke` wired to the repo smoke script, demo gatekeeper fixtures
  normalized to `poseidon-preimage@1`.
- `forge fmt` applied to contracts (pure formatting; `forge fmt --check`
  now green — resolves the release-blocking fmt gate).
- `.gitignore` verified for generated artifacts (node_modules, `.turbo`,
  `dist`, `build`, `coverage`, `contracts/out|cache|broadcast`, `.DS_Store`,
  `.env*`, `.gitgate`) — none are tracked in this commit.

### Fixed
- Demo gate report fixture `2026-08-08-registered-blocked.json` self-named
  `file` field (was pointing at the pass report).
- Stale "Status: Milestone 0 complete" README banner replaced with the
  actual milestone state.

## [0.7.0] — 2026-08-09 — Milestone 7–8: Gatekeeper security review (release-blocking fixes)

### Added
- `revokeProof` in `ZKVerifierRegistry` (owner-only, permanent tombstone):
  - `ProofStatus.Revoked`, `ProofIsRevoked` error, `ProofRevoked` event;
    re-registration of a revoked anchor reverts; `requireProved` reverts.
    `SCHEMA_VERSION` unchanged (no storage layout change).
  - 5 new forge tests (`ZKVerifierRegistry.t.sol`); `forge snapshot`
    regenerated; fuzz/invariant suites still green.
- Artifact binding: `ProofEnvelope`/`SignedEnvelope` gain optional
  `artifactHash` (sha256 of the canonical artifact bundle); CLI `cmdProve`
  embeds it; `validateEnvelope` accepts it. Integration test asserts the
  field.
- `packages/api` surfaces the `revoked` status (Zod enum, OpenAPI enum,
  `RegistryAdapter` maps `2 → revoked`).
- Gatekeeper rewrite with real gate logic:
  - `gatekeeper-lib.mjs`: pure/testable gate — envelope shape, circuit
    match, certified vkHash, allow-list, artifact binding (manifest + on-disk
    recompute), engine proof verification, trusted-key signature, and
    **on-chain enforcement** (`circuits`/`getProofStatus`/`requireProved`
    over JSON-RPC: registered, active, unrevoked, unexpired).
  - `gatekeeper-probe.mjs` now a thin CLI over the lib (artifact-dir, rpc-url,
    registry, max-age flags; JSON report; exit 0/1/2).
  - `gatekeeper-e2e.mjs`: registered → pass, expired → block, revoked →
    block, unregistered → block against a live anvil registry.
  - 14 negative unit tests (`packages/cli/test/gatekeeper.test.ts`).

### Changed
- Trust boundary: `gatekeeper.yml` now uses `pull_request_target` —
  workflow/action/scripts run from the base ref; the PR head is checked out
  read-only and only its envelope is read. The gate key comes from the
  `ZK_GATEKEEPER_PUBLIC_KEY` repo secret (fail-closed; no in-repo key,
  no self-signing fixture in CI). Gate parameters come from repo `vars`,
  never PR inputs. `.github/actions/zk-verify` adds
  `artifact-dir`/`rpc-url`/`registry-address`/`max-age` inputs and requires
  `public-key`.
- CLI test suite: 58 → 73 tests.

### Fixed
- On-chain selectors in the gate lib (`circuits`, `getProofStatus`) — they
  were computed from signatures with doubled `0x` prefixes; now verified
  against the deployed registry.
- `docs/19-gatekeeper.md` rewritten for the M8 trust model.

## [0.6.0] — 2026-08-09 — Milestone 6: Developer CLI

### Added
- `packages/cli@0.1.0` — developer CLI (ADR-0006/ADR-0007/ADR-0009):
  `zk env set`, `zk new`, `zk prove`, `zk verify [--offline|online|--api …]`,
  `zk register` (API), `zk status`, `zk registry`, `zk deploy` (foundry
  script), shell completions, machine-readable `--json` where useful,
  exit codes 0/1/2, redacted secrets in config.
- `cmdProve` embeds `artifactHash` (artifact bundle sha256) in the
  envelope; `cmdVerify` checks shape + signature + engine proof and the
  API path.
- `e2e-flow.mjs`: anvil → forge deploy → API → env → new → prove → verify
  (offline) → register → status → registry → verify (online) → on-chain
  `requireProved` gate — all green.
- Fix (porting M4/M5 to the CLI): Fp2 `pi_b` swap (real-first as
  `Verifier.sol` expects); double `bytes32` padding in the status adapter;
  `zket error` shape for third-party consumers.
- Tests: 58 CLI tests (unit + integration + fresh-install check).

## [0.5.0] — 2026-08-09 — Milestone 5: Backend API

### Added
- `packages/api@0.2.0` — Fastify 5 REST gateway (ADR-0011, docs/18):
  - Request signing: HMAC-SHA256 over a canonical request string
    (`x-zk-key`, `x-zk-nonce`, `x-zk-timestamp`, `x-zk-signature`),
    constant-time comparison, nonce replay store, 300 s TTL — per
    ADR-0005/ADR-0011.
  - RBAC: `read`/`submit`/`write`/`audit` roles decoded from
    `ZK_API_KEYS`, enforced per-route; unknown roles rejected at startup.
  - Routes: `/v1/circuits`, `/v1/proofs/verify`, `/v1/proofs/register`
    (idempotency-key, 409 on replay-conflict, per-key exclusive concurrency),
    `/v1/proofs/status/:circuitId/:publicInputHash`, `/v1/registry`,
    `/v1/audit`, `/v1/health`, `/v1/ready`, `/v1/metrics` (Prometheus),
    `/v1/openapi.json` + `/v1/docs` (Swagger UI, generated from Zod).
  - RFC 9457 `application/problem+json` error envelope with stable codes —
    never a bare 500 for client mistakes (fuzz-verified across 300 seeded
    malformed bodies).
  - Clean Architecture ports/adapters: `domain` → `application` (use cases) →
    `infrastructure` (contracts registry adapter via ethers, auth stores,
    audit file, metrics, OTel tracing) → `api` (HTTP facade only).
  - Body/field validation via Zod schemas shared with OpenAPI output.
- Tests: 73 tests (unit + integration + security suite):
  threat matrix (unauthenticated surface), auth bypass attempts (missing/
  tampered/expired/replayed headers), RBAC matrix (every role × every route),
  idempotency semantics, 300-malformed-body fuzz, concurrency, oversized
  payloads, signature/hex/trailing-slash edge cases.
- Security hardening from docs/04 review: FST_ERR_CTP mappings
  (413/415/400), register response serialization fix (verified field),
  uppercase-hex signature handling, trailing-slash 404 semantics.
- Docs: ADR-0011 (request signing, roles, idempotency, errors), docs/18
  (API design review). Roadmap M5 marked complete.

### Changed
- `@zkpe/proof-format`, `@zkpe/engine`, `@zkpe/circuit-lib` exports gain
  `require`/`default` entry points for the API's dual-format loading; no v1
  breaking API changes.
- `.gitignore` covers `packages/api/dist`.

## [0.4.0] — 2026-08-08 — Milestone 4: Smart Contracts + Blockchain Registry

### Added
- `contracts/` Foundry project (Foundry 1.7.1, solc 0.8.27 pinned, OZ
  contracts v5.7.0 + upgradeable v5.7.0 submodules):
  - snarkjs-generated `Verifier.sol` per M1 circuit (dev PTau artifacts),
    wrapped by generic `IZkVerifier` adapters (real-first Fp2 normalization).
  - `ZKVerifierRegistry.sol` — append-only, forward-only proof anchor
    ledger (ADR-0004): on-chain Groth16 verification, `vkHash` binding,
    keyed `getProofStatus`, `requireProved` gate. **Upgradeable (UUPS,
    ADR-0010)** with schema-versioned `_authorizeUpgrade` guard and
    **Pausable** emergency pause.
  - `ProofGatekeeper.sol` consumable hook + `GatedApp.sol` demo consumer.
- Deployment & verification: `Deploy.s.sol` (anvil/Sepolia, smoke-proof on
  deploy), `Verify.s.sol` (post-deploy functional checks), deploy README
  incl. Etherscan source verification procedure.
- Tests: 35 forge tests across unit/integration/fuzz/invariants, incl.
  replay-attack, cross-circuit replay, tamper negatives, exact-replay
  idempotency, expiry exactness (fuzz), append-only invariants (64×64),
  upgrade + pause behaviors, ABI regression pin.
- Security: Slither 0.11.6 runs scoped to our source (findings triaged in
  docs/16), Mythril symbolic run (GatedApp clean; registry SWC-101 false
  positive verified at PC 79), gas report with budgets (GAS-REPORT.md,
  `registerProof` ≈ 297k).
- CI: `.github/workflows/contracts.yml` — build incl. sizes, tests,
  fuzz, invariants, `forge snapshot --check`, `forge fmt --check`, Slither
  with triaged exclusions.
- Docs: ADR-0010 (upgrades/pause/schema), docs/16 security analysis.

### Changed
- Registry no longer plain-constructor: `initialize(owner)` + ERC-1967
  proxy (breaking ABI change vs. earlier draft — no deployments existed).
- Root `.gitignore` covers `contracts/out`, `contracts/cache`.

## [0.3.0] — 2026-08-08 — Milestone 2: Envelope Signing & Key Management

### Added
- `packages/keys@0.1.0` (new, ADR-0009):
  - Ed25519 key generation, JWK/PEM export & import, full key validation
    (shape + `d↔x` consistency), RFC 7638-style `keyId` thumbprints.
  - `KeyRing`: rotation (active key + verifiable history), bounded retention,
    strict persistence JSON, duplicate/unknown-key guards.
  - `FileKeyStore`: atomic writes, 0600 permission enforcement, tamper and
    permission-unsafe load rejection.
  - `signEnvelope` / `verifyEnvelope` / `assertEnvelopeSignature` for the v2
    signed envelope, with `requireSigned` policy.
  - Benchmark harness (doc 11 targets): raw sign 57k ops/s, raw verify
    24k ops/s, envelope sign+verify 14k ops/s — all within budget.
- `packages/proof-format@0.2.0` (additive, no v1 breakage):
  - Versioned envelope: `SignedEnvelope` (formatVersion 2) with
    `EnvelopeSignature`; version-aware `validateEnvelope`;
    `signatureInput` (canonical bytes over envelope minus signature);
    `validateSignatureShape`.
- Golden vector test: recorded signature independently verified with the
  openssl CLI.
- Docs: ADR-0009 (signing & key management), ADR-0006 amendment (v2 format),
  docs/14 implementation notes.

### Security
- Ed25519 signatures bind `formatVersion` — downgrade to unsigned v1 is
  impossible without invalidating the signature; gatekeeper requires v2.
- Keyring files must be 0600; group/other-accessible files are refused.
- All imported keys are validated and keyId-cross-checked; private keys
  never leave the keyring JSON (0600-protected).

### Changed
- Workspace packages bumped to 0.2.0 (proof-format API unchanged for v1).


## [0.2.0] — 2026-08-08 — Milestone 1: Proof engine

### Added
- `packages/circuit-lib@0.1.0` — v1 circuits and artifact pipeline:
  - `poseidon-preimage@1.0.0` (240 constraints) and `merkle-inclusion@1.0.0`
    (974 constraints) in circom 2.1.9.
  - Deterministic dev PTau (power 16, fixed beacon) with recorded sha256,
    re-verified before every keygen run.
  - Dev keygen (`groth16 setup` + vk export) and `certify` producing certified
    CircuitManifests; artifact digests reproduced across reruns (test-verified).
  - `artifactPaths` / `checkArtifacts` integrity API (Security T1).
- `packages/engine@0.1.0` — runtime engine:
  - `HashProvider` interface + registry; `PoseidonHashProvider` matching the
    circuits bit-for-bit (oracle-verified).
  - `Circuit` handle (integrity-checked), `parseCircuitInputs` manifest-driven
    validation (canonical fields, `u1`, `u8/u32`, arity).
  - `prove` / `verify` (Groth16 via pinned snarkjs 0.7.6) with task audit
    records (`TaskRecord`, `runTask`).
  - `verifyDevPtau`, `generateDevKeys`, `snarkjsCliPath` dev key helpers.
  - Benchmark harness (doc 11 targets): prove 45–76 ms, verify 6–8 ms.
- Docs: 13-engine-design (implementation notes), ADR-0008 amendment
  (v1 circuits renamed `sha256-preimage` → `poseidon-preimage`; SHA-256
  in-circuit deferred to v2 due to compiler miscompile finding).

### Fixed
- Ambient typings for untyped `snarkjs` / `circomlibjs` in engine and
  circuit-lib tests; test typecheck now strict (89 tests green).

## [0.1.0] — 2026-08-07 — Milestone 0: Foundations

### Added
- Monorepo scaffolding: npm workspaces, Turborepo task pipeline, strict TypeScript
  base config, ESLint flat config (typescript-eslint), `.editorconfig`.
- Repository hygiene: `.gitignore`, `.env.example`, MIT `LICENSE`, `CHANGELOG.md`.
- CI skeleton: lint / typecheck / test workflow; placeholder secret-scan workflow.
- `packages/proof-format@0.1.0` — versioned proof envelope (ADR-0006):
  - canonical JSON serialization (deterministic, key-sorted),
  - keccak256 / sha256 helpers,
  - BN254 field-element validation,
  - `createEnvelope` / `computeProofHash` / `validateEnvelope`,
  - CircuitManifest validation + `computeManifestHash` (ADR-0007),
  - unit test suite (40+ assertions) covering determinism, tamper detection, boundaries.
- `archive/legacy/` quarantine path.

### Documentation
- CRD milestone (doc 12) + ADR-0008 (cryptographic parameters freeze) added;
  roadmap (07) updated with the CRD gate.

### Security
- Secret-scan workflow placeholder (hard gate at Milestone 8).
- Envelope/manifest structural validation prevents malformed artifacts from entering
  later pipeline stages.

