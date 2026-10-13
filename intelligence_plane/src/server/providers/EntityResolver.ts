/**
 * VARDHAN — ENTITY RESOLVER
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolves company names/domains into canonical entities and deduplicates.
 *
 * Uses DomainResolver (existing) for actual domain resolution — never guesses.
 * Name-aliasing only happens through the explicit alias registry; we NEVER
 * merge entities merely because names are similar.
 */
import type { CanonicalCompany, Provenance } from './Model';
import { DomainResolver, type ResolveSeed } from '../DomainResolver';
import type { CompanyResolution } from '../DeepTypes';
import type { HttpFetcher } from '../IntelligenceCase';

export interface EntityResolution {
  canonical_name: string;
  official_domain: string | null;
  aliases: string[];
  github_org: string | null;
  matched: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export class EntityResolver {
  private readonly knownAliases: Map<string, string> = new Map(); // lowercase name → canonical
  private readonly fetcher: HttpFetcher | null;

  constructor(fetcher: HttpFetcher | null = null) {
    this.fetcher = fetcher;
  }

  /**
   * Resolve a company name or domain into a canonical entity.
   * Uses evidence — never guesses domains.
   */
  async resolve(nameOrDomain: string): Promise<EntityResolution | null> {
    const isDomain = /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(nameOrDomain);

    if (isDomain) {
      const d = DomainResolver.canonicalizeDomain(nameOrDomain);
      return {
        canonical_name: nameOrDomain,
        official_domain: d,
        aliases: [nameOrDomain],
        github_org: null,
        matched: true,
        confidence: 'HIGH',
      };
    }

    // Company name — check alias map first
    const key = nameOrDomain.toLowerCase().trim();
    const canonical = this.knownAliases.get(key);
    if (canonical) {
      return { canonical_name: canonical, official_domain: null, aliases: [nameOrDomain], github_org: null, matched: true, confidence: 'MEDIUM' };
    }

    // Try DomainResolver with the name (requires fetcher)
    if (this.fetcher) {
      const seed: ResolveSeed = { domain: null, website_url: null, company_name: nameOrDomain };
      try {
        const resolved: CompanyResolution = await DomainResolver.resolve(seed, this.fetcher);
        if (resolved.official_domain) {
          return {
            canonical_name: resolved.canonical_name,
            official_domain: resolved.official_domain,
            aliases: [nameOrDomain],
            github_org: null,
            matched: true,
            confidence: resolved.resolution_confidence,
          };
        }
      } catch {
        // provider failure does not kill the pipeline
      }
    }

    return {
      canonical_name: nameOrDomain,
      official_domain: null,
      aliases: [nameOrDomain],
      github_org: null,
      matched: false,
      confidence: 'LOW',
    };
  }

  /**
   * Normalize a list of canonical companies — merge duplicates by domain.
   * Never merges by name similarity alone.
   */
  dedupe(companies: CanonicalCompany[]): CanonicalCompany[] {
    const seen = new Set<string>();
    const result: CanonicalCompany[] = [];
    for (const c of companies) {
      const raw = c.domain || '';
      const key = raw
        ? raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase()
        : `name:${c.canonical_name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(c);
    }
    return result;
  }

  /** Register a name alias (e.g. "Cloudflare, Inc." → "Cloudflare"). */
  registerAlias(alias: string, canonical: string): void {
    this.knownAliases.set(alias.toLowerCase().trim(), canonical);
  }

  /** Load a list of canonical companies into the alias map. */
  index(companies: CanonicalCompany[]): void {
    for (const c of companies) {
      this.registerAlias(c.company, c.canonical_name);
      if (c.canonical_name !== c.company) {
        this.registerAlias(c.canonical_name, c.canonical_name);
      }
    }
  }
}
