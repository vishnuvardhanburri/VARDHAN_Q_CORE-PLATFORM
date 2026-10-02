/**
 * VARDHAN PUBLIC SOURCE GRAPH
 * ─────────────────────────────────────────────────────────────────────────────
 * A cohesive, READ-ONLY model of a company's publicly observable professional
 * surface. It aggregates three things into a single, classifiable graph:
 *
 *   1. discovered_pages   — the bounded, same-origin pages surfaced by
 *                           PublicLinkDiscovery (CompanySurface.discovered_pages)
 *   2. classifications   — per-path professional category, derived from the
 *                           SHARED PROFESSIONAL_PATHS taxonomy (single source of
 *                           truth — see `classify`)
 *   3. sameAs links       — the cross-origin profile / social links the company
 *                           itself declares in JSON-LD on its own pages
 *
 * The graph never fabricates pages or identities: a page is only a member when
 * PublicLinkDiscovery observed it as a public (HTTP 2xx) same-origin page, and a
 * sameAs link is only a member when a real `<script type="application/ld+json">`
 * block on the company's site declared it.
 *
 * It exposes one `classify(path|url)` entry point so the categorisation
 * semantics are owned in exactly one place (delegating to the taxonomy shared
 * with PublicLinkDiscovery), plus bounded, regex-based extractors for the two
 * public structured-data sources a company page commonly exposes: JSON-LD
 * `sameAs` blocks and `<loc>` entries in `sitemap.xml`.
 */

import type {
  CompanySurface, DiscoveredPage, ProfessionalPageCategory,
} from './IntelligenceCase';
import { categorizeProfessionalPath } from './PublicLinkDiscovery';

/**
 * A public cross-origin identity link that the company declares on its own
 * pages (currently only JSON-LD `sameAs` — e.g. LinkedIn / GitHub / Twitter).
 */
export interface SameAsLink {
  /** The public profile / org URL the company points to. */
  url: string;
  /** The company page on which the link was observed. */
  source_page_url: string;
  /** How the link was observed. */
  observed_via: 'json-ld';
}

/** Serialised form suitable for logging / artifact persistence. */
export interface PublicSourceGraphJSON {
  company: string;
  origin: string;
  homepage: string;
  discovered_pages: DiscoveredPage[];
  classifications: Record<string, string>;
  page_categories: Record<string, string[]>;
  sameAs: SameAsLink[];
}

const DEFAULT_MAX_SAME_AS = 50;
const DEFAULT_MAX_SITEMAP_LOCS = 200;

/** Matches a `<script type="application/ld+json">…</script>` block (bounded). */
const JSON_LD_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
/** Matches `<loc>https://...</loc>` entries in a sitemap (bounded, regex). */
const SITEMAP_LOC_RE = /<loc>\s*(https?:\/\/[^<]+)\s*<\/loc>/gi;

/**
 * The cohesive public source graph. Instances are effectively immutable:
 * `withSameAs` returns a new graph rather than mutating.
 */
export class PublicSourceGraph {
  readonly company: string;
  readonly origin: string;
  readonly homepage: string;
  readonly discovered_pages: DiscoveredPage[];
  /** path -> professional category (single classification per discovered page). */
  readonly classifications: Record<string, ProfessionalPageCategory>;
  /** category -> list of discovered page URLs (mirrors CompanySurface shape). */
  readonly page_categories: Record<string, string[]>;
  readonly sameAs: SameAsLink[];

  constructor(opts: {
    company: string;
    origin: string;
    homepage: string;
    discovered_pages?: DiscoveredPage[];
    sameAs?: SameAsLink[];
  }) {
    this.company = opts.company ?? '';
    this.origin = opts.origin ?? '';
    this.homepage = opts.homepage ?? '';
    this.discovered_pages = opts.discovered_pages ? [...opts.discovered_pages] : [];
    this.sameAs = opts.sameAs ? [...opts.sameAs] : [];
    this.classifications = {};
    this.page_categories = {};
    for (const page of this.discovered_pages) {
      const key = page.path || page.url;
      // Trust an explicit category assigned by PublicLinkDiscovery; otherwise
      // derive it from the shared taxonomy so the graph stays self-consistent.
      const category = page.category ?? this.classify(key);
      this.classifications[key] = category;
      (this.page_categories[category] ||= []).push(page.url);
    }
  }

  /**
   * Classify a professional page PATH or full URL into a category, same-origin
   * aware.
   *
   * - A full URL is only assigned a professional category when it shares THIS
   *   graph's origin (the company's own domain). A cross-origin URL — e.g. a
   *   competitor's `/team`, or an external social link — is NEVER fabricated as
   *   a company professional page; it returns `'other'`.
   * - A bare path (e.g. `"/team"`) is assumed to be the company's own and is
   *   classified by the shared PROFESSIONAL_PATHS taxonomy.
   */
  classify(pathOrUrl: string): ProfessionalPageCategory {
    let pathname: string;
    try {
      const u = new URL(pathOrUrl);
      if (u.origin !== this.origin) return 'other';
      pathname = u.pathname;
    } catch {
      // Bare path ("/team") — no origin to compare against; classify by taxonomy.
      pathname = pathOrUrl;
    }
    return categorizeProfessionalPath(pathname);
  }

