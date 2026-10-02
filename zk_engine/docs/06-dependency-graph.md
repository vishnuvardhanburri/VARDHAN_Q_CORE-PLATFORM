# 06 — Dependency Graph

**Status:** Complete
**Date:** 2026-08-07

---

## 1. Build-Time Dependency Order (strict, per architecture approval)

The milestone ordering in `08-milestone-roadmap.md` follows this graph. An edge A → B
means "A must exist and be verified before B is built".

```
circuit-lib (circom)
      │
      ▼
proof-format ─────────────┐
      │                   │
      ▼                   ▼
ZK Proof Engine ───► Witness Generator
      │                   │
      ├───────────┬───────┘
      ▼           ▼
Proof Verifier ──► Smart Contracts ──► Blockchain Registry
      │                   ▲
      │                   │
      ▼                   │
Backend API ──────────────┘
      │
      ├──► Developer CLI ──► GitHub Action ──► CI/CD Gatekeeper
      │
      └──► Dashboard ──► Documentation ──► E2E Tests
```

## 2. Package Dependency Matrix (runtime)

| Package | Depends on | Depended-on by |
|---------|------------|----------------|
| `circuit-lib` | circom (tool), `proof-format` types | engine, api, cli |
| `proof-format` | nothing (zero-dep on core) | engine, api, cli, contracts (as spec) |
| `engine` | `proof-format`, `circuit-lib`, snarkjs, circom_witnesscalc | api, cli |
| `contracts` | foundry; `proof-format` spec | api (ABI), gatekeeper (deploy) |
| `api` | `engine`, `contracts` (ABI), fastify | cli, dashboard, gatekeeper |
| `cli` | `engine`, `api` client | action, gatekeeper, docs |
| `action` | `cli` (bundled or npm) | gatekeeper |
| `gatekeeper` | `action`, `api` | CI only |
| `dashboard` | `api` client, `proof-format` | — |
| `e2e` | everything (devDependency) | CI only |

## 3. Toolchain Dependencies (external, pinned)

| Tool | Version pin | Used by |
|------|-------------|---------|
| circom 2 | `2.1.x` (via npm `circom2`) | circuit compilation |
| snarkjs | `0.7.x` | Groth16 setup/prove/verify |
| circom_witnesscalc | `1.x` | fast witness generation |
| Foundry (`forge`/`anvil`) | `stable` pinned in CI | contracts |
| Node.js | `20 LTS+` (22 in CI; engines field `>=20`) | all TS packages |
| npm | `10+` | workspaces |
| Turborepo | `2.x` | task orchestration |
| Vitest | `4.x` (M0 baseline) | unit tests |
| Playwright | `1.x` | e2e |
| Docker | CI image pinning | action/gatekeeper |

## 4. Versioning Strategy

- All packages share the root `version` at release; tags like `v1.0.0`.
- `proof-format` is **semver-locked**: changing it is a breaking change requiring ADR.
- `circuit-lib` artifacts (r1cs, wasm, zkeys) are content-addressed by hash.

## 5. Validation Rule

A milestone may not begin until every upstream node in this graph for its scope has
shipped and passed its own milestone gate (tests + docs + lint + typecheck).