# 00 — Project Context

**Status:** Living document — regenerate/update from repository evidence.
**Last verified:** 2026-08-09 (working tree state)
**Source-of-truth order:** repository implementation > tests > ADRs > docs > conversation history.

---

## 1. Project identity and purpose

**Name:** ZK Proof Engine (`zk-proof-engine`)

Production-grade zero-knowledge proof system for **software supply-chain
verification**: a proof is generated in a private proving environment, verified
locally and on-chain against a blockchain registry, and used as a CI/CD
**gatekeeper** that blocks pull-request merges (and app operations) until a
valid, on-chain-enforced proof is presented.

Product surface: ZK circuits + proving engine + canonical proof format +
Ed25519-signed proof envelopes + on-chain registry (Solidity) + reading/writing
backend API + developer CLI + GitHub Action + dashboard (read-only
observability).

## 2. Product/problem statement

Teams need cryptographically sound evidence that a software artifact was built
and attested in a trusted environment before it is deployed. The system:

1. Lets an operator sign a **proof envelope** (Ed25519) binding: circuit,
   verification key hash, artifact bundle hash, public inputs, and the Groth16
   proof.
2. Publishes the proof anchor on-chain (append-only registry with
   `requireProved` and permanent `revokeProof`).
3. Runs a **trusted CI gate** (`pull_request_target`, code from the base
   branch only) that requires shape/circuit/vkHash/artifact-binding/
   proof-validity/signature/on-chain checks before merge.
4. Exposes read-only observability (status, registry, gate reports) via a
   dashboard — private witnesses never cross the boundary.

## 3. Core architecture (layers)

```
Private proving environment (CLI, operator machine)  ← witnesses never cross this boundary
        │
ZK engine (@zkpe/engine): Groth16 proving/verification, Poseidon hashing
        │
Proof format (@zkpe/proof-format): canonical JSON, keccak256/sha256, envelope
v1/v2, manifest, ABI-compatible publicInputHash
        │
Keys (@zkpe/keys): Ed25519 key rotation + envelope signing
        ▼
Backend API (@zkpe/api, Fastify): HMAC request signing, RBAC, idempotent
register, chain adapter — orchestrates only, no own crypto
        ▼
Blockchain registry (contracts/): Groth16 verification, anchors,
requireProof, revoke, pause, UUPS upgradeable
        ▼
GitHub gatekeeper (.github/workflows/gatekeeper.yml + zk-verify action):
trusted-base pull_request_target; checks envelope (secret key), artifact
binding, engine verification (certified vk), on-chain state
        ▼
Deployment decision (merge gate; optional GatedApp on-chain allowlist)
```

## 4. Repository / package map

| Path | Package | Version | Role |
|---|---|---|---|
| `packages/proof-format` | `@zkpe/proof-format` | 0.2.0 | Canonical serialization, hashing, envelope v1/v2+, manifests, ABI anchor. Zero runtime deps (@noble/hashes) |
| `packages/circuit-lib` | `@zkpe/circuit-lib` | 0.2.0 | Circom circuits (2, v1.0.0), dev PTau pipeline, certification, artifact hashing, ArtifactFacts |
| `packages/engine` | `@zkpe/engine` | 0.2.0 | Circuit handle + integrity gate, prover/verifier (snarkjs 0.7.6), Poseidon hash provider, task audit |
| `packages/keys` | `@zkpe/keys` | 0.1.0 | Ed25519 keypair/JWK/PEM, KeyRing rotation, FileKeyStore (0600), envelope sign/verify |
| `packages/api` | `@zkpe/api` | 0.2.0 | Fastify 5 REST gateway; HMAC auth, RBAC roles, idempotent register, problem+json, OTel, `/v1/metrics`, audit |
| `packages/cli` | `@zkpe/cli` | 0.1.0 | `zk` binary (env,new,prove,verify,register,status,registry,deploy,completions); thin orchestration |
| `packages/dashboard` | `@zkpe/dashboard` | 0.1.0 | M9 web UI (React+Vite) read-only BFF (Fastify) w/ session cookie + gate report store |
| `contracts/` | Foundry 1.7.1 | — | RegisterProof/requireProved registry, Groth16 verifier (?), adapters, GatedConsumers |
| `.github/` | — | — | CI, contracts CI, gatekeeper.yml + zk-verify action, secret-scan |

