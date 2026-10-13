/**
 * VARDHAN — QUERY GENERATOR (§4)
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates targeted public research queries from company identity.
 * Queries remain focused and bounded — never broad spam.
 */

export interface QueryContext {
  company: string;
  domain: string;
  /** Known person name (if any). */
  personName?: string;
  /** Known technical topic/signal (if any). */
  technicalTopic?: string;
  /** Known technical area (e.g. "platform engineering"). */
  technicalArea?: string;
}

export interface ResearchQuery {
  query: string;
  category: 'technical' | 'people' | 'activity' | 'contact' | 'general';
  intent: string;
}

export class QueryGenerator {
  /**
   * Generate targeted public research queries from company identity.
   * Uses the company name for better search recall (search engines index
   * company names more reliably than bare domains).
   */
  static generate(ctx: QueryContext): ResearchQuery[] {
    const co = ctx.company || ctx.domain;
    const queries: ResearchQuery[] = [];

    // Technical research queries
    const techQueries = [
      { q: `"${co}" engineering`, intent: 'engineering organization/discovery' },
      { q: `"${co}" architecture`, intent: 'architectural overview' },
      { q: `"${co}" API`, intent: 'API surface and documentation' },
      { q: `"${co}" developers`, intent: 'developer platform' },
      { q: `"${co}" GitHub`, intent: 'GitHub identity and repositories' },
      { q: `"${co}" security`, intent: 'security/trust posture' },
      { q: `"${co}" status incident`, intent: 'status page and incident history' },
      { q: `"${co}" engineering blog`, intent: 'engineering blog content' },
      { q: `"${co}" migration`, intent: 'technical migration activity' },
      { q: `"${co}" infrastructure`, intent: 'infrastructure/platform' },
      { q: `"${co}" platform`, intent: 'platform engineering' },
      { q: `"${co}" SRE`, intent: 'site reliability engineering' },
      { q: `"${co}" security engineering`, intent: 'security engineering team' },
      { q: `"${co}" changelog`, intent: 'release changelog' },
      { q: `"${co}" release`, intent: 'release announcements' },
      { q: `"${co}" hiring engineering`, intent: 'technical hiring signals' },
    ];

    for (const { q, intent } of techQueries) {
      queries.push({ query: q, category: 'technical', intent });
    }

    // For a known technical signal: search specifically for that signal
    if (ctx.technicalTopic) {
      queries.push({
        query: `"${co}" "${ctx.technicalTopic}"`,
        category: 'technical',
        intent: `refine known technical signal: ${ctx.technicalTopic}`,
      });
    }

    // For a known person: verify their role/company association
    if (ctx.personName) {
      queries.push(
        { query: `"${ctx.personName}" "${co}"`, category: 'people', intent: 'verify person-company association' },
        { query: `"${ctx.personName}" engineering`, category: 'people', intent: 'verify person technical role' },
      );
      if (ctx.technicalArea) {
        queries.push({
          query: `"${ctx.personName}" "${ctx.technicalArea}"`,
          category: 'people',
          intent: 'verify person technical area',
        });
      }
    }

    // People discovery queries (when no known person)
    if (!ctx.personName) {
      queries.push({
        query: `"${co}" "engineering" "head of" OR "CTO" OR "VP"`,
        category: 'people',
        intent: 'discover engineering leadership',
      });
    }

    // Activity queries
    queries.push(
      { query: `site:${ctx.domain} /blog /changelog /releases`, category: 'activity', intent: 'recent engineering activity' },
      { query: `"${co}" funding series OR acquisition`, category: 'activity', intent: 'company growth events' },
    );

    return queries;
  }

  /**
   * Generate a minimal set of queries for a quick freshness check.
   * Used when the dataset is mostly sufficient but may be stale.
   */
  static generateFreshnessQueries(ctx: QueryContext): ResearchQuery[] {
    const co = ctx.company || ctx.domain;
    return [
      { query: `"${co}" release latest`, category: 'activity', intent: 'latest releases' },
      { query: `"${co}" news latest`, category: 'activity', intent: 'latest news' },
      { query: `"${co}" GitHub activity`, category: 'activity', intent: 'GitHub activity check' },
      { query: `"${co}" security incident breach`, category: 'technical', intent: 'security incidents' },
    ];
  }
}
