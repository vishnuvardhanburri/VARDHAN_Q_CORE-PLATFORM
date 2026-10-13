import { IntelligenceCase } from './IntelligenceCase';

export interface TemporalDelta {
  metric: string;
  previous_value: any;
  current_value: any;
  delta: any;
  trend: 'INCREASING' | 'DECREASING' | 'STABLE';
  significance: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface InstitutionalTrajectory {
  status: 'STABLE' | 'PIVOTING' | 'IN_CRISIS' | 'ACCELERATING';
  predicted_next_move: string;
  vulnerability_window: string;
  confidence: number;
  deltas: TemporalDelta[];
}

export class TemporalDeltaEngine {
  /**
   * Compares the current case against a historical snapshot to detect trajectory.
   */
  public static calculateTrajectory(current: IntelligenceCase, previous: IntelligenceCase): InstitutionalTrajectory {
    const deltas: TemporalDelta[] = [];

    // 1. Evidence Growth Delta
    const evDelta = current.evidence.length - previous.evidence.length;
    deltas.push({
      metric: 'evidence_growth',
      previous_value: previous.evidence.length,
      current_value: current.evidence.length,
      delta: evDelta,
      trend: evDelta > 0 ? 'INCREASING' : 'STABLE',
      significance: evDelta > 5 ? 'HIGH' : 'LOW',
    });

    // 2. Signal Shift Delta
    const prevSignals = new Set((previous.signals || []).map(s => s.type));
    const currSignals = (current.signals || []).map(s => s.type);
    const newSignals = currSignals.filter(s => !prevSignals.has(s));

    deltas.push({
      metric: 'new_signal_types',
      previous_value: prevSignals.size,
      current_value: new Set(currSignals).size,
      delta: newSignals.length,
      trend: newSignals.length > 0 ? 'INCREASING' : 'STABLE',
      significance: newSignals.length > 2 ? 'HIGH' : 'MEDIUM',
    });

    // 3. Budget Consumption Velocity
    const curBs = current.budget_state || { requestsUsed: 0, queriesUsed: 0, githubObservations: 0, stoppedEarly: false };
    const prevBs = previous.budget_state || { requestsUsed: 0, queriesUsed: 0, githubObservations: 0, stoppedEarly: false };
    const budgetDelta = curBs.requestsUsed - prevBs.requestsUsed;
    deltas.push({
      metric: 'research_velocity',
      previous_value: prevBs.requestsUsed,
      current_value: curBs.requestsUsed,
      delta: budgetDelta,
      trend: budgetDelta > 0 ? 'INCREASING' : 'STABLE',
      significance: 'MEDIUM',
    });

    // SYNTHESIS: Determine the institutional state
    let status: 'STABLE' | 'PIVOTING' | 'IN_CRISIS' | 'ACCELERATING' = 'STABLE';
    let predictedMove = 'Maintaining current operational baseline.';
    let window = 'Standard engagement window.';

    const highSigCount = deltas.filter(d => d.significance === 'HIGH').length;

    if (highSigCount >= 2) {
      status = 'PIVOTING';
      predictedMove = 'Rapidly shifting infrastructure or product focus to address a core bottleneck.';
      window = 'IMMEDIATE: The company is in a state of flux; high receptivity to external expertise.';
    } else if (highSigCount === 1 && deltas[0].metric === 'evidence_growth' && deltas[0].delta > 10) {
      status = 'IN_CRISIS';
      predictedMove = 'Attempting to stabilize a failing system or mitigate a major leak/outage.';
      window = 'CRITICAL: Extreme vulnerability; high urgency for resolution.';
    } else if (highSigCount === 0 && deltas[0].delta > 0) {
      status = 'ACCELERATING';
      predictedMove = 'Steady growth and expansion of technical surface.';
      window = 'OPPORTUNISTIC: Growth-phase expansion.';
    }

    return {
      status,
      predicted_next_move: predictedMove,
      vulnerability_window: window,
      confidence: 0.7 + (highSigCount * 0.1),
      deltas,
    };
  }
}
