# Mission H — Baseline

**Pillar:** Vardhan Intelligence
**Tagline:** BE DIFFERENT
**Verified:** 2026-10-17
**Scope:** Docs only. No new facts beyond those listed here. No secrets.

## Purpose

**DISCOVER → CORRELATE → UNDERSTAND → VERIFY**

This file freezes the verified Mission H starting point: repo identity,
toolchain, CI snapshot, component inventory, live-web status, baseline
tests, limitations, and the Q-Core connection. It is the reference for
all Mission H follow-on work.

> Intelligence may discover. Only Q Core may authorize trusted execution.

## 1. Repo Identity

- URL: https://github.com/vishnuvardhanburri/VARDHAN_Q_CORE-PLATFORM
- Branch: `main`
- HEAD: `7e07949` (`7e0794901744b5478666aa1561da04579c377492`)
- Status on 2026-10-17: in sync with `origin`, tree clean.
- Citable baseline stays `943e61d` (6/6 green).

## 2. Toolchain & Workspace

- `rustc` 1.99.0
- `node` v22.22.1
- 33 cargo workspace members.
- `platform_web` = 2 static pages only.
- CLI `./qcore` + `scripts/vardhan.ts` REPL.
- 9 CI workflows.

## 3. CI Snapshot (2026-10-17, on `7e07949`)

| Workflow | Run ID | Result |
| --- | --- | --- |
| Sovereign | 39020652524 | success |
| Supply Chain | 39020652425 | success |
| Web Contract | 39020652509 + 39020652429 | success |
| Enterprise | 39020652522 | in_progress |
| Correctness | 39020652525 | in_progress |

Prior commit `842f66f`:

- Enterprise `39017661002` FAILURE (exit 101, docs-only commit,
  root cause unconfirmed) + 5 success.

## 4. Component Inventory

### 4.1 IMPLEMENTED

- `intelligence_plane/src/server/DeepProspectBuilder.ts` (1526)
- `IntelligenceEngine.ts` (611, PRODUCTION anti-mock guard)
- `VardhanOperator.ts` (1403, never auto-sends)
- `DiagnosticOpportunityEngine.ts` (435, £15K diagnostic chain)
- `OpportunityQualityEngine.ts` (126, sole `why_now` owner, 2-source rule)
- `OpportunityDecisionEngine.ts` (129)
- `OutreachEligibilityGate.ts` (54)
- `BankSignalDatabase.ts` (466, curated)
- `BankQualificationEngine.ts` (509, commercialReadiness NOT_ASSESSED)
- `BankProblemDossierGenerator.ts` (637)
- `BankSponsorRoleMap.ts` (158)
- `LivePublicObservationProvider.ts` (401, real keyless fetch)
- `LiveWebResearchProvider.ts` (450, fallback orchestrator)
- `SerperSearchProvider.ts` (dormant, no key)
- `GitHubProvider.ts` (245, keyless-capable)
- ProviderRegistry / CSVProvider / SourceRegistry / EntityResolver
- `scripts/evaluate_bank_opportunities.ts` (354, writes `.research/bank/`)
- QCoreAdapter (spawns `vardhan-receipt`, dual-sig)
- Rust trust-boundary counterparts (`vardhan_receipt`
  IntelligenceIdentity + `VARDHAN_CORE_INTELLIGENCE_POLICY_V1`,
  `vardhan_transaction` IntelligenceFindingSealing)

### 4.2 MOCK

- `WebSearchProvider.ts` / PublicWebSearchProvider (zetaflow-hardcoded)
- GitHubWebProvider (returns `[]`)
- PassiveReconProvider (`SIMULATION` comment)

### 4.3 PARTIAL / Broken

- `targetQualificationEngine.ts` (broken import `allCompaniesResearch`)
- `PeopleExtractor.ts` (`CANDIDATE_ROLES` ReferenceError)
- `signalRoutes.ts`
- `OutreachDashboardView.tsx` (1743, missing `replyWorthinessEngine`)
- `src/data/` ENTIRELY MISSING (`mockData` / `allCompaniesResearch` /
  `realTargetCompanies` / `v2DataEngine` → 29x TS2307, 248 tsc errors)
- JobSignalProvider / RiskEngine / AutonomousTypes /
  `behavioral_experiment` / `live_api` / `subjectIntelligenceEngine` /
  `control_plane` RealControlPlane broken imports.

### 4.4 DOC-ONLY

- `research/SOURCE_REGISTER.md` (16 sources)
- 4 bank profiles
- `docs/commercial/*` (£15K → £60K → £500K gated path)
- `docs/customer-readiness/*` (Mission G pack)
- `.research/bank` artifacts (5 opps, all NOT_ASSESSED)

## 5. Live-Web Status

- NO keyless web-search implementation exists (grep
  `duckduckgo` / `searx` / `brave` / `bing` → only log-label mentions,
  zero HTTP code).
- Serper dormant (no key).
- Live observation real via direct fetch.
- No API keys available → keyless approach required.

## 6. Baseline Test Results (ran 2026-10-17)

- vitest 4 focus files (`bankProblemDiscovery`,
  `commercial_opportunity`, `providerArchitecture`, `liveWebFallback`):
  9/9 PASS.
- Known failures: `boundary.test.ts` 5/5 (status-string drift),
  `peopleOwner.test.ts` 1 (`CANDIDATE_ROLES`), `supplyChainSecurity.test.ts`
  1 (`cargo sbom`).
- `tsc` (`tsconfig.app.json`): 248 errors (missing `src/data` cascade).

## 7. Limitations — Gap / Commercial Why-It-Matters

| # | Gap (from audit) | Why it matters commercially |
| --- | --- | --- |
| 1 | No keyless search | Discovery cannot run without keys; blocks live evidence chain |
| 2 | Missing `src/data` | 248 tsc errors; app-level intelligence cannot build green |
| 3 | Reply UI-only | `OutreachDashboardView` cannot prove engagement readiness |
| 4 | Revenue not wired | £15K → £60K → £500K gated path stays doc-only |
| 5 | Static briefs | Bank dossiers cannot refresh from live signals |
| 6 | Mock providers | Hardcoded / empty / SIMULATION outputs are not citable |
| 7 | Test regressions | Boundary / people-owner / supply-chain failures erode trust |
| 8 | No Rust commercial surface | No sales logic in `backend/`; sealing only, per policy |

## 8. Q-Core Connection

Sealing via QCoreAdapter → `vardhan-receipt`
(IntelligenceFindingSealing, policy
`VARDHAN_CORE_INTELLIGENCE_POLICY_V1`, tenant
`org-vardhan-intelligence`); no sales logic in `backend/`.

---

*End of Mission H baseline. Verified facts only; follow-on missions must
cite this file and `943e61d` until a new green baseline is declared.*
