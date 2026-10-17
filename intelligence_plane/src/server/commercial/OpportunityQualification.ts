/**
 * VARDHAN — MISSION-H OPPORTUNITY QUALIFICATION (CANONICAL WRAPPER)
 * ─────────────────────────────────────────────────────────────────────────────
 * Canonical Mission-H opportunity model that WRAPS (does not replace) the
 * existing engines:
 *   - findings/OpportunityQualityEngine (source-diversity + freshness filter)
 *   - discovery/OpportunityDecisionEngine (VERIFIED/INVESTIGATION/ADVISORY states)
 *   - discovery/OutreachEligibilityGate (outreach eligibility invariants)
 *   - bank/intelligence/BankQualificationEngine (0–100 prioritization shape)
 *   - DiagnosticOpportunityEngine (diagnostic hypothesis builder)
 *
 * This module adds the commercial qualification layer on top: WHY_NOW-gated
 * GO/HOLD/DROP verdicts, Q-Core capability-fit mapping with evidence refs,
 * buyer-role identification, and staged commercial scoping
 * (DISCOVERY_15K → POV_60K → PRODUCTION).
 *
 * Hard invariants (enforced in CODE, not comments):
 *   - GO requires a dated, sourced, fresh WHY_NOW (≤180 days).
 *   - GO requires ≥1 DEMONSTRATED/PARTIAL capability mapping.
 *   - Any NOT_SUPPORTED (or PLANNED-claimed-for-PRODUCTION) mapping → DROP.
 *   - Speculative security wording without public-fact support → HOLD.
 *
 * Determinism: qualifyOpportunity/scoreOpportunity are pure functions of
 * their input. No randomness, no Date.now(), no network. An optional nowIso
 * parameter is accepted for testability but never affects scoring — freshness
 * is derived SOLELY from the caller-supplied whyNow.freshnessDays.
 *
 * Privacy/safety: no PII or contact generation here; no auto-send. Human
 * approval is always required downstream (OutreachEligibilityGate).
 */

/** Fit of a Q-Core capability to the prospect's workflow. */
export type QCoreFitLevel = 'DEMONSTRATED' | 'PARTIAL' | 'PLANNED' | 'NOT_SUPPORTED';

/** Buyer archetype for the identified sponsor. */
export type BuyerType = 'ECONOMIC' | 'TECHNICAL' | 'OPERATIONAL' | 'CHAMPION';

/** Commercial verdict. */
export type QualificationVerdict = 'GO' | 'HOLD' | 'DROP';

/** Commercial stage in the Mission-H land-and-expand motion. */
export type CommercialStageName = 'DISCOVERY_15K' | 'POV_60K' | 'PRODUCTION';

/** Pointer to the sealed evidence that backs a capability claim. */
export interface CapabilityEvidenceRef {
  sourceFile: string;
  testName: string;
}

/** A single Q-Core capability mapped to the prospect workflow. */
export interface CapabilityMapping {
  capability: string;
  evidenceRef: CapabilityEvidenceRef;
  level: QCoreFitLevel;
}

/** A public (URL-backed) fact used to ground the hypothesis. */
export interface PublicFact {
  fact: string;
  sourceUrl: string;
}

/** Dated trigger event that creates buying urgency. */
export interface WhyNow {
  event: string;
  sourceUrl: string;
  publishedDate: string;
  eventDate?: string;
  relevance: string;
  /** Age of the trigger in days, supplied by the caller (deterministic). */
  freshnessDays: number;
}

/** Identified buyer for the opportunity. */
export interface BuyerRole {
  function: string;
  why: string;
  buyerType: BuyerType;
}

/** One commercial stage with buyer outcome, deliverables and entry criteria. */
export interface CommercialStage {
  stage: CommercialStageName;
  buyerOutcome: string;
  deliverables: string[];
  customerInputs: string[];
  acceptanceCriteria: string[];
  dependencies: string[];
}

/** Fully qualified Mission-H opportunity (input fields + verdict). */
export interface QualifiedOpportunity {
  company: string;
  sector: string;
  geography: string;
  workflow: string;
  publicFacts: PublicFact[];
  problemHypothesis: string;
  inferenceVsFact: string;
  whyNow: WhyNow | null;
  capabilityMappings: CapabilityMapping[];
  buyerRole: BuyerRole;
  commercial: CommercialStage[];
  verdict: QualificationVerdict;
  verdictReason: string;
  resolveEvidence?: string;
}

/**
 * Input to qualifyOpportunity — everything except the verdict fields.
 * nowIso is accepted for testability/record-keeping only; it is NEVER used
 * in the scoring or verdict path (freshness comes from whyNow.freshnessDays).
 */
