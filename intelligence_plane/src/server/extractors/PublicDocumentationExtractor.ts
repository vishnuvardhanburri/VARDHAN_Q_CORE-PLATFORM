/**
 * VARDHAN — PUBLIC DOCUMENTATION EXTRACTOR
 * ─────────────────────────────────────────────────────────────────────────────
 * Extracts technical signals from public documentation, help centers, and guides.
 * Targets: Scaling limits, architecture shifts, API deprecations, and infra-hints.
 */

import { SourceExtractor, Observation } from './SourceExtractor';
import { SourceType } from '../IntelligenceCase';

export class PublicDocumentationExtractor extends SourceExtractor {
  readonly sourceType: SourceType = 'PUBLIC_DOCUMENTATION';

  private readonly DETECTORS = [
    {
      type: 'INFRA_LIMITATION',
      patterns: [
        /limit(?:ation)?\s+of\s+(?:the\s+)?(?:system|api|platform)/gi,
        /maximum\s+(?:allowed|supported)\s+(?:requests|connections|nodes)/gi,
        /quota\s+(?:exceeded|reached|limits)/gi,
        /scale(?:d|s)?\s+up\s+to\s+\d+/gi,
      ],
      confidence: 0.7,
    },
    {
      type: 'ARCHITECTURE_SHIFT',
      patterns: [
        /migrat(?:ing|rated)\s+to\s+(?:a\s+)?(?:new|different)\s+(?:architecture|platform|backend)/gi,
        /deprecat(?:ing|ated)\s+in\s+favor\s+of/gi,
        /transition(?:ing)?\s+from\s+.*to\s+.*/gi,
        /legacy\s+(?:system|architecture|version)/gi,
      ],
      confidence: 0.8,
    },
    {
      type: 'RELIABILITY_HINT',
      patterns: [
        /availability\s+of\s+\d+%\s+uptime/gi,
        /disaster\s+recovery\s+strategy/gi,
        /failover\s+mechanism/gi,
        /latency\s+requirements\s+of\s+/gi,
        /sla\s+guarantee/gi,
      ],
      confidence: 0.6,
    },
    {
      type: 'SCALING_PAIN',
      patterns: [
        /challeng(?:es|ing)\s+with\s+scaling/gi,
        /performance\s+bottleneck/gi,
        /throughput\s+constraints/gi,
        /resource\s+exhaustion/gi,
      ],
      confidence: 0.7,
    },
  ];

  extract(html: string, url: string, context: any): Observation[] {
    const text = this.cleanText(html);
    const observations: Observation[] = [];

    for (const detector of this.DETECTORS) {
      for (const pattern of detector.patterns) {
        const matches = text.matchAll(pattern);
        for (const match of matches) {
          // Capture a window around the match for context
          const start = Math.max(0, match.index! - 150);
          const end = Math.min(text.length, match.index! + match[0].length + 150);
          const snippet = text.slice(start, end).trim();

          observations.push({
            type: detector.type,
            raw_text: `...${snippet}...`,
            confidence: detector.confidence,
            metadata: {
              url,
              pattern: pattern.toString(),
              match: match[0],
            },
          });
        }
      }
    }

    return observations;
  }
}
