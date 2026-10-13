/**
 * VARDHAN — Bank Qualification Engine
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Evidence-based qualification scoring for bank opportunities.
 *
 * ── IMPORTANT ───────────────────────────────────────────────────────────────
 *
 * The `totalScore` is an INTERNAL PRIORITIZATION SCORE (0–100). It measures
 * how much evidence exists that a bank has a relevant, disclosed initiative
 * and a technically-addressable problem. It does NOT measure commercial
 * readiness, buying intent, or procurement likelihood.
 *
 * Commercial readiness is scored separately as `commercialReadinessScore`
 * (0–100) and labelled with `commercialReadiness` (NOT_ASSESSED / LOW / MEDIUM / HIGH).
 * This dimension is driven by evidence of a buying process, budget, procurement
 * timeline, or explicit vendor evaluation — NONE of which are present in the
 * current public signal set. All current opportunities are therefore
 * commercialReadiness = NOT_ASSESSED.
 *
 * Scoring criteria for the internal prioritization score (0–100 total):
 *   1. Evidence quality and recency            (max 20)
 *   2. Relevance to Vardhan capability         (max 20)
 *   3. Evidence of disclosed initiative        (max 10) — research, program,
 *      pilot, exploring keywords in public signals.
 *   4. Evidence of unmet problem             (max 10) — risk, threat, challenge,
 *      gap, vulnerability, disruption, "breaking encryption" language.
 *   5. Identifiable technical sponsor role     (max 15)
 *   6. Bounded evaluation feasibility          (max 15) — can a synthetic-data
 *      evaluation be run? (feasibility, not willingness)
 *   7. Measurable acceptance criteria           (max 10) — can success metrics
 *      be defined?
 *
 * Scoring criteria for commercial readiness (0–100, SEPARATE):
 *   A. Evidence of buying process / willingness (max 50) — procurement, RFP,
 *      budget, vendor selection, "evaluating solutions", etc.
 *   B. Sponsor access & initiative maturity     (max 30) — named sponsor roles,
 *      program described as operational vs exploratory.
 *   C. Problem specificity                      (max 20) — concrete problem stated.
 *
 * Rules:
 *   - Missing evidence MUST lower confidence.
 *   - No inflated percentages or urgency labels without evidence.
 *   - Score < 50 → BLOCKED (insufficient evidence for internal prioritisation).
 *   - Score >= 50 → READY_FOR_HUMAN_APPROVAL (requires human sign-off before outreach).
 *   - Multiple signals from multiple sources → confidence bonus.
 *   - commercialReadiness = NOT_ASSESSED unless buying-process evidence exists.
 *
 * Discovery, qualification, and outreach approval are separate stages.
 * NO automated outreach is ever triggered by this engine.
 */

import { BankSignal, BankSignalGroup, BankProblemType } from './BankSignalModel';
import { getSponsors } from './BankSponsorRoleMap';
import {
  VARDHAN_CAPABILITIES,
} from './BankSignalDatabase';

export type QualificationStatus =
  | 'READY_FOR_HUMAN_APPROVAL'
  | 'BLOCKED'
  | 'NEEDS_VERIFICATION';

export type PriorityTier = 'P0' | 'P1' | 'P2' | 'P3';

export interface QualificationScoreBreakdown {
  evidenceQuality: number;              // 0–20
  capabilityRelevance: number;          // 0–20
  disclosedInitiative: number;        // 0–10  (renamed from activeInitiative)
  unmetProblemEvidence: number;         // 0–10  (NEW — separates initiative from problem)
  technicalSponsor: number;             // 0–15
  evaluationFeasibility: number;        // 0–15  (renamed from boundedEvaluation)
  measurableCriteria: number;           // 0–10  (max reduced from 15)
  total: number;                        // 0–100
}