Submodules pinned: `forge-std` (≈v1.16.2), `openzeppelin-contracts` 5.7.0, `openzeppelin-contracts-upgradeable` 5.7.0. Toolchain: circom 2.1.9, snarkjs 0.7.6, solc 0.8.27, Foundry 1.7.1.

**DEBT-1:** `ptau16_dev.ptau` is a deterministic dev PTau; a community ceremony PTau is required for prod and is not present.

## 5. Current milestone status (from repository evidence)

Git log (aff25e6…b64f626) + CHANGELOG + docs/07 roadmap:

| Milestone | Status | Evidence |
|---|---|---|
| CRD | complete | ADR-0008, docs/12 |
| M0 Foundations | complete | packages/proof-format v0.1→0.2, CI skeleton |
| M1 Engine | complete | circuits + artifacts + engine (0.2.x builds, tests) |
| M2 Witness | complete | inputs.ts manifest-driven validation (folded into engine) |
| M3 Verifier | complete | engine verifier + canonical vectors anchored vs solidity |
| M4 Contracts | complete | ZKVerifierRegistry etc., forge suite green (43 ✅ w/ fuzz+invariants), gas snapshot |
| M5 API | complete | HMAC+RBAC+idempotency suite (73→78 tests) |
| M6 CLI | complete | zk binary, fresh-install, e2e-flow green |
| M7–M8 Gatekeeper | complete | gatekeeper.yml PR-read-only gate; negative suite;
  ADR-0012; revoked registry v2 |
| M9 Dashboard | **in progress, uncommitted** | packages/dashboard exists in working tree (untracked), docs/20 written; not in git log |
| M10 Docs | pending | user guide/runbook out; docs exist, dashboards doc added |
| M11 E2E | pending | gatekeeper-e2e.mjs exists but no CI nightly; playwright absent |
| M12 Release | pending | no 1.0.0, no external audit |

Repo status: working tree has **uncommitted work**: `packages/dashboard/` and
`scripts/smoke-dashboard.mjs` (untracked), `packages/api/src/client.ts`
(+`auditLogs`), `package-lock.json`, `docs/20-dashboard.md`.

## 6. Non-negotiable architectural rules

1. Backend/API is **orchestration** — it must not re-implement hashing, serialization, proving, or verification. All cryptography lives in proof-format/engine.
2. `proof-format` is the **canonical serialization layer** (canonical JSON, keccak256/sha256 helpers, ABI publicInputHash). No other package emits its own field encodings.
3. Never duplicate hashing, serialization, proving, or verification logic across packages.
4. Private witnesses never reach public/API/verification layers; the API accepts public inputs only (ADR-0005).
5. Gatekeeper must **fail closed** (no trusted key → block).
6. Artifact identity must be **cryptographically bound** to the proof (`artifactHash` in envelope, sha256 of canonical bundle).
7. Trusted verification keys must never be controlled by untrusted PR code (`ZK_GATEKEEPER_PUBLIC_KEY` secret, base-branch checkout).
8. Registry state must be checked before accepting deployment (on-chain `requireProved`, purge of revoked anchors).
9. Version protocol/circuit/proof formats explicitly (manifestVersion 1, format v1/v2, circuit semver, SCHEMA_VERSION).
10. Security-boundary changes require tests **and an ADR**.
11. Deterministic behavior + explicit interfaces (canonicalize→hash everywhere).
12. Do not redesign working components without evidence of a defect.
13. Every milestone requires tests, documentation, and verification (per-milestone gates).

## 7. Security invariants

- API: requests must carry HMAC-SHA256 signatures valid within 300s; nonce replay rejected; RBAC roles read/submit/write/audit; idempotency keys prevent double registrations; rate limits (token bucket incl. stricter verify bucket); malformed bodies → RFC 9457 codes.
- Envelope: `proofHash` recomputed and bound; signature binds formatVersion (downgrade v2→v1 impossible) ; sign/verify uses trusted key.
- Gate: all 7 checks must pass; report deterministically; `pull_request_target` isolation — PR code never executed.
- Contracts: append-only ledger, forward-only status, `ProofIsRevoked` permanent, `requireProved` reverts on unproved/expired/revoked, pausable, UUPS with schema guard, owner-only mutations.
- Dashboard: read-only, session cookie HMAC w/ HttpOnly/SameSite=Lax, CSP/nojs headers, no `dangerouslySetInnerHTML`.

## 8. Cryptographic invariants

