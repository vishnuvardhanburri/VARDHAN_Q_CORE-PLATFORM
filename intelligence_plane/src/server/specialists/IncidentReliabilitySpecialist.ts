import { BaseSpecialist } from './BaseSpecialist';
import { SpecialistInput } from './SpecialistTypes';
import { CompanyResearchContext } from '../CompanyResearchContext';

export class IncidentReliabilitySpecialist extends BaseSpecialist {
  readonly taskType = 'INCIDENT_RELIABILITY';

  async collectEvidence(input: SpecialistInput, context: CompanyResearchContext): Promise<any[]> {
    const evidence: any[] = [];
    const statusPaths = ['/status', '/status.html', '/reliability'];
    
    for (const path of statusPaths) {
      const url = `https://${input.domain}${path}`;
      try {
        const response = await context.executeRequest(url);
        if (response.ok) {
          const text = await response.text();
          if (text.toLowerCase().includes('incident') || text.toLowerCase().includes('outage')) {
            evidence.push(this.createEvidence(
              url,
              `Found public incident reporting surface containing keywords (incident/outage)`,
              'DOCUMENT',
              'STATUS_PAGE',
              'Reliability Evidence',
              'MEDIUM'
            ));
          }
        }
      } catch (e) {
        // Expected
      }
    }

    return evidence;
  }
}
