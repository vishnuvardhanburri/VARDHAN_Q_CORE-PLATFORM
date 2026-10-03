import { DomainResolver, ResolveSeed } from '../src/server/DomainResolver';
import { PublicLinkDiscovery } from '../src/server/PublicLinkDiscovery';
import { PublicSourceGraph } from '../src/server/PublicSourceGraph';
import type { CompanyResolution } from '../src/server/DeepTypes';
import type { HttpFetcher, CompanySurface, DiscoveredPage, ProfessionalPageCategory } from '../src/server/IntelligenceCase';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
// tests/sourceGraph.test.ts
// ─────────────────────────────────────────────────────────────────────────────────
// Tests for Topology B — Company Identity + Public Source Graph.
//
// Coverage areas (per task spec):
//   1. Domain resolution paths            -> src/server/DomainResolver.ts
//   2. Same-origin classification         -> src/server/PublicLinkDiscovery.ts + PublicSourceGraph.ts
//   3. 404-skip behaviour                 -> src/server/PublicLinkDiscovery.ts
//   4. JSON-LD sameAs extraction          -> src/server/PublicSourceGraph.ts
//   5. sitemap <loc> extraction (regex, bounded) -> src/server/PublicSourceGraph.ts
//
// Run: npx tsx tests/sourceGraph.test.ts


let pass = 0, fail = 0; const failures: string[] = [];
const assert = (c: boolean, m: string) => { if (c) pass++; else { fail++; failures.push(m); console.log('[FAIL] ' + m); } };

async function run(name: string, fn: () => Promise<void>) {
  try { console.log('\n--- ' + name + ' ---'); await fn(); }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fail++; failures.push(name + ': ' + msg);
    console.log('[FAIL] ' + name + ': ' + msg);
  }
}

// ── mock fetcher helpers ─────────────────────────────────────────────────────

/** Response whose `.url` can be overridden (simulates a redirect target). */
function mkResponse(body: string, status = 200, url = ''): Response {
  const r = new Response(body, { status, headers: { 'content-type': 'text/html' } });
  if (url) Object.defineProperty(r, 'url', { value: url, configurable: true });
  return r;
}

/** Routes keyed by exact URL; supports a `url` override for the response (redirect). */
function domainFetcher(routes: Record<string, { body?: string; status?: number; url?: string }>): HttpFetcher {
  return async (url: string, _init?: any) => {
    const hit = routes[url];
    if (!hit) return mkResponse('', 404);
    return mkResponse(hit.body ?? '', hit.status ?? 200, hit.url ?? '');
  };
}

type Route = { status: number; body: string; ct?: string };
/** Routes keyed by trailing-slash-normalised URL (used for the crawler). */
function crawlFetcher(routes: Record<string, Route>): HttpFetcher {
  return async (url: string, _init?: any) => {
    const key = url.replace(/\/$/, '') || url;
    const hit = routes[key] || routes[url];
    if (hit) {
      return new Response(hit.body, {
        status: hit.status,
        headers: hit.ct ? { 'content-type': hit.ct } : {},
      });
    }
    return new Response('', { status: 404, headers: { 'content-type': 'text/html' } });
  };
}

// ── 1. Domain resolution paths (never guesses; AMBIGUOUS/LOW when ambiguous) ──

