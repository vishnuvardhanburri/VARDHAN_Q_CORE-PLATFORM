/**
 * VARDHAN — COMPANY RESEARCH PIPELINE (STAGE 3)
 * ─────────────────────────────────────────────────────────────────────────────
 * Live company-intelligence pipeline: plan focused queries → keyless/serper
 * search → canonicalize + dedup → fetch-verify top sources → corroboration →
 * signals + contradictions. Read-only, no secrets, no auto-outreach.
 * NEVER throws: every failure is recorded in `limitations`.
 */

import { randomBytes } from 'crypto';
import type { HttpFetcher } from '../IntelligenceCase.ts';
import type { SearchProvider } from '../WebSearchProvider.ts';

export type VerifiedSourceType =
  | 'OFFICIAL_COMPANY'
  | 'REGULATORY'
  | 'OFFICIAL_TECH_DOC'
  | 'FILING'
  | 'CREDIBLE_REPORTING'
  | 'OTHER';

export type SourceConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface VerifiedSource {
  canonicalUrl: string;
  publisher: string;
  sourceType: VerifiedSourceType;
  title: string;
  excerpt: string;
  publishedDate?: string;
  eventDate?: string;
  retrievedAt: string;
  httpStatus: number;
  corroboratedBy: string[];
  confidence: SourceConfidence;
}

export interface CompanySignal {
  category: string;
  statement: string;
  sourceUrls: string[];
  eventDate?: string;
  verified: boolean;
}

export interface QueryExecution {
  query: string;
  results: number;
  cached: boolean;
}

export interface CompanyResearchStats {
  sourcesRetrieved: number;
  sourcesAttempted: number;
  duplicateRate: number;
  claimsWithEvidencePct: number;
}

export interface CompanyResearchResult {
  runId: string;
  company: string;
  domain: string;
  startedAt: string;
  finishedAt: string;
  queriesExecuted: QueryExecution[];
  sources: VerifiedSource[];
  signals: CompanySignal[];
  contradictions: string[];
  limitations: string[];
  stats: CompanyResearchStats;
}

export interface CompanyResearchOptions {
  maxSources?: number;
  verifyTop?: number;
}

interface RawHit {
  title: string;
  snippet: string;
  url: string;
}

const FETCH_USER_AGENT = 'VARDHAN-LIVE-OBSERVER/1.0';
const FETCH_TIMEOUT_MS = 8000;
const MAX_RESULTS_PER_QUERY = 8;
const EXCERPT_CHARS = 500;
const REGULATOR_HOSTS: string[] = ['fca.org.uk', 'federalreserve.gov', 'ecb.europa.eu', 'finma.ch'];
const LAUNCH_WORDS: string[] = ['launches', 'launching', 'introduces', 'unveils', 'rolls out', 'goes live'];
const EXIT_WORDS: string[] = [
  'discontinues',
  'discontinue',
  'discontinuing',
  'shuts down',
  'sunsets',
  'decommissions',
  'winds down',
  'phases out',
];
const STOPWORDS: Set<string> = new Set([
  'the', 'and', 'with', 'from', 'that', 'this', 'into', 'over', 'under', 'about',
  'after', 'before', 'between', 'their', 'there', 'what', 'when', 'where', 'which',
  'while', 'your', 'have', 'has', 'had', 'will', 'would', 'should', 'could',
  'more', 'most', 'than', 'then', 'also', 'such', 'only', 'other', 'some',
  'these', 'those', 'says', 'new',
]);

/** Lowercase host, strip tracking params, default ports, fragments, trailing slash. Never throws. */
export function canonicalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  try {
    const u = new URL(trimmed);
    u.hostname = u.hostname.toLowerCase();
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) {
      u.port = '';
    }
    const kept: Array<[string, string]> = [];
    u.searchParams.forEach((value: string, key: string) => {
      const lower = key.toLowerCase();
      if (lower === 'gclid' || lower === 'fbclid' || lower.startsWith('utm_')) return;
      kept.push([key, value]);
    });
    kept.sort((a: [string, string], b: [string, string]) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
    );
    u.search = kept.length > 0
      ? `?${kept.map(([k, v]: [string, string]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`
      : '';
    u.hash = '';
    if (u.pathname.length > 1) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    } else if (u.pathname === '/') {
      u.pathname = '';
    }
    const serialized = u.toString();
    // WHATWG URL always serializes a bare origin with "/"; strip it so
    // root URLs canonicalize to the bare origin (trailing-slash rule).
    if (u.search === '' && serialized.endsWith('/') && (u.pathname === '' || u.pathname === '/')) {
      return serialized.slice(0, -1);
    }
    return serialized;
  } catch {
    return trimmed;
  }
}

