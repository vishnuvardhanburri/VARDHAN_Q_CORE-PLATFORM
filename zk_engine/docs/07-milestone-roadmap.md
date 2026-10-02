# 07 — Milestone Roadmap

**Status:** Active — implemented through M10 (2026-08-10). M11 in progress
(working tree, uncommitted). M12 not started (release-blockers gate).
**Date:** 2026-08-07

---

## 1. Sequencing Rules

- Follow the dependency order in `06-dependency-graph.md` exactly.
- Each milestone ends with a **gate**: lint + typecheck + tests green, docs updated,
  changelog entry, and a demo/verify step. No milestone starts before the previous gate
  passes.
- Milestones produce working, tested artifacts — not scaffolding.

## 2. Roadmap

| # | Milestone | Deliverables | Gate |
|---|-----------|--------------|------|
| CRD | Cryptographic Design Review | Proof-system freeze (ADR-0008), benchmark harness spec, gas-budget validation plan, trust-assumption sign-off, re-evaluated threat model (Part A complete at design freeze; Part B measurements tracked by M3/M4/M11 gates) — see `12-crypto-design-review.md` | Part A checklist 100% + ADR-0008 recorded before any crypto code lands |
| 0 | Repo scaffolding + foundations | Monorepo init (npm workspaces + turbo), TS strict base, `.gitignore`, env example, LICENSE, README, CI skeleton (lint/typecheck), `archive/legacy/` in place, security tooling placeholder, `packages/proof-format` v0.1 (envelope types, canonical serialization, proofHash, validation + tests) | `npm ci` + `turbo lint typecheck test` green; README ≥ requirements |
| 1 | ZK Proof Engine | `packages/circuit-lib` v1 set (`poseidon-preimage` + `merkle-inclusion` circom, ADR-0008 amendment 1; `sha256-preimage` deferred — docs/13 §3), `packages/engine` (compile → R1CS/WASM, keygen, PTau dev path with checksums), pinned toolchain + lockfile | Engine compile+keygen tests pass; artifact hashes reproduced in 2 runs |
| 2 | Witness Generator | Witness generation for both circuits (fast path `circom_witnesscalc`), input schema validation, negative-input rejection tests | Witness vectors match known-good golden values; property tests pass |
| 3 | Proof Verifier | Offline verifier (snarkjs@local vk, hash-checked), verify CLI smoke, `vkHash` canonicalization, negative (tampered proof) tests | Golden proof verifies; tampered proof rejected 100% |
| 4 | Smart Contracts + Blockchain Registry | Foundry scaffold, snarkjs `VerifierVerifier.sol` per circuit, `ZKVerifierRegistry.sol` (append-only, events, status model), `ProofGatekeeper.sol`, forge tests + fuzz/invariants, `anvil` local deploy script | `forge test` green incl. fuzz + invariant; registry replay-attack test passes |
| 5 | Backend API | ✅ Complete 2026-08-09 — Fastify server: circuits, proof verify/register (HMAC auth, nonces, RBAC, Zod schemas, rate limits, idempotency), registry reads, chain read client, audit, metrics, OTel | API integration tests green (73 tests, incl. security suite); forged-verify rejected; auth replay rejected — ADR-0011, docs/18 |
| 6 | Developer CLI | ✅ Complete 2026-08-09 — `zk` CLI (TypeScript): `env set`, `new`, `prove`, `verify`, `register`, `status`, `registry`, `deploy`, completions; artifact hashing + envelope signing | CLI e2e tests pass against local anvil + API (58 tests + e2e-flow green) |
| 7 | GitHub Action | ✅ Complete 2026-08-09 — composite action `zk-verify` (repo-pinned) wrapping `gatekeeper-probe.mjs`; artifact-binding + on-chain inputs; report outputs | Action tested on a demo PR; PR-head read-only checkout |
| 8 | CI/CD Gatekeeper | ✅ Complete 2026-08-09 — Gatekeeper required-status: signed proof envelope, certified vkHash allow-list, artifact binding, trusted-key signature (secret), on-chain enforcement (registered/active/unrevoked/unexpired); `pull_request_target` trust boundary; `gate-negative` job runs 14 negative tests; on-chain e2e (registered→pass, expired/revoked/unregistered→block); branch-protection docs | Gate blocks unsigned/no-proof PR; bypass attempt fails; report visible — ADR-0012, docs/19 |
| 9 | Dashboard | ✅ implemented (2026-08-10): `packages/dashboard` — React dashboard: proof search, circuit health, registry viewer, gatekeeper reports, verify demo; read-only BFF w/ session auth; risks (XSS defenses, CSP); Vitest + `scripts/smoke-dashboard.mjs` e2e smoke — see docs/20 | Dashboard tests green (~13); no `dangerouslySetInnerHTML` used; smoke green |
| 10 | Documentation | User guide, API reference (OpenAPI), security model, ops/runbook, ADR index, glossary; CI link-check on `docs/` | `docs` CI check passes; every CLI command documented |
| 11 | End-to-End Tests | in progress (2026-08-10): node orchestration journey (prove → verify → register → on-chain gate) green locally; CI job (anvil) being committed; Playwright dashboard leg pending, on CI nightly job, cleanup | Full journey green on fresh-env; artifacts archived |
| 12 | Hardening + Release | External audit checklist applied, full `osv-scanner`/`snyk` scan, perf budget on verify gas, v1.0.0 release tag, prod setup MOP | Release checklist 100%; audit findings closed/none |

## 3. Mapping to Components

The twelve architecture components map to milestones as follows (CRD precedes M0; M0 is
prerequisites): CRD=design freeze, M0=foundations, M1=engine, 2=witness, 3=verifier,
4=contracts+registry, 5=api, 6=cli, 7=action, 8=gatekeeper, 9=dashboard, 10=docs,
11=e2e, 12=release.

## 4. Risk Watchlist

| Risk | Plan |
|------|------|
| circom tool version drift | pin + lockfile + hash checks in CI (M1) |
| Solidity verifier correctness | use generated verifier as-is; fuzz + two independent verifiers (contract vs snarkjs) compare (M4) |
| CI e2e needs anvil + PTau states | hermetic job caching, PTau checksums in repo |
| Dashboard depends on API at runtime | contract-first: dashboard mocks via OpenAPI; e2e covers real path (M11) |

## 5. Approval Request

Approve this roadmap (and the ADRs) to begin **Milestone 0** then **Milestone 1**. On
approval I will proceed sequentially — each milestone with its tests, docs, and
verification before starting the next.