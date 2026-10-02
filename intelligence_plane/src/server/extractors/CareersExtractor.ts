/**
 * VARDHAN — CAREERS EXTRACTOR
 * ─────────────────────────────────────────────────────────────────────────────
 * Specialized extraction for Greenhouse, Lever, and custom career pages.
 * Focuses on SRE, Platform, and Infrastructure hiring signals.
 */

import { SourceExtractor, Observation } from './SourceExtractor';
import { SourceType } from '../IntelligenceCase';

export class CareersExtractor extends SourceExtractor {
  readonly sourceType: SourceType = 'JOB_SOURCE';

  extract(html: string, url: string, context: any): Observation[] {
    const text = this.cleanText(html);
    const observations: Observation[] = [];

    // Pattern 1: High-value infra roles
    const infraRolesRegex = /\b(?:SRE|Site Reliability Engineer|Platform Engineer|Infrastructure Engineer|Cloud Architect|DevOps Engineer)\b/gi;
    let match;
    while ((match = infraRolesRegex.exec(text)) !== null) {
      observations.push({
        type: 'SRE_hiring',
        raw_text: this.extractSnippet(text, match.index, match[0]),
        confidence: 0.9,
        metadata: { role: match[0], source: 'careers_page' }
      });
    }

    // Pattern 2: Tech stack requirements (Kubernetes, Terraform, etc.)
    const stackRegex = /\b(?:Kubernetes|K8s|Terraform|Ansible|CloudFormation|AWS|GCP|Azure|Prometheus|Grafana)\b/gi;
    while ((match = stackRegex.exec(text)) !== null) {
      observations.push({
        type: 'tech_stack_requirement',
        raw_text: this.extractSnippet(text, match.index, match[0]),
        confidence: 0.7,
        metadata: { technology: match[0], source: 'careers_page' }
      });
    }

    return observations;
  }

  private extractSnippet(text: string, index: number, keyword: string): string {
    const start = Math.max(0, index - 60);
    const end = Math.min(text.length, index + keyword.length + 60);
    return text.slice(start, end).trim();
  }
}