/** Eight focused queries spanning security, crypto-agility, regulatory, assurance, custody, resilience, partnerships, procurement. */
export function planQueries(company: string, domain: string): string[] {
  const c = `"${company}"`;
  return [
    `${c} ${domain} security strategy`,
    `${c} ${domain} post-quantum cryptography crypto-agility PQC`,
    `${c} ${domain} regulatory compliance programme`,
    `${c} ${domain} audit attestation assurance`,
    `${c} ${domain} custody digital assets`,
    `${c} ${domain} operational resilience vendor outage`,
    `${c} ${domain} technology partnership`,
    `${c} ${domain} procurement tender programme`,
  ];
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPublishedDate(html: string): string | undefined {
  const patterns: RegExp[] = [
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|publish_date|publication-date|date|DC\.date)["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*?(?:property|name)=["'](?:article:published_time|publish_date|date)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m: RegExpMatchArray | null = html.match(re);
    const raw: string | undefined = m?.[1]?.trim();
    if (raw !== undefined && raw.length > 0) {
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
    }
  }
  return undefined;
}

function classifySourceType(hostname: string, companyDomain: string): VerifiedSourceType {
  try {
    const host = hostname.toLowerCase();
    const companyHost = companyDomain.toLowerCase().replace(/^www\./, '');
    if (host === companyHost || host.endsWith(`.${companyHost}`)) return 'OFFICIAL_COMPANY';
    if (REGULATOR_HOSTS.some((r: string) => host === r || host.endsWith(`.${r}`))) return 'REGULATORY';
    return 'CREDIBLE_REPORTING';
  } catch {
    return 'OTHER';
  }
}

function publisherOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
}

function rootPathOf(canonicalUrl: string): string {
  try {
    const u = new URL(canonicalUrl);
    const segs: string[] = u.pathname.split('/').filter((s: string) => s.length > 0);
    return segs.length > 0 ? `${u.hostname}/${segs[0]}` : u.hostname;
  } catch {
    return canonicalUrl;
  }
}

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w: string) => w.length >= 4 && !STOPWORDS.has(w));
}

function sharedSignificantWords(a: string, b: string): string[] {
  const setA = new Set<string>(significantWords(a));
  return [...new Set<string>(significantWords(b))].filter((w: string) => setA.has(w));
}

function containsWord(haystack: string, word: string): boolean {
  return haystack.includes(word);
}

function mapSignalCategory(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('quantum') || t.includes('post-quantum') || t.includes('pqc') || t.includes('crypto-agil')) return 'CRYPTO_PQC';
  if (/\bcscf\b/.test(t) || /\bcsp\b/.test(t) || t.includes('customer security programme')) return 'SECURITY_PROGRAMME';
  if (t.includes('custody')) return 'CUSTODY';
  if (t.includes('audit') || t.includes('attestation')) return 'ASSURANCE';
  if (t.includes('resilien') || t.includes('outage')) return 'RESILIENCE';
  if (t.includes('procurement') || t.includes('tender')) return 'PROCUREMENT';
  return 'GENERAL_TECH';
}

export class CompanyResearchPipeline {
  private readonly searchProvider: SearchProvider;
  private readonly fetcher: HttpFetcher;

  constructor(searchProvider: SearchProvider, fetcher: HttpFetcher) {
    this.searchProvider = searchProvider;
    this.fetcher = fetcher;
  }

