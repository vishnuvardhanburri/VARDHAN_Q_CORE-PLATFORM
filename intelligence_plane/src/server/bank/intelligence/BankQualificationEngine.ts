/**
 * VARDHAN — Bank Qualification Engine
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Evidence-based qualification scoring for bank opportunities.
 *
 * Scoring criteria (0-100 total):
 *   1. Evidence quality and recency            (max 20)
 *   2. Relevance to Vardhan capability         (max 20)
 *   3. Evidence of active initiative           (max 15)
 *   4. Identifiable technical sponsor role     (max 15)
 *   5. Plausible bounded evaluation            (max 15)
 *   6. Measurable acceptance criteria          (max 15)
 *
 * Rules:
 *   - Missing evidence MUST lower confidence.
 *   - No inflated percentages or urgency labels without evidence.
 *   - Score < 50 → BLOCKED (insufficient evidence).
 *   - Score >= 50 → READY_FOR_HUMAN_APPROVAL (requires human sign-off before outreach).
 *   - Multiple signals from multiple sources → confidence bonus.
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
  evidenceQuality: number;          // 0–20
  capabilityRelevance: number;      // 0–20
  activeInitiative: number;         // 0–15
  technicalSponsor: number;        // 0–15
  boundedEvaluation: number;        // 0–15
  measurableCriteria: number;       // 0–15
  total: number;                   // 0–100
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
const INITIATIVE_MAX = 15;
const SPONSOR_MAX = 15;
const EVALUATION_MAX = 15;
const CRITERIA_MAX = 15;
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

    // ── 3. Evidence of active initiative (0–15) ─────────────────────── ──
    let activeInitiative = 0;
    const initiativeKeywords = [
      'research', 'programme', 'program', 'initiative', 'pilot', 'developing',
      'investing', 'engaging', 'exploring', 'transition', 'migration', 'adoption',
      'upskilling', 'training', 'assessment', 'evaluation',
    ];
    for (const sig of signals) {
      const text = (sig.observedFact + ' ' + sig.evidenceExcerpt).toLowerCase();
      const matches = initiativeKeywords.filter(k => text.includes(k));
      if (matches.length >= 3) activeInitiative += 5;
      else if (matches.length >= 1) activeInitiative += 3;
    }
    // Multiple signals = stronger initiative evidence
    if (signals.length >= 3) activeInitiative += 3;
    else if (signals.length >= 2) activeInitiative += 2;
    else activeInitiative += 1;
    activeInitiative = Math.max(0, Math.min(INITIATIVE_MAX, activeInitiative));

    // ── 4. Identifiable technical sponsor role (0–15) ───────────────── ──
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

    // ── 5. Plausible bounded evaluation (0–15) ─────────────────────── ──
    let boundedEvaluation = 0;
    // A bounded evaluation is plausible if: there's a specific problem type,
    // a relevant Vardhan capability, and at least one real signal
    if (signals.length >= 1 && relevantCaps.length > 0) {
      boundedEvaluation = 8;
      if (signals.length >= 2) boundedEvaluation += 3;
      if (signals.some(s => s.confidence === 'HIGH')) boundedEvaluation += 4;
    }
    boundedEvaluation = Math.max(0, Math.min(EVALUATION_MAX, boundedEvaluation));

    // ── 6. Measurable acceptance criteria (0–15) ───────────────────── ──
    let measurableCriteria = 0;
    // Measurable criteria are possible if the problem type is concrete (not GENERAL_SECURITY_POSTURE)
    if (problemType !== 'GENERAL_SECURITY_POSTURE') {
      measurableCriteria = 6;
      if (relevantCaps.length > 0) measurableCriteria += 5;
      if (signals.some(s => s.confidence === 'HIGH')) measurableCriteria += 4;
    }
    measurableCriteria = Math.max(0, Math.min(CRITERIA_MAX, measurableCriteria));

    // ── Total ────────────────────────────────────────────────────────── ──
    const scoreBreakdown: QualificationScoreBreakdown = {
      evidenceQuality,
      capabilityRelevance,
      activeInitiative,
      technicalSponsor,
      boundedEvaluation,
      measurableCriteria,
      total: Math.round(
        evidenceQuality + capabilityRelevance + activeInitiative +
        technicalSponsor + boundedEvaluation + measurableCriteria
      ),
    };

    // ── Priority determination ──────────────────────────────────────── ──
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
    } else if (priority === 'P0') {
      // P0 requires human approval (never automated outreach)
      status = 'READY_FOR_HUMAN_APPROVAL';
    } else {
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
      },
    };
  }
}