export interface CommercialReadinessScore {
  buyingProcessEvidence: number;       // 0–50 — procurement, RFP, budget, vendor eval
  sponsorAccess: number;               // 0–30 — named sponsor roles, program maturity
  problemSpecificity: number;          // 0–20 — concrete problem stated
  total: number;                       // 0–100
  label: 'NOT_ASSESSED' | 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface QualifiedBankOpportunity {
  institution: string;
  businessArea: string;
  problemType: BankProblemType;
  problemHypothesis: string;
  signalGroupId: string;
  signalIds: string[];
  sourceUrls: string[];
  sourceCount: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  evidenceCount: number;
  signalAgeDays: number;
  scoreBreakdown: QualificationScoreBreakdown;
  totalScore: number;
  /** Label for the total score — always 'INTERNAL PRIORITIZATION SCORE'. */
  scoreLabel: 'INTERNAL PRIORITIZATION SCORE';
  /** Separate commercial-readiness dimension (NOT part of totalScore). */
  commercialReadiness: CommercialReadinessScore;
  priority: PriorityTier;
  status: QualificationStatus;
  blockReason: string;
  vardhanCapabilities: string[];
  recommendedValidationQuestion: string;
  unresolvedQuestions: string[];
  evidenceGaps: string[];
}

// ── Scoring constants ────────────────────────────────────────────────────────

const EVIDENCE_MAX = 20;
const CAPABILITY_MAX = 20;
const INITIATIVE_MAX = 10;        // reduced from 15 — initiative is one dimension
const PROBLEM_EVIDENCE_MAX = 10;  // NEW — unmet problem evidence
const SPONSOR_MAX = 15;
const EVALUATION_MAX = 15;
const CRITERIA_MAX = 10;           // reduced from 15
const SCORE_THRESHOLD = 50;

// Problem types that are most directly addressable by Vardhan capabilities
const HIGH_FIT_PROBLEM_TYPES: BankProblemType[] = [
  'CRYPTOGRAPHIC_AGILITY',
  'AUDIT_LIFECYCLE',
  'TRUST_BOUNDARY',
  'KEY_LIFECYCLE',
  'THIRD_PARTY_RISK',
  'COMPLIANCE_AUTOMATION',
  'VERIFICATION_INFRASTRUCTURE',
];

// ── Scoring helper ──────────────────────────────────────────────────────────

function ageDays(publishedDate: string): number {
  const pub = new Date(publishedDate);
  const now = new Date();
  const diff = Math.floor((now.getTime() - pub.getTime()) / (1000 * 60 * 60 * 24));
  return isNaN(diff) ? 9999 : Math.max(0, diff);
}

function confidenceToScore(conf: 'HIGH' | 'MEDIUM' | 'LOW'): number {
  return conf === 'HIGH' ? 1.0 : conf === 'MEDIUM' ? 0.6 : 0.3;
}

// ── Keyword lists for initiative / problem / commercial signals ──────────────

/** Keywords indicating the bank has publicly disclosed a research program, pilot,
 *  or exploration initiative. These show *awareness* and *activity*, NOT buying intent. */
const INITIATIVE_KEYWORDS = [
  'research', 'programme', 'program', 'initiative', 'pilot', 'developing',
  'investing', 'engaging', 'exploring', 'transition', 'migration', 'adoption',
  'upskilling', 'training', 'assessment', 'evaluation',
];

/** Keywords indicating the bank has publicly described an unmet problem, risk,
 *  or technical challenge. These show *problem awareness*, NOT a buying process. */
const PROBLEM_KEYWORDS = [
  'risk', 'threat', 'challenge', 'gap', 'vulnerability', 'difficulty', 'burden',
  'disruption', 'breaking', 'must', 'required', 'needed', 'require', 'pain',
  'inevitable', 'future risk', 'must address', 'must prepare', 'must migrate',
  'cannot', 'unable', 'lacks', 'missing', 'without',
];

/** Keywords indicating a buying process, procurement, budget, or willingness
 *  to evaluate commercial solutions. Presence of these raises commercial readiness
 *  from NOT_ASSESSED. Absence keeps it NOT_ASSESSED (no invented intent). */
const COMMERCIAL_KEYWORDS = [
  'procurement', 'rfp', 'tender', 'budget', 'vendor selection',
  'evaluating solutions', 'evaluating vendors', 'looking to procure',
  'seeking to procure', 'need to procure', 'proof of value', 'poc',
  'request for proposal', 'vendor evaluation', 'commercial',
  'contracting', 'purchase decision', 'investment decision',
  'allocated budget', 'budget allocation', 'procurement process',
];

// ── Main qualifier ──────────────────────────────────────────────────────────

export class BankQualificationEngine {
  /**
   * Qualify a single signal group (multiple signals converging on one hypothesis).
   */
  static qualify(
    group: BankSignalGroup,
    options?: {
      institution?: string;
    }
  ): QualifiedBankOpportunity {
    const signals = group.signals;
    const institution = group.institution;
    const problemType = group.problemType;

    const sponsorMap = getSponsors(institution);
    const hasSponsorMap = sponsorMap !== null;

    // ── 1. Evidence quality and recency (0–20) ───────────────────────── ──
    let evidenceQuality = 0;
    const sourceUrls = new Set<string>();
    const allGaps: string[] = [];

    for (const sig of signals) {
      sourceUrls.add(sig.sourceUrl);
      // Source type quality
      if (sig.sourceType === 'CORPORATE_WEBSITE' || sig.sourceType === 'TECHNICAL_BLOG') {
        evidenceQuality += 4;
      } else if (sig.sourceType === 'PUBLIC_PDF') {
        evidenceQuality += 6;
      } else if (sig.sourceType === 'ENGINEERING_PUBLICATION') {
        evidenceQuality += 5;
      } else if (sig.sourceType === 'PRESS_RELEASE') {
        evidenceQuality += 3;
      } else {
        evidenceQuality += 2;
      }

      // Evidence excerpt length (specificity)
      if (sig.evidenceExcerpt.length >= 150) evidenceQuality += 2;
      else if (sig.evidenceExcerpt.length >= 50) evidenceQuality += 1;

      // Confidence of individual signal
      evidenceQuality += Math.round(confidenceToScore(sig.confidence) * 3);

      // Age penalty
      const sigAge = ageDays(sig.publishedDate);
      if (sigAge <= 30) evidenceQuality += 2;      // very recent
      else if (sigAge <= 90) evidenceQuality += 1; // recent
      else if (sigAge <= 180) evidenceQuality += 0; // historical OK
      else evidenceQuality -= 2;                     // old — penalty

      allGaps.push(...sig.evidenceGaps);
    }

    evidenceQuality = Math.max(0, Math.min(EVIDENCE_MAX, evidenceQuality + (sourceUrls.size > 1 ? 2 : 0)));

    // ── 2. Relevance to Vardhan capability (0–20) ─────────────────────── ──
    let capabilityRelevance = 0;
    const relevantCaps: string[] = [];
    const capMap: Record<string, string[]> = {};
    for (const cap of VARDHAN_CAPABILITIES) {
      capMap[cap.id] = cap.relevanceToBankProblems;
      if (cap.relevanceToBankProblems.includes(problemType)) {
        relevantCaps.push(cap.id);
      }
    }

    if (relevantCaps.length > 0) {
      capabilityRelevance = Math.min(CAPABILITY_MAX, relevantCaps.length * 8);
    }
    if (HIGH_FIT_PROBLEM_TYPES.includes(problemType)) {
      capabilityRelevance = Math.min(CAPABILITY_MAX, capabilityRelevance + 4);
    }

    // ── 3. Evidence of disclosed initiative (0–10) ───────────────────── ──
    // Measures whether the bank has publicly disclosed a research program,
    // pilot, or exploration initiative. This shows *awareness*, NOT buying
    // intent. Does not imply a problem exists or that the bank will purchase.
    let disclosedInitiative = 0;
    for (const sig of signals) {
      const text = (sig.observedFact + ' ' + sig.evidenceExcerpt).toLowerCase();
      const matches = INITIATIVE_KEYWORDS.filter(k => text.includes(k));
      if (matches.length >= 3) disclosedInitiative += 4;
      else if (matches.length >= 1) disclosedInitiative += 2;
    }
    // Multiple signals = stronger initiative evidence
    if (signals.length >= 3) disclosedInitiative += 2;
    else if (signals.length >= 2) disclosedInitiative += 1;
    disclosedInitiative = Math.max(0, Math.min(INITIATIVE_MAX, disclosedInitiative));

    // ── 4. Evidence of unmet problem (0–10) ─────────────────────────── ──
    // Measures whether the bank has publicly described a problem, risk, or
    // technical challenge (e.g., "breaking encryption", "future threats").
    // This is SEPARATE from initiative — a bank can research a topic without
    // describing a problem, and can describe a problem without active research.
    let unmetProblemEvidence = 0;
    for (const sig of signals) {
      const text = (sig.observedFact + ' ' + sig.evidenceExcerpt).toLowerCase();
      const matches = PROBLEM_KEYWORDS.filter(k => text.includes(k));
      if (matches.length >= 3) unmetProblemEvidence += 4;
      else if (matches.length >= 1) unmetProblemEvidence += 3;
    }
    // High-confidence signals strengthen problem evidence
    if (signals.some(s => s.confidence === 'HIGH')) unmetProblemEvidence += 1;
    unmetProblemEvidence = Math.max(0, Math.min(PROBLEM_EVIDENCE_MAX, unmetProblemEvidence));

    // ── 5. Evidence of commercial buying process (0–50, SEPARATE) ──── ──
    // Measures whether the bank has publicly disclosed a procurement process,
    // budget, RFP, or willingness to evaluate commercial solutions.
    // THIS SCORE IS NOT PART OF totalScore — it feeds commercialReadiness only.
    // No commercial intent is EVER invented: if no keywords match, score = 0.
    let buyingProcessEvidence = 0;
    for (const sig of signals) {
      // Only scan PUBLIC SOURCE TEXT — never the inferredImplication, which is
      // Vardhan's own analysis and would invent commercial intent.
      const text = (sig.observedFact + ' ' + sig.evidenceExcerpt).toLowerCase();
      const matches = COMMERCIAL_KEYWORDS.filter(k => text.includes(k));
      if (matches.length >= 2) buyingProcessEvidence += 20;
      else if (matches.length >= 1) buyingProcessEvidence += 10;
    }
    buyingProcessEvidence = Math.max(0, Math.min(50, buyingProcessEvidence));

    // ── 6. Identifiable technical sponsor role (0–15) ───────────────── ──
    let technicalSponsor = 0;
    const sponsorRoles = sponsorMap?.sponsorRoles || [];
    const relevantSponsors = sponsorRoles.filter(s => {
      const keywords = s.role.toLowerCase() + ' ' + s.department.toLowerCase();
      return problemType === 'CRYPTOGRAPHIC_AGILITY' && /cryptography|quantum|security|tech/.test(keywords) ||
             problemType === 'AUDIT_LIFECYCLE' && /audit|security|ops|compliance/.test(keywords) ||
             problemType === 'THIRD_PARTY_RISK' && /risk|security|ciso|procurement/.test(keywords) ||
             problemType === 'COMPLIANCE_AUTOMATION' && /compliance|risk|security|ciso|cro/.test(keywords) ||
             problemType === 'TRUST_BOUNDARY' && /cryptography|security|network|quantum/.test(keywords) ||
             problemType === 'KEY_LIFECYCLE' && /cryptography|quantum|security/.test(keywords) ||
             true; // Default: any sponsor role is relevant
    });
    if (sponsorMap && sponsorRoles.length > 0) {
      technicalSponsor += 5; // Role identified
      if (relevantSponsors.length > 0) {
        technicalSponsor += 5;
      }
      if (relevantSponsors.some(s => s.confidence === 'HIGH')) {
        technicalSponsor += 5;
      } else if (relevantSponsors.length >= 2) {
        technicalSponsor += 3;
      }
    }
    technicalSponsor = Math.max(0, Math.min(SPONSOR_MAX, technicalSponsor));

    // ── 7. Bounded evaluation feasibility (0–15) ───────────────────── ──
    // Measures whether a synthetic-data evaluation CAN be run — i.e., there is
    // a specific problem type, a relevant Vardhan capability, and real signals.
    // This is about FEASIBILITY, not the bank's willingness to pay.
    let evaluationFeasibility = 0;
    if (signals.length >= 1 && relevantCaps.length > 0) {
      evaluationFeasibility = 8;
      if (signals.length >= 2) evaluationFeasibility += 3;
      if (signals.some(s => s.confidence === 'HIGH')) evaluationFeasibility += 4;
    }
    evaluationFeasibility = Math.max(0, Math.min(EVALUATION_MAX, evaluationFeasibility));

    // ── 8. Measurable acceptance criteria (0–10) ─────────────────────── ──
    let measurableCriteria = 0;
    // Measurable criteria are possible if the problem type is concrete (not GENERAL_SECURITY_POSTURE)
    if (problemType !== 'GENERAL_SECURITY_POSTURE') {
      measurableCriteria = 4;
      if (relevantCaps.length > 0) measurableCriteria += 3;
      if (signals.some(s => s.confidence === 'HIGH')) measurableCriteria += 3;
    }
    measurableCriteria = Math.max(0, Math.min(CRITERIA_MAX, measurableCriteria));

    // ── Total (INTERNAL PRIORITIZATION SCORE) ─────────────────────── ──
    const scoreBreakdown: QualificationScoreBreakdown = {
      evidenceQuality,
      capabilityRelevance,
      disclosedInitiative,
      unmetProblemEvidence,
      technicalSponsor,
      evaluationFeasibility,
      measurableCriteria,
      total: Math.round(
        evidenceQuality + capabilityRelevance + disclosedInitiative +
        unmetProblemEvidence + technicalSponsor +
        evaluationFeasibility + measurableCriteria
      ),
    };

    // ── Priority determination (INTERNAL — not commercial readiness) ── ──
    // Thresholds lowered because max score is still 100 but factors were
    // redistributed (initiative 15→10, criteria 15→10, new problem factor 10).
    const rawScore = scoreBreakdown.total;
    let priority: PriorityTier = rawScore >= 85 ? 'P0' :
                                   rawScore >= 65 ? 'P1' :
                                   rawScore >= 50 ? 'P2' : 'P3';

    // ── Status determination ────────────────────────────────────────── ──
    let status: QualificationStatus;
    let blockReason = '';

    if (rawScore < SCORE_THRESHOLD) {
      status = 'BLOCKED';
      blockReason = `Signal score (${rawScore}/100) below qualification threshold (${SCORE_THRESHOLD}). Evidence gaps: ${[...new Set(allGaps)].slice(0, 3).join('; ') || 'insufficient signal strength'}.`;
      priority = 'P3';
    } else {
      // Score >= 50 → READY_FOR_HUMAN_APPROVAL (never automated outreach)
      status = 'READY_FOR_HUMAN_APPROVAL';
    }

    // ── Aggregate evidence gaps ────────────────────────────────────── ──
    const uniqueGaps = [...new Set(allGaps)];

    // ── Unresolved questions ───────────────────────────────────────── ──
    const unresolvedQuestions = signals.map(s => s.recommendedValidationQuestion);

    // ── Overall confidence (conservative — minimum of signal confidences) ──
    const confidence: 'HIGH' | 'MEDIUM' | 'LOW' =
      signals.every(s => s.confidence === 'HIGH') ? 'HIGH' :
      signals.some(s => s.confidence === 'LOW') ? 'LOW' :
      'MEDIUM';

    // ── Oldest signal age for the group ──────────────────────────────── ──
    const maxAge = Math.max(...signals.map(s => ageDays(s.publishedDate)));

    // ── Commercial readiness (SEPARATE from internal prioritization) ── ──
    // Computed from buying-process evidence (0 if no commercial keywords),
    // sponsor access, and problem specificity. This is NOT part of totalScore.
    const sponsorAccessScore = Math.min(30, sponsorMap ? (sponsorRoles.length * 5 + (relevantSponsors.some(s => s.confidence === 'HIGH') ? 10 : 0)) : 0);
    const problemSpecificityBase = unmetProblemEvidence > 0 ? 10 : 0;
    const problemSpecificityScore = Math.min(20, problemSpecificityBase + (signals.length >= 2 && unmetProblemEvidence > 0 ? 10 : 0));
    const commercialTotalScore = buyingProcessEvidence + sponsorAccessScore + Math.min(20, problemSpecificityScore);

    let commercialLabel: 'NOT_ASSESSED' | 'LOW' | 'MEDIUM' | 'HIGH';
    if (buyingProcessEvidence === 0) {
      commercialLabel = 'NOT_ASSESSED';
    } else if (commercialTotalScore >= 70) {
      commercialLabel = 'HIGH';
    } else if (commercialTotalScore >= 40) {
      commercialLabel = 'MEDIUM';
    } else {
      commercialLabel = 'LOW';
    }

    return {
      institution,
      businessArea: sponsorMap ? `${sponsorMap.jurisdiction} banking operations` : 'Banking operations',
      problemType,
      problemHypothesis: group.hypothesis,
      signalGroupId: group.groupId,
      signalIds: signals.map(s => s.signalId),
      sourceUrls: [...sourceUrls],
      sourceCount: sourceUrls.size,
      confidence,
      evidenceCount: signals.length,
      signalAgeDays: maxAge,
      scoreBreakdown,
      totalScore: rawScore,
      scoreLabel: 'INTERNAL PRIORITIZATION SCORE',
      commercialReadiness: {
        buyingProcessEvidence,
        sponsorAccess: sponsorAccessScore,
        problemSpecificity: problemSpecificityScore,
        total: commercialTotalScore,
        label: commercialLabel,
      },
      priority,
      status,
      blockReason,
      vardhanCapabilities: relevantCaps,
      recommendedValidationQuestion: signals[0]?.recommendedValidationQuestion || '',
      unresolvedQuestions,
      evidenceGaps: uniqueGaps,
    };
  }

