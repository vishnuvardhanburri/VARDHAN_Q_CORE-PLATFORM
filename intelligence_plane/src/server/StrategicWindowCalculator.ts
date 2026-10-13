import { IntelligenceCase, Evidence } from './IntelligenceCase';
import { TemporalDeltaEngine, InstitutionalTrajectory } from './TemporalDeltaEngine';
import { ThesisEngine, StrategicThesis } from './ThesisEngine';

export interface StrategicWindow {
  window_status: 'OPEN' | 'CLOSING' | 'CLOSED';
  urgency_score: number; // 0-1
  recommended_action: string;
  optimal_contact_date: string;
}

export class StrategicWindowCalculator {
  /**
   * Combines the Temporal Trajectory and the Strategic Thesis to calculate
   * the precise "Window of Opportunity" for high-ticket outreach.
   */
  public static calculateWindow(
    thesis: StrategicThesis,
    trajectory: InstitutionalTrajectory
  ): StrategicWindow {
    let urgency = 0.5;
    let status: StrategicWindow['window_status'] = 'OPEN';
    let action = 'Standard high-ticket outreach approach.';

    // 1. Boost urgency based on trajectory status
    switch (trajectory.status) {
      case 'IN_CRISIS':
        urgency += 0.4;
        status = 'OPEN';
        action = 'Aggressive intervention: Lead with the immediate failure and the risk of systemic collapse.';
        break;
      case 'PIVOTING':
        urgency += 0.2;
        status = 'OPEN';
        action = 'Consultative approach: Position as the partner to accelerate their current pivot.';
        break;
      case 'ACCELERATING':
        urgency -= 0.1;
        status = 'OPEN';
        action = 'Growth-partner approach: Position as the scale-expert to prevent future bottlenecks.';
        break;
      case 'STABLE':
        urgency -= 0.2;
        status = 'CLOSING';
        action = 'Educational approach: Highlight the "Competitive Obsolescence" risk.';
        break;
    }

    // 2. Boost urgency based on Thesis confidence and financial impact
    if (thesis.confidence > 0.8) urgency += 0.1;

    // 3. Cap and finalize
    urgency = Math.min(Math.max(urgency, 0), 1);

    const date = new Date();
    date.setDate(date.getDate() + (urgency > 0.7 ? 3 : 14));

    return {
      window_status: status,
      urgency_score: urgency,
      recommended_action: action,
      optimal_contact_date: date.toISOString().split('T')[0],
    };
  }
}