async function domainResolutionTests() {
  // (a) GROWJO_DOMAIN — domain supplied directly by the Growjo record.
  {
    const seed: ResolveSeed = { domain: '  WWW.Acme.com  ', website_url: null, company_name: 'Acme Corp' };
    const r: CompanyResolution = await DomainResolver.resolve(seed, domainFetcher({}));
    assert(r.resolution_method === 'GROWJO_DOMAIN', `GROWJO_DOMAIN method (got ${r.resolution_method})`);
    assert(r.official_domain === 'acme.com', 'GROWJO_DOMAIN official_domain canonicalised to acme.com');
    assert(r.resolution_confidence === 'HIGH', 'GROWJO_DOMAIN HIGH');
    assert(r.resolution_source === 'Growjo record for Acme Corp', 'GROWJO_DOMAIN source preserved');
  }

  // (b) PUBLIC_REDIRECT — website URL with NO canonical/og:url → redirect target.
  {
    const seed: ResolveSeed = { domain: null, website_url: 'https://acme.com', company_name: 'Acme' };
    const r = await DomainResolver.resolve(seed, domainFetcher({
      'https://acme.com': { body: '<html><head><title>Acme</title></head><body>hi</body></html>' },
    }));
    assert(r.resolution_method === 'PUBLIC_REDIRECT', `PUBLIC_REDIRECT method (got ${r.resolution_method})`);
    assert(r.official_domain === 'acme.com', 'PUBLIC_REDIRECT official_domain');
    assert(r.resolution_confidence === 'HIGH', 'PUBLIC_REDIRECT HIGH');
  }

  // (b') PUBLIC_REDIRECT — actual HTTP redirect followed by the fetcher.
  {
    const seed: ResolveSeed = { domain: null, website_url: 'https://acme.com', company_name: 'Acme' };
    const r = await DomainResolver.resolve(seed, domainFetcher({
      'https://acme.com': { body: '<html></html>', url: 'https://acme.com/' },
    }));
    assert(r.resolution_method === 'PUBLIC_REDIRECT', `redirect-followed -> PUBLIC_REDIRECT (got ${r.resolution_method})`);
    assert(r.official_domain === 'acme.com', 'redirect official_domain canonicalised');
    assert(r.resolution_source === 'https://acme.com/', 'redirect source = final url');
  }

  // (c) GROWJO_HOMEPAGE_CANONICAL — canonical <link> tag, consistent with redirect.
  {
    const seed: ResolveSeed = { domain: null, website_url: 'https://acme.com', company_name: 'Acme' };
    const r = await DomainResolver.resolve(seed, domainFetcher({
      'https://acme.com': {
        body: '<html><head><link rel="canonical" href="https://acme.com/"></head><body></body></html>',
      },
    }));
    assert(r.resolution_method === 'GROWJO_HOMEPAGE_CANONICAL', `canonical method (got ${r.resolution_method})`);
    assert(r.official_domain === 'acme.com', 'canonical official_domain');
    assert(r.resolution_confidence === 'HIGH', 'canonical HIGH');
    assert(r.resolution_source === 'https://acme.com/', 'canonical source = <link href>');
  }

  // (d) OGP_URL — og:url meta present, NO canonical tag, consistent with redirect.
  {
    const seed: ResolveSeed = { domain: null, website_url: 'https://acme.com', company_name: 'Acme' };
    const r = await DomainResolver.resolve(seed, domainFetcher({
      'https://acme.com': {
        body: '<html><head><meta property="og:url" content="https://acme.com/hq"></head><body></body></html>',
      },
    }));
    assert(r.resolution_method === 'OGP_URL', `OGP_URL method (got ${r.resolution_method})`);
    assert(r.official_domain === 'acme.com', 'OGP_URL official_domain');
    assert(r.resolution_source === 'https://acme.com/hq', 'OGP_URL source = og:url');
  }

  // (e) AMBIGUOUS (conflicting canonical vs redirect) — LOW, official_domain null.
  {
    const seed: ResolveSeed = { domain: null, website_url: 'https://acme.com', company_name: 'Acme' };
    const r = await DomainResolver.resolve(seed, domainFetcher({
      'https://acme.com': {
        body: '<html><head><link rel="canonical" href="https://acme.com/"></head></html>',
        url: 'https://acme.org/', // redirect destination disagrees with canonical
      },
    }));
    assert(r.resolution_method === 'AMBIGUOUS', `conflict -> AMBIGUOUS (got ${r.resolution_method})`);
    assert(r.resolution_confidence === 'LOW', 'conflict LOW');
    assert(r.official_domain === null, 'conflict official_domain null (never guesses)');
  }

  // (f) AMBIGUOUS (no domain/website at all) — never guesses.
  {
    const seed: ResolveSeed = { domain: null, website_url: null, company_name: 'Ghost Inc' };
    const r = await DomainResolver.resolve(seed, domainFetcher({}));
    assert(r.resolution_method === 'AMBIGUOUS', `no-data -> AMBIGUOUS (got ${r.resolution_method})`);
    assert(r.official_domain === null, 'no-data official_domain null');
    assert(r.resolution_confidence === 'LOW', 'no-data LOW');
  }

  // (g) Network failure — the fetcher rejects. This is NOT treated as ambiguous:
  //     the Growjo-supplied website URL itself is a legitimate public source
  //     (we never guess — we use the operator-supplied URL's domain). The
  //     resolver falls back to that URL and returns PUBLIC_REDIRECT rather than
  //     crashing or fabricating a name-based domain.
  {
    const seed: ResolveSeed = { domain: null, website_url: 'https://acme.com', company_name: 'Acme' };
    const throwingFetcher: HttpFetcher = async () => { throw new Error('network down'); };
    const r = await DomainResolver.resolve(seed, throwingFetcher);
    assert(r.resolution_method === 'PUBLIC_REDIRECT', `network-failure -> PUBLIC_REDIRECT fallback (got ${r.resolution_method})`);
    assert(r.official_domain === 'acme.com', 'network-failure falls back to website domain (not a guess, not null)');
    assert(r.resolution_confidence === 'HIGH', 'network-failure fallback HIGH');
  }
}

