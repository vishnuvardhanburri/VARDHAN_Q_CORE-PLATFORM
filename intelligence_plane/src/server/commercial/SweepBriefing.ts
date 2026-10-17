/**
 * VARDHAN — STAGE 7 SWEEP BRIEFING (PURE per-company research → qualify → draft)
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure briefing layer for the live opportunity sweep. Converts one
 * CompanyResearchPipeline result into the ranked brief JSON consumed by the
 * Rust API (part A):
 *
 *   research result → WHY_NOW pick → OpportunityQualificationInput
 *   → qualifyOpportunity + scoreOpportunity → draftOutreach (GO only)
 *
 * Conventions (reuse, do not reinvent):
 *   - WHY_NOW pick mirrors the engine freshness rule: first corroborated
 *     MEDIUM+ source with an eventDate/publishedDate ≤180d. No trigger →
 *     whyNow=null → HOLD per engine rules.
 *   - Sector is fixed to 'Banking'; workflow derives from the top signal
 *     category; publicFacts come from the top-3 verified sources.
 *   - Capability mappings are drawn from QCORE_CAPABILITY_REGISTRY
 *     (sealed-receipts DEMONSTRATED, replay-idempotency DEMONSTRATED,
 *     ed25519-signing PARTIAL) — registry evidenceRefs, never hardcoded.
 *   - Drafts are GO-only via draftOutreachWithReason; anything else yields a
 *     brief-without-email (draft null + machine-readable reason). No auto-send.
 *
 * Purity: briefForCompany/rankBriefs/dropBrief/sweepCompanies are pure
 * functions of their inputs (no network, no randomness). Freshness is derived
 * from the caller-supplied nowIso (default: current time) so tests stay
 * deterministic. sweepCompanies never throws per-company: a throwing pipeline
 * runner is isolated into a DROP brief with a limitations entry.
 */

import {
  QCORE_CAPABILITY_REGISTRY,
  qualifyOpportunity,
  scoreOpportunity,
  type BuyerRole,
  type CapabilityMapping,
  type CommercialStage,
  type OpportunityQualificationInput,
  type PublicFact,
  type QCoreFitLevel,
  type QualificationVerdict,
  type WhyNow,
} from './OpportunityQualification.ts';
import { draftOutreachWithReason } from './OutreachDrafting.ts';
import type {
  CompanyResearchResult,
  CompanyResearchStats,
  CompanySignal,
  VerifiedSource,
} from '../company/CompanyResearchPipeline.ts';

/** Fixed sector for the bank sweep. */
export const SWEEP_SECTOR = 'Banking';

/** Fixed geography for the bank sweep (per-bank geo is not researched). */
export const SWEEP_GEOGRAPHY = 'Global';

/** Fixed buyer function for the bank sweep. */
export const SWEEP_BUYER_FUNCTION = 'Payments Operations / Trade Finance Operations';

/** WHY_NOW freshness ceiling in days (mirrors the engine rule). */
export const SWEEP_FRESH_DAYS_MAX = 180;

const MS_PER_DAY = 86_400_000;

/** Sort weight for ranked output: GO first, then HOLD, then DROP. */
export const VERDICT_RANK: Record<QualificationVerdict, number> = {
  GO: 0,
  HOLD: 1,
  DROP: 2,
};

/** One sweep input: a bank/company display name plus its canonical domain. */
export interface SweepTarget {
  company: string;
  domain: string;
}

/** Condensed WHY_NOW trigger carried on the brief. */
export interface SweepBriefWhyNow {
  event: string;
  sourceUrl: string;
  publishedDate: string;
}

/** Draft-only outreach artefact carried on the brief (null when blocked). */
export interface SweepBriefDraft {
  sub: string;
  body: string;
  wordCount: number;
}

/** Ranked brief JSON consumed by the Rust API (part A). */
export interface SweepBrief {
  company: string;
  domain: string;
  runId: string;
  verdict: QualificationVerdict;
  verdictReason: string;
  score: number;
  whyNow: SweepBriefWhyNow | null;
  publicFacts: PublicFact[];
  capabilityMappings: CapabilityMapping[];
  buyerRole: BuyerRole;
  draft: SweepBriefDraft | null;
  draftBlockedReason: string | null;
  signals: CompanySignal[];
  limitations: string[];
  stats: CompanyResearchStats;
}

/** Derive a banking workflow phrase from the top signal category. */
export function workflowForSignalCategory(category: string | undefined): string {
  switch ((category ?? '').toUpperCase()) {
    case 'CRYPTO_PQC':
      return 'Payments signing and crypto-agility review';
    case 'SECURITY_PROGRAMME':
      return 'Payments operations security review';
    case 'CUSTODY':
      return 'Digital asset custody operations';
    case 'ASSURANCE':
      return 'Audit and assurance operations';
    case 'RESILIENCE':
      return 'Operational resilience and vendor review';
    case 'PROCUREMENT':
      return 'Procurement and vendor onboarding';
    default:
      return SWEEP_BUYER_FUNCTION;
  }
}

