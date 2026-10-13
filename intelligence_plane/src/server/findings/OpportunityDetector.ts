/**
 * VARDHAN — ENGINEERING OPPORTUNITY DETECTOR (§2, §7)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { DeepSignal } from '../DeepTypes';
import type { Evidence } from '../IntelligenceCase';

export type OpportunityType =
  | 'SCALING_PRESSURE'
  | 'PERFORMANCE'
  | 'RELIABILITY_PRESSURE'
  | 'INFRA_COMPLEXITY'
  | 'DB_DATA_LAYER_CHANGE'
  | 'OBSERVABILITY_WORK'
  | 'SECURITY_RELEVANCE'
  | 'ARCHITECTURE_CHANGE'
  | 'PLATFORM_MIGRATION'
  | 'ENGINEERING_CHANGE'
  | 'MAJOR_TECH_EXPANSION'
  | 'RECENT_ENGINEERING'
  | 'PUBLIC_TECH_BEHAVIOR';

export type OpportunityConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type FindingClassification = 'LOW_VALUE' | 'RESEARCH_MORE' | 'ENGINEERING_OPPORTUNITY' | 'VERIFIED_FINDING';

export interface EngineeringOpportunity {
  opportunity_id: string;
  title: string;
  type: OpportunityType;
  technicalArea: string;
  signalIds: string[];
  evidenceIds: string[];
  freshness: { level: string; ageDays: number | null };
  reasons: string[];
  whyNow: string[];
  confidence: OpportunityConfidence;
  nextAction: string;
  unknowns: string[];
}

export interface FindingOutput {
  classification: FindingClassification;
  opportunity: EngineeringOpportunity | null;
  explanation: string;
  evidenceIds: string[];
  rejectedSignals: string[];
  evaluatedAt: string;
}

const SCALING_KEYWORDS = [
  'scaling', 'scale', 'scalability', 'capacity', 'growth', 'traffic', 'load',
  'performance', 'latency', 'throughput', 'bottleneck', 'sharding', 'partition',
  'distributed', 'microservice', 'service mesh', 'kafka', 'redis', 'cassandra',
  'migration', 'migrate', 'replatform', 'replatforming', 'kubernetes', 'k8s',
  'infrastructure', 'platform', 'sre', 'devops', 'observability', 'monitoring',
  'incident', 'outage', 'postmortem', 'post-mortem', 'reliability',
];

const TECH_HIRING_KEYWORDS = [
  'site reliability', 'sre', 'platform engineer', 'infrastructure',
  'data engineer', 'database', 'distributed systems', 'scaling',
  'migration', 'kubernetes', 'cloud', 'devops', 'security engineer',
  'security', 'backend', 'infrastructure engineer', 'observability',
  'production', 'incident response', 'reliability',
];

export class OpportunityDetector {
  static detect(
    signals: DeepSignal[],
    evidence: Evidence[],
    options: {
      existingFindings?: string[];
      company?: string;
      now?: string;
    } = {},
  ): EngineeringOpportunity[] {
    const now = options.now || new Date().toISOString();
    const groups: Record<string, { signals: DeepSignal[], evidence: Evidence[] }> = {};

    // 1. Group signals by technical area first
    for (const s of signals) {
      const area = this.extractTechnicalArea(s.excerpt + ' ' + (s.related_evidence_ids || []).join(' '), s.type);
      if (!groups[area]) groups[area] = { signals: [], evidence: [] };
      groups[area].signals.push(s);
      if (s.related_evidence_ids) {
        // Find actual evidence objects for these IDs
        const related = evidence.filter(e => s.related_evidence_ids?.includes(e.id));
        groups[area].evidence.push(...related);
      }
    }

    const opportunities: EngineeringOpportunity[] = [];

    for (const [area, data] of Object.entries(groups)) {
      const signals = data.signals;
      const evidence = data.evidence;

      // Assess the group as a single entity
      const opp = this.assessGroup(area, signals, evidence, now, options.company);
      if (opp) {
        opportunities.push(opp);
      }
    }

    const confidenceOrder: Record<OpportunityConfidence, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
    return opportunities.sort((a, b) => confidenceOrder[b.confidence] - confidenceOrder[a.confidence]);
  }

  private static assessGroup(area: string, signals: DeepSignal[], evidence: Evidence[], now: string, company?: string): EngineeringOpportunity | null {
    const text = signals.map(s => s.excerpt).join(' ').toLowerCase();
    const matchedKeywords = SCALING_KEYWORDS.filter(k => text.includes(k.toLowerCase()));

    if (signals.length === 0) return null;
    if (signals.length === 1) {
      const s = signals[0];
      const sText = (s.excerpt + ' ' + (s.related_evidence_ids || []).join(' ')).toLowerCase();
      const sKws = SCALING_KEYWORDS.filter(k => sText.includes(k.toLowerCase()));
      if (sKws.length < 2 && !(s.type === 'PUBLIC_INCIDENT' || s.type === 'SECURITY_PAGE' || s.type === 'STATUS_PAGE')) {
        return null;
      }
    }

    const type = this.classifyOpportunityType(signals[0], matchedKeywords);
    
    let ageDays: number | null = null;
    const freshest = signals.sort((a, b) => (b.published_at ? new Date(b.published_at).getTime() : 0) - (a.published_at ? new Date(a.published_at).getTime() : 0))[0];
    if (freshest?.published_at) {
      ageDays = Math.round((Date.now() - new Date(freshest.published_at).getTime()) / (1000 * 60 * 60 * 24));
    }
    const freshnessLevel = ageDays === null ? 'UNKNOWN' : ageDays < 30 ? 'FRESH' : ageDays < 180 ? 'AGING' : 'STALE';

    return {
      opportunity_id: 'opp_' + Math.random().toString(36).slice(2, 10),
      title: `${type.replace(/_/g, ' ')} detected: ${area}`,
      type,
      technicalArea: area,
      signalIds: signals.map(s => s.signal_id),
      evidenceIds: evidence.map(e => e.id),
      freshness: { level: freshnessLevel, ageDays },
      reasons: [
        `Corroborated by ${signals.length} signals in ${area} area`,
        `Matched keywords: ${matchedKeywords.slice(0, 5).join(', ')}`,
      ],
      whyNow: ageDays !== null ? [`Evidence is ${ageDays} days old`] : ['Recency unclear'],
      confidence: signals.length >= 2 ? 'HIGH' : 'MEDIUM',
      nextAction: 'Verify technical claims via live observation',
      unknowns: ['Internal implementation details'],
    };
  }

  private static classifyOpportunityType(s: DeepSignal, keywords: string[]): OpportunityType {
    if (s.type === 'PUBLIC_INCIDENT' || s.type === 'STATUS_PAGE') return 'RELIABILITY_PRESSURE';
    if (s.type === 'SECURITY_PAGE') return 'SECURITY_RELEVANCE';
    if (keywords.includes('migration') || keywords.includes('migrate') || keywords.includes('replatform')) return 'PLATFORM_MIGRATION';
    if (keywords.includes('sharding') || keywords.includes('distributed') || keywords.includes('microservice') || keywords.includes('kubernetes')) return 'INFRA_COMPLEXITY';
    if (keywords.includes('database') || keywords.includes('data layer') || keywords.includes('cassandra') || keywords.includes('redis')) return 'DB_DATA_LAYER_CHANGE';
    if (keywords.includes('monitoring') || keywords.includes('observability') || keywords.includes('sre') || keywords.includes('incident')) return 'OBSERVABILITY_WORK';
    if (keywords.includes('scaling') || keywords.includes('scalability') || keywords.includes('capacity') || keywords.includes('growth') || keywords.includes('traffic')) return 'SCALING_PRESSURE';
    if (keywords.includes('hiring') || keywords.includes('hire')) return 'ENGINEERING_CHANGE';
    return 'RECENT_ENGINEERING';
  }

  private static extractTechnicalArea(text: string, signalType: string): string {
    const areas: [string, string][] = [
      ['database', 'Database/data layer'],
      ['kubernetes', 'Container orchestration'],
      ['migration', 'Platform migration'],
      ['microservice', 'Service architecture'],
      ['redis', 'Caching layer'],
      ['kafka', 'Stream processing'],
      ['monitoring', 'Observability'],
      ['security', 'Security engineering'],
      ['infrastructure', 'Infrastructure'],
      ['platform', 'Platform engineering'],
      ['scal', 'Scalability'],
    ];
    for (const [kw, area] of areas) {
      if (text.toLowerCase().includes(kw)) return area;
    }
    return signalType === 'TECHNICAL_HIRING' ? 'Technical hiring' : 'Platform engineering';
  }

  static evaluateFinding(
    opp: EngineeringOpportunity,
    evidenceCount: number,
    correlationCount: number,
    qualifiedSignalCount: number = opp.signalIds.length
  ): FindingOutput {
    const conf = opp.confidence;

    // Contextual-only evidence (no qualified technical signals from semantic
    // extraction) must NOT produce ENGINEERING_OPPORTUNITY. CONTEXT pressure
    // alone → RESEARCH_MORE until verified technical signals are found.
    const hasQualifiedSignals = qualifiedSignalCount > 0;

    if (conf === 'LOW' && correlationCount < 2) {
      return {
        classification: 'LOW_VALUE',
        opportunity: opp,
        explanation: `Low confidence (${conf}) with only ${correlationCount} correlation(s) — not actionable.`,
        evidenceIds: opp.evidenceIds,
        rejectedSignals: [],
        evaluatedAt: new Date().toISOString(),
      };
    }
    if (conf === 'LOW' && correlationCount >= 3) {
      return {
        classification: hasQualifiedSignals ? 'ENGINEERING_OPPORTUNITY' : 'RESEARCH_MORE',
        opportunity: opp,
        explanation: `Low confidence but corroborated by ${correlationCount} source(s).${!hasQualifiedSignals ? ' No qualified technical signals — needs verification.' : ''}`,
        evidenceIds: opp.evidenceIds,
        rejectedSignals: [],
        evaluatedAt: new Date().toISOString(),
      };
    }
    // MEDIUM confidence requires at least 2 independent cross-source correlations.
    // CONTEXT alone (e.g., a single group of same-page signals) must NOT
    // automatically produce ENGINEERING_OPPORTUNITY — requires RESEARCH_MORE.
    if (conf === 'MEDIUM' && correlationCount >= 2) {
      return {
        classification: hasQualifiedSignals ? 'ENGINEERING_OPPORTUNITY' : 'RESEARCH_MORE',
        opportunity: opp,
        explanation: `Medium confidence with ${correlationCount} correlations.${!hasQualifiedSignals ? ' No qualified technical signals — RESEARCH_MORE.' : ''}`,
        evidenceIds: opp.evidenceIds,
        rejectedSignals: [],
        evaluatedAt: new Date().toISOString(),
      };
    }
    if (conf === 'HIGH' && correlationCount >= 5 && evidenceCount >= 5) {
      return {
        classification: 'VERIFIED_FINDING',
        opportunity: opp,
        explanation: `High confidence, ${correlationCount} corroboration(s), ${evidenceCount} evidence items — verified finding.`,
        evidenceIds: opp.evidenceIds,
        rejectedSignals: [],
        evaluatedAt: new Date().toISOString(),
      };
    }
    if (conf === 'HIGH' && correlationCount >= 1) {
      return {
        classification: 'ENGINEERING_OPPORTUNITY',
        opportunity: opp,
        explanation: `High confidence with ${correlationCount} corroboration(s).`,
        evidenceIds: opp.evidenceIds,
        rejectedSignals: [],
        evaluatedAt: new Date().toISOString(),
      };
    }

    return {
      classification: 'RESEARCH_MORE',
      opportunity: opp,
      explanation: 'More evidence needed',
      evidenceIds: opp.evidenceIds,
      rejectedSignals: [],
      evaluatedAt: new Date().toISOString(),
    };
  }
}
