import { BaseSpecialist } from './BaseSpecialist';
import { SpecialistInput } from './SpecialistTypes';
import { CompanyResearchContext } from '../CompanyResearchContext';

export class CommunityDiscussionSpecialist extends BaseSpecialist {
  readonly taskType = 'COMMUNITY_TECHNICAL_DISCUSSION';

  async collectEvidence(input: SpecialistInput, context: CompanyResearchContext): Promise<any[]> {
    const evidence: any[] = [];
    // In production, this would use a search provider to find Reddit/HackerNews/Forums
    // For this implementation, we check for a community/forum page on the site
    const communityPaths = ['/community', '/forum', '/discussions'];
    
    for (const path of communityPaths) {
      const url = `https://${input.domain}${path}`;
      try {
        const response = await context.executeRequest(url);
        if (response.ok) {
          evidence.push(this.createEvidence(
            url,
            `Discovered public community discussion surface at ${path}`,
            'DISCUSSION',
            'PUBLIC_PROFESSIONAL_SOURCE',
            'Community Evidence',
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