/** Fixed buyer role for the bank sweep (CHAMPION in payments operations). */
function sweepBuyerRole(): BuyerRole {
  return {
    function: SWEEP_BUYER_FUNCTION,
    why: 'Owns payment review capacity and trade-finance operations throughput.',
    buyerType: 'CHAMPION',
  };
}

/** Capability mappings bound to registry evidence (never hardcoded refs). */
function sweepCapabilityMappings(): CapabilityMapping[] {
  const levels: Record<string, QCoreFitLevel> = {
    'sealed-receipts': 'DEMONSTRATED',
    'replay-idempotency': 'DEMONSTRATED',
    'ed25519-signing': 'PARTIAL',
  };
  const out: CapabilityMapping[] = [];
  for (const entry of QCORE_CAPABILITY_REGISTRY) {
    const level: QCoreFitLevel | undefined = levels[entry.capability];
    if (level !== undefined) {
      out.push({
        capability: entry.capability,
        evidenceRef: { sourceFile: entry.evidenceRef.sourceFile, testName: entry.evidenceRef.testName },
        level,
      });
    }
  }
  return out;
}

/** Single DISCOVERY_15K stage with concrete customer inputs (feasibility). */
function sweepCommercialStages(): CommercialStage[] {
  return [
    {
      stage: 'DISCOVERY_15K',
      buyerOutcome: 'Scoped diagnostic of review load in the target workflow with evidence-backed findings.',
      deliverables: ['Diagnostic report', 'Evidence pack'],
      customerInputs: ['Sandbox access for receipt verification', 'Architecture overview call'],
      acceptanceCriteria: ['Report delivered in 3 weeks', 'Findings reviewed with sponsor'],
      dependencies: ['NDA signed'],
    },
  ];
}

/** Whole days between an ISO date and nowMs; null when unparseable. */
function freshnessDaysOf(dateIso: string, nowMs: number): number | null {
  const parsed = Date.parse(dateIso);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.floor((nowMs - parsed) / MS_PER_DAY));
}

interface WhyNowPick {
  source: VerifiedSource;
  triggerDate: string;
  freshnessDays: number;
}

/**
 * Strongest WHY_NOW: first corroborated MEDIUM+ source with an
 * eventDate/publishedDate ≤180d. Null when no source qualifies.
 */
function pickWhyNowSource(sources: readonly VerifiedSource[], nowMs: number): WhyNowPick | null {
  for (const source of sources) {
    if (source.confidence !== 'HIGH' && source.confidence !== 'MEDIUM') continue;
    if (source.corroboratedBy.length === 0) continue;
    const trigger: string | undefined = source.eventDate ?? source.publishedDate;
    if (trigger === undefined || trigger.trim().length === 0) continue;
    const freshnessDays: number | null = freshnessDaysOf(trigger, nowMs);
    if (freshnessDays === null || freshnessDays > SWEEP_FRESH_DAYS_MAX) continue;
    return { source, triggerDate: trigger, freshnessDays };
  }
  return null;
}

/** Top-N URL-backed facts from fetch-verified sources (HTTP 200 + excerpt). */
function topPublicFacts(sources: readonly VerifiedSource[], limit: number): PublicFact[] {
  const out: PublicFact[] = [];
  for (const source of sources) {
    if (out.length >= limit) break;
    if (source.httpStatus !== 200 || source.excerpt.trim().length === 0) continue;
    const title: string = source.title.trim();
    const excerpt: string = source.excerpt.replace(/\s+/g, ' ').trim().slice(0, 220);
    const fact: string = title.length > 0 ? `${title} — ${excerpt}` : excerpt;
    if (fact.length === 0) continue;
    out.push({ fact, sourceUrl: source.canonicalUrl });
  }
  return out;
}

/**
 * Pure per-company briefing: research result → qualify → draft.
 * Never throws for a well-formed result; use sweepCompanies (or a
 * try/catch) to isolate unexpected runner failures.
 */