  async run(company: string, domain: string, opts: CompanyResearchOptions = {}): Promise<CompanyResearchResult> {
    const maxSources = opts.maxSources ?? 12;
    const verifyTop = opts.verifyTop ?? 6;
    const startedAt = new Date().toISOString();
    const runId = `run_${startedAt.slice(0, 10).replace(/-/g, '')}_${randomBytes(4).toString('hex')}`;
    const queriesExecuted: QueryExecution[] = [];
    const limitations: string[] = [];
    const contradictions: string[] = [];

    try {
      const queries: string[] = planQueries(company, domain);
      const rawHits: RawHit[] = [];
      for (const query of queries) {
        try {
          const resp = await this.searchProvider.search(query, { maxResults: MAX_RESULTS_PER_QUERY });
          const results = resp.results ?? [];
          queriesExecuted.push({ query, results: results.length, cached: false });
          for (const r of results) {
            if (r.url !== undefined && r.url.length > 0) {
              rawHits.push({ title: r.title ?? '', snippet: r.snippet ?? '', url: r.url });
            }
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unknown search error';
          queriesExecuted.push({ query, results: 0, cached: false });
          limitations.push(`Search failed for "${query}": ${message}`);
        }
      }

      const sourcesAttempted = rawHits.length;
      const byCanonical = new Map<string, RawHit>();
      for (const hit of rawHits) {
        const canonical = canonicalizeUrl(hit.url);
        if (!byCanonical.has(canonical)) byCanonical.set(canonical, hit);
      }
      const uniqueCount = byCanonical.size;
      const duplicateRate = sourcesAttempted > 0 ? (sourcesAttempted - uniqueCount) / sourcesAttempted : 0;

      if (sourcesAttempted === 0) {
        limitations.push(`No search results returned for ${company} (${domain}) across ${queries.length} queries — honest empty run.`);
      }

      const now = new Date().toISOString();
      const sources: VerifiedSource[] = [];
      const entries: Array<[string, RawHit]> = [...byCanonical.entries()].slice(0, maxSources);
      entries.forEach(([canonicalUrl, hit]: [string, RawHit], index: number) => {
        if (index < verifyTop) {
          sources.push(this.fetchVerifyPlaceholder(canonicalUrl, hit, domain, now));
        } else {
          sources.push({
            canonicalUrl,
            publisher: publisherOf(canonicalUrl),
            sourceType: classifySourceType(publisherOf(canonicalUrl), domain),
            title: hit.title,
            excerpt: hit.snippet,
            publishedDate: undefined,
            eventDate: undefined,
            retrievedAt: now,
            httpStatus: 0,
            corroboratedBy: [],
            confidence: 'LOW',
          });
          limitations.push(`Search-only source not fetch-verified (beyond verifyTop=${verifyTop}): ${canonicalUrl}`);
        }
      });

      // Fetch-verify top N sequentially (polite, deterministic order).
      for (let i = 0; i < Math.min(verifyTop, sources.length); i++) {
        await this.verifySource(sources[i], entries[i][1], limitations);
      }

      this.applyCorroboration(sources);
      for (const s of sources) {
        const verified = s.httpStatus === 200 && s.excerpt.length > 0;
        s.confidence = verified && s.corroboratedBy.length > 0 ? 'HIGH' : verified ? 'MEDIUM' : 'LOW';
        if (!verified) {
          limitations.push(`Unverified source (HTTP ${s.httpStatus}, excerpt ${s.excerpt.length} chars): ${s.canonicalUrl}`);
        }
      }

      const signals: CompanySignal[] = sources.map((s: VerifiedSource) => ({
        category: mapSignalCategory(`${s.title} ${s.excerpt}`),
        statement: s.title.length > 0 ? `${s.title} — ${s.excerpt.slice(0, 160)}` : s.excerpt.slice(0, 200),
        sourceUrls: [s.canonicalUrl],
        eventDate: s.eventDate,
        verified: s.httpStatus === 200 && s.excerpt.length > 0,
      }));

      this.detectContradictions(sources, contradictions);

      const verifiedCount = signals.filter((s: CompanySignal) => s.verified).length;
      const finishedAt = new Date().toISOString();
      return {
        runId,
        company,
        domain,
        startedAt,
        finishedAt,
        queriesExecuted,
        sources,
        signals,
        contradictions,
        limitations,
        stats: {
          sourcesRetrieved: sources.length,
          sourcesAttempted,
          duplicateRate,
          claimsWithEvidencePct: sources.length > 0 ? (verifiedCount / sources.length) * 100 : 0,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown pipeline error';
      limitations.push(`Pipeline failure recorded (no throw): ${message}`);
      return {
        runId,
        company,
        domain,
        startedAt,
        finishedAt: new Date().toISOString(),
        queriesExecuted,
        sources: [],
        signals: [],
        contradictions,
        limitations,
        stats: { sourcesRetrieved: 0, sourcesAttempted: 0, duplicateRate: 0, claimsWithEvidencePct: 0 },
      };
    }
  }

  private fetchVerifyPlaceholder(canonicalUrl: string, hit: RawHit, domain: string, now: string): VerifiedSource {
    const publisher = publisherOf(canonicalUrl);
    return {
      canonicalUrl,
      publisher,
      sourceType: classifySourceType(publisher, domain),
      title: hit.title,
      excerpt: hit.snippet,
      publishedDate: undefined,
      eventDate: undefined,
      retrievedAt: now,
      httpStatus: 0,
      corroboratedBy: [],
      confidence: 'LOW',
    };
  }

  private async verifySource(source: VerifiedSource, hit: RawHit, limitations: string[]): Promise<void> {
    try {
      const res = await this.fetcher(source.canonicalUrl, {
        method: 'GET',
        headers: { 'User-Agent': FETCH_USER_AGENT, Accept: 'text/html' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      source.httpStatus = res.status;
      source.retrievedAt = new Date().toISOString();
      if (res.status === 200) {
        const html: string = await res.text();
        const text = stripHtml(html);
        source.excerpt = text.slice(0, EXCERPT_CHARS);
        const published = extractPublishedDate(html);
        if (published !== undefined) source.publishedDate = published;
      } else {
        limitations.push(`Fetch returned HTTP ${res.status} for ${source.canonicalUrl} — keeping search snippet only.`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown fetch error';
      source.httpStatus = 0;
      source.retrievedAt = new Date().toISOString();
      source.excerpt = hit.snippet;
      limitations.push(`Fetch failed for ${source.canonicalUrl}: ${message}`);
    }
  }

  private applyCorroboration(sources: VerifiedSource[]): void {
    for (let i = 0; i < sources.length; i++) {
      for (let j = i + 1; j < sources.length; j++) {
        const a = sources[i];
        const b = sources[j];
        const sameRoot = rootPathOf(a.canonicalUrl) === rootPathOf(b.canonicalUrl);
        const shared = sharedSignificantWords(`${a.title} ${a.excerpt}`, `${b.title} ${b.excerpt}`);
        if (sameRoot || shared.length >= 4) {
          if (!a.corroboratedBy.includes(b.canonicalUrl)) a.corroboratedBy.push(b.canonicalUrl);
          if (!b.corroboratedBy.includes(a.canonicalUrl)) b.corroboratedBy.push(a.canonicalUrl);
        }
      }
    }
  }

  private detectContradictions(sources: VerifiedSource[], out: string[]): void {
    for (let i = 0; i < sources.length; i++) {
      for (let j = i + 1; j < sources.length; j++) {
        const a = sources[i];
        const b = sources[j];
        const textA = `${a.title} ${a.excerpt}`.toLowerCase();
        const textB = `${b.title} ${b.excerpt}`.toLowerCase();
        const shared = sharedSignificantWords(textA, textB);
        if (shared.length < 2) continue;
        const aLaunch = LAUNCH_WORDS.some((w: string) => containsWord(textA, w));
        const bLaunch = LAUNCH_WORDS.some((w: string) => containsWord(textB, w));
        const aExit = EXIT_WORDS.some((w: string) => containsWord(textA, w));
        const bExit = EXIT_WORDS.some((w: string) => containsWord(textB, w));
        if ((aLaunch && !aExit && bExit && !bLaunch) || (bLaunch && !bExit && aExit && !aLaunch)) {
          out.push(
            `Contradiction on "${shared.slice(0, 5).join(', ')}": ${a.canonicalUrl} reports launch signals while ${b.canonicalUrl} reports discontinuation.`,
          );
        }
      }
    }
  }
}