- Field elements as decimal `Fr` strings; `parseFieldElement` canonical (`[0, r)`).
- `vkHash = keccak256(canonical vk JSON)`; envelope `proofHash = keccak256(canonical envelope minus proofHash)` (v1) / content-minus-proofHash-&-signature (v2).
- `publicInputHash = keccak256(abi.encode(uint256[]))` — byte-identical to the on-chain anchor (pinned by `canonical-vectors.json` both in TS (`abi.test.ts`) and Solidity `CanonicalHash.t.sol`).
- Registry records (ZKVerifierRegistry.sol): status keyed `(circuitId, publicInputHash)`; append-only leaf set `proofLeaves[proofHash]` with on-chain `proofHash = keccak256(abi.encode(circuitId, vkHash, publicInputs, a, b, c))`.
- `artifactHash = sha256(canonical artifact bundle)` binds the **circuit** r1cs/wasm/zkey/vk artifacts in the envelope — it is NOT application-binary provenance (docs/09 §2.2).
- `circuitId` → `bytes32` left-aligned; `pi_b` Fp2 swapped to real-first for Verifier.sol.
- Poseidon-in-circuit vs engine Poseidon provider — bit-for-bit oracle match is test-asserted.
- Ed25519 keyId = SHA-256 of canonical public JWK (RFC 7638 ordering), 64 hex.
- SHA-256 for artifact digests; keccak for structural binding; Poseidon in-circuit.
- PTau: dev beacon fixed + recorded sha256, re-verified before keygen.
- **Provenance limits (docs/09 §2.1–2.2):** v1 proves only the two implemented
  relations (`poseidon-preimage@1`, `merkle-inclusion@1`). The system does
  **not** prove source→binary provenance and makes no claim that a binary
  result derives from specific source code; `sha256-preimage` is deferred
  (docs/13 §3); source→binary binding is a future capability requiring a new
  circuit (docs/09 §7.3).

## 9. API boundaries

All `/v1/*` (Fastify, `packages/api`). Public: `/v1/health`, `/v1/ready`, `/v1/metrics`, `/v1/docs`, `/v1/openapi.json`. Auth required otherwise: `GET /v1/circuits`, `POST /v1/proofs/verify` (role `submit`), `POST /v1/proofs/register` (role `write` + `Idempotency-Key`), `GET /v1/proofs/status/:circuitId/:publicInputHash`, `GET /v1/registry`, `GET /v1/audit` (role `audit`). Errors always `application/problem+json` with stable codes (`UNVERIFIED` 428, `STATE-CONFLICT` 409, `AUTH-*` 401, …). Client: `signedFetch` (client.ts) — the ONLY HMAC implementation besides the server (dashboard reuses it).

## 10. CLI boundaries

`zk <cmd>` exit codes 0/1/2 (usage 2). Commands: `env set/show/list`, `new`, `prove`, `verify (--offline/--api)`, `register`, `status`, `registry`, `deploy` (foundry script), `completions`. Secrets redacted `<redacted:N>`. Envelope files signed by external keys (gatekeeper/My fixture). Machine-readable `--json`. No CLI has its own crypto — delegates to engine + proof-format + api client.

## 11. Gatekeeper trust model

- The gate runs on **PRs via `pull_request_target`**; the workflow, action, and `gatekeeper-probe.mjs` come from the **base branch** (trusted). PR head is checked out **read-only** into a temp dir; only `.gitgate/gate-envelope.json` is read. Parameters from repo vars + secrets, never PR inputs.
- Trusted key: `ZK_GATEKEEPER_PUBLIC_KEY` (Ed25519 public JWK) — secret. No in-repo key, no self-signing in CI. Fail-closed if absent.
- Required checks (gatekeeper-lib.mjs): shape, circuit, certified vkHash, allowlist, artifactHash == canonical bundle sha256 (manifest + on-disk recompute), engine proof validity, signature require-signed, on-chain registered+active / status proved / `requireProved` no-revert (unexpired).
- On failure: gate job fails → branch protection blocks merge; PR comment with report JSON.
- `gate-negative` job reruns the 15-case suite (14 negatives) on trusted code.

## 12. Testing / quality gates

| Gate | Command | Where |
|---|---|---|
| lint + typecheck + unit+integration | `npm run check` (turbo: lint/typecheck/test) | CI `quality` |
| build + fresh-install (cross-platform matrix) | `npm run build` + `fresh-install` | CI platforms |
| contracts | `forge test` (43), fuzz/invariants, `forge snapshot --check`, fmt --check, slither | CI contracts |
| gatekeeper negative suite | `npm test` (`packages/cli/test/gatekeeper.test.ts`) | CI `gate-negative` |
| e2e (anvil) | `e2e-flow.mjs`, `gatekeeper-e2e.mjs` | manual/PR |
| smoke (dashboard BFF) | `node scripts/smoke-dashboard.mjs` | manual |
| bench | turbo `bench` | perf budgets |

