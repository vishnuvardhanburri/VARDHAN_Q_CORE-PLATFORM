import { IntelligenceCase } from './IntelligenceCase';
import { HumanSignal } from './providers/HumanTelemetryProvider';

export interface SynapseCorrelation {
  vulnerability_type: 'SYSTEMIC_COLLAPSE' | 'KNOWLEDGE_VACUUM' | 'TECHNICAL_DEBT_EXPLOSION';
  confidence: number;
  technical_trigger: string;
  human_trigger: string;
  combined_thesis: string;
  leverage_point: string;
}

export class SynapseEngine {
  /**
   * Correlates Behavioral (Technical) anomalies with Human Telemetry.
   * This is the Hybrid Intelligence layer.
   */
  public static correlate(
    technicalSignals: any[],
    humanSignals: HumanSignal[]
  ): SynapseCorrelation[] {
    console.log(`[SynapseEngine] Correlating technical and human telemetry...`);

    const correlations: SynapseCorrelation[] = [];

    // 1. Pattern: [Technical: P99 Spikes/Stability] + [Human: Burnout/Frustration]
    // Result: TECHNICAL_DEBT_EXPLOSION
    const hasStabilityIssues = technicalSignals.some(s =>
      s.type === 'DEV_PAIN' || s.excerpt?.includes('P99') || s.excerpt?.includes('latency')
    );
    const hasBurnout = humanSignals.some(s => s.type === 'BURNOUT_SIGNAL');

    if (hasStabilityIssues && hasBurnout) {
      correlations.push({
        vulnerability_type: 'TECHNICAL_DEBT_EXPLOSION',
        confidence: 0.9,
        technical_trigger: 'Chronic stability failures in core runtime.',
        human_trigger: 'Core engineers expressing frustration and burnout in commit logs.',
        combined_thesis: 'The company is trapped in a cycle of "firefighting" where technical debt has surpassed the team\'s capacity to fix it.',
        leverage_point: 'Pitch as the "Surgical Strike" team that removes the debt so the engineers can stop burning out.',
      });
    }

    // 2. Pattern: [Technical: Shadow Infra/Leaked API] + [Human: Knowledge Bottleneck]
    // Result: KNOWLEDGE_VACUUM
    const hasShadowInfra = technicalSignals.some(s => s.type === 'SHADOW_INFRA' || s.type === 'SHADOW_API');
    const hasBottleneck = humanSignals.some(s => s.type === 'KNOWLEDGE_BOTTLENECK');

    if (hasShadowInfra && hasBottleneck) {
      correlations.push({
        vulnerability_type: 'KNOWLEDGE_VACUUM',
        confidence: 0.85,
        technical_trigger: 'Exposed staging/internal environments suggesting unmanaged growth.',
        human_trigger: 'Critical system knowledge concentrated in a single individual.',
        combined_thesis: 'Infrastructure is expanding faster than the knowledge base. The "Single Point of Failure" (Human) is the only thing keeping the "Shadow Infra" (Technical) from collapsing.',
        leverage_point: 'Pitch as the "Institutional Memory" partner to formalize and secure their scaling process.',
      });
    }

    return correlations;
  }
}
