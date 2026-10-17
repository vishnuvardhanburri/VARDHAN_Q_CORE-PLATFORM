/**
 * VARDHAN — STAGE 5 RANKED BRIEFS BUILDER (LIVE HSBC + CURATED REGISTERS)
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds the ranked entry-point set HONESTLY from available evidence:
 *   - HSBC: live sweep run_20261017_93640ac8.json (12/12 sources, 6 verified
 *     HTTP-200 GENERAL_TECH security-center pages, NO dated event ≤180d).
 *   - JPMorgan / LGT / Swift: honest-empty live runs (DDG 202 challenge
 *     throttle) OVERLAID with curated research/SOURCE_REGISTER.md evidence.
 *     Curated sources are marked provenance-CURATED: httpStatus 0 (not
 *     fetch-verified in this sweep), NO pipeline-extracted publishedDate /
 *     eventDate (register dates live in prose, not in re-fetched HTML meta),
 *     so the engine freshness rule yields whyNow=null → HOLD. No GO, no
 *     draft, no fabricated dates or URLs.
 *
 * Usage (from intelligence_plane/):
 *   npx tsx scripts/build-ranked-briefs.ts
 *
 * Outputs:
 *   - .research/briefs/ranked.json        (Rust BriefSummary array: company,
 *     verdict, score, signal_url, why_now, buyer_role)
 *   - .research/briefs/<slug>.json        (full SweepBrief per company)
 *
 * Purity: ranking/drafting reuse briefForCompany + rankBriefs from
 * SweepBriefing.ts (pure functions). This script only does file IO.
 * No network, no randomness. Fixed NOW_ISO keeps freshness deterministic.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  briefForCompany,
  rankBriefs,
  type SweepBrief,
} from '../src/server/commercial/SweepBriefing.ts';
import type {
  CompanyResearchResult,
  CompanySignal,
  VerifiedSource,
} from '../src/server/company/CompanyResearchPipeline.ts';

/** Fixed "now" so engine freshness math stays deterministic. */
const NOW_ISO = '2026-10-17T12:00:00.000Z';

/** Throttle limitation recorded on every curated (non-live) brief. */
const THROTTLE_LIMITATION =
  'Live DDG sweep throttled (HTTP 202 challenge) — brief built from curated SOURCE_REGISTER; re-run live sweep before outreach';

/** Script dir → intelligence_plane root → .research/briefs. */
const SCRIPT_DIR: string = path.dirname(fileURLToPath(import.meta.url));
const IP_ROOT: string = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT: string = path.resolve(IP_ROOT, '..');
const BRIEFS_DIR: string = path.join(IP_ROOT, '.research', 'briefs');
const COMPANIES_DIR: string = path.join(IP_ROOT, '.research', 'companies');

/** Curated source row copied verbatim from research/SOURCE_REGISTER.md. */
interface CuratedRow {
  id: string;
  title: string;
  publisher: string;
  sourceType: VerifiedSource['sourceType'];
  url: string;
  claim: string;
  confidence: VerifiedSource['confidence'];
  corroboratedBy: string[];
}

/** Rust BriefSummary shape (backend/control_plane_api/src/intelligence_briefs.rs). */
interface BriefSummary {
  company: string;
  verdict: 'GO' | 'HOLD' | 'DROP';
  score: number;
  signal_url: string | null;
  why_now: string | null;
  buyer_role: string | null;
}

function readJsonFile(filePath: string): CompanyResearchResult {
  const raw: string = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as CompanyResearchResult;
}

/**
 * Overlay curated SOURCE_REGISTER rows onto an honest-empty live run.
 * Provenance is explicit: httpStatus 0 (not fetch-verified this sweep),
 * no publishedDate/eventDate (no re-fetched HTML meta to extract one from),
 * signals verified:false. Every sourceUrl exists in SOURCE_REGISTER.
 */
