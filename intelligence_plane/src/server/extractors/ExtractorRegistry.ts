/**
 * VARDHAN — EXTRACTOR REGISTRY
 * ─────────────────────────────────────────────────────────────────────────────
 * Central registry mapping SourceTypes to their specialized extractors.
 */

import { SourceType } from '../IntelligenceCase';
import { SourceExtractor } from './SourceExtractor';
import { StatusExtractor } from './StatusExtractor';
import { CareersExtractor } from './CareersExtractor';
import { PublicDocumentationExtractor } from './PublicDocumentationExtractor';

class ExtractorRegistry {
  private registry: Map<SourceType, SourceExtractor> = new Map();

  constructor() {
    this.register(new StatusExtractor());
    this.register(new CareersExtractor());
    this.register(new PublicDocumentationExtractor());
    // Other extractors (GitHub, Blog, etc.) will be added here
  }

  private register(extractor: SourceExtractor) {
    this.registry.set(extractor.sourceType, extractor);
  }

  public getExtractor(type: SourceType): SourceExtractor | undefined {
    return this.registry.get(type);
  }

  public getAllTypes(): SourceType[] {
    return Array.from(this.registry.keys());
  }
}

export const extractorRegistry = new ExtractorRegistry();
