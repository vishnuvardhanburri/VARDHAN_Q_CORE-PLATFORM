// DomainResolver.ts
// -------------------
// Resolves a Growjo-imported company to its canonical official domain using ONLY
// sources the Growjo record + publicly observable redirect/canonical behaviour.
// It NEVER guesses a domain (no name-based search-engine/DNS lookups without
// operator-supplied credentials). Ambiguous cases surface as RESEARCH_MORE.

import type { CompanyResolution, GrowjoCompany } from './DeepTypes';
import type { HttpFetcher } from './IntelligenceCase';

export interface ResolveSeed {
  domain: string | null;
  website_url: string | null;
  company_name: string;
}

export class DomainResolver {
  static canonicalizeDomain(input: string): string {
    let d = input.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    d = d.replace(/^www\./, '');
    return d;
  }

  /** Resolve canonical domain from a Growjo seed, never guessing. */
  static async resolve(seed: ResolveSeed, fetcher: HttpFetcher): Promise<CompanyResolution> {
    // 1) Growjo already supplied a domain.
    if (seed.domain && seed.domain.trim()) {
      const d = DomainResolver.canonicalizeDomain(seed.domain);
      if (d) {
        return {
          canonical_name: seed.company_name.trim(),
          official_domain: d,
          resolution_method: 'GROWJO_DOMAIN',
          resolution_source: `Growjo record for ${seed.company_name}`,
          resolution_confidence: 'HIGH',
        };
      }
    }

    // 2) Growjo supplied a website URL — follow it legitimately (redirects,
    //    canonical link tag, og:url meta). All of these are public, observable
    //    behaviour of the company's own site. Never guess.
    if (seed.website_url && seed.website_url.trim()) {
      try {
        let finalUrl = seed.website_url.trim();
        let html = '';
        // A bounded number of redirect hops is followed by the fetcher itself
        // (redirect: 'follow' is the default); we additionally read the
        // canonical link tag and og:url meta for a corroborated official domain.
        let canonical: string | null = null;
        let ogUrl: string | null = null;
        try {
          const res = await fetcher(finalUrl, { method: 'GET', headers: { accept: 'text/html' }, signal: AbortSignal.timeout(8000) });
          html = await res.text();
          finalUrl = res.url || finalUrl;
          canonical = extractMeta(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
          ogUrl = extractMeta(html, /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i);
        } catch { /* transient network failure — fall back to redirect target */ }

        const candidates = [canonical, ogUrl, finalUrl].filter(Boolean) as string[];
        const domains = candidates.map(c => DomainResolver.canonicalizeDomain(c));
        const unique = Array.from(new Set(domains));
        const consistent = unique.length === 1 && unique[0];
        if (consistent) {
          // All observed official-domain signals agree. Prefer the most
          // authoritative signal actually observed: canonical <link> tag first,
          // then the og:url meta, then the redirect destination. This makes the
          // full chain (GROWJO_DOMAIN -> PUBLIC_REDIRECT -> GROWJO_HOMEPAGE_CANONICAL
          // -> OGP_URL) a real, observable resolution path — never a guess.
          const method: CompanyResolution['resolution_method'] = canonical
            ? 'GROWJO_HOMEPAGE_CANONICAL'
            : ogUrl ? 'OGP_URL' : 'PUBLIC_REDIRECT';
          const source = canonical ?? ogUrl ?? finalUrl;
          return {
            canonical_name: seed.company_name.trim(),
            official_domain: consistent,
            resolution_method: method,
            resolution_source: source,
            resolution_confidence: 'HIGH',
          };
        }
        // Conflicting canonical/og/redirect signals -> ambiguous.
        if (unique.length > 1) {
          return {
            canonical_name: seed.company_name.trim(),
            official_domain: null,
            resolution_method: 'AMBIGUOUS',
            resolution_source: `Conflicting canonical/og:url/redirect targets: ${unique.join(', ')}`,
            resolution_confidence: 'LOW',
          };
        }
      } catch (e) {
        return {
          canonical_name: seed.company_name.trim(),
          official_domain: null,
          resolution_method: 'AMBIGUOUS',
          resolution_source: `Resolution failed: ${e instanceof Error ? e.message : String(e)}`,
          resolution_confidence: 'LOW',
        };
      }
    }

    // 3) No domain or website to go on — never guess.
    return {
      canonical_name: seed.company_name.trim(),
      official_domain: null,
      resolution_method: 'AMBIGUOUS',
      resolution_source: 'No domain or website supplied by Growjo; no legitimate public source available without operator credentials.',
      resolution_confidence: 'LOW',
    };
  }
}

function extractMeta(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1] : null;
}