function curatedResult(
  base: CompanyResearchResult,
  rows: readonly CuratedRow[],
  signalCategory: string,
  signalStatement: string,
): CompanyResearchResult {
  const retrievedAt: string = NOW_ISO;
  const sources: VerifiedSource[] = rows.map((row: CuratedRow): VerifiedSource => ({
    canonicalUrl: row.url,
    publisher: row.publisher,
    sourceType: row.sourceType,
    title: row.title,
    excerpt: `[${row.id} curated from SOURCE_REGISTER] ${row.claim}`,
    retrievedAt,
    httpStatus: 0,
    corroboratedBy: [...row.corroboratedBy],
    confidence: row.confidence,
  }));
  const signals: CompanySignal[] = [
    {
      category: signalCategory,
      statement: signalStatement,
      sourceUrls: rows.map((row: CuratedRow): string => row.url),
      verified: false,
    },
  ];
  return {
    ...base,
    sources,
    signals,
    limitations: [...base.limitations, THROTTLE_LIMITATION],
    stats: {
      sourcesRetrieved: rows.length,
      sourcesAttempted: rows.length,
      duplicateRate: 0,
      claimsWithEvidencePct: 0,
    },
  };
}

/** JPMorgan curated rows (JPM-01..04, research/SOURCE_REGISTER.md). */
const JPM_ROWS: readonly CuratedRow[] = [
  {
    id: 'JPM-01',
    title: 'QKD network for mission-critical blockchain app',
    publisher: 'jpmorganchase.com',
    sourceType: 'OFFICIAL_COMPANY',
    url: 'https://www.jpmorganchase.com/newsroom/press-releases/2022/jpmc-toshiba-ciena-build-first-quantum-key-distribution-network',
    claim:
      'JPMC/Toshiba/Ciena announced metro QKD trial securing a blockchain app at 800 Gbps.',
    confidence: 'HIGH',
    corroboratedBy: [
      'https://www.jpmorgan.com/technology/technology-blog/jpmc-toshiba-ciena-build-first-quantum-key-distribution-network-critical-blockchain-application',
    ],
  },
  {
    id: 'JPM-02',
    title: 'FLARE organisation on tech blog',
    publisher: 'jpmorgan.com',
    sourceType: 'OFFICIAL_COMPANY',
    url: 'https://www.jpmorgan.com/technology/technology-blog/jpmc-toshiba-ciena-build-first-quantum-key-distribution-network-critical-blockchain-application',
    claim: 'JPMC operates named applied-research lab FLARE authoring quantum-network research.',
    confidence: 'HIGH',
    corroboratedBy: [
      'https://www.jpmorganchase.com/newsroom/press-releases/2022/jpmc-toshiba-ciena-build-first-quantum-key-distribution-network',
    ],
  },
  {
    id: 'JPM-03',
    title: '800 Gbps quantum-secured optical paper',
    publisher: 'jpmorganchase.com',
    sourceType: 'OFFICIAL_COMPANY',
    url: 'https://www.jpmorganchase.com/content/dam/jpm/cib/complex/content/technology/publications/qkd-research-prototype-project-5-1.pdf',
    claim: 'JPMC published experimental research on quantum-secured optical channels.',
    confidence: 'HIGH',
    corroboratedBy: [],
  },
  {
    id: 'JPM-04',
    title: 'Quantum-resistant blockchain research (coverage)',
    publisher: 'cointelegraph.com',
    sourceType: 'CREDIBLE_REPORTING',
    url: 'https://cointelegraph.com/news/jpmorgan-unveils-research-on-quantum-resistant-blockchain-network',
    claim: 'Industry press reported JPMC quantum-resistant blockchain research with FLARE quoted.',
    confidence: 'MEDIUM',
    corroboratedBy: [],
  },
];