// ── 2 & 3. Same-origin classification + 404-skip behaviour (PublicLinkDiscovery) ─

async function discoveryTests() {
  const HOME = `<html><head><title>Acme</title></head><body>
  <a href="/team">Team</a>
  <a href="/developers">Developers</a>
  <a href="/about">About</a>
  <a href="https://evil.com/privacypolicy">Evil</a>
  <a href="https://linkedin.com/company/acme">LinkedIn</a>
  </body></html>`;
  const TEAM = `<html><body><h1>Team</h1></body></html>`;
  const DEV = `<html><body><h1>Dev</h1></body></html>`;
  const ABOUT = `<html><body><h1>About</h1></body></html>`;

  const routes: Record<string, Route> = {
    'https://acme.com': { status: 200, body: HOME },
    'https://acme.com/team': { status: 200, body: TEAM },
    'https://acme.com/developers': { status: 200, body: DEV },
    'https://acme.com/about': { status: 200, body: ABOUT },
  };

  const logs: string[] = [];
  const surface = await PublicLinkDiscovery.discover('https://acme.com/', {
    fetcher: crawlFetcher(routes),
    maxPages: 60,
    delayMs: 0,
    timeoutMs: 1000,
    logger: (m: string) => logs.push(m),
  });

  const urls = surface.discovered_pages.map(p => p.url);

  // (same-origin) — company professional pages recorded.
  assert(urls.includes('https://acme.com/'), 'homepage recorded');
  assert(urls.includes('https://acme.com/team'), '/team recorded (same-origin)');
  assert(urls.includes('https://acme.com/developers'), '/developers recorded (same-origin)');
  assert(urls.includes('https://acme.com/about'), '/about recorded (same-origin)');

  // (same-origin) — cross-origin links are NOT followed/re-recorded.
  assert(!urls.some(u => u.includes('evil.com')), 'cross-origin evil.com NOT recorded');
  assert(!urls.some(u => u.includes('linkedin.com')), 'cross-origin linkedin NOT recorded');

  // (404-skip) — a seeded 404 path is logged with the exact skip message...
  const skipped = logs.find(l =>
    l.includes('https://acme.com/careers') &&
    l.includes('404') &&
    l.includes('not a public page, skipping')
  );
  assert(!!skipped, `404 seeded path logged & skipped (logs captured: ${logs.length})`);
  // ...and is NOT recorded in discovered_pages.
  assert(!urls.some(u => u.includes('/careers')), '404 path not recorded in discovered_pages');
}

// ── PublicSourceGraph cohesion: fromSurface + classify + same-origin ───────

