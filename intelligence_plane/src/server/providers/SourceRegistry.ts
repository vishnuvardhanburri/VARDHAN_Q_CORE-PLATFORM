/**
 * VARDHAN — SOURCE REGISTRY
 * ─────────────────────────────────────────────────────────────────────────────
 * Every public source the crawler may visit gets registered here with:
 *   domain, category, priority, authority metadata, allowed/blocked,
 *   last_checked, notes.
 *
 * The crawler MUST check the registry before visiting any URL.
 * Sources are prioritized based on technical relevance, company relationship,
 * source quality, freshness, and likelihood of useful evidence.
 *
 * Unknown-source policy (spec §10):
 *   UNKNOWN SOURCE → DISCOVERED → CLASSIFY → POLICY CHECK → TRUST LEVEL → ALLOW/BLOCK
 *
 * Unknown sources may be discovered (classification attempted), but they are
 * NOT automatically trusted as evidence. A source must reach TRUSTED status
 * — via explicit allow or classification + policy — before it contributes
 * evidence. DISCOVERED_EXTERNAL_SOURCE ≠ TRUSTED_TECHNICAL_EVIDENCE.
 */
import type { SourceEntry, SourceCategory } from './Model';

interface AuthorityMetadata {
  /** Trust score 0-100 (editorial sources = 90+, user-content = 30). */
  trust_score?: number;
  /** Whether the source exposes structured data (JSON-LD, OGP). */
  structured_data?: boolean;
  /** Whether the source is rate-limited / anti-bot protected. */
  rate_limited?: boolean;
  /** Content language hint. */
  language?: string;
}

/**
 * Trust level for a discovered source. Sources progress through these stages
 * before being allowed to contribute evidence.
 */
export type SourceTrustLevel =
  | 'DISCOVERED'          // seen for the first time, not yet classified
  | 'CLASSIFIED'          // category identified, policy check pending
  | 'POLICY_CHECK'        // policy rules evaluated
  | 'TRUSTED'             // allowed to contribute evidence
  | 'BLOCKED';            // explicitly blocked by policy

/**
 * Result of checking a source URL against the registry's classification +
 * policy pipeline. Distinguishes "discovered but untrusted" from "trusted".
 */
export interface SourceClassification {
  /** The URL that was checked. */
  url: string;
  /** Resolved domain. */
  domain: string;
  /** Classified category (or 'OTHER' if unknown). */
  category: SourceCategory;
  /** Trust level after policy evaluation. */
  trust_level: SourceTrustLevel;
  /** Human-readable reason for the trust decision. */
  reason: string;
  /** Whether the source is allowed to contribute evidence (TRUSTED only). */
  is_trusted: boolean;
  /** Whether the source was previously registered (explicitly known). */
  was_known: boolean;
}

export class SourceRegistry {
  private sources: Map<string, SourceEntry> = new Map();

  /** Register a source. Overwrites if the domain already exists. */
  register(source: SourceEntry): void {
    const key = this.canonicalDomain(source.domain);
    this.sources.set(key, { ...source });
  }

  /** Bulk-register from a list. */
  registerAll(sources: SourceEntry[]): void {
    for (const s of sources) this.register(s);
  }

  /** Check if a URL is allowed to be crawled AND trusted for evidence. */
  isAllowed(url: string): boolean {
    const classification = this.classify(url);
    return classification.is_trusted;
  }

  /**
   * Classify and trust-evaluate a source URL.
   * Implements the DISCOVERED → CLASSIFY → POLICY_CHECK → TRUST LEVEL flow.
   * Unknown sources are classified (not outright denied), but must pass
   * the policy check to become TRUSTED.
   */
  classify(url: string): SourceClassification {
    let domain: string;
    try {
      domain = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return {
        url, domain: '', category: 'OTHER', trust_level: 'BLOCKED',
        reason: 'Malformed URL — cannot classify.', is_trusted: false, was_known: false,
      };
    }

    const canonicalDomain = this.canonicalDomain(domain);
    const existing = this.sources.get(canonicalDomain);

    // ── Stage 1: DISCOVERED / KNOWN ──
    if (!existing) {
      // Unknown source — classify by domain pattern + path heuristics.
      const category = this.classifyDomain(domain);
      // Policy: unknown sources are classified but start as CLASSIFIED (not trusted).
      // They must pass the policy check to contribute evidence.
      const policyResult = this.applyPolicy(domain, url, category, false);
      return {
        url, domain, category,
        trust_level: policyResult.trust_level,
        reason: policyResult.reason,
        is_trusted: policyResult.trust_level === 'TRUSTED',
        was_known: false,
      };
    }

    // ── Known source: DISCOVERED → policy check ──
    if (existing.blocked) {
      return {
        url, domain, category: existing.category, trust_level: 'BLOCKED',
        reason: `Explicitly blocked in registry (${existing.notes || 'n/a'}).`,
        is_trusted: false, was_known: true,
      };
    }

    // Apply policy rules to known sources
    const policyResult = this.applyPolicy(domain, url, existing.category, true, existing);
    return {
      url, domain, category: existing.category,
      trust_level: policyResult.trust_level,
      reason: policyResult.reason,
      is_trusted: policyResult.trust_level === 'TRUSTED',
      was_known: true,
    };
  }

  /**
   * Classify a domain into a SourceCategory using heuristics.
   */
  private classifyDomain(domain: string): SourceCategory {
    const d = domain.toLowerCase();
    if (d.includes('github.com') || d.includes('raw.githubusercontent.com') || d.includes('api.github.com')) return 'GITHUB';
    if (d.includes('linkedin.com')) return 'PROFESSIONAL';
    if (d.includes('vercel.app') || d.includes('vercel.com') || d.includes('netlify.app')) return 'PROFESSIONAL';
    // Company's own infrastructure domains are COMPANY
    // Others default to OTHER — they remain untrusted until explicitly registered
    return 'OTHER';
  }

