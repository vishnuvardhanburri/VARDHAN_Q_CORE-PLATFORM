/**
 * VARDHAN — EVIDENCE SCORING ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 * Quantifies the technical value of public observations.
 * Implements the weighted-average scoring model to distinguish between
 * noise (MICRO) and strategic intelligence (CRITICAL).
 */

import { Evidence, EvidenceStrength, ScoreBreakdown, EvidenceType, TemporalStatus, EvidenceRelationship } from './IntelligenceCase';

const EVIDENCE_WEIGHTS = Object.freeze({
  reliability: 0.25,
  directness: 0.20,
  specificity: 0.15,
  freshness: 0.10,
  relevance: 0.15,
  repeatability: 0.10,
  independence: 0.05
});

const STRENGTH_THRESHOLDS = Object.freeze([
  { min: 81, strength: 'CRITICAL' as EvidenceStrength },
  { min: 61, strength: 'HIGH' as EvidenceStrength },
  { min: 41, strength: 'MEDIUM' as EvidenceStrength },
  { min: 21, strength: 'LOW' as EvidenceStrength },
  { min: 0, strength: 'MICRO' as EvidenceStrength },
]);

/**
 * Internal type to track score and the reason why it was given.
 */
interface ScoredDimension {
  score: number;
  reason: string;
}

export class EvidenceScoringEngine {

  /**
   * Transforms a raw observation into a scored Evidence record.
   */
  public static score(evidence: Partial<Evidence>): Evidence {
    const breakdownResult = this.calculateDetailedBreakdown(evidence);
    
    const breakdown = breakdownResult?.breakdown || {
      reliability: 0,
      directness: 0,
      specificity: 0,
      freshness: 0,
      relevance: 0,
      repeatability: 0,
      independence: 0,
    };
    const reasons = breakdownResult?.reasons || {};
    const totalScore = this.calculateWeightedScore(breakdown);

    return {
      id: evidence.id || `ev-${Math.random().toString(36).substr(2, 9)}`,
      company_id: evidence.company_id || 'unknown',
      source_type: evidence.source_type || 'UNKNOWN',
      source_url: (evidence as any).source_url || '',
      source_title: (evidence as any).source_title || '',
      timestamp: (evidence as any).timestamp || new Date(),

      raw_observation: evidence.raw_observation || evidence.observed_behavior || '',
      normalized_observation: evidence.normalized_observation || evidence.evidence_text || '',

      scoring: {
        ...breakdown,
        total_score: totalScore
      },
      strength: this.mapScoreToStrength(totalScore),
      confidence: this.calculateConfidence(breakdown),

      observation_type: evidence.observation_type || 'GENERIC',
      temporal_status: this.calculateTemporalStatus((evidence as any).timestamp),
      relationship: evidence.relationship || 'NEUTRAL',
      scoring_reasons: reasons,

      supports: evidence.supports || [],
      contradicts: evidence.contradicts || [],

      type: evidence.type || this.inferType(evidence as any),
      provider: (evidence as any).provider || 'VardhanEngine',
      retrieved_at: evidence.retrieved_at || new Date().toISOString(),

      observed_behavior: evidence.observed_behavior || '',
      evidence_text: evidence.evidence_text || '',
      public_url: evidence.public_url || evidence.source_url || '',
      evidence_origin: evidence.evidence_origin || 'REAL_PUBLIC_OBSERVATION',
      reproductions: evidence.reproductions || 1,
      repeatable: evidence.repeatable ?? true,
      tested_without_auth: evidence.tested_without_auth ?? true,
      not_tested: evidence.not_tested || []
    } as Evidence;
  }

  private static calculateDetailedBreakdown(ev: Partial<Evidence>): { breakdown: ScoreBreakdown; reasons: Record<string, string> } {
    const rel = this.scoreReliability(ev.source_type);
    const dir = this.scoreDirectness(ev.raw_observation || ev.observed_behavior || '');
    const spec = this.scoreSpecificity(ev.raw_observation || ev.observed_behavior || '');
    const fresh = this.scoreFreshness((ev as any).timestamp);
    const relv = this.scoreRelevance(ev.raw_observation || ev.observed_behavior || '');

    const breakdown: ScoreBreakdown = {
      reliability: rel.score,
      directness: dir.score,
      specificity: spec.score,
      freshness: fresh.score,
      relevance: relv.score,
      repeatability: ev.repeatable ? 100 : 0,
      independence: 50,
    };

    const reasons: Record<string, string> = {
      WHY_RELIABILITY: rel.reason,
      WHY_DIRECTNESS: dir.reason,
      WHY_SPECIFICITY: spec.reason,
      WHY_FRESHNESS: fresh.reason,
      WHY_RELEVANCE: relv.reason,
      WHY_REPEATABILITY: ev.repeatable ? 'Observation is reproducible' : 'Observation is transient/one-off',
      WHY_INDEPENDENCE: 'Baseline independent observation',
    };

    return { breakdown, reasons };
  }