async function sourceGraphModelTests() {
  const pages: DiscoveredPage[] = [
    { url: 'https://acme.com/', path: '/', title: 'Acme', category: 'homepage' },
    { url: 'https://acme.com/team', path: '/team', category: 'team_people' },
    { url: 'https://acme.com/developers', path: '/developers', category: 'engineering' },
    { url: 'https://acme.com/blog', path: '/blog', category: 'blog' },
  ];
  const surface: CompanySurface = {
    company: 'acme',
    origin: 'https://acme.com',
    homepage: 'https://acme.com/',
    discovered_pages: pages,
    page_categories: {
      homepage: ['https://acme.com/'],
      team_people: ['https://acme.com/team'],
      engineering: ['https://acme.com/developers'],
      blog: ['https://acme.com/blog'],
    },
  };
  const sameAs = [{ url: 'https://github.com/acme', source_page_url: 'https://acme.com/', observed_via: 'json-ld' as const }];
  const graph = PublicSourceGraph.fromSurface(surface, { sameAs });

  // classify() is same-origin aware: same-origin path → professional category.
  assert(graph.classify('/team') === 'team_people', 'classify("/team") -> team_people');
  assert(graph.classify('/engineering') === 'engineering', 'classify("/engineering") -> engineering');
  assert(graph.classify('/blog') === 'blog', 'classify("/blog") -> blog');
  assert(graph.classify('/about') === 'about', 'classify("/about") -> about');
  assert(graph.classify('/careers') === 'hiring', 'classify("/careers") -> hiring');

  // Full same-origin URL is classified by its pathname.
  assert(graph.classify('https://acme.com/team') === 'team_people', 'same-origin URL classified by pathname');
  // Cross-origin URLs are NEVER fabricated as company professional pages.
  assert(graph.classify('https://evil.com/team') === 'other', 'cross-origin /team -> other (not fabricated)');
  assert(graph.classify('https://linkedin.com/in/acme') === 'other', 'cross-origin social -> other');
  assert(graph.classify('https://github.com/acme') === 'other', 'cross-origin github -> other');

  // isSameOrigin
  assert(graph.isSameOrigin('https://acme.com/team') === true, 'isSameOrigin true for company domain');
  assert(graph.isSameOrigin('https://evil.com/x') === false, 'isSameOrigin false for foreign host');
  assert(graph.isSameOrigin('not-a-url') === false, 'isSameOrigin false for invalid url');

  // classifications + page_categories aggregated from discovered_pages.
  assert(graph.classifications['/team'] === 'team_people', 'classifications[/team] = team_people');
  assert(graph.classifications['/developers'] === 'engineering', 'classifications[/developers] = engineering');
  assert(graph.categoryCount() === 4, `categoryCount = 4 (got ${graph.categoryCount()})`);

  // sameAs aggregated.
  assert(graph.sameAs.length === 1, 'sameAs aggregated (1 link)');
  assert(graph.sameAs[0].url === 'https://github.com/acme', 'sameAs link preserved');
  assert(graph.sameAs[0].observed_via === 'json-ld', 'sameAs provenance preserved');

  // withSameAs merges + dedupes.
  const grown = graph.withSameAs([
    { url: 'https://github.com/acme', source_page_url: 'https://acme.com/', observed_via: 'json-ld' }, // dup
    { url: 'https://twitter.com/acme', source_page_url: 'https://acme.com/', observed_via: 'json-ld' },
  ]);
  assert(grown.sameAs.length === 2, `withSameAs dedupes (got ${grown.sameAs.length})`);
  assert(grown.sameAs.some(l => l.url === 'https://twitter.com/acme'), 'new sameAs link added');

  // toJSON serialises the graph.
  const json = graph.toJSON();
  assert(json.classifications['/team'] === 'team_people', 'toJSON classifications');
  assert(Array.isArray(json.sameAs) && json.sameAs[0].url === 'https://github.com/acme', 'toJSON sameAs');
}

// ── 4. JSON-LD sameAs extraction (regex, bounded) ───────────────────────────

async function jsonLdTests() {
  const html = `<html><head>
  <script type="application/ld+json">{"sameAs":["https://github.com/acme","https://linkedin.com/company/acme"]}</script>
  <script type="application/ld+json">{"sameAs":"https://twitter.com/acme"}</script>
  <script type="application/ld+json">{not valid json}</script>
  <script type="application/ld+json">[{"sameAs":["https://instagram.com/acme"]},{"sameAs":"https://youtube.com/acme"}]</script>
  <script type="text/javascript">var same = ["https://evil.com"];</script>
  </head></html>`;

  const links = PublicSourceGraph.extractJsonLdSameAs(html, 'https://acme.com/', 50);
  const urls = links.map(l => l.url);

  assert(urls.includes('https://github.com/acme'), 'JSON-LD array sameAs extracted');
  assert(urls.includes('https://linkedin.com/company/acme'), 'JSON-LD array second entry extracted');
  assert(urls.includes('https://twitter.com/acme'), 'JSON-LD string sameAs extracted');
  assert(urls.includes('https://instagram.com/acme') && urls.includes('https://youtube.com/acme'), 'JSON-LD array-of-blocks flattened');
  assert(!urls.includes('https://evil.com'), 'non-JSON-LD script ignored (no fabrication)');
  assert(links.every(l => l.source_page_url === 'https://acme.com/'), 'sameAs carries source page');
  assert(links.every(l => l.observed_via === 'json-ld'), 'sameAs observed_via = json-ld');

  // Bounded by max.
  const bounded = PublicSourceGraph.extractJsonLdSameAs(html, 'https://acme.com/', 2);
  assert(bounded.length === 2, `bounded to max=2 (got ${bounded.length})`);
}

