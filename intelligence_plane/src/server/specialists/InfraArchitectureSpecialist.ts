import { BaseSpecialist } from './BaseSpecialist';
import { SpecialistInput } from './SpecialistTypes';
import { CompanyResearchContext } from '../CompanyResearchContext';

export class InfraArchitectureSpecialist extends BaseSpecialist {
  readonly taskType = 'INFRASTRUCTURE_ARCHITECTURE';

  async collectEvidence(input: SpecialistInput, context: CompanyResearchContext): Promise<any[]> {
    const evidence: any[] = [];
    // Complex infra clues often appear in engineering blogs or specialized pages
    const targets = [`https://${input.domain}/engineering`, `https://${input.domain}/blog`];
    
    for (const url of targets) {
      try {
        const response = await context.executeRequest(url);
        if (response.ok) {
          const text = await response.text();
          const infraKeywords = ['distributed system', 'gpu', 'inference', 'multi-region', 'pipeline', 'orchestration'];
          
          for (const kw of infraKeywords) {
            if (text.toLowerCase().includes(kw)) {
              evidence.push(this.createEvidence(
                url,
                `Found reference to architectural complexity: ${kw}`,
                'DOCUMENT',
                'ENGINEERING_BLOG',
                'Infrastructure Architecture Evidence',
                'MEDIUM'
              ));
            }
          }
        }
      } catch (e) {
        // Expected
      }
    }

    return evidence;
  }
}
