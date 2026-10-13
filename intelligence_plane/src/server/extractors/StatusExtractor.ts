/**
 * VARDHAN — STATUS PAGE EXTRACTOR
 * ─────────────────────────────────────────────────────────────────────────────
 * Specialized extraction for status.io, atlassian statuspage, etc.
 * Focuses on incident reports, outage windows, and operational health.
 */

import { SourceExtractor, Observation } from './SourceExtractor';
import { SourceType } from '../IntelligenceCase';

export class StatusExtractor extends SourceExtractor {
  readonly sourceType: SourceType = 'STATUS_PAGE';

  extract(html: string, url: string, context: any): Observation[] {
    const text = this.cleanText(html);
    const observations: Observation[] = [];

    // Pattern 1: Outages and Incidents
    const incidentRegex = /\b(?:major|partial|service)?\s*outage\b|\bindent report\b|\bindent\b|degraded service|service interruption|postmortem\b|post-mortem\b|downtime|\bresolved\s+(?:the\s+)?incident\b/gi;
    let match;
    while ((match = incidentRegex.exec(text)) !== null) {
      observations.push({
        type: 'incident',
        raw_text: this.extractSnippet(text, match.index, match[0]),
        confidence: 0.95,
        metadata: { keyword: match[0], source: 'status_page' }
      });
    }

    // Pattern 2: System Health/Operational Status
    const healthRegex = /\ball systems (?:operational|normal)\b|status page|real-time status|system status|availability status/gi;
    while ((match = healthRegex.exec(text)) !== null) {
      observations.push({
        type: 'system_health',
        raw_text: this.extractSnippet(text, match.index, match[0]),
        confidence: 0.8,
        metadata: { keyword: match[0], source: 'status_page' }
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
