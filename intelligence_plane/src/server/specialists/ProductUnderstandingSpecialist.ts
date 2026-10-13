import { BaseSpecialist } from './BaseSpecialist';
import { SpecialistInput } from './SpecialistTypes';
import { CompanyResearchContext } from '../CompanyResearchContext';

export class ProductUnderstandingSpecialist extends BaseSpecialist {
  readonly taskType = 'PRODUCT_UNDERSTANDING';

  async collectEvidence(input: SpecialistInput, context: CompanyResearchContext): Promise<any[]> {
    const evidence: any[] = [];
    const productPaths = ['/products', '/features', '/solutions'];
    
    for (const path of productPaths) {
      const url = `https://${input.domain}${path}`;
      try {
        const response = await context.executeRequest(url);
        if (response.ok) {
          const text = await response.text();
          if (text.length > 0) {
            evidence.push(this.createEvidence(
              url,
              `Product description and capabilities found at ${path}`,
              'DOCUMENT',
              'PUBLIC_DOCUMENTATION',
              'Product Understanding',
              'LOW'
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
