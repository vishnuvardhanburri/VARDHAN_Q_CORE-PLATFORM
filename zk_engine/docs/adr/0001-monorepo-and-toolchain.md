# ADR-0001 — Monorepo Structure & Toolchain

**Status:** Accepted (pending approval)
**Date:** 2026-08-07

## Context
The system spans circuits, TS libraries, contracts, API, CLI, dashboard, CI, and tests.
A single package would tangle build steps; many separate repos would fragment versioning.

## Decision
Adopt an **npm-workspaces monorepo** with **Turborepo** for task orchestration:

- Root: `package.json` (workspaces), `tsconfig.base.json`, Turborepo `turbo.json`.
- Packages in `packages/`: `circuit-lib`, `proof-format`, `engine`, `contracts`, `api`, `cli`, `dashboard`.
- TypeScript strict in every package; shared `tsconfig.base.json`.
- Single lockfile (`package-lock.json`), Node 20 LTS pinned via `engines`.

## Consequences
- One `npm install`, one lockfile, uniform CI.
- Turborepo caches lint/typecheck/test/build; deterministic CI.
- Contracts (`packages/contracts`) is a Foundry package living inside the workspace; it
  exposes compiled ABIs to `api` via a small generator script.
- Breaking `proof-format` changes require an ADR update (semver-locked package).

## Alternatives considered
- pnpm workspaces: equivalent; npm chosen for zero extra install surface.
- Git submodules: rejected (fragile, slower CI).
