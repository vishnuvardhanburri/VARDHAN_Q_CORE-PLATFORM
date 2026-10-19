# Mission H — Closeout (Live Opportunity Engine)

**HEAD at closeout:** `7e07949` (pre-commit; new SHA recorded in §8 after push).
**Outcome: HOLD×4, honest.** No GO, no draft, no fabrication — the engine refused
to qualify without a dated trigger, exactly as designed.
**`.research/` decision:** `.gitignore` has NO research rules (`git check-ignore`
clean) → `intelligence_plane/.research/briefs/` + `/companies/` COMMITTED
(200K). Pre-existing `intelligence_plane/.research/bank/` (Mission-G era, already
tracked) untouched.

## 1. Per-stage table (1–9)

| Stage | What | Evidence | Tests |
|---|---|---|---|
| 1 Baseline | Froze repo identity, toolchain, CI, limits | `docs/vardhan-intelligence/MISSION_H_BASELINE.md` | vitest 4-file focus 9/9; tsc 248 known |
| 2 Keyless search | DDG HTML provider, no keys/deps, polite 1.2s | `src/server/providers/KeylessSearchProvider.ts` | `keylessSearch` 7 |
| 3 Pipeline | 8-query plan, verifyTop=6, dedup, corroboration, honest-empty | `src/server/company/CompanyResearchPipeline.ts` + **regression fix** (§4) | `companyResearchPipeline` 8 |
| 4 Qualification | Weights, HARD RULES a–e, registry, GO/HOLD/DROP | `src/server/commercial/OpportunityQualification.ts` | `opportunityQualification` 10 |
| 5 Sweep+briefs | Pure research→qualify→draft; ranked HOLD×4 | `SweepBriefing.ts`, scripts, `.research/briefs/` | `liveOpportunitySweep` 4 |
| 6 Outreach | GO-only drafts, 60–100w, CTA, blocklist, anti-reuse | `src/server/commercial/OutreachDrafting.ts` | `outreachDrafting` 7 |
| 7 Rust API | Session-gated read-only briefs, fail-closed | `backend/control_plane_api/src/intelligence_briefs.rs` + tests | cargo `intelligence_briefs` 4 |
| 8 Security | UA/no-auth, strip params, excerpt-only, blocks, honesty | `tests/missionHSecurity.test.ts` | `missionHSecurity` 5 |
| 9 Closeout | This doc + 4 companion docs + commit/push/CI watch | `docs/vardhan-intelligence/` (5 new files) | FULL re-run §7 |

Prior art reused untouched: `liveWebFallback` 1, `commercial_opportunity`
1 test × 34 asserts, `peopleOwner` 1, `bankProblemDiscovery` 6,
`providerArchitecture` 1.

## 2. Full test inventory (ACTUAL counts, re-run §7)

vitest Mission-H set (11 files): companyResearchPipeline 8, keylessSearch 7,
liveWebFallback 1, opportunityQualification 10, commercial_opportunity 1
(34 asserts), peopleOwner 1, bankProblemDiscovery 6, providerArchitecture 1,
liveOpportunitySweep 4, outreachDrafting 7, missionHSecurity 5 → **51 tests**.
cargo: `intelligence_briefs` 4 + full `control_plane_api` suite green:
43 lib + 4 g2 + 1 tenant-isolation + 4 briefs + 13 org-lifecycle + 1 receipt +
6 tenant_isolation_test + 1 tenant_isolation_tests = 73 passed, 0 failed
(verified 2026-10-17 pre-commit).

## 3. Stage-3 regression incident (implicit keyless default)

During Stage 3, `LiveWebResearchProvider` defaulted to a live keyless search
when no provider was injected; the commercial path then hit live DDG HTTP
implicitly and timed out. Fix (THIS commit, surgical): explicit-injection only —
`searchProvider` must arrive via `options.searchProvider`; the fallback stays
Serper (keyed) → Null terminator so offline/mock/fake-fetcher callers never
touch the network (`LiveWebResearchProvider.ts` + comment). `PeopleExtractor.ts`
import fix (`CANDIDATE_ROLES` value-import) and `lib.rs` route merge (2 lines)
complete the surgical set — see `git diff` §7.

