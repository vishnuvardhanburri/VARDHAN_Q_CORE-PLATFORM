/**
 * VARDHAN — PERSON DISCOVERY ENGINE (additive)
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates autonomous person discovery across ALL sources, independent of
 * any single provider. The engine answers: "Who at this company could own
 * this technical finding?"
 *
 * Discovery topology (no single provider required):
 *
 *   PROVIDER DATA (Growjo / CSV / licensed / imported)
 *           ↓
 *   PUBLIC SOURCE GRAPH (team pages, engineering pages, blog authors)
 *           ↓
 *   GITHUB IDENTITIES (company-linked repos → contributors)
 *           ↓
 *   ENTITY RESOLUTION (merge same person from multiple sources)
 *           ↓
 *   OwnerCandidate[] with per-source provenance
 *
 * Key guarantees:
 *   - No fabricated people. Every candidate has explicit public evidence.
 *   - Identity confidence ≠ ownership confidence. A person can be HIGH identity
 *     confidence (clearly listed on a team page) but MEDIUM ownership
 *     confidence (role not directly tied to the finding's subsystem).
 *   - Never merges people using name-similarity alone. Entity resolution
 *     requires matching canonical name AND a shared source URL or role.
 *   - Unknown/missing names in provider records produce zero candidates —
 *     owners are never invented from company names or generic fields.
 *
 * Field-level provenance tags (spec §8):
 *   GROWJO_IDENTITY          — identity from Growjo provider data
 *   OFFICIAL_COMPANY_SOURCE  — identity from company's own public page
 *   PUBLIC_PROFESSIONAL_SOURCE — identity from third-party professional source
 */

import type { CanonicalCompany, CanonicalPerson } from './providers/Model';
import type {
  DeepStage, ProviderCompanyLike, GithubRepoMeta
} from './DeepTypes';
import type {
  OwnerCandidate, StrengthLevel,
  DiscoveredPage, ProfessionalPageCategory
} from './IntelligenceCase';
import { PeopleExtractor } from './PeopleExtractor';

/**
 * Provenance tags for person identity. Keeps the 6 canonical provenance
 * identifiers; this tag describes where a *person* identity came from.
 */
export type PersonProvenance =
  | 'GROWJO_IDENTITY'
  | 'OFFICIAL_COMPANY_SOURCE'
  | 'PUBLIC_PROFESSIONAL_SOURCE';

/** Source of a candidate identity — for evidence lineage (spec §14). */
export interface IdentitySource {
  /** The provenance layer that contributed this identity. */
  provenance: PersonProvenance;
  /** Canonical provider key (growjo, csv, public-dataset, github, public-page). */
  provider_key: string;
  /** URL of the source page / record. */
  source_url: string;
  /** Confidence in the *identity* (separate from ownership confidence). */
  identity_confidence: StrengthLevel;
}

/**
 * A discovered person with full provenance lineage.
 */
export interface DiscoveredPerson {
  person_id: string;          // stable internal id
  canonical_name: string;
  aliases: string[];
  role: string;
  company: string;
  company_id: string | null;
  identity_sources: IdentitySource[];
  relationship_to_area: string;
  identity_confidence: StrengthLevel;
  ownership_confidence: StrengthLevel | null;  // resolved later
  source_urls: string[];
  evidence: string[];
  explicit_evidence: boolean;
  candidates: OwnerCandidate[];  // the merged raw candidate views
}