  /**
   * Policy check: evaluate whether a source should be trusted based on its
   * category, known status, and authority metadata.
   * Key rule (spec §10): DISCOVERED_EXTERNAL_SOURCE ≠ TRUSTED_TECHNICAL_EVIDENCE.
   * Unknown sources (wasKnown=false) in category 'OTHER' are NOT trusted.
   */
  private applyPolicy(
    domain: string,
    url: string,
    category: SourceCategory,
    wasKnown: boolean,
    entry?: SourceEntry,
  ): { trust_level: SourceTrustLevel; reason: string } {
    // Explicitly blocked entries
    if (entry && entry.blocked) {
      return { trust_level: 'BLOCKED', reason: 'Explicitly blocked in registry.' };
    }

    // Explicitly denied known entries
    if (entry && !entry.allowed) {
      return { trust_level: 'BLOCKED', reason: `Allowed=${entry.allowed} (explicitly denied).` };
    }

    // Unknown sources (not in registry) — classify as CLASSIFIED but not trusted
    // unless they fall into a category that is implicitly trustworthy.
    if (!wasKnown) {
      const trustScore = this.implicitTrustScore(domain, url, category);
      if (trustScore >= 85) {
        return { trust_level: 'TRUSTED', reason: `Unknown source ${domain} classified as ${category} with high implicit trust (score ${trustScore}).` };
      }
      return {
        trust_level: 'POLICY_CHECK',
        reason: `Unknown source ${domain}: classified as ${category} but implicit trust score ${trustScore} < 85. Not trusted as evidence.`
      };
    }

    // Known + allowed sources are trusted if they have sufficient authority
    const trustScore = (entry?.authority_metadata as any)?.trust_score ?? 0;
    if (trustScore >= 50) {
      return { trust_level: 'TRUSTED', reason: `Known source ${domain} trusted (score ${trustScore}).` };
    }
    return {
      trust_level: 'POLICY_CHECK',
      reason: `Known source ${domain}: authority trust score ${trustScore} below threshold (50).`
    };
  }

  /**
   * Compute an implicit trust score for an unknown source based on domain
   * patterns and the URL path. High scores for well-known platform domains.
   */
  private implicitTrustScore(domain: string, url: string, category: SourceCategory): number {
    const d = domain.toLowerCase();
    // Well-known technical platforms
    const platforms = ['github.com', 'raw.githubusercontent.com', 'api.github.com',
      'linkedin.com', 'vercel.com', 'vercel.app', 'netlify.app'];
    if (platforms.some(p => d.includes(p))) return 90;
    // Subdomains of the target company (e.g. engineering.company.com)
    if (d.includes('engineering') || d.includes('tech') || d.includes('blog')) return 70;
    return 0;
  }

  /** Look up a source entry by domain. */
  get(domain: string): SourceEntry | undefined {
    return this.sources.get(this.canonicalDomain(domain));
  }

  /** Get sources prioritized by technical relevance for a given company. */
  getPrioritizedForCompany(companyDomain: string | null): SourceEntry[] {
    const all = Array.from(this.sources.values());
    // Always prioritize the company's own domain + its subdomains
    return all.sort((a, b) => {
      const aIsCompany = a.domain === companyDomain;
      const bIsCompany = b.domain === companyDomain;
      if (aIsCompany && !bIsCompany) return -1;
      if (!aIsCompany && bIsCompany) return 1;
      return b.priority - a.priority;
    });
  }

  /** Record the last-checked timestamp for a domain. */
  markChecked(domain: string, when: string = new Date().toISOString()): void {
    const key = this.canonicalDomain(domain);
    const entry = this.sources.get(key);
    if (entry) entry.last_checked = when;
  }

  /** Get all sources in a category. */
  getByCategory(category: SourceCategory): SourceEntry[] {
    return Array.from(this.sources.values()).filter(s => s.category === category);
  }

  private canonicalDomain(domain: string): string {
    return domain.toLowerCase().replace(/^www\./, '').replace(/\/.*$/, '');
  }

  /** Build a default registry with well-known technical sources. */
  static createDefault(): SourceRegistry {
    const reg = new SourceRegistry();
    reg.registerAll([
      { domain: 'github.com', category: 'GITHUB', priority: 100, authority_metadata: { trust_score: 95, structured_data: true }, allowed: true, blocked: false, last_checked: null, notes: 'Official GitHub — public repos and engineering orgs.' },
      { domain: 'raw.githubusercontent.com', category: 'GITHUB', priority: 80, authority_metadata: { trust_score: 95, structured_data: true }, allowed: true, blocked: false, last_checked: null, notes: 'Raw GitHub file hosting.' },
      { domain: 'api.github.com', category: 'GITHUB', priority: 95, authority_metadata: { trust_score: 95, rate_limited: true }, allowed: true, blocked: false, last_checked: null, notes: 'GitHub REST API — public metadata only.' },
      { domain: 'vercel.com', category: 'PROFESSIONAL', priority: 50, authority_metadata: { trust_score: 75 }, allowed: true, blocked: false, last_checked: null, notes: 'Company websites / Vercel deployments.' },
      { domain: 'netlify.app', category: 'PROFESSIONAL', priority: 45, authority_metadata: { trust_score: 65 }, allowed: true, blocked: false, last_checked: null, notes: 'Static site deployments.' },
      { domain: 'linkedin.com', category: 'PROFESSIONAL', priority: 40, authority_metadata: { trust_score: 80, rate_limited: true }, allowed: true, blocked: false, last_checked: null, notes: 'Professional profiles — public pages only.' },
    ]);
    return reg;
  }
}