export function briefForCompany(
  result: CompanyResearchResult,
  company: string,
  domain: string,
  nowIso?: string,
): SweepBrief {
  const parsedNow: number = nowIso !== undefined ? Date.parse(nowIso) : Date.now();
  const nowMs: number = Number.isNaN(parsedNow) ? Date.now() : parsedNow;
  const workflow: string = workflowForSignalCategory(result.signals[0]?.category);
  const publicFacts: PublicFact[] = topPublicFacts(result.sources, 3);
  const capabilityMappings: CapabilityMapping[] = sweepCapabilityMappings();
  const buyerRole: BuyerRole = sweepBuyerRole();

  const picked: WhyNowPick | null = pickWhyNowSource(result.sources, nowMs);
  let whyNowInput: WhyNow | null = null;
  if (picked !== null) {
    const title: string = picked.source.title.trim();
    const excerpt: string = picked.source.excerpt.replace(/\s+/g, ' ').trim().slice(0, 200);
    const built: WhyNow = {
      event: title.length > 0 ? title : excerpt,
      sourceUrl: picked.source.canonicalUrl,
      publishedDate: picked.source.publishedDate ?? picked.triggerDate,
      relevance: `Trigger may affect review load in the ${workflow} workflow.`,
      freshnessDays: picked.freshnessDays,
    };
    if (picked.source.eventDate !== undefined) built.eventDate = picked.source.eventDate;
    whyNowInput = built;
  }

  const topFact: string = publicFacts[0]?.fact ?? 'No verified public facts in this run.';
  const problemHypothesis: string =
    whyNowInput !== null
      ? `Review load for the ${workflow} workflow may be rising as ${company} pursues its recently reported programme.`
      : `It is unclear whether ${company} faces near-term review pressure in the ${workflow} workflow.`;
  const inferenceVsFact = `Fact: ${topFact} Inference: capacity pressure is an unconfirmed hypothesis.`;

  const input: OpportunityQualificationInput = {
    company,
    sector: SWEEP_SECTOR,
    geography: SWEEP_GEOGRAPHY,
    workflow,
    publicFacts,
    problemHypothesis,
    inferenceVsFact,
    whyNow: whyNowInput,
    capabilityMappings,
    buyerRole,
    commercial: sweepCommercialStages(),
  };
  if (nowIso !== undefined) input.nowIso = nowIso;

  const qualified = qualifyOpportunity(input);
  const score: number = scoreOpportunity(input);
  const drafted = draftOutreachWithReason(qualified);

  const limitations: string[] = [...result.limitations];
  if (whyNowInput === null) {
    limitations.push(
      'No fresh corroborated MEDIUM+ trigger found — HOLD per engine rules (GO requires a dated, sourced WHY_NOW ≤180d).',
    );
  }

  return {
    company,
    domain,
    runId: result.runId,
    verdict: qualified.verdict,
    verdictReason: qualified.verdictReason,
    score,
    whyNow:
      whyNowInput === null
        ? null
        : {
            event: whyNowInput.event,
            sourceUrl: whyNowInput.sourceUrl,
            publishedDate: whyNowInput.publishedDate,
          },
    publicFacts,
    capabilityMappings,
    buyerRole,
    draft:
      drafted.draft === null
        ? null
        : { sub: drafted.draft.subject, body: drafted.draft.body, wordCount: drafted.draft.wordCount },
    draftBlockedReason: drafted.reason,
    signals: [...result.signals],
    limitations,
    stats: { ...result.stats },
  };
}

/** DROP brief for an isolated per-company failure (honest empty, score 0). */
export function dropBrief(company: string, domain: string, reason: string, runId = 'sweep_failed'): SweepBrief {
  return {
    company,
    domain,
    runId,
    verdict: 'DROP',
    verdictReason: reason,
    score: 0,
    whyNow: null,
    publicFacts: [],
    capabilityMappings: sweepCapabilityMappings(),
    buyerRole: sweepBuyerRole(),
    draft: null,
    draftBlockedReason: 'Brief-without-email: company failed before drafting.',
    signals: [],
    limitations: [reason],
    stats: { sourcesRetrieved: 0, sourcesAttempted: 0, duplicateRate: 0, claimsWithEvidencePct: 0 },
  };
}

/** Ranked order: GO first, then HOLD, then DROP; score desc within a verdict. */
export function rankBriefs(briefs: readonly SweepBrief[]): SweepBrief[] {
  return [...briefs].sort(
    (a: SweepBrief, b: SweepBrief) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || b.score - a.score,
  );
}

/**
 * Sweep a target list with an injected pipeline runner. Never throws
 * per-company: a throwing runner is isolated into a DROP brief (with the
 * error recorded in limitations) while the remaining companies still brief.
 */
export async function sweepCompanies(
  targets: readonly SweepTarget[],
  runPipeline: (company: string, domain: string) => Promise<CompanyResearchResult>,
  nowIso?: string,
): Promise<SweepBrief[]> {
  const briefs: SweepBrief[] = [];
  for (const target of targets) {
    try {
      const result: CompanyResearchResult = await runPipeline(target.company, target.domain);
      briefs.push(briefForCompany(result, target.company, target.domain, nowIso));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      briefs.push(dropBrief(target.company, target.domain, `Per-company sweep failed (isolated, others unaffected): ${message}`));
    }
  }
  return briefs;
}