export interface PersonDiscoveryInput {
  /** Company under research. */
  company: string;
  /** Resolved official domain. */
  domain: string;
  /** The finding's technical area (for role-relevance scoring). */
  technicalArea: string;
  /** Area hints for responsibility matching. */
  technicalAreaHints?: string[];
  /** Provider company data (Growjo / CSV / licensed — any/all). */
  providerCompanies: ProviderCompanyLike[];
  /** Discovered public pages + HTML. */
  pages: DiscoveredPage[];
  htmlByUrl: Map<string, string>;
  /** GitHub repos discovered on the company's own public pages. */
  githubRepos?: GithubRepoMeta[];
  /** Optional HTTP fetcher for GitHub contributor profile lookups. */
  fetcher?: (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;
  /** Optional progress callback. */
  onProgress?: (stage: DeepStage, message: string) => void;
}

/**
 * PersonDiscoveryEngine — autonomous, provider-independent person discovery.
 *
 * Provider order is NOT hardcoded (spec §1). Companies are passed as a flat
 * list; the engine extracts people from whichever providers carry real person
 * data, then augments with public-surface discovery.
 */
export class PersonDiscoveryEngine {
  /**
   * Discover all person candidates for a company from every available source.
   * Returns unified, entity-resolved candidates with per-source provenance.
   */
  static async discover(input: PersonDiscoveryInput): Promise<OwnerCandidate[]> {
    const { company, domain, technicalArea, providerCompanies, pages, htmlByUrl, githubRepos, technicalAreaHints } = input;

    const candidates: { candidate: OwnerCandidate; source: IdentitySource }[] = [];

    // ── 1. PROVIDER-DERIVED PEOPLE (any provider, any order — not hardcoded) ──
    for (const pc of providerCompanies) {
      // The role-match gate (spec §8): a provider person becomes a candidate
      // ONLY when identity + role + company all hold. No provider is required.
      if (!pc.primary_person_name) {
        input.onProgress?.('people', `  [${pc.source}] no person name in record — skipped (not a candidate, not invented).`);
        continue;
      }
      // Reject when the "name" equals the company name (common CSV artifact).
      if (pc.primary_person_name.toLowerCase().trim() === pc.company?.toLowerCase().trim() || pc.primary_person_name.toLowerCase() === pc.canonical_name?.toLowerCase()) {
        input.onProgress?.('people', `  [${pc.source}] name equals company name — not a real person, skipped.`);
        continue;
      }
      if (!this.isTechnicalRole(pc.primary_title)) {
        input.onProgress?.('people', `  [${pc.source}] ${pc.primary_person_name} — skipped (role "${pc.primary_title || ''}" is not a technical owner role).`);
        continue;
      }
      const domainOk = this.domainMatch(pc.domain, domain) || this.domainMatch(pc.website, domain);
      if (!domainOk && !this.companyIdentityMatch(pc.company, company)) {
        input.onProgress?.('people', `  [${pc.source}] ${pc.primary_person_name} — skipped (domain/identity mismatch).`);
        continue;
      }

      const sourceUrl = pc.growjo_url || pc.source_url || pc.linkedin_url || '';
      const provenance: PersonProvenance = pc.source === 'GROWJO' ? 'GROWJO_IDENTITY' : 'OFFICIAL_COMPANY_SOURCE';
      const tag = provenance === 'GROWJO_IDENTITY' ? 'GROWJO_IDENTITY' : 'OFFICIAL_COMPANY_SOURCE';
      const evidence = `${tag}: ${pc.primary_person_name} is listed as ${pc.primary_title} on ${sourceUrl || `(${pc.source} record)`}`;

      input.onProgress?.('people', `  [${pc.source}] ${pc.primary_person_name} — ${pc.primary_title} (HIGH identity, ${provenance})`);

      candidates.push({
        candidate: {
          name: pc.primary_person_name,
          role: pc.primary_title || 'Technical role',
          company: pc.company || company,
          source_urls: sourceUrl ? [sourceUrl] : [],
          evidence: [evidence],
          relationship_to_area: `Role '${pc.primary_title}' covers ${technicalArea}.`,
          confidence: 'HIGH',
          explicit_evidence: true,
        },
        source: { provenance, provider_key: pc.source.toLowerCase(), source_url: sourceUrl, identity_confidence: 'HIGH' },
      });
    }

    // ── 2. AUTONOMOUS PUBLIC-PAGE DISCOVERY (PeopleExtractor) ──
    // Extract from ALL professional page categories — not just team/about.
    const publicCandidate = PeopleExtractor.extractFromPages(pages, htmlByUrl, {
      company,
      technicalAreaHints: technicalAreaHints || ['api', 'backend', 'infrastructure', 'platform', 'security'],
    });
    for (const c of publicCandidate) {
      input.onProgress?.('people', `  [public-page] ${c.name} — ${c.role} (${c.confidence} identity, OFFICIAL_COMPANY_SOURCE)`);
      candidates.push({
        candidate: c,
        source: { provenance: 'OFFICIAL_COMPANY_SOURCE', provider_key: 'public-page', source_url: c.source_urls[0] || '', identity_confidence: c.confidence },
      });
    }

    // ── 3. GITHUB IDENTITY DISCOVERY ──
    // Extract contributor identities from company-linked repos.
    // Uses the unauthenticated GitHub API (rate-limit aware). If rate-limited,
    // falls back to scraping the public contributors graph page.
    if (githubRepos && githubRepos.length > 0 && input.fetcher) {
      input.onProgress?.('people', `  [github] discovering contributors from ${Math.min(githubRepos.length, 3)} top repo(s)...`);
      const reposByStars = [...githubRepos].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
      const topRepos = reposByStars.slice(0, 3);

      let rateLimited = false;
      for (const repo of topRepos) {
        if (rateLimited) break;
        let contributors: GitHubContributor[] = [];
        try {
          // Try GitHub API first (unauthenticated, 60 req/hr)
          const apiUrl = `https://api.github.com/repos/${repo.org}/${repo.repo}/contributors?per_page=15`;
          const res = await input.fetcher(apiUrl, {
            method: 'GET',
            headers: { accept: 'application/vnd.github+json', 'user-agent': 'vardhan-discovery' },
            signal: AbortSignal.timeout(8000),
          });
          const remaining = typeof (res.headers as any)?.get === 'function'
            ? (res.headers as any).get('x-ratelimit-remaining')
            : (res.headers as any)?.['x-ratelimit-remaining'];
          if (typeof remaining === 'string' && parseInt(remaining, 10) === 0) {
            rateLimited = true;
            input.onProgress?.('people', `  [github] API rate limit reached — falling back to page-scrape for contributors.`);
            // Fallback: scrape the contributors page (no API rate limit)
            try {
              const scrapeRes = await input.fetcher(
                `https://github.com/${repo.org}/${repo.repo}/graphs/contributors`,
                { method: 'GET', headers: { 'user-agent': 'vardhan-discovery', accept: 'text/html' }, signal: AbortSignal.timeout(8000) }
              );
              const scrapeHtml = await scrapeRes.text();
              // Extract GitHub usernames from the contributors page
              const userRe = /github\.com\/([A-Za-z0-9._-]+)/g;
              const seen = new Set<string>();
              let m: RegExpExecArray | null;
              while ((m = userRe.exec(scrapeHtml)) !== null) {
                const login = m[1];
                if (login !== repo.org && !seen.has(login)) {
                  seen.add(login);
                  contributors.push({ login, html_url: `https://github.com/${login}`, contributions: 1 });
                }
              }
              rateLimited = false; // page scrape doesn't consume API budget
            } catch (e2: any) {
              input.onProgress?.('people', `  [github] scrape fallback failed: ${e2?.message || String(e2)}`);
              break;
            }
          } else if (!res.ok) {
            input.onProgress?.('people', `  [github] API ${res.status} for ${repo.org}/${repo.repo} — skipping.`);
            continue;
          } else {
            contributors = await res.json() as GitHubContributor[];
          }

          // For each contributor, fetch their profile to verify company affiliation.
          const existingLogins = new Set(candidates.map(c => c.candidate.name.toLowerCase()));
          for (const c of contributors) {
            if (existingLogins.has(c.login.toLowerCase())) continue; // dedupe across repos
            const profileUrl = c.html_url || `https://github.com/${c.login}`;
            let role = 'Open-source contributor';
            let confidence: 'HIGH' | 'MEDIUM' = 'MEDIUM';
            let extraEvidence = '';

            // Verify company affiliation via the contributor's public profile page
            try {
              const profileRes = await input.fetcher(profileUrl, {
                method: 'GET',
                headers: { 'user-agent': 'vardhan-discovery', accept: 'text/html' },
                signal: AbortSignal.timeout(8000),
              });
              const profileHtml = await profileRes.text().catch(() => '');
              const companyDomain = profileHtml.toLowerCase();
              // Check if the profile mentions the company domain or company name
              const companyLower = input.company.toLowerCase();
              const domainLower = input.domain.toLowerCase();
              if (companyDomain.includes(domainLower) || companyDomain.includes(companyLower) ||
                  companyLower.includes(companyLower)) {
                // The contributor's profile mentions the company — upgrade confidence
                confidence = 'HIGH';
                role = 'Core engineer (company verified on GitHub profile)';
                extraEvidence = `Profile at ${profileUrl} references ${input.company}.`;
              }
            } catch (e: any) {
              // Profile fetch failed — keep MEDIUM confidence
            }

            candidates.push({
              candidate: {
                name: c.login,
                role,
                company: input.company,
                source_urls: [profileUrl],
                evidence: [`GitHub contributor: ${c.login} appears in contributors of ${repo.org}/${repo.repo} (${c.contributions} contributions)` + (extraEvidence ? `. ${extraEvidence}` : '')],
                relationship_to_area: 'Contributed to core engineering repositories.',
                confidence,
                explicit_evidence: true,
              },
              source: { provenance: 'PUBLIC_PROFESSIONAL_SOURCE', provider_key: 'github', source_url: profileUrl, identity_confidence: 'HIGH' },
            });
            existingLogins.add(c.login.toLowerCase());
          }
          input.onProgress?.('people', `  [github] ${repo.org}/${repo.repo}: ${contributors.length} contributor(s) extracted.`);
        } catch (e: any) {
          input.onProgress?.('people', `  [github] error for ${repo.org}/${repo.repo}: ${e?.message || String(e)}`);
        }
      }
    }

    // ── 4. ENTITY RESOLUTION ──
    // Merge candidates from multiple sources. NEVER merge by name similarity alone —
    // require: canonical name match AND (shared source URL OR shared role).
    const resolved = this.resolveEntities(candidates, company);

    const allCandidates: OwnerCandidate[] = [];
    for (const person of resolved) {
      // Use the highest-confidence candidate view as the representative
      const best = person.candidates.reduce((best, c) => {
        const rank = { LOW: 0, MEDIUM: 1, HIGH: 2, NOT_APPLICABLE: 0 };
        return rank[c.confidence] > rank[best.confidence] ? c : best;
      }, person.candidates[0]);
      // Merge all candidate evidence into the representative
      for (const c of person.candidates) {
        best.evidence = Array.from(new Set([...best.evidence, ...c.evidence]));
        best.source_urls = Array.from(new Set([...best.source_urls, ...c.source_urls]));
      }
      allCandidates.push(best);
    }

    input.onProgress?.('people', `People discovery complete: ${resolved.length} unique person(s), ${resolved.filter(p => p.identity_confidence === 'HIGH').length} HIGH-identity.`);

    return allCandidates;
  }

