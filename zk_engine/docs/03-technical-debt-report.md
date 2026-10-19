# 03 — Technical Debt Report

**Status:** Complete
**Date:** 2026-08-07

---

## 1. Executive Summary

The repository is **greenfield** (0 commits). There is no inherited technical debt.
However, the sibling repos audited in `01` exhibit debt patterns that this project must
explicitly design against. This report defines the **debt-prevention contract** and the
**acceptance criteria** that gate each milestone.

## 2. Observed Debt Patterns in Audited Siblings (do-not-replicate)

| Pattern | Observed in | Mitigation for this repo |
|---------|-------------|--------------------------|
| Single-purpose root scripts (`rewrite_app.cjs`, `remove_popstate.cjs`, `refactor_routes.cjs`, `rewrite_app2.cjs`) | XAVIRA-Technologies | No one-off codegen scripts in repo root; all tooling lives in `scripts/` with docs |
| Dead README (`README.md` = 1 byte) | XAVIRA-Technologies | README is a CI-checked artifact (milestone gate) |
| `.env` committed to disk at repo root | XAVIRA-Technologies | `.env*` in `.gitignore`; secrets via environment/CI secrets only |
| Multiple lockfiles (`bun.lock` + `package-lock.json`) | XAVIRA-Technologies | Single package manager (npm), single `package-lock.json` |
| Generated AI-patch scripts left as litter | both | `archive/legacy/` quarantine path exists for any such artifacts |
| `venv`, `node_modules`, `dist` present in-tree | both | Root `.gitignore` enforced from Milestone 0 |
| Untested dashboards (UI without tests) | both | Dashboard ships at least 1 Vitest/Playwright test per view |

## 3. Debt-Prevention Contract (mandatory from Milestone 1)

1. **No files at repo root** except `package.json`, `README.md`, `tsconfig.json`,
   `.gitignore`, and `docs/`, `packages/`, `scripts/`, `.github/` directories.
2. **TypeScript strict mode** enabled in every package; `noUncheckedIndexedAccess` on.
3. **Contracts are immutable once deployed in a milestone**; changes go through a new
   version + migration note in docs.
4. **Every package** has: unit tests, `npm run lint`, `npm run typecheck`, `npm run build`
   with zero warnings.
5. **No vendored dependencies** (no committed `node_modules`, binaries, or downloads).
6. **All infra-as-code** (CI workflows, Foundry configs, Dockerfiles) is versioned and
   reviewed with the code that uses it.
7. **No environment-specific hardcoding**: chains, RPC URLs, API URLs come from env vars
   with typed defaults, validated at startup.
8. **Documentation is code**: docs change in the same PR as behavior; `docs/` is CI-checked
   for broken links (Milestone 10).
9. **Proof artifacts are reproducible**: pinned circom/snarkjs/foundry versions,
   committed `package-lock.json`, and hash-verified PTau files (checksums in repo).

## 4. Zero-Baseline

- TODOs: 0 (must never be committed without an issue reference)
- Deprecations: 0
- Dead code paths: 0 (enforced by `ts-prune` in CI, Milestone 5+)
- Unused dependencies: 0 (`knip` check in CI)
- Coverage floor: **80%** on ZK core, **70%** elsewhere (Milestone 7 onwards)

## 5. Backlog of Debt Items (future, tracked)

These are *intentional* deferrals, recorded now so they never become silent debt:

| ID | Item | Deferred to | Why |
|----|------|-------------|-----|
| DEBT-1 | Community trusted-setup ceremony (prod) | Post-Milestone 8 | Requires stakeholders; dev PTau is sufficient until then — operating plan: docs/21 |
| DEBT-2 | Multi-chain registry (zkSync/Arbitrum) | Post-Milestone 12 | Single-EVM scope approved for v1 |
| DEBT-3 | Recursive/aggregated proofs | Post-Milestone 12 | Groth16 single-proof satisfies v1 gatekeeper needs |
| DEBT-4 | Key management service for API signing | Post-Milestone 6 | API-key HMAC covers v1; KMS is infra decision |

## 6. Approval Checkpoint

The items in §3 and §5 are accepted as the debt-prevention standard. Milestone gates will
fail CI if §3 items are violated.