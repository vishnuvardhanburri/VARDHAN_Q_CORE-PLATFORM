# Mission I — Customer Entry Points (live revalidation 2026-10-17)

Companion to `CUSTOMER_ENTRY_POINTS.md` (Mission H ranked set). This file records the
Mission I final live re-sweep only. Verdict: **HOLD×4, zero GO** — the valid outcome;
no trigger met the dated bar and none was manufactured. Swift is financial-messaging
infrastructure (not a bank); the same evidence bar applies.

Sweep log: `/tmp/sweep_missionI_final.log` (4 lines, one per company).
Ranked artifact: `intelligence_plane/.research/briefs/ranked.json` (4 entries, all
Rust contract keys present, `why_now: null` throughout).
Fresh briefs: `hsbc-com.json` (run `run_20261017_4aa3b732`), `jpmorgan-com.json`
(run `run_20261017_73111493`), `lgt-com.json` (run `run_20261017_7950706e`),
`swift-com.json` (run `run_20261017_3007c308`).

## HSBC — HOLD 70 (live-verified posture, no dated trigger)

1. Company/domain: HSBC / hsbc.com. 2. Trigger: NONE dated — strongest verified
   source `https://www.us.hsbc.com/help/security/protection-measures` (HTTP 200,
   HIGH, corroborated ×4) is evergreen hygiene content. 3. Freshness: null → HOLD.
4. Demonstrated capability: sealed-receipts DEMONSTRATED
   (`backend/vardhan_receipt`/validate-canonical) vs Safeguard/HSBCnet posture
   (6 verified GENERAL_TECH signals). 5. Buyer: Payments Operations / Trade Finance
   Operations (CHAMPION). 6. Discovery question: "Your Safeguard and HSBCnet
   security-measures pages show a mature controls posture — where does payment
   review capacity hurt most when threat advisories spike?" 7. Next: 10-minute
   session mapping one payment-review workflow to the sealed-receipt evidence pack
   (facts human-verified first). 8. Risks: nurture-only, no dated trigger;
   2 search-only sources unverified (HTTP 0); existing controls acknowledged, never
   deficiency language. 9. Verdict/score: HOLD / 70, draft null (engine rule).

## JPMorgan — HOLD 60 (throttled; projection separate)

1. JPMorgan / jpmorgan.com. 2. Trigger: NONE fetch-verified
   (full review: `JPMORGAN_EVIDENCE_REVIEW.md`). 3. Freshness: null → HOLD.
4. replay-idempotency DEMONSTRATED — background relevance to FLARE ledger research
   only, not a claim. 5. Buyer: as above. 6. Question: "FLARE's QKD trial secured a
   blockchain app at 800 Gbps — if that research ever touches production settlement,
   where would replay assurance sit in review?" 7. Next: monitor; session only on a
   future verified trigger. 8. Risks: Forbes 403/captcha, BW slug-date unverified,
   2022 material stale; what-if GO/94 is hypothesis only. 9. HOLD / 60, no draft.

## LGT — HOLD 60 (throttled; SEBA custody is undated context)

1. LGT / lgt.com. 2. Trigger: NONE dated (0 live sources). 3. Freshness: null.
4. ed25519-signing PARTIAL — stated as PARTIAL; no custody-signing claim.
5. Buyer: as above. 6. Question: "Your SEBA-partnered direct crypto offering puts
   signing operations in focus — how is custody-signing review capacity holding up?"
7. Next: session only on a verified custody trigger. 8. Risks: zero live sources;
   register as context only. 9. HOLD / 60, no draft.

## Swift — HOLD 60 (infrastructure; CSP undated context)

1. Swift / swift.com (messaging infrastructure). 2. Trigger: NONE dated (0 live
   sources). 3. Freshness: null. 4. sealed-receipts DEMONSTRATED — relevant to CSP
   attestation evidence IF a member-driven trigger appears; context only today.
5. Buyer: as above (weaker mapping — infrastructure, not a bank). 6. Question:
   "Under CSP mandatory-controls attestation, where does member evidence-review
   capacity hurt most at attestation crunch time?" 7. Next: session only on a
   verified CSP trigger. 8. Risks: buyer mapping weaker; zero live sources.
9. HOLD / 60, no draft.

## Standing rules (unchanged)

No drafts produced (HOLD → `draft: null` + `draftBlockedReason`); nothing auto-sent
or enrolled — any future draft needs GO + human approval. Pricing (£15k discovery
→ £60k PoV → production scoped) stays out of nurture unless authorised.
