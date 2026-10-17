# Mission H — Live Research Validation (2026-10-17)

Honest record of the live-web validation exercise behind the HOLD×4 sweep.
All runs keyless (no API keys); all artefacts under `intelligence_plane/.research/`.

## 1. Timestamps (UTC, `2026-10-17`)

| Company | Run | Started → Finished | Result |
|---|---|---|---|
| HSBC | `run_20261017_93640ac8` | 10:08:14 → 10:08:38Z | 12/12 sources, 6 verified |
| JPMorgan | `run_20261017_15a70711` / `…75a48bb2` | 10:08:38Z / 10:12:33Z | 0 sources (throttled) |
| LGT | `run_20261017_82489de1` / `…909ee989` | 10:08:47Z / 10:14:43Z | 0 sources (throttled) |
| Swift | `run_20261017_a03f9260` / `…6e0e0b07` | 10:08:56Z / 10:16:52Z | 0 sources (throttled) |

JPMorgan/LGT/Swift were each attempted TWICE (initial + post-cooldown retry);
all retries stayed empty — evidence for the DDG throttle finding, not a bug.

## 2. Queries executed per company (8 planned, `planQueries`)

`"<Company>" <domain> + security strategy | post-quantum cryptography
crypto-agility PQC | regulatory compliance programme | audit attestation
assurance | custody digital assets | operational resilience vendor outage |
technology partnership | procurement tender programme`. HSBC: all 8 returned hits.
Others: 8/8 empty per run (e.g. Swift `run_…a03f9260`: 8 queries, 0 results, honest-empty limitation).

## 3. Sources opened (HSBC: 6 verified HTTP-200)

Verified fetch (title — excerpt>0 chars): `us.hsbc.com/help/security/protection-measures`,
`us.hsbc.com/help/security`, `hsbc.com/online-security`,
`hsbc.com/online-security/secure-email-communications`,
`hsbcnet.com/online-security/security-measures`,
`business.us.hsbc.com/en/regulations/hsbc-safeguard`. 6 further hits
(expat/in-views/Medium/LinkedIn) stayed search-only (`verifyTop=6` cap) and are
listed as limitations — never promoted to facts.

## 4. Trigger found: NONE dated → HOLD

No source yielded a pipeline-extracted `publishedDate`/`eventDate` ≤180d, so
`whyNow: null` for all four briefs → HOLD per hard rule (a). JPMorgan/LGT/Swift
briefs overlay curated `SOURCE_REGISTER` signals (QKD trial, SEBA custody, CSP
regime) with `httpStatus: 0`, prose-only dates NOT promoted — still HOLD, honestly.

## 5. Q-Core mapping applied (uniform, registry-backed)

`sealed-receipts` DEMONSTRATED + `replay-idempotency` DEMONSTRATED +
`ed25519-signing` PARTIAL (registry evidenceRefs). Fit sub-score 30 for all four.

## 6. Buyer role / verdict / discovery question / draft

Buyer (all): **Payments Operations / Trade Finance Operations (CHAMPION)** —
owns payment review capacity and trade-finance throughput. Verdicts: **HOLD×4**,
reason `No WHY_NOW trigger` (scores: HSBC 70, others 60). Drafts: **all null**,
`draftBlockedReason: 'Brief-without-email: verdict is HOLD; outreach drafts require GO.'`

Per-company signals (all HOLD — trigger, not signal, is the blocker):

- **HSBC** (live, 12 signals): 6 verified GENERAL_TECH (protection-measures,
  security center, online-security hub, secure-email, HSBCnet measures, Safeguard
  fraud protection) + 2 unverified GENERAL_TECH (expat/IN) + 4 unverified
  CRYPTO_PQC (quantum-defences view, 2× Medium governance/PQC, LinkedIn banks-quantum).
- **JPMorgan** (curated, 1 CRYPTO_PQC signal): quantum-network programme —
  FLARE QKD trial + quantum-resistant ledger research (QKD press release 2022,
  tech-blog writeup, QKD prototype PDF, Cointelegraph ledger piece).
- **LGT** (curated, 1 CUSTODY signal): digital-asset custody via SEBA
  broker-custodian (LGT crypto announcement, bitcoinnews.ch, LGT_Group wiki, lgt.com).
- **Swift** (curated, 1 ASSURANCE signal): Customer Security Programme
  mandatory-controls + attestation (SWIFT wiki, ISACA CSP journal, 10-years-on
  CSP retrospective, Bangladesh Bank robbery context).

Proposed (not pipeline-generated) discovery questions for the re-sweep:
HSBC — quantum-defences view → crypto-agility timeline?; JPMorgan — QKD trial →
production-ledger relevance?; LGT — SEBA custody → settlement-signing needs?;
Swift — CSP attestation → member review capacity?

## 7. Uncertainties

PQC view undated (HSBC quantum-defences page unverified); register prose dates
unpromoted (JPMorgan 2022 QKD release exists as text, not as extracted event
date); DDG throttle leaves 3/4 companies on curated-not-live evidence.

## 8. Metrics

Sources/query: HSBC 1.5 (12/8), others 0. Verify rate: HSBC 50% (6/12).
Corroboration (`claimsWithEvidencePct`): HSBC 50%, others 0%. Score composition:
HSBC 70 = 10+30+15+15+0; others 60 = 0+30+15+15+0 (evidence/freshness zeroed by
missing WHY_NOW). See `OPPORTUNITY_QUALIFICATION_MODEL.md` for the weight table.