  private static scoreReliability(type?: string): ScoredDimension {
    const map: Record<string, { s: number, r: string }> = {
      'PUBLIC_DOCUMENTATION': { s: 90, r: 'Official documentation provides high factual reliability' },
      'GITHUB': { s: 80, r: 'GitHub activity provides strong technical evidence of implementation' },
      'STATUS_PAGE': { s: 95, r: 'Verified company status page is a primary source of truth' },
      'SECURITY': { s: 90, r: 'Official security/compliance pages are highly reliable' },
      'ENGINEERING_BLOG': { s: 85, r: 'Engineering blogs provide high-context internal perspectives' },
      'SEARCH_RESULT': { s: 40, r: 'Search result is an unverified pointer to a potential source' },
      'UNKNOWN': { s: 30, r: 'Unknown source type has low intrinsic reliability' }
    };
    const result = map[type || 'UNKNOWN'] || { s: 50, r: 'General public source with moderate reliability' };
    return { score: result.s, reason: result.r };
  }

  private static scoreDirectness(text: string): ScoredDimension {
    const directKeywords = /\b(?:outage|bug|failure|error|critical|vulnerability|leak|incident)\b/i;
    if (directKeywords.test(text)) {
      return { score: 90, reason: 'Contains explicit high-impact technical keywords (e.g., outage, failure)' };
    }
    return { score: 30, reason: 'Generic prose without explicit failure/incident markers' };
  }

  private static scoreSpecificity(text: string): ScoredDimension {
    const specificPatterns = [
      /\b\d+\.\d+\.\d+\b/, // Version numbers
      /\b[A-Z][a-z]+Module\b/, // Class/Module names
      /\b(api|endpoint|db|cache|cluster)\b/i
    ];
    const matches = specificPatterns.filter(p => p.test(text)).length;
    const score = Math.min(100, 30 + (matches * 20));
    return {
      score,
      reason: matches > 0 ? `Contains ${matches} specific technical markers (versioning, modules, or infrastructure components)` : 'Lacks specific technical identifiers'
    };
  }

  private static scoreFreshness(date?: Date): ScoredDimension {
    if (!date) return { score: 50, reason: 'No timestamp available; assuming moderate freshness' };
    const daysOld = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
    if (daysOld < 30) return { score: 100, reason: 'Extremely fresh: observed within the last 30 days' };
    if (daysOld < 180) return { score: 70, reason: 'Recent: observed within the last 6 months' };
    if (daysOld < 365) return { score: 40, reason: 'Dated: observed within the last year' };
    return { score: 10, reason: 'Historical: observation is over a year old' };
  }

  private static scoreRelevance(text: string): ScoredDimension {
    const relKeywords = /\b(scaling|infra|platform|reliability|latency|throughput|migration)\b/i;
    if (relKeywords.test(text)) {
      return { score: 85, reason: 'Strong alignment with infrastructure and platform reliability themes' };
    }
    return { score: 40, reason: 'Low alignment with core strategic intelligence themes' };
  }

  private static calculateTemporalStatus(date?: Date): TemporalStatus {
    if (!date) return 'UNKNOWN_DATE';
    const daysOld = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
    if (daysOld < 30) return 'CURRENT';
    if (daysOld < 180) return 'RECENT';
    return 'HISTORICAL';
  }

  private static calculateWeightedScore(b: ScoreBreakdown): number {
    const reliability = b && typeof b.reliability === 'number' ? b.reliability : 0;
    const reliabilityWeight = EVIDENCE_WEIGHTS.reliability;
    const directness = b && typeof b.directness === 'number' ? b.directness : 0;
    const directnessWeight = EVIDENCE_WEIGHTS.directness;
    const specificity = b && typeof b.specificity === 'number' ? b.specificity : 0;
    const specificityWeight = EVIDENCE_WEIGHTS.specificity;
    const freshness = b && typeof b.freshness === 'number' ? b.freshness : 0;
    const freshnessWeight = EVIDENCE_WEIGHTS.freshness;
    const relevance = b && typeof b.relevance === 'number' ? b.relevance : 0;
    const relevanceWeight = EVIDENCE_WEIGHTS.relevance;
    const repeatability = b && typeof b.repeatability === 'number' ? b.repeatability : 0;
    const repeatabilityWeight = EVIDENCE_WEIGHTS.repeatability;
    const independence = b && typeof b.independence === 'number' ? b.independence : 0;
    const independenceWeight = EVIDENCE_WEIGHTS.independence;

    return Math.round(
      (reliability * reliabilityWeight) +
      (directness * directnessWeight) +
      (specificity * specificityWeight) +
      (freshness * freshnessWeight) +
      (relevance * relevanceWeight) +
      (repeatability * repeatabilityWeight) +
      (independence * independenceWeight)
    );
  }

  private static mapScoreToStrength(score: number): EvidenceStrength {
    return STRENGTH_THRESHOLDS.find(t => score >= t.min)?.strength || 'MICRO';
  }

  private static calculateConfidence(b: ScoreBreakdown): number {
    return ((b?.reliability ?? 0) + (b?.directness ?? 0)) / 200;
  }

  private static inferType(ev: Partial<Evidence>): EvidenceType {
    if (ev.source_type === 'GITHUB') return 'PUBLIC_CODE';
    if (ev.source_type === 'STATUS_PAGE' || ev.source_type === 'SECURITY') return 'DIRECT_OBSERVATION';
    if (ev.source_type === 'ENGINEERING_BLOG') return 'DOCUMENTED_FACT';
    return 'DIRECT_OBSERVATION';
  }
}