**Currently green (verified 2026-08-09):** turbo check 11/11, contracts 43 tests + fuzz + invariant + snapshot, dashboard (13) + smoke, CLI e2e.

**Resolved in release preparation:** `forge fmt` drift (was failing on
`src/ProofGatekeeper.sol` + 4 more) — `forge fmt` applied; `forge fmt --check`
green.

## 13. Deployment assumptions

- Local/dev: `anvil` RPC (`127.0.0.1:8545`), Foundry deploy scripts (`Deploy.s.sol` + `Register.s.sol` + `Verify.s.sol` + GatedDeploy), Sepolia documented in `scripts/README.deploy.md`); M5 API via env; no Dockerfiles; no prod k8s manifests (M12 pending).
- Secrets: `ZK_API_KEYS` (api), `ZK_DASHBOARD_SESSION_SECRET`/`ZK_DASHBOARD_PASSWORD`, `ZK_GATEKEEPER_PUBLIC_KEY` (secrets), gate key private stays offline.
- Dev mode uses `ZK_ENV=dev` PTau16 (DEBT-1) — never prod.
- The gate only enforces merges once branch protection is enabled (documented in docs/19).

## 14. Known technical debt

- DEBT-1: production PT (ceremony) missing; dev ptau16 only.
- DEBT-4: API auth keys in env (no KMS) per ADR-0005.
- `contracts/script/Upgrade.s.sol` referenced in deploy README but not present; upgrade path exercised only via `UpgradeAndPause.t.sol` + forge.
- Secret scan is a **hard gate** (`secret-scan.yml`): pinned gitleaks 8.16.1, range resolution owned by `scripts/scan-range.mjs` (selftest-guarded; never emits an invalid revision range — unresolvable inputs degrade to full history), scoped allowlist in `.gitleaks.toml`.
- No persistent DB — API in-memory idempotency/nonce/audit ring (single process); dashboard gate reports on filesystem (FsGateRepoStore).
- `contracts` exposes `proofLeaves` append-only set → unbounded growth (acknowledged).
- Docs 11 perf targets: gas budget met at M4; engine perf met (44.7/7.4ms).

## 15. Known risks

- R1: **Working-tree state**: uncommitted M9 work (dashboard, scripts, docs) — mitigated by the release-preparation commit.
- R2: *(resolved 2026-08-09)* `forge fmt` drift — applied; `forge fmt --check` green.
- R3: PTau ceremony (T6) must precede prod.
- R4: Gate only blocks if branch protection make it required (operational risk).
- R5: Secrets live in env vars → env leakage risk.
- R6: Contract registerProof honest-caller condition (permissionless); replay & correctness tests mitigate.
- R7: Dashboard untracked — CI `platforms` job builds it, but dependency tower to dashboard in `api` dist assumed built.

## 16. Next milestone

**M9 — Dashboard (implementation state: working tree tests + smoke green).** Remaining to close M9: commit; verify CI hits dashboard (quality job includes lint/typecheck/test of dash tests); optionally vitest+jsdom is already wired; add `scripts/` smoke wiring in repo; align package.json `start`/`main` with dist layout; resolve docs/20 mismatches (UI_ALLOWLIST, adopt vite output); then M10 docs, M11 e2e, M12 hardening/release.

## 17. Engineering decision principles

1. Minimal changes; surface latency vs proof everywhere the layer touches crypto.
   - Never trust a client-supplied "verified" flag.
2. Prefer deterministic behavior and explicit interfaces over convenience.
3. Fail closed on trust-boundary boundaries (auth / gate / key handling).
4. Version every protocol/circuit/format contract; wire changes to align across packages.
5. Only centralize in packages with clean boundaries (proof-format, engine); everything else orchestrates.

---

*This file is secured; no private keys, seeds, passwords, or personal identifiers are stored here. Runtime secrets live in env files / GitHub secrets — see `.env.example`.*

Key sources: README.md, CHANGELOG.md, docs/07 (roadmap), docs/19 + ADR-0012 (gatekeeper), ADR-0005/0011 (API auth), ADR-0008 (crypto freeze), ADR-0009 (envelope), ADR-0010 (contracts), package sources/tests (verified 2026-08-09).