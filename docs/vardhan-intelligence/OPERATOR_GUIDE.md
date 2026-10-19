# Mission H — Operator Guide

Run from repo root unless noted. All CLIs are read-only: no secrets, no auto-send.
Exit 0 on honest-empty; exit 2 on crash/usage error.

## 1. Keyless search smoke (connectivity check)

```bash
cd intelligence_plane && npx tsx scripts/keyless-search-smoke.ts
```

Runs 3 fixed queries (HSBC quantum/IBM, Swift CSCF, LGT/SEBA) against live DDG.
Exit 0 if ≥2/3 return ≥1 result. Run this FIRST — if it fails, the sweep will
honestly empty-out too; check the throttle playbook (§6) before re-running.

## 2. Single-company research

```bash
cd intelligence_plane && npx tsx scripts/live-company-research.ts \
  --company "HSBC" --domain hsbc.com [--max-sources 12]
```

Writes `intelligence_plane/.research/companies/<slug>/run_<id>.json` + `brief.md`
(8 planned queries, top-6 fetch verification, dedup, corroboration,
contradictions, limitations, stats). Explicit keyless injection is wired inside
— no flags needed. Re-running the same company creates a NEW run dir entry;
nothing is overwritten.

## 3. Full sweep (ranked HOLD×4)

```bash
cd intelligence_plane && npx tsx scripts/live-opportunity-sweep.ts \
  --targets hsbc,jpmorgan,lgt,swift
```

Per-company form also works:
`--company "HSBC" --domain hsbc.com [--company … --domain …]`.
Options: `[--max-sources N] [--out PATH]` (default: `.research/briefs/ranked.json`).
**Takes ~7+ min**: ~10–25s per company PLUS a mandatory 90s sleep BETWEEN
companies (`INTER_COMPANY_POLITENESS_MS` — do NOT shorten; see §6).

## 4. Rebuild ranked briefs (no network)

```bash
cd intelligence_plane && npx tsx scripts/build-ranked-briefs.ts
```

Deterministic rebuild of `.research/briefs/ranked.json` + per-company
`<slug>.json` from sweep runs overlaid with curated register evidence
(fixed `NOW_ISO`). Use after editing sweep logic to refresh outputs offline.

## 5. Rust briefs API

```bash
VARDHAN_BRIEFS_PATH=intelligence_plane/.research/briefs/ranked.json \
  cargo test -p control_plane_api --test intelligence_briefs
```

With the control plane running (authenticated session required):

```bash
curl -s -H "Authorization: Bearer $SESSION" \
  http://localhost:8080/v1/intelligence/briefs | python3 -m json.tool
curl -s -H "Authorization: Bearer $SESSION" \
  http://localhost:8080/v1/intelligence/briefs/hsbc | python3 -m json.tool
```

Expect 503 `BRIEFS_UNAVAILABLE` if the JSON is missing, 500 `BRIEFS_INVALID`
if malformed, 404 `BRIEF_NOT_FOUND` for unknown companies. Case-insensitive match.

## 6. Throttle playbook (DDG 202 challenge)

Symptom: 8/8 queries × companies return 0 sources; provider maps HTTP 429/202
→ `SEARCH_RATE_LIMITED`. DDG issued an HTTP-202 challenge page during this
mission (all post-HSBC runs empty despite 1.2s per-query politeness).

1. STOP sweeping — further runs stay empty and waste cooldown.
2. Wait out the cooldown (observed: re-runs at +4/+6/+8 min still throttled;
   allow **≥90 min**, ideally overnight, before a re-sweep).
3. Keep the 90s inter-company spacing; do not parallelise companies.
4. Re-run smoke first; only sweep when ≥2/3 smoke queries return results.
5. Honest-empty runs are exit-0 artefacts — keep their JSON (provenance).

## 7. Re-sweep-to-resolve-HOLD procedure

All four briefs are HOLD with machine-readable `resolveEvidence`:

1. Re-run the sweep after cooldown (§6) — fresh runs may surface a dated
   MEDIUM+ trigger (pipeline picks the first corroborated source with
   `eventDate`/`publishedDate` ≤180d as WHY_NOW).
2. If a company flips to GO, `build-ranked-briefs.ts` regenerates its brief
   WITH a draft (GO-only) — review the draft, never auto-send.
   Draft checklist: 60–100 words, exactly one question (verbatim CTA
   `Would it be worth a 10-minute review?`), `we hypothesize` inference label,
   `your existing controls may already cover this` acknowledgement, buyer-role
   title only (no named persons/emails), no price unless a stage has a priceNote.
3. If still HOLD, read `verdictReason` + `limitations`: missing-trigger HOLDs
   need a dated event; ungrounded-speculation HOLDs need rephrasing or new facts.
   Current HOLD reasons: HSBC — no WHY_NOW (score 70); JPMorgan/LGT/Swift —
   no WHY_NOW + curated-only facts (score 60 each).
4. DROP verdicts (none currently) are terminal — re-scope, don't re-sweep.
5. Re-run the Mission-H vitest set + `intelligence_briefs` cargo test, then
   commit the refreshed `.research/` + docs per the Stage-9 recipe.
6. Never edit `ranked.json` by hand — it is generated output. Fix the inputs
   (runs, register, builder logic) and regenerate.

## 8. Current HOLD×4 quick reference (2026-10-17)

| Company | Score | Verdict reason | Draft | Next evidence |
|---|---|---|---|---|
| HSBC | 70 | No WHY_NOW trigger | null (HOLD) | Dated ≤180d trigger from re-sweep |
| JPMorgan | 60 | No WHY_NOW trigger | null (HOLD) | Live (non-curated) sources + dated trigger |
| LGT | 60 | No WHY_NOW trigger | null (HOLD) | Live (non-curated) sources + dated trigger |
| Swift | 60 | No WHY_NOW trigger | null (HOLD) | Live (non-curated) sources + dated trigger |
