import { IntelligenceCase, Evidence } from '../IntelligenceCase';
import { TrendSignal } from './TrendAndChangeIntelligenceEngine';

export type AdvisoryType = 
  | 'PUBLIC_EXPOSURE_ADVISORY' 
  | 'ARCHITECTURE_CHANGE_ADVISORY' 
  | 'INFRASTRUCTURE_CHANGE_ADVISORY' 
  | 'RELIABILITY_TREND_ADVISORY' 
  | 'SCALING_TREND_ADVISORY' 
  | 'TECHNOLOGY_MIGRATION_ADVISORY' 
  | 'PUBLIC_INCIDENT_ADVISORY' 
  | 'DATA_HANDLING_ADVISORY' 
  | 'OPERATIONAL_COMPLEXITY_ADVISORY' 
  | 'OTHER_PUBLIC_TECHNICAL_ADVISORY';

export interface AdvisoryDecision {
  eligible: boolean;
  type?: AdvisoryType;
  rationale: string;
  proofContractSatisfied: boolean;
}

export class AdvisoryEligibilityEngine {
  async evaluate(
    caseData: IntelligenceCase, 
    trends: TrendSignal[]
  ): Promise<AdvisoryDecision> {
    
    // 1. Check for Public Exposure (Strict but non-accusatory)
    const hasExposure = caseData.evidence.some(e => 
      e.observed_behavior.toLowerCase().includes('exposed') || 
      e.observed_behavior.toLowerCase().includes('publicly accessible')
    );

    if (hasExposure) {
      return {
        eligible: true,
        type: 'PUBLIC_EXPOSURE_ADVISORY',
        rationale: 'Publicly observable asset identified without verifying private access.',
        proofContractSatisfied: true
      };
    }

    // 2. Check for meaningful Trends
    if (trends.length > 0) {
      const trend = trends[0];
      if (trend.signalType === 'INCREASING_DISTRIBUTED_SYSTEM_COMPLEXITY') {
        return {
          eligible: true,
          type: 'ARCHITECTURE_CHANGE_ADVISORY',
          rationale: `Observed trend of ${trend.description}`,
          proofContractSatisfied: true
        };
      }
    }

    // 3. Check for documented incidents (L2)
    const hasIncidents = caseData.evidence.some(e => 
      e.observed_behavior.toLowerCase().includes('outage') || 
      e.observed_behavior.toLowerCase().includes('incident')
    );

    if (hasIncidents) {
      return {
        eligible: true,
        type: 'PUBLIC_INCIDENT_ADVISORY',
        rationale: 'Publicly documented reliability incident observed.',
        proofContractSatisfied: true
      };
    }

    return {
      eligible: false,
      rationale: 'Insufficient evidence for an advisory notice.',
      proofContractSatisfied: false
    };
  }
}
