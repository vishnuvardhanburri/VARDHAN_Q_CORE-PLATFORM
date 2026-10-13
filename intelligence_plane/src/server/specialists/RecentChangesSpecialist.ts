import { BaseSpecialist } from './BaseSpecialist';
import { SpecialistInput } from './SpecialistTypes';
import { CompanyResearchContext } from '../CompanyResearchContext';

export class RecentChangesSpecialist extends BaseSpecialist {
  readonly taskType = 'RECENT_TECHNICAL_CHANGES';

  async collectEvidence(input: SpecialistInput, context: CompanyResearchContext): Promise<any[]> {
    const evidence: any[] = [];
    const changelogPaths = ['/changelog', '/releases', '/updates'];
    
    for (const path of changelogPaths) {
      const url = `https://${input.domain}${path}`;
      try {
        const response = await context.executeRequest(url);
        if (response.ok) {
          evidence.push(this.createEvidence(
            url,
            `Discovered recent changes/releases at ${path}`,
            'DOCUMENT',
            'PUBLIC_DOCUMENTATION',
            'Recent Change Evidence',
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
