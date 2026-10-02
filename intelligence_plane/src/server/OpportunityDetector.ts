/**
 * VARDHAN — OPPORTUNITY DETECTOR
 * ─────────────────────────────────────────────────────────────────────────────
 * Now a simplified router. It no longer performs qualification or promotion.
 * It exclusively consumes OutreachReady opportunities.
 */

import { DeepProspect } from './DeepProspectBuilder';

export interface OpportunityReport {
  company_name: string;
  qualified_opportunities: any[];
  summary: string;
}

export class OpportunityDetector {
  /**
   * Extracts the final outreach-ready opportunities from a DeepProspect.
   * This is now a pure projection layer.
   */
  static detect(prospect: DeepProspect): OpportunityReport {
    return {
      company_name: prospect.company_name,
      qualified_opportunities: prospect.outreach_ready_opportunities,
      summary: `Identified ${prospect.outreach_ready_opportunities.length} outreach-ready diagnostic opportunities.`,
    };
  }
}