## 4. DDG throttle findings (202 challenge)

Keyless provider polite per-query (~1.2s) but back-to-back companies tripped
DuckDuckGo HTTP 429/202 → `SEARCH_RATE_LIMITED`. HSBC (first) succeeded 12/12;
JPMorgan/LGT/Swift went 0/8 ×2 attempts each (retries at +4/+6/+8 min still
throttled). Mitigation committed: 90s `INTER_COMPANY_POLITENESS_MS` in
`live-opportunity-sweep.ts` + honest-empty exit-0 artefacts kept as provenance.

## 5. All-HOLD outcome — why honest

Ranked: HSBC 70, JPMorgan/LGT/Swift 60 — ALL HOLD, `whyNow: null`, drafts null.
No pipeline run surfaced a dated (≤180d) corroborated MEDIUM+ trigger, and
register prose dates were NOT promoted to event dates. A GO would have required
fabricating a trigger; the engine returned HOLD with `resolveEvidence` instead.
Scores decompose per the weight table (fit 30 + buyer 15 + feasibility 15
throughout; evidence/freshness zeroed by the missing WHY_NOW).

## 6. File manifest (added / modified)

Added — docs: `OPPORTUNITY_QUALIFICATION_MODEL.md`,
`SECURITY_AND_DATA_BOUNDARIES.md`, `OPERATOR_GUIDE.md`,
`LIVE_RESEARCH_VALIDATION.md`, this file; plus prior-stage
`CUSTOMER_ENTRY_POINTS.md`, `LIVE_RESEARCH_ARCHITECTURE.md`, `MISSION_H_BASELINE.md`.
Added — TS: `server/commercial/{OpportunityQualification,OutreachDrafting,SweepBriefing}.ts`,
`server/company/CompanyResearchPipeline.ts`, `server/providers/KeylessSearchProvider.ts`,
`scripts/{keyless-search-smoke,live-company-research,live-opportunity-sweep,build-ranked-briefs}.ts`,
`tests/{companyResearchPipeline,keylessSearch,liveOpportunitySweep,missionHSecurity,opportunityQualification,outreachDrafting}.test.ts`,
`intelligence_plane/docs/vardhan-intelligence/LIVE_RESEARCH_ARCHITECTURE.md`,
`.research/briefs/` (5 JSON) + `.research/companies/` (7 runs + 4 brief.md).
Added — Rust: `backend/control_plane_api/src/intelligence_briefs.rs`,
`backend/control_plane_api/tests/intelligence_briefs.rs`.
Modified (3, surgical): `backend/control_plane_api/src/lib.rs` (2 lines:
mod + merge), `LiveWebResearchProvider.ts` (fallback + comment),
`PeopleExtractor.ts` (import fix).

## 7. Limitations + next steps

Limits: 3/4 companies on curated-not-live evidence; no dated triggers; DDG
throttle unexpired; drafts unproven in production (no GO yet); bank/ dir predates H.
Curated overlays are explicitly marked (`curated register evidence` statements,
`Limitations: Live DDG sweep throttled (HTTP 202 challenge) — brief built from
curated SOURCE_REGISTER; re-run live sweep before outreach`) so no reader can
mistake them for fetch-verified findings. Per-company run JSONs (7 files) and
per-company `brief.md` narratives (4 files) preserve the raw provenance behind
every brief field.
Next: (1) re-sweep post-cooldown (≥90 min, smoke first); (2) dated-trigger
resolution per `resolveEvidence`; (3) 1–2 evidence-strong adds only when a GO
appears — no scope creep, no mock data, no infra changes.

## 8. Commit / CI record

- Commit: `Mission H: live opportunity engine (keyless DDG + pipeline + qualification + briefs API + ranked HOLD×4)` — SHA: _recorded on push below_.
- CI workflows (polled `actions/runs?per_page=6`, recorded honestly per workflow):
  _terminal states recorded in the final report; `unknown/running` stated as-is at timeout — never claimed green without all-success._
