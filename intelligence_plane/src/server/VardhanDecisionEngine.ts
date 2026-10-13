/**
 * VARDHAN — DECISION ENGINE (§10)
 * ─────────────────────────────────────────────────────────────────────────────
 * Scores every candidate signal/finding across 10 evidence dimensions.
 * Aggressive in discovery, conservative in claims.
 *
 * Dimensions (0–2 scale: 0=absent, 1=partial, 2=strong):
 *   1. technical_relevance  — Is this relevant to technical/security outreach?
 *   2. evidence_strength    — How many independent evidence items support it?
 *   3. source_quality       — Are sources official/public/professional?
 *   4. freshness            — Is the information current?
 *   5. reproducibility      — Can it be reproduced / is it repeatable?
 *   6. cross_source_correlation — Does independent sources corroborate?
 *   7. novelty              — Is this actually different from generic content?
 *   8. business_relevance   — Does it matter to the company's business?
 *   9. ownerability         — Can a technical owner be identified?
 *  10. noise_penalty        — Is this generic noise (latency, headers, versions)?
 *
 * Decision: REJECT / LOW_VALUE / RESEARCH_MORE / VALID_FINDING / STRONG_FINDING
 */

import type { Evidence } from './IntelligenceCase';
import type { DeepSignal, DeepFinding } from './DeepTypes';
import type { FreshSource, FreshnessLevel } from './FreshnessEngine';
import { FreshnessEngine } from './FreshnessEngine';

export type DecisionOutcome = 'REJECT' | 'LOW_VALUE' | 'RESEARCH_MORE' | 'VALID_FINDING' | 'STRONG_FINDING';

export interface Dimension {
  name: string;
  score: 0 | 1 | 2;
  /** Public evidence IDs backing this dimension's score. */
  evidence_ids: string[];
  /** Human-readable explanation. */
  explanation: string;
}

export interface Decision {
  outcome: DecisionOutcome;
  /** Overall score (sum of dimension scores minus penalties). */
  score: number;
  /** Max possible score (for normalization). */
  max_score: number;
  /** Per-dimension breakdown. */
  dimensions: Dimension[];
  /** Why the outcome was chosen. */
  reason: string;
  /** Evidence IDs that back the decision. */
  evidence_ids: string[];
  /** Any warnings (e.g. model refused, evidence weak). */
  warnings: string[];
  /** When the decision was made. */
  decided_at: string;
}

export interface DecisionContext {
  company: string;
  domain: string;
  signals: DeepSignal[];
  evidence: Evidence[];
  finding: DeepFinding | null;
  findings: any | null;
  signals_count: number;
  evidence_count: number;
  sources_count: number;
  owner: { name: string; confidence: string } | null;
  contacts: any[];
  /** Previous research state (for change/novelty detection). */
  previous_state: any | null;
  /** Available model gateway (optional). */
  modelGateway?: any;
}

/** Scoring thresholds. */
const THRESHOLDS = {
  STRONG: 14,   // 7 dimensions × 2 = 14 needed for STRONG_FINDING (with noise penalty offset)
  VALID: 8,     // 8 needed for VALID_FINDING
  LOW_VALUE: 3, // 3-7 → LOW_VALUE
};

