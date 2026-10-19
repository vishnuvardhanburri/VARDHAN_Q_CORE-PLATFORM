/**
 * VARDHAN — SOURCE EXTRACTOR BASE
 * ─────────────────────────────────────────────────────────────────────────────
 * Base class for source-specific extraction logic.
 * Each extractor is responsible for turning raw HTML/Content into
 * structured Observations that can be scored as Evidence.
 */

import { SourceType, EvidenceStrength } from '../IntelligenceCase';

export interface Observation {
  type: string;             // The structured observation type (e.g., 'SRE_hiring')
  raw_text: string;          // The exact snippet from the source
  confidence: number;        // Extractor's internal confidence (0.0 - 1.0)
  metadata: Record<string, any>;
}

export abstract class SourceExtractor {
  abstract readonly sourceType: SourceType;

  /**
   * Extract structured observations from the source content.
   * @param html The raw HTML or text content of the page.
   * @param url The URL of the source.
   * @param context Additional context (company name, current signals, etc.)
   */
  abstract extract(html: string, url: string, context: any): Observation[];

  /**
   * Utility to clean HTML for easier regex matching.
   */
  protected cleanText(html: string): string {
    return html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
