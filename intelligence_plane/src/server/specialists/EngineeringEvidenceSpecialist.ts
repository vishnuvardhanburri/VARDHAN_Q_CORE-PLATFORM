import { BaseSpecialist } from './BaseSpecialist';
import { SpecialistInput } from './SpecialistTypes';
import { CompanyResearchContext } from '../CompanyResearchContext';

export class EngineeringEvidenceSpecialist extends BaseSpecialist {
  readonly taskType = 'ENGINEERING_EVIDENCE';

  async collectEvidence(input: SpecialistInput, context: CompanyResearchContext): Promise<any[]> {
    const evidence: any[] = [];
    const engPaths = ['/blog/engineering', '/engineering/blog', '/tech/blog'];
    
    for (const path of engPaths) {
      const url = `https://${input.domain}${path}`;
      try {
        const response = await context.executeRequest(url);
        if (response.ok) {
          const text = await response.text();
          if (text.toLowerCase().includes('scaling') || text.toLowerCase().includes('migration') || text.toLowerCase().includes('architecture')) {
            evidence.push(this.createEvidence(
              url,
              `Engineering blog contains high-value technical content (scaling/migration/architecture)`,
              'DOCUMENT',
              'ENGINEERING_BLOG',
              'Engineering Evidence',
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