export class VardhanDecisionEngine {
  /**
   * Evaluate a candidate signal/finding across all 10 dimensions.
   * Returns a scored decision with evidence traceability.
   */
  static decide(ctx: DecisionContext): Decision {
    const dimensions: Dimension[] = [];

    // 1. Technical relevance
    const techRel = this.scoreTechnicalRelevance(ctx);
    dimensions.push(techRel);

    // 2. Evidence strength
    const evStrength = this.scoreEvidenceStrength(ctx);
    dimensions.push(evStrength);

    // 3. Source quality
    const srcQuality = this.scoreSourceQuality(ctx);
    dimensions.push(srcQuality);

    // 4. Freshness
    const freshness = this.scoreFreshness(ctx);
    dimensions.push(freshness);

    // 5. Reproducibility
    const repro = this.scoreReproducibility(ctx);
    dimensions.push(repro);

    // 6. Cross-source correlation
    const correlation = this.scoreCrossSourceCorrelation(ctx);
    dimensions.push(correlation);

    // 7. Novelty
    const novelty = this.scoreNovelty(ctx);
    dimensions.push(novelty);

    // 8. Business relevance
    const bizRel = this.scoreBusinessRelevance(ctx);
    dimensions.push(bizRel);

    // 9. Ownerability
    const ownerable = this.scoreOwnerability(ctx);
    dimensions.push(ownerable);

    // 10. Noise penalty (negative)
    const noise = this.scoreNoisePenalty(ctx);
    dimensions.push(noise);

    const rawScore = dimensions.reduce((sum, d) => sum + d.score, 0);
    const score = Math.max(0, rawScore);
    const maxScore = 18; // 9 positive dimensions × 2 = 18 (noise is negative)

    let outcome: DecisionOutcome;
    if (score >= THRESHOLDS.STRONG) {
      outcome = 'STRONG_FINDING';
    } else if (score >= THRESHOLDS.VALID) {
      outcome = 'VALID_FINDING';
    } else if (score >= THRESHOLDS.LOW_VALUE) {
      outcome = 'LOW_VALUE';
    } else {
      outcome = 'REJECT';
    }

    // Additional gating: VALID/STRONG requires reproducible evidence, not noise
    if (outcome === 'STRONG_FINDING' || outcome === 'VALID_FINDING') {
      if (noise.score > 0) {
        if (outcome === 'STRONG_FINDING') outcome = 'VALID_FINDING';
        else outcome = 'RESEARCH_MORE';
      }
      // Requires at least one reproduction
      if (ctx.evidence.filter(e => (e.reproductions || 0) > 0).length === 0) {
        outcome = 'RESEARCH_MORE';
      }
    }

    const allEvidenceIds = Array.from(new Set(dimensions.flatMap(d => d.evidence_ids)));
    const warnings: string[] = [];
    if (!ctx.owner) warnings.push('No technical owner identified — cannot produce outreach opportunity.');
    if (ctx.evidence_count < 2) warnings.push('Low evidence count — claims not independently corroborated.');
    if (ctx.signals_count === 0) warnings.push('No technical signals detected.');
    if (ctx.modelGateway && !ctx.modelGateway.hasAvailableModel) {
      warnings.push('No local model available — using deterministic scoring only.');
    }

    const reason = this.buildReason(outcome, dimensions, ctx);

    return {
      outcome,
      score,
      max_score: maxScore,
      dimensions,
      reason,
      evidence_ids: allEvidenceIds,
      warnings,
      decided_at: new Date().toISOString(),
    };
  }

  // ── Dimension scorers ──

  private static scoreTechnicalRelevance(ctx: DecisionContext): Dimension {
    const techSignalTypes = new Set([
      'ENGINEERING_ARTICLE', 'TECHNICAL_DOCUMENTATION', 'API_REFERENCE', 'SDK_DOCS',
      'STATUS_PAGE', 'PUBLIC_INCIDENT', 'SECURITY_PAGE', 'TECHNICAL_HIRING',
      'ARCHITECTURE_DISCUSSION', 'BLOG', 'NEWS',
    ]);
    const techSignals = ctx.signals.filter(s => techSignalTypes.has(s.type));
    const evidenceIds = techSignals.map(s => s.signal_id);
    let score: 0 | 1 | 2 = 0;
    if (techSignals.length > 0) score = techSignals.length >= 3 ? 2 : 1;
    return {
      name: 'technical_relevance',
      score,
      evidence_ids: evidenceIds,
      explanation: `${techSignals.length} technical signal(s) detected out of ${ctx.signals_count} total.`,
    };
  }

  private static scoreEvidenceStrength(ctx: DecisionContext): Dimension {
    const ids = ctx.evidence.map(e => e.id);
    let score: 0 | 1 | 2 = 0;
    if (ctx.evidence_count >= 5) score = 2;
    else if (ctx.evidence_count >= 2) score = 1;
    return {
      name: 'evidence_strength',
      score,
      evidence_ids: ids,
      explanation: `${ctx.evidence_count} independent evidence items.`,
    };
  }

