import { BaseSpecialist } from './BaseSpecialist';
import { SpecialistInput } from './SpecialistTypes';
import { CompanyResearchContext } from '../CompanyResearchContext';

export class TechFootprintSpecialist extends BaseSpecialist {
  readonly taskType = 'TECHNOLOGY_FOOTPRINT';

  async collectEvidence(input: SpecialistInput, context: CompanyResearchContext): Promise<any[]> {
    const evidence: any[] = [];
    const targets = [`https://${input.domain}`, `https://${input.domain}/robots.txt`];

    for (const url of targets) {
      try {
        const response = await context.executeRequest(url);
        const text = await response.text();

        // Search for tech clues (e.g. "Powered by", "Built with", specific headers)
        const techClues = [
          { pattern: /aws/i, tech: 'AWS' },
          { pattern: /gcp|google cloud/i, tech: 'GCP' },
          { pattern: /azure/i, tech: 'Azure' },
          { pattern: /kubernetes|k8s/i, tech: 'Kubernetes' },
          { pattern: /react/i, tech: 'React' },
          { pattern: /typescript/i, tech: 'TypeScript' },
        ];

        for (const clue of techClues) {
          if (clue.pattern.test(text)) {
            evidence.push(this.createEvidence(
              url,
              `Detected technology clue: ${clue.tech}`,
              'SURFACE',
              'PUBLIC_DOCUMENTATION',
              'Infrastructure Clue',
              'MEDIUM'
            ));
          }
        }
      } catch (e) {
        console.error(`[TechFootprint] failed to fetch ${url}`);
      }
    }

    return evidence;
  }
}
