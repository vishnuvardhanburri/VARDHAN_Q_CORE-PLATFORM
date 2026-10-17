/**
 * VARDHAN — JPM WHAT-IF GO PROJECTION (READ-ONLY EVIDENCE + LABELED PROJECTION)
 * ─────────────────────────────────────────────────────────────────────────────
 * What-if projection only: answers "does JPM qualify even WITH recovered
 * dates?" using the sealed engines WITHOUT changing engine rules and WITHOUT
 * modifying ranked.json.
 *
 * Input: .research/briefs/jpmorgan-com.json as the base brief (capability
 * mappings / buyerRole / publicFacts / workflow) + a caller-supplied WHY_NOW
 * (Forbes 2026-07-01 AI-at-scale trigger, freshnessDays computed from
 * 2026-07-01 to today). Runs qualifyOpportunity + scoreOpportunity +
 * draftOutreachWithReason and prints verdict / score / draft wordCount +
 * full verdictReason plus the date-confidence caveat block.
 *
 * Projection only — the official brief stays HOLD until a fetch-verified
 * dated trigger exists. This script is NOT imported from any production path.
 *
 * Usage (from intelligence_plane/):
 *   npx tsx scripts/jpm-whatif-projection.ts
 * Exit 0 on success.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  qualifyOpportunity,
  scoreOpportunity,
  type BuyerRole,
  type CapabilityMapping,
  type CommercialStage,
  type OpportunityQualificationInput,
  type PublicFact,
  type WhyNow,
} from '../src/server/commercial/OpportunityQualification.ts';
import { draftOutreachWithReason } from '../src/server/commercial/OutreachDrafting.ts';

/** Script dir → intelligence_plane root → base brief path. */
const SCRIPT_DIR: string = path.dirname(fileURLToPath(import.meta.url));
const IP_ROOT: string = path.resolve(SCRIPT_DIR, '..');
const BASE_BRIEF_PATH: string = path.join(IP_ROOT, '.research', 'briefs', 'jpmorgan-com.json');

/** Fixed sector/geography mirror the sweep conventions (Banking / Global). */
const SWEEP_SECTOR = 'Banking';
const SWEEP_GEOGRAPHY = 'Global';

/** Fallback buyer function mirrors SweepBriefing.SWEEP_BUYER_FUNCTION. */
const FALLBACK_WORKFLOW = 'Payments Operations / Trade Finance Operations';

const MS_PER_DAY = 86_400_000;

/** Verbatim date-confidence caveat (projection only, official brief stays HOLD). */
const CAVEAT_BLOCK =
  'Forbes date MEDIUM (snippet+slug, page fetch 403 — no meta-tag confirmation); ' +
  'Businesswire date HIGH (mirror header). Projection only — official brief stays HOLD ' +
  'until a fetch-verified dated trigger exists.';

/** Minimal shape of the base brief file we reuse (read-only evidence). */
interface BaseBriefFile {
  company: string;
  capabilityMappings: CapabilityMapping[];
  buyerRole: BuyerRole;
  publicFacts: PublicFact[];
  workflow?: string;
  signals?: Array<{ category?: string }>;
}

/** Derive a banking workflow phrase mirroring SweepBriefing.workflowForSignalCategory. */
function workflowForSignalCategory(category: string | undefined): string {
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
      return FALLBACK_WORKFLOW;
  }
}

/** Single DISCOVERY_15K stage with concrete customer inputs (feasibility). */
function projectionCommercialStages(): CommercialStage[] {
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function loadBaseBrief(filePath: string): BaseBriefFile {
  const raw: string = fs.readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Base brief is not an object: ${filePath}`);
  }
  const base = parsed as Record<string, unknown>;
  if (!isNonEmptyString(base['company'])) throw new Error('Base brief missing company.');
  if (!Array.isArray(base['capabilityMappings'])) throw new Error('Base brief missing capabilityMappings.');
  if (typeof base['buyerRole'] !== 'object' || base['buyerRole'] === null) {
    throw new Error('Base brief missing buyerRole.');
  }
  if (!Array.isArray(base['publicFacts'])) throw new Error('Base brief missing publicFacts.');
  return {
    company: base['company'] as string,
    capabilityMappings: base['capabilityMappings'] as CapabilityMapping[],
    buyerRole: base['buyerRole'] as BuyerRole,
    publicFacts: base['publicFacts'] as PublicFact[],
    workflow: isNonEmptyString(base['workflow']) ? (base['workflow'] as string) : undefined,
    signals: Array.isArray(base['signals']) ? (base['signals'] as Array<{ category?: string }>) : undefined,
  };
}

function main(): void {
  const base: BaseBriefFile = loadBaseBrief(BASE_BRIEF_PATH);

  // Freshness computed from 2026-07-01 (UTC midnight) to today — deterministic
  // given the clock, no engine rule change (caller-supplied freshnessDays).
  const freshnessDays: number = Math.max(
    0,
    Math.floor((Date.now() - Date.parse('2026-07-01T00:00:00.000Z')) / MS_PER_DAY),
  );

  const whyNow: WhyNow = {
    event:
      'Forbes: JPMorgan Chase moving AI from experimental phase to production-scale deployment ' +
      'across banking workflows (published 2026-07-01, corroborated by Businesswire/ResearchAndMarkets ' +
      'digital-transformation report press release 2025-07-15)',
    sourceUrl:
      'https://www.forbes.com/sites/bernardmarr/2026/07/01/how-jpmorgan-chase-is-building-the-ai-powered-bank-of-the-future',
    publishedDate: '2026-07-01',
    eventDate: undefined,
    relevance: 'AI-at-scale programme creates reconciliation/audit-trail workflow load — Q-Core sealed-receipt fit',
    freshnessDays,
  };

  const workflow: string =
    base.workflow !== undefined && base.workflow.trim().length > 0
      ? base.workflow
      : workflowForSignalCategory(base.signals?.[0]?.category);

  const topFact: string =
    base.publicFacts[0]?.fact ?? 'No verified public facts in this run.';
  const problemHypothesis: string =
    `Review load for the ${workflow} workflow may be rising as ${base.company} pursues its recently reported AI-at-scale programme.`;
  const inferenceVsFact = `Fact: ${topFact} Inference: capacity pressure is an unconfirmed hypothesis.`;

  const input: OpportunityQualificationInput = {
    company: base.company,
    sector: SWEEP_SECTOR,
    geography: SWEEP_GEOGRAPHY,
    workflow,
    publicFacts: base.publicFacts,
    problemHypothesis,
    inferenceVsFact,
    whyNow,
    capabilityMappings: base.capabilityMappings,
    buyerRole: base.buyerRole,
    commercial: projectionCommercialStages(),
  };

  const qualified = qualifyOpportunity(input);
  const score: number = scoreOpportunity(input);
  const drafted = draftOutreachWithReason(qualified);

  console.log('[JPM WHAT-IF PROJECTION]');
  console.log(`base=.research/briefs/jpmorgan-com.json`);
  console.log(`whyNowFreshnessDays=${freshnessDays}`);
  console.log(`verdict=${qualified.verdict}`);
  console.log(`score=${score}`);
  console.log(`draftWordCount=${drafted.draft === null ? 'null' : String(drafted.draft.wordCount)}`);
  console.log(`draftReason=${drafted.reason ?? 'null'}`);
  if (drafted.draft !== null) {
    console.log(`draftSubject=${drafted.draft.subject}`);
    console.log(`draftBody=${drafted.draft.body}`);
  }
  console.log(`verdictReason=${qualified.verdictReason}`);
  console.log(CAVEAT_BLOCK);
}

main();
