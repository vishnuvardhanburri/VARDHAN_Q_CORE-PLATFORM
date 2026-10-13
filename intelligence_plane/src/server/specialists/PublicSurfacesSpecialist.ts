import { BaseSpecialist } from './BaseSpecialist';
import { SpecialistInput } from './SpecialistTypes';
import { CompanyResearchContext } from '../CompanyResearchContext';

export class PublicSurfacesSpecialist extends BaseSpecialist {
  readonly taskType = 'PUBLIC_TECHNICAL_SURFACES';

  async collectEvidence(input: SpecialistInput, context: CompanyResearchContext): Promise<any[]> {
    const evidence: any[] = [];
    const commonPaths = ['/docs', '/api', '/developers', '/status', '/engineering', '/blog', '/changelog'];
    
    for (const path of commonPaths) {
      const url = `https://${input.domain}${path}`;
      try {
        const response = await context.executeRequest(url);
        if (response.ok) {
          evidence.push(this.createEvidence(
            url,
            `Discovered public technical surface: ${path}`,
            'SURFACE',
            'API_ENDPOINT',
            'Surface Discovery',
            'LOW'
          ));
        }
      } catch (e) {
        // Expected for many paths
      }
    }

    return evidence;
  }
}