  /**
   * Entity resolution: deduplicate candidates referring to the same real person.
   * Merging requires: matching canonical name AND (shared source URL OR shared role).
   * Never merges purely on name similarity.
   */
  private static resolveEntities(
    entries: { candidate: OwnerCandidate; source: IdentitySource }[],
    company: string
  ): DiscoveredPerson[] {
    const persons = new Map<string, DiscoveredPerson>();

  for (const { candidate, source } of entries) {
      const key = this.canonicalName(candidate.name);
      const existing = persons.get(key);

      if (existing) {
        // Merge only if there is corroborating evidence: shared source URL or
        // matching role. Prevents false-positive name collisions (e.g. two
        // "John Smith" at different companies).
        const shareUrl = existing.source_urls.some(u => candidate.source_urls.includes(u));
        const sameRole = existing.role.toLowerCase() === candidate.role.toLowerCase();
        if (shareUrl || sameRole) {
          existing.aliases = Array.from(new Set([...existing.aliases, ...this.aliasesFor(key)]));
          existing.identity_sources.push(source);
          existing.evidence = Array.from(new Set([...existing.evidence, ...candidate.evidence]));
          existing.source_urls = Array.from(new Set([...existing.source_urls, ...candidate.source_urls]));
          existing.explicit_evidence = existing.explicit_evidence || candidate.explicit_evidence;
          // Upgrade confidence to the higher of the two
          const rank = { LOW: 0, MEDIUM: 1, HIGH: 2, NOT_APPLICABLE: 0 };
          if (rank[candidate.confidence] > rank[existing.identity_confidence]) {
            existing.identity_confidence = candidate.confidence;
          }
          existing.candidates.push(candidate);
        } else {
          // Same canonical name but different company/role/source — treat as
          // a separate person (name collision). Use a disambiguated key.
          const disambiguatedKey = `${key}|${candidate.company.toLowerCase()}`;
          this.upsertPerson(persons, disambiguatedKey, candidate, source);
        }
      } else {
        this.upsertPerson(persons, key, candidate, source);
      }
    }

    return Array.from(persons.values());
  }