  private static scoreSourceQuality(ctx: DecisionContext): Dimension {
    // evidence_origin uses EvidenceOrigin ('MOCK_TEST' | 'REAL_PUBLIC_OBSERVATION' | 'DOCUMENTED_SOURCE')
    // but some evidence records store the 6-tag provenance — cast to string for comparison
    const officialSources = ctx.evidence.filter(e => {
      const origin = e.evidence_origin as string;
      return origin === 'DOCUMENTED_SOURCE' || origin === 'OFFICIAL_COMPANY_SOURCE' || origin === 'GROWJO_SOURCE';
    }).length;
    const publicSources = ctx.evidence.filter(e => {
      const origin = e.evidence_origin as string;
      return origin === 'DOCUMENTED_SOURCE' || origin === 'PUBLIC_PROFESSIONAL_SOURCE' || origin === 'DOCUMENTED_FACT';
    }).length;
    const observationSources = ctx.evidence.filter(e => {
      const origin = e.evidence_origin as string;
      return origin === 'REAL_PUBLIC_OBSERVATION';
    }).length;
    const ids = ctx.evidence.map(e => e.id);
    let score: 0 | 1 | 2 = 0;
    const qualityCount = officialSources + publicSources;
    if (qualityCount >= 3) score = 2;
    else if (qualityCount >= 1) score = 1;
    return {
      name: 'source_quality',
      score,
      evidence_ids: ids,
      explanation: `${officialSources} official/ licensed, ${publicSources} professional/public, ${observationSources} real observations.`,
    };
  }

  private static scoreFreshness(ctx: DecisionContext): Dimension {
    const freshness = FreshnessEngine.classify(ctx.evidence.length > 0 ? ctx.evidence[0].retrieved_at : undefined);
    const ids = ctx.evidence.slice(0, 3).map(e => e.id);
    let score: 0 | 1 | 2 = 0;
    if (freshness.level === 'FRESH') score = 2;
    else if (freshness.level === 'AGING') score = 1;
    return {
      name: 'freshness',
      score,
      evidence_ids: ids,
      explanation: `Latest evidence: ${freshness.level} — ${freshness.reason}`,
    };
  }

  private static scoreReproducibility(ctx: DecisionContext): Dimension {
    const reproducible = ctx.evidence.filter(e => (e.reproductions || 0) > 1 && e.repeatable).length;
    const ids = ctx.evidence.filter(e => (e.reproductions || 0) > 1).map(e => e.id);
    let score: 0 | 1 | 2 = 0;
    if (reproducible >= 3) score = 2;
    else if (reproducible >= 1) score = 1;
    return {
      name: 'reproducibility',
      score,
      evidence_ids: ids,
      explanation: `${reproducible} reproducible observation(s).`,
    };
  }

  private static scoreCrossSourceCorrelation(ctx: DecisionContext): Dimension {
    // Check if multiple evidence items reference the same source_url pattern
    const urlDomains = new Set(ctx.evidence.map(e => { try { return new URL(e.public_url).hostname; } catch { return ''; } }));
    const uniqueSignalSources = new Set(ctx.signals.map(s => { try { return new URL(s.source_url).hostname; } catch { return ''; } }));
    const ids = ctx.evidence.map(e => e.id);
    let score: 0 | 1 | 2 = 0;
    const totalUniqueSources = urlDomains.size + uniqueSignalSources.size;
    if (totalUniqueSources >= 3) score = 2;
    else if (totalUniqueSources >= 2) score = 1;
    return {
      name: 'cross_source_correlation',
      score,
      evidence_ids: ids,
      explanation: `${totalUniqueSources} independent source domains referenced.`,
    };
  }

  private static scoreNovelty(ctx: DecisionContext): Dimension {
    if (!ctx.previous_state || !ctx.previous_state.signals) {
      return { name: 'novelty', score: 1, evidence_ids: [], explanation: 'No previous state — cannot assess novelty (assumed potentially novel).' };
    }
    const prevSignalIds = new Set(ctx.previous_state.signals.map((s: any) => s.signal_id));
    const newSignals = ctx.signals.filter(s => !prevSignalIds.has(s.signal_id));
    const ids = newSignals.map(s => s.signal_id);
    let score: 0 | 1 | 2 = 0;
    if (newSignals.length >= 3) score = 2;
    else if (newSignals.length >= 1) score = 1;
    return {
      name: 'novelty',
      score,
      evidence_ids: ids,
      explanation: `${newSignals.length} new signal(s) vs. previous research.`,
    };
  }

