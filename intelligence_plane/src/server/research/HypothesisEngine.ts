/**
 * VARDHAN — HYPOTHESIS ENGINE (§4)
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates technical hypotheses from observed signals. A hypothesis is NOT
 * a finding — it's a reason to perform the next research action.
 *
 * "What is the highest-value next piece of information I can obtain, and is it
 * worth the time?"
 */

import type { DeepSignal } from '../DeepTypes';
import type { Evidence } from '../IntelligenceCase';
import type { CorrelatedSignalGroup } from '../signals/SignalCorrelationEngine';

export type HypothesisType =
  | 'SCALING_PRESSURE'
  | 'PERFORMANCE'
  | 'RELIABILITY'
  | 'INFRASTRUCTURE_COMPLEXITY'
  | 'DATABASE_COMPLEXITY'
  | 'OBSERVABILITY'
  | 'SECURITY_RELEVANCE'
  | 'ARCHITECTURE_CHANGE'
  | 'PLATFORM_MIGRATION'
  | 'ENGINEERING_CHANGE'
  | 'PUBLIC_INCIDENT_FOLLOWUP';

export interface Hypothesis {
  id: string;
  type: HypothesisType;
  /** Human-readable statement. */
  statement: string;
  /** Evidence IDs supporting this hypothesis. */
  supportingEvidenceIds: string[];
  /** Signal IDs that triggered this hypothesis. */
  signalIds: string[];
  /** Next actions to investigate. */
  nextActions: string[];
  /** Initial estimated information gain (0–1). */
  estimatedInfoGain: number;
  /** Initial research cost estimate (0–1). */
  estimatedCost: number;
}

export class HypothesisEngine {
  /**
   * Generate hypotheses from signals and correlated signal groups.
   * Each hypothesis is a research direction, not a claim.
   */
  static generate(
    signals: DeepSignal[],
    evidence: Evidence[],
    correlations: CorrelatedSignalGroup[],
  ): Hypothesis[] {
    const hypotheses: Hypothesis[] = [];

    for (const group of correlations) {
      const h = this.hypothesisFromGroup(group, evidence);
      if (h) hypotheses.push(h);
    }

    // Also generate from individual high-strength signals
    for (const s of signals) {
      if (s.signal_strength === 'HIGH' && !hypotheses.some(h => h.signalIds.includes(s.signal_id))) {
        const h = this.hypothesisFromSignal(s, evidence);
        if (h) hypotheses.push(h);
      }
    }

    // Sort by estimated information gain (descending)
    return hypotheses.sort((a, b) => b.estimatedInfoGain - a.estimatedInfoGain);
  }

  private static hypothesisFromGroup(group: CorrelatedSignalGroup, evidence: Evidence[]): Hypothesis | null {
    let evIds = Array.from(new Set(group.signals.flatMap(s => s.related_evidence_ids || [])));
    // Also match signals to evidence by URL (source_url ↔ public_url)
    for (const s of group.signals) {
      const urlMatch = evidence.find(e => e.public_url === s.source_url && !evIds.includes(e.id));
      if (urlMatch) evIds.push(urlMatch.id);
    }
    const sigIds = group.signals.map(s => s.signal_id);

    let type: HypothesisType;
    let statement: string;

    switch (group.theme) {
      case 'scalability_infra':
        type = 'SCALING_PRESSURE';
        statement = `Public evidence suggests increasing infrastructure complexity or scaling pressure around ${this.extractSubject(group)}.`;
        break;
      case 'database_data':
        type = 'DATABASE_COMPLEXITY';
        statement = `Evidence suggests database/data-layer complexity or migration activity in ${this.extractSubject(group)}.`;
        break;
      case 'cloud_platform':
        type = 'PLATFORM_MIGRATION';
        statement = `Signals indicate a potential platform or cloud migration/investment in ${this.extractSubject(group)}.`;
        break;
      case 'observability_sre':
        type = 'RELIABILITY';
        statement = `Engineering activity suggests reliability/observability investments in ${this.extractSubject(group)}.`;
        break;
      case 'security_trust':
        type = 'SECURITY_RELEVANCE';
        statement = `Public signals suggest security-relevance work in ${this.extractSubject(group)}.`;
        break;
      default:
        type = 'ENGINEERING_CHANGE';
        statement = `Correlated engineering activity detected in ${this.extractSubject(group)}.`;
    }

    return {
      id: 'hyp_' + Math.random().toString(36).slice(2, 10),
      type,
      statement,
      supportingEvidenceIds: evIds,
      signalIds: sigIds,
      nextActions: [
        'Verify live behavior against public sources',
        'Check for corroborating engineering content',
        'Look for recent technical hiring in this area',
        'Confirm reproducibility',
      ],
      estimatedInfoGain: Math.min(0.95, group.strength + 0.2),
      estimatedCost: group.subsystemCrossed ? 0.5 : 0.3,
    };
  }

  private static hypothesisFromSignal(signal: DeepSignal, evidence: Evidence[]): Hypothesis | null {
    const text = (signal.excerpt + ' ' + (signal.source_title || '')).toLowerCase();
    let type: HypothesisType | null = null;
    let statement = signal.excerpt.slice(0, 120);

    if (text.includes('incident') || text.includes('outage') || text.includes('postmortem')) {
      type = 'PUBLIC_INCIDENT_FOLLOWUP';
      statement = `Public incident/outage reported — follow up for current status and remediation.`;
    } else if (text.includes('migrat') || text.includes('replatform')) {
      type = 'ARCHITECTURE_CHANGE';
      statement = `Evidence of platform migration or re-platforming.`;
    } else if (text.includes('scalab') || text.includes('throughput') || text.includes('capacity')) {
      type = 'SCALING_PRESSURE';
      statement = `Evidence of scaling pressure or capacity planning.`;
    } else if (text.includes('observab') || text.includes('monitor') || text.includes('sre')) {
      type = 'OBSERVABILITY';
      statement = `Evidence of observability/SRE engineering work.`;
    }

    if (!type) return null;

    return {
      id: 'hyp_' + Math.random().toString(36).slice(2, 10),
      type,
      statement,
      supportingEvidenceIds: signal.related_evidence_ids || [],
      signalIds: [signal.signal_id],
      nextActions: [
        'Live-verify the technical claim',
        'Search for corroborating engineering content',
        'Check for related GitHub activity',
      ],
      estimatedInfoGain: 0.5,
      estimatedCost: 0.3,
    };
  }

  private static extractSubject(group: CorrelatedSignalGroup): string {
    const urls = group.independentSources;
    if (urls.length > 0) return `across ${urls.length} source(s)`;
    return 'the company technical surface';
  }
}