// ── 5. sitemap <loc> extraction (regex, bounded, same-origin) ──────────────

async function sitemapTests() {
  const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://acme.com/</loc></url>
  <url><loc>https://acme.com/team</loc></url>
  <url><loc>https://acme.com/blog/post-1</loc></url>
  <url><loc>https://acme.com/blog/post-2</loc></url>
  <url><loc>https://acme.com/blog/post-3</loc></url>
  <url><loc>   https://acme.com/team   </loc></url>
  <url><loc>https://example.com/steal</loc></url>
  <url><loc>https://rival.com/page</loc></url>
  </urlset>`;

  const locs = PublicSourceGraph.extractSitemapLocs(xml, 'https://acme.com', 200);

  // same-origin locs extracted (regex-bounded).
  assert(locs.includes('https://acme.com/'), 'sitemap home <loc> extracted');
  assert(locs.includes('https://acme.com/team'), 'sitemap /team <loc> extracted');
  assert(locs.includes('https://acme.com/blog/post-1'), 'sitemap blog <loc> extracted');
  // cross-origin <loc> entries skipped (same-origin only).
  assert(!locs.some(u => u.includes('example.com')), 'sitemap cross-origin example.com skipped');
  assert(!locs.some(u => u.includes('rival.com')), 'sitemap cross-origin rival.com skipped');
  // whitespace around <loc> content is trimmed; duplicates removed (order preserved).
  const teamCount = locs.filter(u => u === 'https://acme.com/team').length;
  assert(teamCount === 1, `sitemap locs deduplicated (got ${teamCount} /team)`);
  assert(locs.indexOf('https://acme.com/team') < locs.indexOf('https://acme.com/blog/post-1'), 'sitemap order preserved');
  // bounded by max.
  const bounded = PublicSourceGraph.extractSitemapLocs(xml, 'https://acme.com', 2);
  assert(bounded.length === 2, `sitemap bounded to max=2 (got ${bounded.length})`);

  // Empty / no locs → nothing.
  assert(PublicSourceGraph.extractSitemapLocs('<urlset></urlset>', 'https://acme.com').length === 0, 'empty sitemap -> no locs');
}

// ── classification taxonomy parity (classify == categorizeProfessionalPath) ─

async function taxonomyParityTests() {
  const graph = new PublicSourceGraph({ company: 'acme', origin: 'https://acme.com', homepage: 'https://acme.com/' });
  const cases: Array<[string, ProfessionalPageCategory]> = [
    ['/team', 'team_people'],
    ['/leadership', 'team_people'],
    ['/people', 'team_people'],
    ['/engineering', 'engineering'],
    ['/technology', 'engineering'],
    ['/tech', 'engineering'],
    ['/developers', 'engineering'],
    ['/blog', 'blog'],
    ['/changelog', 'blog'],
    ['/docs', 'docs'],
    ['/documentation', 'docs'],
    ['/security', 'security'],
    ['/trust-center', 'security'],
    ['/status', 'status_ops'],
    ['/incidents', 'status_ops'],
    ['/about', 'about'],
    ['/company', 'about'],
    ['/press', 'about'],
    ['/careers', 'hiring'],
    ['/jobs', 'hiring'],
    ['/random-page', 'other'],
  ];
  for (const [input, expected] of cases) {
    assert(graph.classify(input) === expected, `classify("${input}") === "${expected}"`);
  }
}

async function main() {
  await run('DomainResolver — resolution paths (never guesses)', domainResolutionTests);
  await run('PublicLinkDiscovery — same-origin + 404-skip', discoveryTests);
  await run('PublicSourceGraph — model: classify / same-origin / aggregation', sourceGraphModelTests);
  await run('PublicSourceGraph — JSON-LD sameAs extraction (regex, bounded)', jsonLdTests);
  await run('PublicSourceGraph — sitemap <loc> extraction (regex, bounded)', sitemapTests);
  await run('PublicSourceGraph — classify taxonomy parity', taxonomyParityTests);

  console.log('\n==================================================');
  console.log(`sourceGraph tests: ${pass} passed, ${fail} failed.`);
  if (fail === 0) console.log('ALL TESTS PASSED.');
  else { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
  expect(fail).toBe(0);
}

await main();
  });
});