  private static scoreBusinessRelevance(ctx: DecisionContext): Dimension {
    // Heuristic: security/status/incident signals are more business-relevant
    const bizSignals = ctx.signals.filter(s =>
      s.type === 'PUBLIC_INCIDENT' || s.type === 'SECURITY_PAGE' || s.type === 'STATUS_PAGE'
    );
    const ids = bizSignals.map(s => s.signal_id);
    let score: 0 | 1 | 2 = 0;
    if (bizSignals.length >= 2) score = 2;
    else if (bizSignals.length >= 1) score = 1;
    return {
      name: 'business_relevance',
      score,
      evidence_ids: ids,
      explanation: `${bizSignals.length} business-critical signal(s) (security/incident/status).`,
    };
  }

  private static scoreOwnerability(ctx: DecisionContext): Dimension {
    const ids: string[] = [];
    let score: 0 | 1 | 2 = 0;
    if (ctx.owner && ctx.owner.confidence === 'HIGH') {
      score = 2;
      ids.push(...((ctx.owner as any).owner_evidence || []));
    } else if (ctx.owner) {
      score = 1;
    } else if (ctx.signals_count > 0) {
      score = 1; // signals exist, owner search not yet attempted
      ids.push(...ctx.signals.map(s => s.signal_id));
    }
    return {
      name: 'ownerability',
      score,
      evidence_ids: ids,
      explanation: ctx.owner
        ? `Owner identified: ${ctx.owner.name} (${ctx.owner.confidence})`
        : ctx.signals_count > 0
        ? 'Signals detected but owner not yet discovered.'
        : 'No owner and no signals.',
    };
  }

  private static scoreNoisePenalty(ctx: DecisionContext): Dimension {
    // Noise: generic engineering articles, latency-only observations, version-only signals
    const noiseSignals = ctx.signals.filter(s =>
      s.type === 'BLOG' || s.type === 'ENGINEERING_ARTICLE' || s.type === 'TECHNICAL_HIRING' || s.type === 'NEWS'
    );
    const weakSignals = ctx.signals.filter(s => s.signal_strength === 'LOW');
    const ids = [...noiseSignals.map(s => s.signal_id), ...weakSignals.map(s => s.signal_id)];
    let score: 0 | 1 | 2 = 0; // This is a penalty, so negative score
    const noiseCount = noiseSignals.length + weakSignals.length;
    if (noiseCount >= 5) score = 2; // heavy penalty
    else if (noiseCount >= 2) score = 1; // light penalty
    return {
      name: 'noise_penalty',
      score: -score as any, // negative contribution
      explanation: `${noiseCount} generic/noise signal(s) detected — penalizes overclaiming.`,
      evidence_ids: ids,
    };
  }

  private static buildReason(outcome: DecisionOutcome, dimensions: Dimension[], ctx: DecisionContext): string {
    const parts: string[] = [];
    if (ctx.signals_count === 0) parts.push('No technical signals detected.');
    if (!ctx.owner) parts.push('No technical owner identified.');
    const strongDims = dimensions.filter(d => d.score >= 2 && d.name !== 'noise_penalty');
    const weakDims = dimensions.filter(d => d.score > 0 && d.score < 2 && d.name !== 'noise_penalty');
    const noiseDim = dimensions.find(d => d.name === 'noise_penalty');
    if (strongDims.length > 0) parts.push(`Strong on: ${strongDims.map(d => d.name).join(', ')}.`);
    if (weakDims.length > 0) parts.push(`Partial: ${weakDims.map(d => d.name).join(', ')}.`);
    if (noiseDim && noiseDim.score < 0) parts.push(`Noise penalty: ${noiseDim.explanation}`);
    if (parts.length === 0) parts.push('Evidence insufficient for a defensible finding.');
    return parts.join(' ');
  }
}