export interface OpportunityQualificationInput {
  company: string;
  sector: string;
  geography: string;
  workflow: string;
  publicFacts: PublicFact[];
  problemHypothesis: string;
  inferenceVsFact: string;
  whyNow: WhyNow | null;
  capabilityMappings: CapabilityMapping[];
  buyerRole: BuyerRole;
  commercial: CommercialStage[];
  nowIso?: string;
}

/** Registry entry binding a Q-Core capability to its sealed evidence. */
export interface QCoreCapabilityRegistryEntry {
  capability: string;
  evidenceRef: CapabilityEvidenceRef;
  maxClaimLevel: QCoreFitLevel;
  scopeNote: string;
}

/**
 * Canonical Q-Core capability registry. maxClaimLevel caps what any
 * CapabilityMapping may claim for that capability — claiming higher is
 * treated as an unsupported production claim (→ DROP).
 */
export const QCORE_CAPABILITY_REGISTRY: readonly QCoreCapabilityRegistryEntry[] = [
  {
    capability: 'sealed-receipts',
    evidenceRef: { sourceFile: 'backend/vardhan_receipt', testName: 'validate-canonical' },
    maxClaimLevel: 'DEMONSTRATED',
    scopeNote: 'Sealed canonical receipts verified by backend validate-canonical suite.',
  },
  {
    capability: 'replay-idempotency',
    evidenceRef: { sourceFile: 'backend/vardhan_idempotency', testName: 'g2-replay-idempotency' },
    maxClaimLevel: 'DEMONSTRATED',
    scopeNote: 'Replay and idempotency guards covered by G2 test scope.',
  },
  {
    capability: 'tenant-binding',
    evidenceRef: { sourceFile: 'backend/control_plane_api', testName: 'tenant-403-isolation' },
    maxClaimLevel: 'DEMONSTRATED',
    scopeNote: 'Tenant isolation enforced; cross-tenant access returns 403 per control-plane API tests.',
  },
  {
    capability: 'ed25519-signing',
    evidenceRef: { sourceFile: 'backend/vault/license', testName: 'ed25519-unit' },
    maxClaimLevel: 'DEMONSTRATED',
    scopeNote: 'Ed25519 signing covered by vault/license unit paths.',
  },
  {
    capability: 'ml-dsa-87-signing',
    evidenceRef: { sourceFile: 'backend/core_crypto', testName: 'ml-dsa-87-unit' },
    maxClaimLevel: 'PARTIAL',
    scopeNote: 'PARTIAL: software-only path; HSM-backed signing not demonstrated.',
  },
  {
    capability: 'ml-kem-1024-exchange',
    evidenceRef: { sourceFile: 'backend/core_crypto', testName: 'ml-kem-1024-encap-decap' },
    maxClaimLevel: 'PARTIAL',
    scopeNote: 'PARTIAL: EXCHANGE ONLY — key establishment demonstrated, not at-rest encryption.',
  },
  {
    capability: 'mtls-service-identity',
    evidenceRef: { sourceFile: 'backend/g3-proof', testName: 'cargo-mtls-scope' },
    maxClaimLevel: 'PARTIAL',
    scopeNote: 'PARTIAL: mTLS demonstrated within G3 proof cargo scope only.',
  },
  {
    capability: 'vault-rotation',
    evidenceRef: { sourceFile: 'ops/g4-drill', testName: 'g4-dev-rotation-drill' },
    maxClaimLevel: 'PARTIAL',
    scopeNote: 'PARTIAL: rotation exercised as a G4 dev drill only, not production rotation.',
  },
  {
    capability: 'multi-node-clustering',
    evidenceRef: { sourceFile: 'NONE', testName: 'NONE' },
    maxClaimLevel: 'NOT_SUPPORTED',
    scopeNote: 'NOT_SUPPORTED: multi-node / horizontal clustering is not demonstrated.',
  },
  {
    capability: 'production-readiness-perf',
    evidenceRef: { sourceFile: 'NONE', testName: 'NONE' },
    maxClaimLevel: 'NOT_SUPPORTED',
    scopeNote: 'NOT_SUPPORTED: production hardening and at-scale perf claims are blocked.',
  },
  {
    capability: 'compliance-certification',
    evidenceRef: { sourceFile: 'NONE', testName: 'NONE' },
    maxClaimLevel: 'NOT_SUPPORTED',
    scopeNote: 'NOT_SUPPORTED: SOC2/FIPS/compliance certification claims are blocked.',
  },
] as const;

