import { BaseSpecialist } from './BaseSpecialist';
import { SpecialistInput } from './SpecialistTypes';
import { CompanyResearchContext } from '../CompanyResearchContext';

export class DeveloperApiSpecialist extends BaseSpecialist {
  readonly taskType = 'DEVELOPER_API';

  async collectEvidence(input: SpecialistInput, context: CompanyResearchContext): Promise<any[]> {
    const evidence: any[] = [];
    const apiPaths = ['/api/v1', '/developers/api', '/docs/api'];
    
    for (const path of apiPaths) {
      const url = `https://${input.domain}${path}`;
      try {
        const response = await context.executeRequest(url);
        if (response.ok) {
          evidence.push(this.createEvidence(
            url,
            `Detected public API surface at ${path}`,
            'SURFACE',
            'API_ENDPOINT',
            'Developer API Evidence',
            'LOW'
          ));
        }
      } catch (e) {
        // Expected
      }
    }

    return evidence;
  }
}
