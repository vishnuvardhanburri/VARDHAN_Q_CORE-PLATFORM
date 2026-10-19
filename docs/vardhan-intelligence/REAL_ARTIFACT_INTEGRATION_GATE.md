# Real-Artifact Integration Gate (Mission I §3, permanent)

## Why it exists

Two defects escaped fixture-only testing during Missions H/I:

1. An implicit live search provider let offline tests reach the external service.
2. A generated `ranked.json` missed the Rust `BriefSummary` keys — the endpoint 500'd
   (`BRIEFS_INVALID`) on the real file while fixture-based tests stayed green.

Fixture tests remain, but they must not substitute for this gate.

## What it is

Two permanent mechanisms, both wired into Sovereign CI
(`intelligence-real-artifact-gate` job in `.github/workflows/sovereign-ci.yml`):

### A. Producer-to-consumer gate — `intelligence_plane/scripts/real-artifact-gate.ts`

Deterministic, zero network (all fakes explicitly injected). Run from
`intelligence_plane/`: `npx tsx scripts/real-artifact-gate.ts` (exit 0 = PASS).
Mission I result: **PASS** (all 30 checks; step 4 runs the real Rust suite against
the generated file).

1. **Produce** — run the REAL `CompanyResearchPipeline` (production constructor)
   for a GO-shaped and a HOLD-shaped case; then the REAL
   `briefForCompany → rankBriefs → toRankedBrief` path (same functions the sweep
   CLIs call) and write `ranked.json` to a temp dir via the REAL `JSON.stringify`
   path (so `null`-vs-`undefined` serialisation behaviour is exercised, not mocked).
2. **Schema** — every entry must carry the Rust `BriefSummary` contract keys
   (`company/verdict/score/signal_url/why_now/buyer_role` — present, never undefined),
   verdict ∈ {GO,HOLD,DROP}, score 0–100; plus the **date-shape invariant**: a claimed
   WHY_NOW must carry a real `publishedDate` string and every `publicFacts` URL must
   be `https://` (no fabricated dates can pass).
3. **Consume** — load the generated artifact through the REAL Rust endpoint by
   spawning `cargo test -p control_plane_api --test intelligence_briefs` with
   `VARDHAN_BRIEFS_PATH` pointed at the generated file; the existing
   `real_ranked_json_contract` test (actual `BriefStore::load_from_path` +
   `list_briefs` path) must pass.
4. **Fail-closed matrix** — missing file (→ `BRIEFS_UNAVAILABLE`), malformed JSON,
   missing contract keys, wrong top-level shape (→ `BRIEFS_INVALID`) as real files
   on disk; HTTP-level codes stay covered by the Rust `stage8_*` tests.
5. Temp dirs are removed; the committed artifact is never touched.

### B. Explicit-injection guard — `intelligence_plane/tests/explicitProviderInjection.test.ts`

Static, zero network, runs under `npm test` (4/4 pass Mission I). It asserts:

- `CompanyResearchPipeline.ts` never imports the live `KeylessSearchProvider`;
- zero-arg `new CompanyResearchPipeline()` exists nowhere; the constructor signature
  declares `(searchProvider, fetcher)`;
- `new KeylessSearchProvider(` occurs only in the allow-listed live entries
  (`scripts/live-opportunity-sweep.ts`, `scripts/live-company-research.ts`,
  `scripts/keyless-search-smoke.ts`) plus self-construction inside the provider module;
- every unit-test construction passes two args (comma-at-depth-0 check) and never
  constructs/imports the live provider (sole exception: `keylessSearch.test.ts`,
  which injects stub/throwing fetchers + `politenessMs: 0`).

## What it does NOT do

- It does not hit live search, live publishers, or Q-Core (fakes only).
- It does not replace the Rust `intelligence_briefs.rs` suite or the vitest contract
  tests — it binds them together end-to-end.
- It does not bless outreach: drafts still require GO + human approval (§7).

## Operator runbook

- After any change to `SweepBriefing.ts`, `CompanyResearchPipeline.ts`,
  `KeylessSearchProvider.ts`, `intelligence_briefs.rs`, or either sweep writer:
  `npx tsx scripts/real-artifact-gate.ts` + `npm test` from `intelligence_plane/`.
- If the gate fails on step 4, read the cargo output first — the Rust loader error
  names the exact key/shape violation.
