/**
 * VARDHAN — SIGNAL CORRELATION ENGINE (§5, §13)
 * ─────────────────────────────────────────────────────────────────────────────
 * Looks for the same subsystem across multiple independent sources, multiple
 * signals about the same technical theme, and repeated behavior.
 *
 * Correlation does NOT automatically mean causation. The engine stores the
 * relationship and explains WHY signals correlate.
 */

import type { DeepSignal } from '../DeepTypes';
import type { Evidence } from '../IntelligenceCase';
import type { OpportunityType } from '../findings/OpportunityDetector';

export interface CorrelatedSignalGroup {
  /** The technical theme/subsystem this group represents. */
  theme: string;
  /** Signals in this group. */
  signals: DeepSignal[];
  /** Independent source domains that contributed signals. */
  independentSources: string[];
  /** Whether the same subsystem appears across sources. */
  subsystemCrossed: boolean;
  /** Evidence IDs in this group. */
  evidenceIds: string[];
  /** Explanation of why these signals correlate. */
  explanation: string;
  /** Correlation strength (0–1). */
  strength: number;
}

export interface CorrelationResult {
  groups: CorrelatedSignalGroup[];
  /** Count of correlation pairs found. */
  correlationCount: number;
  /** The dominant technical theme. */
  dominantTheme: string | null;
  /** Whether evidence is strong enough for deep research. */
  shouldDeepResearch: boolean;
}

/** Technical themes to look for across signals. */
const THEMES: { name: string; keywords: string[]; opportunityTypes: OpportunityType[] }[] = [
  { name: 'scalability_infra', keywords: ['scalab', 'capacity', 'throughput', 'traffic', 'load', 'performance', 'bottleneck', 'sharding', 'distributed', 'service mesh', 'microservice'], opportunityTypes: ['SCALING_PRESSURE', 'INFRA_COMPLEXITY'] },
  { name: 'database_data', keywords: ['database', 'data layer', 'postgres', 'mysql', 'cassandra', 'redis', 'mongo', 'migration', 'shard', 'partition'], opportunityTypes: ['DB_DATA_LAYER_CHANGE', 'INFRA_COMPLEXITY'] },
  { name: 'cloud_platform', keywords: ['kubernetes', 'k8s', 'aws', 'gcp', 'azure', 'cloud', 'infrastructure', 'platform', 'replatform'], opportunityTypes: ['PLATFORM_MIGRATION', 'INFRA_COMPLEXITY'] },
  { name: 'observability_sre', keywords: ['observability', 'monitoring', 'sre', 'incident', 'reliability', 'postmortem', 'on-call', 'alert'], opportunityTypes: ['OBSERVABILITY_WORK', 'RELIABILITY_PRESSURE'] },
  { name: 'security_trust', keywords: ['security', 'vulnerability', 'auth', 'compliance', 'privacy', 'tls', 'certificate'], opportunityTypes: ['SECURITY_RELEVANCE', 'PUBLIC_TECH_BEHAVIOR'] },
];

export class SignalCorrelationEngine {
  /**
   * Map a technical theme to a specific Engineering Pressure category.
   */
  static mapThemeToPressure(theme: string): string {
    const mapping: Record<string, string> = {
      'scalability_infra': 'SCALING_PRESSURE',
      'database_data': 'DATA_LAYER_MIGRATION_PRESSURE',
      'cloud_platform': 'PLATFORM_MODERNIZATION_PRESSURE',
      'observability_sre': 'RELIABILITY_PRESSURE',
      'security_trust': 'COMPLIANCE_PRESSURE',
    };
    return mapping[theme] || 'UNKNOWN_PRESSURE';
  }

  /**
   * Correlate signals across sources. Returns grouped signals that point
   * toward the same technical area.
   */
  static correlate(signals: DeepSignal[], evidence: Evidence[]): CorrelationResult {
    // RUNTIME GUARD: Ensure only qualified, canonical signals enter the correlation engine.
    // Raw evidence (sig_ev_*) or unqualified objects must be rejected.
    const qualifiedSignals = signals.filter(s => {
      const isCanonical = s.signal_id.startsWith('sig_cand_');
      const hasMetadata = s.type && s.provenance && s.signal_strength;
      const isNotRawEvidence = !s.signal_id.startsWith('sig_ev_');

      if (!isCanonical || !hasMetadata || isNotRawEvidence === false) {
        return false;
      }
      return true;
    });

    const groups: CorrelatedSignalGroup[] = [];

    for (const theme of THEMES) {
      const matchedSignals = qualifiedSignals.filter(s => {
        const text = (s.excerpt + ' ' + (s.source_title || '')).toLowerCase();
        return theme.keywords.some(kw => text.includes(kw.toLowerCase()));
      });

      if (matchedSignals.length === 0) continue;

      const domains = Array.from(new Set(matchedSignals.map(s => {
        try { return new URL(s.source_url).hostname; } catch { return s.source_url; }
      })));

      const evidenceIds = Array.from(new Set(matchedSignals.flatMap(s => s.related_evidence_ids || [])));

      const subsystemCrossed = domains.length >= 2;

      // RELAXED STRENGTH LOGIC: High-impact signals should count even if not corroborated
      const hasCriticalSignal = matchedSignals.some(s => s.signal_strength === 'HIGH');
      const strength = Math.min(1.0, (matchedSignals.length * 0.3) + (domains.length * 0.15));

      groups.push({
        theme: theme.name,
        signals: matchedSignals,
        independentSources: domains,
        subsystemCrossed,
        evidenceIds,
        explanation: `${matchedSignals.length} signal(s) across ${domains.length} independent source(s) for theme "${theme.name}". Subsystems crossed: ${subsystemCrossed ? 'yes' : 'no'}.`,
        strength,
      });
    }

    groups.sort((a, b) => b.strength - a.strength);

    const correlationCount = groups.length;
    const dominantTheme = groups.length > 0 ? groups[0].theme : null;

    // RELAXED DEEP RESEARCH GATE:
    // High-impact signals can now justify research even without subsystem crossing
    const shouldDeepResearch =
      (groups.some(g => g.strength >= 0.6 || (g.strength >= 0.4 && g.signals.some(s => s.signal_strength === 'HIGH')))) ||
      (groups.filter(g => g.subsystemCrossed).length >= 2) ||
      (evidence.length >= 5 && groups.length >= 1);

    return {
      groups,
      correlationCount,
      dominantTheme,
      shouldDeepResearch,
    };
  }

  /** Count how many independent signals support a given finding/theme. */
  static countCorrelations(groups: CorrelatedSignalGroup[]): number {
    return groups.filter(g => g.strength >= 0.3).length;
  }
}
