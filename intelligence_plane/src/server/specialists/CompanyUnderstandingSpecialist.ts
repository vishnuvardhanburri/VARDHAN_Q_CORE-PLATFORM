import { BaseSpecialist } from './BaseSpecialist';
import { SpecialistInput } from './SpecialistTypes';
import { CompanyResearchContext } from '../CompanyResearchContext';

export class CompanyUnderstandingSpecialist extends BaseSpecialist {
  readonly taskType = 'COMPANY_UNDERSTANDING';

  async collectEvidence(input: SpecialistInput, context: CompanyResearchContext): Promise<any[]> {
    const evidence: any[] = [];
    const homepage = `https://${input.domain}`;

    try {
      const response = await context.executeRequest(homepage);
      const text = await response.text();

      // Simple extraction of identity/products from homepage
      // In production, this would use the LLM Gateway to parse the HTML
      if (text.toLowerCase().includes('about') || text.toLowerCase().includes('company')) {
        evidence.push(this.createEvidence(
          homepage,
          `Homepage contains company identity and description for ${input.companyName}`,
          'DOCUMENT',
          'PUBLIC_DOCUMENTATION',
          'Official Homepage',
          'LOW'
        ));
      }
    } catch (e) {
      console.error(`[CompanyUnderstanding] failed to fetch ${homepage}`);
    }

    return evidence;
  }
}