  /**
   * Qualify all signal groups and rank them.
   */
  static qualifyAll(groups: BankSignalGroup[]): {
    qualified: QualifiedBankOpportunity[];
    blocked: QualifiedBankOpportunity[];
    shortlist: QualifiedBankOpportunity[]; // P0 + P1
    metrics: {
      total: number;
      qualified: number;
      blocked: number;
      p0: number;
      p1: number;
      p2: number;
      p3: number;
      avgScore: number;
    };
  } {
    const qualified: QualifiedBankOpportunity[] = [];
    const blocked: QualifiedBankOpportunity[] = [];

    for (const group of groups) {
      const result = this.qualify(group);
      if (result.status === 'BLOCKED') {
        blocked.push(result);
      } else {
        qualified.push(result);
      }
    }

    // Sort qualified by score descending
    qualified.sort((a, b) => b.totalScore - a.totalScore);

    const shortlist = qualified.filter(q => q.priority === 'P0' || q.priority === 'P1');

    return {
      qualified,
      blocked,
      shortlist,
      metrics: {
        total: groups.length,
        qualified: qualified.length,
        blocked: blocked.length,
        p0: qualified.filter(q => q.priority === 'P0').length,
        p1: qualified.filter(q => q.priority === 'P1').length,
        p2: qualified.filter(q => q.priority === 'P2').length,
        p3: blocked.length,
        avgScore: qualified.length > 0
          ? Math.round(qualified.reduce((sum, q) => sum + q.totalScore, 0) / qualified.length)
          : 0,
        avgCommercialReadiness: qualified.length > 0
          ? Math.round(qualified.reduce((sum, q) => sum + q.commercialReadiness.total, 0) / qualified.length)
          : 0,
      },
    };
  }
}