/** LGT curated rows (LGT-01..04, research/SOURCE_REGISTER.md). */
const LGT_ROWS: readonly CuratedRow[] = [
  {
    id: 'LGT-01',
    title: 'Direct crypto investments via SEBA',
    publisher: 'lgt.com',
    sourceType: 'OFFICIAL_COMPANY',
    url: 'https://www.lgt.com/global-en/about-lgt/lgt-news/lgt-now-offering-direct-investments-in-cryptocurrencies-19414',
    claim: 'LGT Bank announced direct BTC/ETH investments with SEBA as broker-custodian.',
    confidence: 'HIGH',
    corroboratedBy: [
      'https://bitcoinnews.ch/30393/lgt-bank-selects-seba-bank-to-provide-digital-asset-custody-and-brokerage-services/',
    ],
  },
  {
    id: 'LGT-02',
    title: 'SEBA custody/brokerage selection (coverage)',
    publisher: 'bitcoinnews.ch',
    sourceType: 'CREDIBLE_REPORTING',
    url: 'https://bitcoinnews.ch/30393/lgt-bank-selects-seba-bank-to-provide-digital-asset-custody-and-brokerage-services/',
    claim: 'Industry coverage corroborates LGT selection of SEBA for custody/brokerage.',
    confidence: 'MEDIUM',
    corroboratedBy: [
      'https://www.lgt.com/global-en/about-lgt/lgt-news/lgt-now-offering-direct-investments-in-cryptocurrencies-19414',
    ],
  },
  {
    id: 'LGT-03',
    title: 'LGT Group profile and scale',
    publisher: 'en.wikipedia.org',
    sourceType: 'CREDIBLE_REPORTING',
    url: 'https://en.wikipedia.org/wiki/LGT_Group',
    claim: 'LGT is princely-owned, ~CHF 386bn AUM, ~6,000 staff, 40+ locations.',
    confidence: 'MEDIUM',
    corroboratedBy: [],
  },
  {
    id: 'LGT-04',
    title: 'LGT institutional presence',
    publisher: 'lgt.com',
    sourceType: 'OFFICIAL_COMPANY',
    url: 'https://www.lgt.com',
    claim: 'LGT maintains public institutional pages on heritage and footprint.',
    confidence: 'HIGH',
    corroboratedBy: [],
  },
];

/** Swift curated rows (SWF-01..04, research/SOURCE_REGISTER.md). */
const SWIFT_ROWS: readonly CuratedRow[] = [
  {
    id: 'SWF-01',
    title: 'Swift cooperative identity',
    publisher: 'en.wikipedia.org',
    sourceType: 'CREDIBLE_REPORTING',
    url: 'https://en.wikipedia.org/wiki/Society_for_Worldwide_Interbank_Financial_Telecommunication',
    claim: 'Swift is a Belgian cooperative (1973) running cross-border payments messaging.',
    confidence: 'MEDIUM',
    corroboratedBy: [],
  },
  {
    id: 'SWF-02',
    title: 'Customer Security Program lessons',
    publisher: 'isaca.org',
    sourceType: 'CREDIBLE_REPORTING',
    url: 'https://www.isaca.org/resources/isaca-journal/issues/2022/volume-1/swifts-customer-security-program-lessons-for-the-cybersecurity-community',
    claim: 'Post-2016 CSP introduced mandatory CSCF controls (16+11 v1) with attestation.',
    confidence: 'MEDIUM',
    corroboratedBy: ['https://worldinformatixcs.com/2026/05/27/ten-years-on-swift-csp-cybersecurity/'],
  },
  {
    id: 'SWF-03',
    title: 'CSP ten-year retrospective',
    publisher: 'worldinformatixcs.com',
    sourceType: 'CREDIBLE_REPORTING',
    url: 'https://worldinformatixcs.com/2026/05/27/ten-years-on-swift-csp-cybersecurity/',
    claim: 'Retrospective traces decade of mandatory CSP controls after 2016 trigger.',
    confidence: 'MEDIUM',
    corroboratedBy: [
      'https://www.isaca.org/resources/isaca-journal/issues/2022/volume-1/swifts-customer-security-program-lessons-for-the-cybersecurity-community',
    ],
  },
  {
    id: 'SWF-04',
    title: 'Bangladesh Bank robbery (context)',
    publisher: 'en.wikipedia.org',
    sourceType: 'CREDIBLE_REPORTING',
    url: 'https://en.wikipedia.org/wiki/Bangladesh_Bank_robbery',
    claim: 'Feb-2016 fraudulent Swift instructions triggered the CSP; no Swift deficiency asserted.',
    confidence: 'MEDIUM',
    corroboratedBy: [],
  },
];

/** Map a full SweepBrief to the Rust BriefSummary contract. */
function toBriefSummary(brief: SweepBrief): BriefSummary {
  const signalUrl: string | null =
    brief.signals[0]?.sourceUrls[0] ?? brief.publicFacts[0]?.sourceUrl ?? null;
  return {
    company: brief.company,
    verdict: brief.verdict,
    score: brief.score,
    signal_url: signalUrl,
    why_now: brief.whyNow?.event ?? null,
    buyer_role: brief.buyerRole.function ?? null,
  };
}

