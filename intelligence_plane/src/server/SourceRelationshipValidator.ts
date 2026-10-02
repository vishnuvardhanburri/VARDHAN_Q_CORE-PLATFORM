/**
 * VARDHAN — SOURCE RELATIONSHIP VALIDATOR
 * ─────────────────────────────────────────────────────────────────────────────
 * Prevents "Identity Leaks" by verifying the relationship between a discovered
 * URL and the target company's verified identity.
 */

import { SourceRelationship } from './IntelligenceCase';

export class SourceRelationshipValidator {
  /**
   * Validates the relationship between a URL and the target company.
   *
   * @param url The URL of the evidence source.
   * @param targetOrigin The verified primary domain of the company (e.g., 'vercel.com').
   * @param companyName The name of the company for external handle verification.
   */
  public static validate(
    url: string,
    targetOrigin: string,
    companyName: string
  ): SourceRelationship {
    if (!url) return 'UNVERIFIED';
    if (!targetOrigin) return 'UNVERIFIED';

    try {
      const urlObj = new URL(url);
      const origin = urlObj.origin;

      // 1. VERIFIED_OWNED: Origin matches target origin (or is a subdomain)
      if (origin === `https://${targetOrigin}` || origin === `http://${targetOrigin}` || origin.endsWith(`.${targetOrigin}`)) {
        return 'VERIFIED_OWNED';
      }

      // 2. VERIFIED_EXTERNAL: Check for known trusted platforms with company handles
      // Implementation: Simple handle check for common platforms
      const path = urlObj.pathname;
      const host = urlObj.hostname;
      const normalizedCompany = companyName.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');

      // GitHub verification
      if (host === 'github.com') {
        const parts = path.split('/').filter(Boolean);
        if (parts.length > 0 && parts[0].toLowerCase().includes(normalizedCompany)) {
          return 'VERIFIED_EXTERNAL';
        }
      }

      // LinkedIn verification
      if (host.includes('linkedin.com/company/')) {
        if (url.toLowerCase().includes(normalizedCompany)) {
          return 'VERIFIED_EXTERNAL';
        }
      }

      // Status page verification (generic pattern)
      if (host.includes('statuspage.io') && url.toLowerCase().includes(normalizedCompany)) {
        return 'VERIFIED_EXTERNAL';
      }

    } catch (e) {
      console.error(`[VALIDATION_ERROR] Failed to parse URL ${url}: ${e}`);
    }

    return 'UNVERIFIED';
  }

  /**
   * Check if a relationship is trusted enough to be used for signal extraction.
   */
  public static isTrusted(relationship: SourceRelationship): boolean {
    return relationship !== 'UNVERIFIED';
  }
}