// ── Scoring weights (documented, deterministic) ─────────────────────────────
// scoreOpportunity returns 0–100:
//   evidence    30 = whyNow present (10) + fresh ≤180d (10) + corroborated (10)
//   fit         30 = ≥1 DEMONSTRATED (30) else ≥1 PARTIAL (15) else (0)
//   buyer       15 = buyerRole.function present (8) + buyerRole.why present (7)
//   feasibility 15 = share of commercial stages with ≥1 concrete customerInput
//   freshness   10 = ≤30d (10) / ≤90d (7) / ≤180d (4) / stale|absent (0)
const WEIGHT_EVIDENCE_MAX = 30;
const WEIGHT_FIT_MAX = 30;
const WEIGHT_BUYER_MAX = 15;
const WEIGHT_FEASIBILITY_MAX = 15;
const WEIGHT_FRESHNESS_MAX = 10;
const WHY_NOW_FRESH_DAYS_MAX = 180;

/** Phrases that require public-fact grounding before a GO is allowed. */
const SPECULATIVE_PHRASES: readonly string[] = [
  'vulnerability',
  'control failure',
  'breach',
] as const;

function normalise(text: string): string {
  return text.toLowerCase();
}

function hasNonEmpty(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function whyNowHasSource(whyNow: WhyNow | null): boolean {
  return whyNow !== null && hasNonEmpty(whyNow.sourceUrl);
}

function corroboratedPublicFacts(publicFacts: PublicFact[]): boolean {
  return publicFacts.some((f) => hasNonEmpty(f.fact) && hasNonEmpty(f.sourceUrl));
}

/** Return the speculative phrases present in the hypothesis (lowercased). */
function speculativeHits(problemHypothesis: string): string[] {
  const hay = normalise(problemHypothesis);
  return SPECULATIVE_PHRASES.filter((p) => hay.includes(p));
}

/** True when every speculative phrase is grounded by at least one public fact. */
function speculativeGrounded(problemHypothesis: string, publicFacts: PublicFact[]): boolean {
  const hits = speculativeHits(problemHypothesis);
  if (hits.length === 0) return true;
  const factsHay = publicFacts.map((f) => normalise(f.fact)).join('\n');
  return hits.every((h) => factsHay.includes(h));
}

function hasDemonstratedOrPartial(mappings: CapabilityMapping[]): boolean {
  return mappings.some((m) => m.level === 'DEMONSTRATED' || m.level === 'PARTIAL');
}

function unsupportedMapping(mappings: CapabilityMapping[]): CapabilityMapping | undefined {
  return mappings.find((m) => m.level === 'NOT_SUPPORTED');
}

/**
 * A PLANNED capability scoped to a PRODUCTION commercial stage is a
 * planned-as-available claim and is blocked as an unsupported production claim.
 */
function plannedForProduction(
  mappings: CapabilityMapping[],
  commercial: CommercialStage[]
): CapabilityMapping | undefined {
  const wantsProduction = commercial.some((c) => c.stage === 'PRODUCTION');
  if (!wantsProduction) return undefined;
  return mappings.find((m) => m.level === 'PLANNED');
}

/**
 * Qualify a Mission-H opportunity. Pure and deterministic: identical input
 * always yields an identical verdict, reason and resolveEvidence.
 */
export function qualifyOpportunity(
  input: OpportunityQualificationInput,
  _nowIso?: string
): QualifiedOpportunity {
  const base = {
    company: input.company,
    sector: input.sector,
    geography: input.geography,
    workflow: input.workflow,
    publicFacts: input.publicFacts,
    problemHypothesis: input.problemHypothesis,
    inferenceVsFact: input.inferenceVsFact,
    whyNow: input.whyNow,
    capabilityMappings: input.capabilityMappings,
    buyerRole: input.buyerRole,
    commercial: input.commercial,
  };

  // HARD RULE (c): unsupported claims → DROP. Checked first; DROP wins.
  const unsupported = unsupportedMapping(input.capabilityMappings);
  if (unsupported !== undefined) {
    return {
      ...base,
      verdict: 'DROP',
      verdictReason:
        `Unsupported production claim blocked: capability '${unsupported.capability}' ` +
        `is marked NOT_SUPPORTED and cannot support any commercial stage.`,
    };
  }
  const plannedClaim = plannedForProduction(input.capabilityMappings, input.commercial);
  if (plannedClaim !== undefined) {
    return {
      ...base,
      verdict: 'DROP',
      verdictReason:
        `Unsupported production claim blocked: capability '${plannedClaim.capability}' ` +
        `is PLANNED but scoped to a PRODUCTION stage.`,
    };
  }

  // HARD RULE (a): GO requires a dated, sourced, fresh WHY_NOW.
  if (input.whyNow === null) {
    return {
      ...base,
      verdict: 'HOLD',
      verdictReason: 'No WHY_NOW trigger: GO requires a dated, sourced trigger event.',
      resolveEvidence: 'Provide a dated why-now event with sourceUrl and freshnessDays ≤180.',
    };
  }
  if (!whyNowHasSource(input.whyNow)) {
    return {
      ...base,
      verdict: 'HOLD',
      verdictReason: 'WHY_NOW has no sourceUrl: GO requires a sourced trigger event.',
      resolveEvidence: 'Attach a verifiable sourceUrl to the why-now event.',
    };
  }
  if (input.whyNow.freshnessDays > WHY_NOW_FRESH_DAYS_MAX) {
    return {
      ...base,
      verdict: 'HOLD',
      verdictReason:
        `Stale WHY_NOW (${input.whyNow.freshnessDays}d > ${WHY_NOW_FRESH_DAYS_MAX}d): ` +
        `trigger is no longer fresh enough for GO.`,
      resolveEvidence: 'Refresh the trigger with a recent event (freshnessDays ≤180) and source.',
    };
  }

  // HARD RULE (b): GO requires demonstrated or partial fit.
  if (!hasDemonstratedOrPartial(input.capabilityMappings)) {
    return {
      ...base,
      verdict: 'HOLD',
      verdictReason:
        'No DEMONSTRATED/PARTIAL capability mapping: GO requires at least one evidenced fit.',
      resolveEvidence: 'Add a capability mapping at DEMONSTRATED or PARTIAL with an evidenceRef.',
    };
  }

  // HARD RULE (d): speculative security wording must be fact-grounded.
  if (!speculativeGrounded(input.problemHypothesis, input.publicFacts)) {
    const hits = speculativeHits(input.problemHypothesis).join(', ');
    return {
      ...base,
      verdict: 'HOLD',
      verdictReason:
        `Speculative wording requires grounding (${hits}): hypothesis uses security ` +
        `language with no supporting public fact.`,
      resolveEvidence: 'Add corroborating publicFacts or rephrase the hypothesis without breach language.',
    };
  }

  return {
    ...base,
    verdict: 'GO',
    verdictReason:
      `Qualified: fresh sourced WHY_NOW (${input.whyNow.freshnessDays}d), ` +
      `evidenced capability fit, grounded hypothesis, identified buyer and feasible scope.`,
  };
}

/**
 * Deterministic 0–100 opportunity score. Pure function of the input —
 * no randomness, no clock, no network. See weight table above.
 */
export function scoreOpportunity(input: OpportunityQualificationInput): number {
  // Evidence (30): present 10 + fresh ≤180d 10 + corroborated 10.
  let evidence = 0;
  if (input.whyNow !== null) evidence += 10;
  if (input.whyNow !== null && input.whyNow.freshnessDays <= WHY_NOW_FRESH_DAYS_MAX) evidence += 10;
  if (corroboratedPublicFacts(input.publicFacts)) evidence += 10;
  evidence = Math.min(evidence, WEIGHT_EVIDENCE_MAX);

  // Fit (30): ≥1 DEMONSTRATED → 30; else ≥1 PARTIAL → 15; else 0.
  let fit = 0;
  if (input.capabilityMappings.some((m) => m.level === 'DEMONSTRATED')) fit = 30;
  else if (input.capabilityMappings.some((m) => m.level === 'PARTIAL')) fit = 15;
  fit = Math.min(fit, WEIGHT_FIT_MAX);

  // Buyer (15): function present 8 + why present 7.
  let buyer = 0;
  if (hasNonEmpty(input.buyerRole.function)) buyer += 8;
  if (hasNonEmpty(input.buyerRole.why)) buyer += 7;
  buyer = Math.min(buyer, WEIGHT_BUYER_MAX);

  // Feasibility (15): share of stages with ≥1 concrete customer input.
  let feasibility = 0;
  if (input.commercial.length > 0) {
    const withInputs = input.commercial.filter((c) =>
      c.customerInputs.some((i) => hasNonEmpty(i))
    ).length;
    feasibility = Math.round((withInputs / input.commercial.length) * WEIGHT_FEASIBILITY_MAX);
  }

  // Freshness (10): graded on whyNow.freshnessDays.
  let freshness = 0;
  if (input.whyNow !== null) {
    const d = input.whyNow.freshnessDays;
    if (d <= 30) freshness = 10;
    else if (d <= 90) freshness = 7;
    else if (d <= WHY_NOW_FRESH_DAYS_MAX) freshness = 4;
    else freshness = 0;
  }
  freshness = Math.min(freshness, WEIGHT_FRESHNESS_MAX);

  return Math.max(0, Math.min(100, evidence + fit + buyer + feasibility + freshness));
}