function main(): void {
  // 1. Load evidence: 1 live HSBC run + 3 honest-empty throttled runs.
  const hsbcLive: CompanyResearchResult = readJsonFile(
    path.join(COMPANIES_DIR, 'hsbc-com', 'run_20261017_93640ac8.json'),
  );
  const jpmEmpty: CompanyResearchResult = readJsonFile(
    path.join(COMPANIES_DIR, 'jpmorgan-com', 'run_20261017_75a48bb2.json'),
  );
  const lgtEmpty: CompanyResearchResult = readJsonFile(
    path.join(COMPANIES_DIR, 'lgt-com', 'run_20261017_909ee989.json'),
  );
  const swiftEmpty: CompanyResearchResult = readJsonFile(
    path.join(COMPANIES_DIR, 'swift-com', 'run_20261017_6e0e0b07.json'),
  );

  // 2. Brief each company through the pure engine (fixed now → deterministic).
  const briefs: SweepBrief[] = rankBriefs([
    briefForCompany(hsbcLive, 'HSBC', 'hsbc.com', NOW_ISO),
    briefForCompany(
      curatedResult(
        jpmEmpty,
        JPM_ROWS,
        'CRYPTO_PQC',
        'JPMorgan Chase quantum-network research programme (FLARE QKD trial + quantum-resistant ledger research, curated register evidence).',
      ),
      'JPMorgan',
      'jpmorgan.com',
      NOW_ISO,
    ),
    briefForCompany(
      curatedResult(
        lgtEmpty,
        LGT_ROWS,
        'CUSTODY',
        'LGT Bank digital-asset custody offering via SEBA broker-custodian (curated register evidence).',
      ),
      'LGT',
      'lgt.com',
      NOW_ISO,
    ),
    briefForCompany(
      curatedResult(
        swiftEmpty,
        SWIFT_ROWS,
        'ASSURANCE',
        'Swift Customer Security Programme mandatory-controls regime with attestation (curated register evidence).',
      ),
      'Swift',
      'swift.com',
      NOW_ISO,
    ),
  ]);

  // 3. Honesty guardrails: zero fabricated dates/URLs, zero GO without a
  //    live-verified dated trigger, zero drafts without GO.
  for (const brief of briefs) {
    if (brief.verdict === 'GO' && brief.whyNow === null) {
      throw new Error(`Honesty violation: GO without WHY_NOW for ${brief.company}`);
    }
    if (brief.draft !== null && brief.verdict !== 'GO') {
      throw new Error(`Honesty violation: draft without GO for ${brief.company}`);
    }
  }

  // 4. Write ranked.json (Rust contract) + per-company full briefs.
  fs.mkdirSync(BRIEFS_DIR, { recursive: true });
  const ranked: BriefSummary[] = briefs.map(toBriefSummary);
  fs.writeFileSync(path.join(BRIEFS_DIR, 'ranked.json'), `${JSON.stringify(ranked, null, 2)}\n`);
  const slugs: Record<string, string> = { HSBC: 'hsbc', JPMorgan: 'jpmorgan', LGT: 'lgt', Swift: 'swift' };
  for (const brief of briefs) {
    const slug: string = slugs[brief.company] ?? brief.company.toLowerCase();
    fs.writeFileSync(path.join(BRIEFS_DIR, `${slug}.json`), `${JSON.stringify(brief, null, 2)}\n`);
  }

  // 5. Report.
  for (const brief of briefs) {
    const summary: BriefSummary | undefined = ranked.find(
      (entry: BriefSummary): boolean => entry.company === brief.company,
    );
    console.log(
      `${brief.company} | ${brief.domain} | ${brief.runId} | verdict=${brief.verdict} ` +
        `| score=${brief.score} | whyNow=${brief.whyNow === null ? 'null' : 'present'} ` +
        `| draft=${brief.draft === null ? 'null' : 'present'} ` +
        `| draftBlockedReason=${brief.draftBlockedReason ?? 'null'} ` +
        `| signal_url=${summary?.signal_url ?? 'null'}`,
    );
  }
  console.log(`Wrote ${ranked.length} ranked summaries + ${briefs.length} per-company briefs to ${BRIEFS_DIR}`);
  console.log(`Repo root for docs step: ${REPO_ROOT}`);
}

main();