  private static upsertPerson(
    persons: Map<string, DiscoveredPerson>,
    key: string,
    candidate: OwnerCandidate,
    source: IdentitySource
  ): void {
    const aliases = this.aliasesFor(key);
    persons.set(key, {
      person_id: `person_${key.replace(/\s+/g, '_')}_${Date.now()}`.slice(0, 64),
      canonical_name: candidate.name,
      aliases,
      role: candidate.role,
      company: candidate.company,
      company_id: null,
      identity_sources: [source],
      relationship_to_area: candidate.relationship_to_area,
      identity_confidence: candidate.confidence,
      ownership_confidence: null,
      source_urls: [...candidate.source_urls],
      evidence: [...candidate.evidence],
      explicit_evidence: candidate.explicit_evidence,
      candidates: [candidate],
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────

  private static canonicalName(name: string): string {
    return (name || '').toLowerCase().replace(/\s+/g, '').replace(/^['"]+|['"]+$/g, '');
  }

  private static aliasesFor(canonical: string): string[] {
    return [canonical];
  }

  private static isTechnicalRole(title: string | null | undefined): boolean {
    if (!title) return false;
    const t = title.toLowerCase();
    const keywords = [
      'cto', 'chief technology officer', 'head of engineering', 'head of platform',
      'head of infrastructure', 'head of security', 'vp engineering', 'vp of engineering',
      'director of engineering', 'director of platform', 'director of infrastructure',
      'platform engineering', 'infrastructure', 'sre', 'security engineer',
      'engineering manager', 'staff engineer', 'principal engineer',
      'technical founder', 'co-founder', 'lead engineer', 'founding engineer',
    ];
    return keywords.some(k => t.includes(k));
  }

  private static domainMatch(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return false;
    const norm = (d: string) => d.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').replace(/:\d+$/, '').toLowerCase();
    return norm(a) === norm(b);
  }

  private static companyIdentityMatch(a: string | null | undefined, b: string): boolean {
    if (!a || !b) return false;
    const norm = (s: string) => s.toLowerCase().replace(/\s*(inc|llc|ltd|co\.?)\s*$/i, '').replace(/\s+/g, ' ').trim();
    const na = norm(a);
    const nb = norm(b);
    return na.includes(nb) || nb.includes(na);
  }
}

interface GitHubContributor {
  login: string;
  html_url?: string;
  contributions?: number;
  avatar_url?: string;
}