  /** True when `url` shares this graph's origin (i.e. the company's own domain). */
  isSameOrigin(url: string): boolean {
    try {
      return new URL(url).origin === this.origin;
    } catch {
      return false;
    }
  }

  /** Build a graph from an existing CompanySurface (discovered pages + categories). */
  static fromSurface(
    surface: CompanySurface,
    opts: { sameAs?: SameAsLink[] } = {}
  ): PublicSourceGraph {
    return new PublicSourceGraph({
      company: surface.company,
      origin: surface.origin,
      homepage: surface.homepage || surface.company_homepage || "",
      discovered_pages: surface.discovered_pages,
      sameAs: opts.sameAs,
    });
  }

  /**
   * Return a NEW graph with additional `sameAs` links merged in (deduplicated by
   * url, preserving provenance order).
   */
  withSameAs(links: SameAsLink[]): PublicSourceGraph {
    const merged = new Map<string, SameAsLink>();
    for (const l of this.sameAs) merged.set(canonicalSameAsKey(l), l);
    for (const l of links) merged.set(canonicalSameAsKey(l), l);
    return new PublicSourceGraph({
      company: this.company, origin: this.origin, homepage: this.homepage,
      discovered_pages: this.discovered_pages, sameAs: Array.from(merged.values()),
    });
  }

  /**
   * Extract JSON-LD `sameAs` links declared on a page (regex, bounded).
   *
   * Each `<script type="application/ld+json">…</script>` block is parsed; its
   * `sameAs` member (a string or array of strings) is collected. Malformed JSON
   * is skipped — never thrown. The `max` bound keeps extraction O(n) in the
   * number of declared links.
   */
  static extractJsonLdSameAs(
    html: string,
    sourcePageUrl: string,
    max: number = DEFAULT_MAX_SAME_AS
  ): SameAsLink[] {
    const out: SameAsLink[] = [];
    const re = new RegExp(JSON_LD_RE.source, JSON_LD_RE.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      let block: unknown;
      try {
        block = JSON.parse(m[1]);
      } catch {
        continue; // ignore malformed JSON-LD
      }
      const arr = Array.isArray(block) ? block : [block];
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        const sameAs: unknown = (item as { sameAs?: unknown }).sameAs;
        if (Array.isArray(sameAs)) {
          for (const link of sameAs) {
            if (out.length >= max) return out;
            if (typeof link === 'string' && link.trim()) {
              out.push({ url: link.trim(), source_page_url: sourcePageUrl, observed_via: 'json-ld' });
            }
          }
        } else if (typeof sameAs === 'string' && sameAs.trim()) {
          if (out.length < max) out.push({ url: sameAs.trim(), source_page_url: sourcePageUrl, observed_via: 'json-ld' });
        }
      }
    }
    return out;
  }

  /**
   * Extract same-origin `<loc>` URLs from a sitemap XML document (regex, bounded).
   *
   * Only URLs whose origin matches the company origin are returned — cross-origin
   * `<loc>` entries are skipped (we never adopt a third-party sitemap). The `max`
   * bound keeps extraction bounded; duplicates are removed while preserving order.
   */
  static extractSitemapLocs(
    xml: string,
    origin: string,
    max: number = DEFAULT_MAX_SITEMAP_LOCS,
    logger?: (message: string) => void
  ): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const re = new RegExp(SITEMAP_LOC_RE.source, SITEMAP_LOC_RE.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      if (out.length >= max) break;
      const loc = m[1].trim();
      if (loc.startsWith(origin)) {
        if (!seen.has(loc)) {
          seen.add(loc);
          out.push(loc);
        }
      } else {
        logger?.(`[sitemap] ${loc} -> not same-origin (skipping)`);
      }
    }
    return out;
  }

  /** Number of distinct professional categories represented on the surface. */
  categoryCount(): number {
    return Object.keys(this.page_categories).length;
  }

  toJSON(): PublicSourceGraphJSON {
    return {
      company: this.company,
      origin: this.origin,
      homepage: this.homepage,
      discovered_pages: this.discovered_pages,
      classifications: { ...this.classifications },
      page_categories: { ...this.page_categories },
      sameAs: [...this.sameAs],
    };
  }
}

// ── internal helpers ───────────────────────────────────────────────────────

function canonicalSameAsKey(link: SameAsLink): string {
  return `${link.observed_via}:${link.url}`;
}
