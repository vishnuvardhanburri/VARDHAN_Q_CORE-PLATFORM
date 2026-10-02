import { IntelligenceEngine } from '../src/server/IntelligenceEngine';
import { LivePublicObservationProvider } from '../src/server/LivePublicObservationProvider';
import { PublicLinkDiscovery } from '../src/server/PublicLinkDiscovery';
import { PeopleExtractor } from '../src/server/PeopleExtractor';
import { OwnerSelector } from '../src/server/OwnerSelector';
import { VardhanOperator } from '../src/server/VardhanOperator';
import type {
  IntelligenceCase, Evidence, EngineMode,
  PublicObservationProvider, ObservationResult, OwnerCandidate,
  CompanySurface, DiscoveredPage
} from '../src/server/IntelligenceCase';
import type { HttpFetcher } from '../src/server/IntelligenceCase';
import * as os from 'os';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
/**
 * VARDHAN INTERACTIVE OPERATOR — test suite
 * Run with:  npx tsx tests/vardhanOperator.test.ts
 *
 * Covers (additive — does not modify the existing acceptanceTest.ts):
 *   - interactive REPL (help / status / dispatch)
 *   - company public-link discovery (bounded, same-origin)
 *   - people extraction (explicit owner, ambiguous owner, no owner)
 *   - owner candidate creation (explicit evidence)
 *   - evidence lineage (ids traceable)
 *   - finding -> owner -> email lineage (GO path)
 *   - production/live observation integration (real provider, injected transport)
 *   - MOCK_TEST evidence rejected in PRODUCTION mode
 *   - human approval before send (no auto-send, requires confirmation)
 */


// ─────────────────────────────────────────────────────────────────────────────
// CANNED HTML / FAKE TRANSPORT
// ─────────────────────────────────────────────────────────────────────────────

const HOMEPAGE_HTML = `<!doctype html><html><head><title>Acme Corp</title></head><body>
<header><nav>
<a href="https://acme.com/about">About</a>
<a href="/team">Team</a>
<a href="/leadership">Leadership</a>
<a href="/engineering">Engineering</a>
<a href="/technology">Technology</a>
<a href="/blog">Blog</a>
<a href="/security">Security</a>
<a href="/careers">Careers</a>
<a href="https://evil.example.com">Evil</a>
<a href="https://api.acme.com/v1/users">API subdomain</a>
</nav></header>
<main><h1>Welcome to Acme</h1></main>
</body></html>`;

const TEAM_HTML = `<!doctype html><html><head><title>Acme Team</title></head><body>
<section class="team">
  <div class="member">
    <img src="/jane.jpg" alt="Jane Doe">
    <h3>Jane Doe</h3>
    <p class="title">Head of Engineering</p>
    <p>Jane leads platform infrastructure and reliability.</p>
  </div>
  <div class="member">
    <img src="/bob.jpg" alt="Bob Smith">
    <h3>Bob Smith</h3>
    <p class="title">VP of Engineering</p>
  </div>
  <div class="member">
    <img src="/sarah.jpg" alt="Sarah Jones">
    <h3>Sarah Jones</h3>
    <p class="title">Head of Marketing</p>
  </div>
</section>
</body></html>`;

const BLOG_HTML = `<html><body><article>
<p>In a recent post, Jane Doe, Head of Engineering at Acme, discussed scaling.</p>
</article></body></html>`;

// A genuine (200) engineering page so discovery has a real engineering-category page
// to record — distinct from 404 probes, which must NOT be counted as discovered.
const ENGINEERING_HTML = `<!doctype html><html><head><title>Acme Engineering</title></head><body>
<main><h1>Acme Engineering</h1>
<p>Infrastructure, platform, and reliability engineering at Acme.</p>
</main></body></html>`;

const AMBIGUOUS_HTML = `<html><body><div class="bio">
The Head of Engineering oversees the team.
</div></body></html>`;

/** Build a deterministic, no-network fetcher that serves the canned pages. */
function fakeFetcher(routes: Record<string, { status: number; body: string; ct?: string }>): HttpFetcher {
  return async (url: string, _init: any): Promise<Response> => {
    const key = url.replace(/\/$/, '') || url;
    const hit = routes[key] || routes[url];
    if (hit) {
      return new Response(hit.body, { status: hit.status, headers: hit.ct ? { 'content-type': hit.ct } : {} });
    }
    return new Response('', { status: 404, headers: { 'content-type': 'text/html' } });
  };
}

function acmeRoutes(): Record<string, { status: number; body: string; ct?: string }> {
  return {
    'https://acme.com': { status: 200, body: HOMEPAGE_HTML, ct: 'text/html' },
    'https://acme.com/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /private', ct: 'text/plain' },
    'https://acme.com/sitemap.xml': { status: 200, body: '<urlset></urlset>', ct: 'application/xml' },
    'https://acme.com/team': { status: 200, body: TEAM_HTML, ct: 'text/html' },
    'https://acme.com/leadership': { status: 200, body: TEAM_HTML, ct: 'text/html' },
    'https://acme.com/engineering': { status: 200, body: ENGINEERING_HTML, ct: 'text/html' },
    'https://acme.com/blog': { status: 200, body: BLOG_HTML, ct: 'text/html' },
  };
}

function noPeopleRoutes(): Record<string, { status: number; body: string; ct?: string }> {
  return {
    'https://acme.com': { status: 200, body: HOMEPAGE_HTML.replace(/<a href="\/team">Team<\/a>/, '').replace(/<a href="\/leadership">Leadership<\/a>/, ''), ct: 'text/html' },
  };
}

// ── Deep-path fixtures ──────────────────────────────────────────────────────

/** Homepage that also carries JSON-LD sameAs links (for `discover` deep sameAs). */
const DISCOVER_HOMEPAGE_HTML = `<!doctype html><html><head><title>Acme Corp</title>
<script type="application/ld+json">{"sameAs":["https://github.com/acme","https://linkedin.com/company/acme","https://twitter.com/acme"]}</script>
</head><body>
<header><nav>
<a href="https://acme.com/about">About</a>
<a href="/team">Team</a>
<a href="/leadership">Leadership</a>
<a href="/engineering">Engineering</a>
<a href="/blog">Blog</a>
<a href="/security">Security</a>
<a href="/careers">Careers</a>
<a href="https://evil.example.com">Evil</a>
</nav></header>
<main><h1>Welcome to Acme</h1></main>
</body></html>`;

/** Developers page with a public mailto + professional profile (contact channel). */
const DEV_CONTACT_HTML = `<html><body><h1>Developer Platform</h1>
<p>We offer a REST API and SDK. Docs at /docs. Services run on Kubernetes.</p>
<p>Follow the team on <a href="https://www.linkedin.com/in/janedoe">LinkedIn</a>.</p>
<p>Contact: <a href="mailto:jane@acme.com">jane@acme.com</a></p>
</body></html>`;

/** Routes for `discover` test — homepage carries JSON-LD sameAs. */
function discoverRoutes(): Record<string, { status: number; body: string; ct?: string }> {
  return {
    'https://acme.com': { status: 200, body: DISCOVER_HOMEPAGE_HTML, ct: 'text/html' },
    'https://acme.com/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /private', ct: 'text/plain' },
    'https://acme.com/sitemap.xml': { status: 200, body: '<urlset></urlset>', ct: 'application/xml' },
    'https://acme.com/team': { status: 200, body: TEAM_HTML, ct: 'text/html' },
    'https://acme.com/leadership': { status: 200, body: TEAM_HTML, ct: 'text/html' },
    'https://acme.com/engineering': { status: 200, body: ENGINEERING_HTML, ct: 'text/html' },
    'https://acme.com/blog': { status: 200, body: BLOG_HTML, ct: 'text/html' },
    'https://acme.com/about': { status: 200, body: AMBIGUOUS_HTML, ct: 'text/html' },
  };
}

/** Routes for deep READY-path tests — extends acmeRoutes with a contact page. */
function deepReadyRoutes(): Record<string, { status: number; body: string; ct?: string }> {
  const r = acmeRoutes();
  r['https://acme.com/developers'] = { status: 200, body: DEV_CONTACT_HTML, ct: 'text/html' };
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST RIG
// ─────────────────────────────────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function assert(cond: boolean, message: string): void {
  if (cond) { passCount++; }
  else { failCount++; failures.push(message); console.log(`[FAIL] ${message}`); }
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passCount++; }
  else { failCount++; failures.push(`${message} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`); console.log(`[FAIL] ${message} got ${JSON.stringify(actual)}`); }
}

const runTest = (name: string, fn: () => Promise<void> | void) => {
  console.log(`\n--- ${name} ---`);
  return fn();
};

function capture() {
  const buf: string[] = [];
  const output = { write: (s: string) => { buf.push(s); } };
  return { buf, output, text: () => buf.join('') };
}

// --------------------------------------------------------------------------- //
// Mock observation provider (mirrors the existing acceptanceTest pattern)
// --------------------------------------------------------------------------- //
class MockProvider implements PublicObservationProvider {
  constructor(private evidenceToReturn: Evidence[]) {}
  async observePublicSurface(_url: string): Promise<ObservationResult> {
    return { evidence: this.evidenceToReturn, discovery_errors: 0 };
  }
}

const goEvidence: Evidence[] = [{
  id: 'ev_go_test', evidence_origin: 'REAL_PUBLIC_OBSERVATION',
  public_url: 'https://api.acme.com/v1/users', source_type: 'API_ENDPOINT', status: 200,
  observed_behavior: 'The payload exposes internal metadata fields like storage_path.',
  sensitive_fields: ['storage_path'], reproductions: 3, repeatable: true,
  tested_without_auth: true, not_tested: ['access private data'],
  retrieved_at: new Date().toISOString(), evidence_text: 'exposes storage_path'
}];

const janeCandidate: OwnerCandidate = {
  name: 'Jane Doe', role: 'Head of Engineering', company: 'acme.com',
  source_urls: ['https://acme.com/team'],
  evidence: ['Jane Doe is listed as Head of Engineering on the Acme team page.'],
  relationship_to_area: "Role 'Head of Engineering' covers engineering & technical leadership.",
  confidence: 'HIGH', explicit_evidence: true
};

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('==================================================');
  console.log('VARDHAN INTERACTIVE OPERATOR — TEST SUITE');
  console.log('==================================================\n');

  // 1. PUBLIC-LINK DISCOVERY — bounded, same-origin
  await runTest('public-link discovery (bounded, same-origin, professional pages)', async () => {
    const surface = await PublicLinkDiscovery.discover('https://acme.com', {
      fetcher: fakeFetcher(acmeRoutes()),
      maxPages: 12, delayMs: 0, timeoutMs: 2000
    });
    assert(surface.discovered_pages.length > 0, 'discovery returns pages');
    assert(surface.origin === 'https://acme.com', `surface origin is acme.com (got ${surface.origin})`);
    const allUrls = surface.discovered_pages.map(p => p.url);
    assert(!allUrls.some(u => u.includes('evil.example.com')), 'cross-origin link NOT followed');
    assert(!allUrls.some(u => u.startsWith('https://api.acme.com')), 'cross-origin api subdomain NOT followed');
    const teamPage = surface.discovered_pages.find(p => p.path === '/team');
    assert(!!teamPage, '/team professional page discovered');
    assert(!!surface.page_categories['team_people'], 'team_people category populated');
    assert(!!surface.page_categories['engineering'], 'engineering category populated');
  });

  // 2. PEOPLE EXTRACTION — explicit owner evidence
  await runTest('people extraction — explicit owner evidence (HIGH)', () => {
    const pages: DiscoveredPage[] = [{ url: 'https://acme.com/team', path: '/team', category: 'team_people' }];
    const html = new Map([['https://acme.com/team', TEAM_HTML]]);
    const cands = PeopleExtractor.extractFromPages(pages, html, { company: 'acme.com' });
    const jane = cands.find(c => c.name === 'Jane Doe');
    const bob = cands.find(c => c.name === 'Bob Smith');
    const sarah = cands.find(c => c.name === 'Sarah Jones');
    assert(!!jane, 'Jane Doe extracted');
    assert(jane?.role === 'Head of Engineering', `Jane role is Head of Engineering (got ${jane?.role})`);
    assert(jane?.confidence === 'HIGH', 'Jane confidence HIGH (explicit listing on team page)');
    assert(jane?.explicit_evidence === true, 'Jane explicit_evidence true');
    assert(!!bob, 'Bob Smith extracted');
    assert(bob?.role === 'VP Engineering', `Bob normalized to VP Engineering (got ${bob?.role})`);
    assert(!sarah, 'Sarah (Head of Marketing — non-candidate role) NOT fabricated');
  });

  // 3. OWNER SELECTION — picks HIGH candidate + evidence string
  await runTest('owner selection — explicit candidate -> HIGH evidence string', () => {
    const sel = OwnerSelector.select([janeCandidate], 'api surface');
    assert(!!sel.candidate, 'an owner was selected');
    assert(sel.candidate?.name === 'Jane Doe', 'selected Jane Doe');
    assert(sel.ownerEvidenceString.includes('Jane Doe'), 'evidence string names the candidate');
    assert(sel.ownerEvidenceString.includes('is listed as'), 'evidence string uses explicit public listing phrase');
    assert(sel.ownerEvidenceString.includes('https://acme.com/team'), 'evidence string cites source URL');
  });

  // 4. OWNER CANDIDATES — no owner found
  await runTest('people extraction — no owner found (homepage only)', async () => {
    const routes = noPeopleRoutes();
    const surface = await PublicLinkDiscovery.discover('https://acme.com', {
      fetcher: fakeFetcher(routes), maxPages: 6, delayMs: 0, timeoutMs: 2000
    });
    const html = new Map<string, string>();
    for (const p of surface.discovered_pages) {
      const r = routes[p.url.replace(/\/$/, '')] || routes[p.url];
      if (r && r.body) html.set(p.url, r.body);
    }
    const pagesForPeople = surface.discovered_pages.filter(p => p.category === 'team_people' || p.category === 'about');
    const cands = PeopleExtractor.extractFromPages(pagesForPeople, html, { company: 'acme.com' });
    assert(cands.length === 0, `no candidates when team page absent (got ${cands.length})`);
  });

  // 5. AMBIGUOUS OWNER — role keyword but no name -> no fabricated candidate
  await runTest('people extraction — ambiguous (role only, no name) -> no candidate', () => {
    const raws = PeopleExtractor.extractPeopleFromHtml(AMBIGUOUS_HTML, 'https://acme.com/bio', 'about');
    assert(raws.length === 0, `ambiguous role without a named person yields no candidate (got ${raws.length})`);
  });

  // 6. AMBIGUOUS OWNER — name+role on a blog (non-people page) -> MEDIUM
  await runTest('people extraction — name+role on non-people page -> MEDIUM confidence', () => {
    const pages: DiscoveredPage[] = [{ url: 'https://acme.com/blog/post', path: '/blog/post', category: 'blog' }];
    const html = new Map([['https://acme.com/blog/post', BLOG_HTML]]);
    const cands = PeopleExtractor.extractFromPages(pages, html, { company: 'acme.com' });
    const jane = cands.find(c => c.name === 'Jane Doe');
    assert(!!jane, 'Jane extracted from blog byline');
    assert(jane?.confidence === 'MEDIUM', `blog-listed role is MEDIUM confidence (got ${jane?.confidence})`);
    assert(jane?.explicit_evidence === false, 'blog-listed role is not explicit evidence');
  });

  // 7. EVIDENCE LINEAGE — ids traceable
  await runTest('evidence lineage — every evidence has id + retrieved_at', () => {
    const ev = goEvidence[0];
    assert(!!ev.id, 'evidence has id');
    assert(!!ev.retrieved_at, 'evidence has retrieved_at');
    assert(ev.evidence_origin === 'REAL_PUBLIC_OBSERVATION', 'evidence is real public observation');
  });

  // 8. FINDING -> OWNER -> EMAIL LINEAGE (GO path, via engine + owner wiring)
  await runTest('lineage: finding -> owner(HIGH) -> email(GO, claims reference evidence ids)', async () => {
    const sel = OwnerSelector.select([janeCandidate], 'api surface');
    const result = await IntelligenceEngine.run(
      'acme.com', 'https://acme.com',
      sel.candidate!.name, sel.candidate!.role, sel.ownerEvidenceString,
      [], 'PRODUCTION' as EngineMode, undefined, new MockProvider(goEvidence)
    );
    assert(result.prospect_decision === 'GO', `decision is GO (got ${result.prospect_decision})`);
    assert(result.claim_validation === 'PASSED', `claim QA PASSED (got ${result.claim_validation})`);
    assert(!!result.email_model, 'email model produced');
    assert(!!result.subject, 'subject generated');
    assert(!!result.body, 'body generated');
    const owner = result.technical_owner!;
    assert(owner.owner_confidence === 'HIGH', `owner confidence HIGH (got ${owner.owner_confidence})`);
    assert(owner.name === 'Jane Doe', 'owner name preserved');
    // every email claim's evidence_ids must reference a real resolved evidence id
    const resolvedIds = new Set((result.resolved_evidence || []).map(e => e.id));
    for (const claim of result.email_model!.claims) {
      if (claim.evidence_ids.length > 0) {
        for (const id of claim.evidence_ids) {
          assert(resolvedIds.has(id), `email claim evidence_id ${id} traces to resolved evidence`);
        }
      }
    }
    // resolved evidence ids trace to raw evidence ids
    const rawIds = new Set(result.evidence.map(e => e.id));
    for (const id of (result.resolved_evidence || []).map(e => e.id)) {
      assert(rawIds.has(id), `resolved evidence id ${id} traces to raw evidence`);
    }
  });

  // 9. PRODUCTION rejects MOCK_TEST evidence from provider -> NO_GO
  await runTest('production mode rejects provider-supplied MOCK_TEST -> NO_GO', async () => {
    const mockFromProvider = [{ ...goEvidence[0], evidence_origin: 'MOCK_TEST' as const }];
    const result = await IntelligenceEngine.run(
      'acme.com', 'https://acme.com', 'Jane Doe', 'Head of Engineering', '',
      [], 'PRODUCTION' as EngineMode, undefined, new MockProvider(mockFromProvider)
    );
    assert(result.prospect_decision === 'NO_GO', `MOCK_TEST in PRODUCTION -> NO_GO (got ${result.prospect_decision})`);
  });

  // 10. LIVE OBSERVATION INTEGRATION — real provider, injected transport
  await runTest('live observation integration (real provider + injected transport)', async () => {
    let onPageCalls = 0;
    const provider = new LivePublicObservationProvider({
      delayMs: 0,
      onPage: () => { onPageCalls++; },
      fetcher: fakeFetcher({
        'https://example.com': { status: 200, body: '<html><body><a href="/more">More</a><a href="https://evil.com">Bad</a></body></html>', ct: 'text/html' },
        'https://example.com/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /', ct: 'text/plain' },
        'https://example.com/sitemap.xml': { status: 200, body: '<urlset></urlset>', ct: 'application/xml' },
        'https://example.com/more': { status: 200, body: '<html><body>more</body></html>', ct: 'text/html' },
      })
    });
    const { evidence, discovery_errors } = await provider.observePublicSurface('https://example.com');
    assert(evidence && evidence.length > 0, 'real provider produced observations');
    assert(onPageCalls > 0, 'onPage progress callback fired');
    assert(evidence && evidence.every(e => e.evidence_origin === 'REAL_PUBLIC_OBSERVATION'), 'all observations are real public observations');
    // never followed the cross-origin evil.com link
    assert(!evidence || !evidence.some(e => e.public_url.includes('evil.com')), 'cross-origin link not followed by provider');

  });

  // 11. INTERACTIVE REPL — help / status / dispatch
  await runTest('REPL help output', async () => {
    const cap = capture();
    const op = new VardhanOperator({ inputLines: ['help', 'exit'], output: cap.output });
    await op.start();
    const out = cap.text();
    assert(out.includes('VARDHAN INTELLIGENCE OPERATOR'), 'banner shown');
    assert(out.includes('research <url>'), 'help lists research');
    assert(out.includes('show findings'), 'help lists show findings');
    assert(out.includes('draft email'), 'help lists draft email');
    assert(out.includes('send'), 'help lists send');
    assert(out.includes('Operator session ended'), 'exit acknowledged');
  });

  await runTest('REPL status before research', async () => {
    const cap = capture();
    const op = new VardhanOperator({ inputLines: ['status', 'exit'], output: cap.output });
    await op.dispatch('status');
    assert(cap.text().includes('No active research'), 'status prompts for research');
  });

  await runTest('REPL unknown command', async () => {
    const cap = capture();
    const op = new VardhanOperator({ inputLines: [], output: cap.output });
    await op.dispatch('boguscommand');
    assert(cap.text().includes('Unknown command'), 'unknown command reported');
  });

  // 12. REPL research (no finding) — live provider, fake transport, then show/draft
  await runTest('REPL research (no finding) + show people + draft email blocked', async () => {
    const cap = capture();
    const op = new VardhanOperator({
      fetch: fakeFetcher(acmeRoutes()),
      saveArtifact: () => {},            // no real FS write
      output: cap.output,
      maxDiscoveryPages: 12,
      discoveryDelayMs: 0,
      observationDelayMs: 0,             // fast: uses real provider with fake transport
    });
    await op.dispatch('research https://acme.com');
    const out = cap.text();
    assert(out.includes('[company]'), 'company discovery stage shown');
    assert(out.includes('[pages]'), 'pages discovery stage shown');
    assert(out.includes('[engineering]'), 'engineering stage shown');
    assert(out.includes('[people]'), 'people stage shown');
    assert(out.includes('[owner]'), 'owner stage shown');
    assert(out.includes('[evidence]'), 'evidence stage shown');
    assert(out.includes('[findings]'), 'findings stage shown');
    assert(out.includes('Jane Doe'), 'Jane Doe surfaced in people output');
    assert(out.includes('Head of Engineering'), 'owner role surfaced');
    // No strong finding -> decision RESEARCH_MORE / NO_GO, email blocked
    assert(out.includes('Decision:') && (out.includes('RESEARCH_MORE') || out.includes('NO_GO')), 'no fabricated finding (RESEARCH_MORE/NO_GO)');
    cap.buf.length = 0;
    await op.dispatch('show people');
    assert(cap.text().includes('Jane Doe'), 'show people lists Jane Doe');
    cap.buf.length = 0;
    await op.dispatch('why owner');
    assert(cap.text().includes('WHY OWNER'), 'why owner works');
    cap.buf.length = 0;
    await op.dispatch('draft email');
    assert(cap.text().includes('EMAIL DRAFT BLOCKED'), 'draft email blocked when not GO');
  });

  // 13. REPL research (GO path) — injected mock provider yields email
  await runTest('REPL research (GO) -> draft email succeeds', async () => {
    const cap = capture();
    const op = new VardhanOperator({
      fetch: fakeFetcher(acmeRoutes()),
      saveArtifact: () => {},
      output: cap.output,
      maxDiscoveryPages: 12,
      discoveryDelayMs: 0,
      observationDelayMs: 0,
      observationProvider: new MockProvider(goEvidence)
    });
    await op.dispatch('research https://acme.com');
    const out = cap.text();
    assert(out.includes('Decision:       GO'), 'GO decision reached through operator');
    cap.buf.length = 0;
    await op.dispatch('draft email');
    const emailOut = cap.text();
    assert(emailOut.includes('EMAIL DRAFT'), 'email drafted on GO');
    assert(emailOut.includes('Subject:'), 'subject shown');
    assert(emailOut.includes('solo founder'), 'VARDHAN founder positioning preserved');
  });

  // 14. HUMAN APPROVAL BEFORE SEND — not configured -> refused
  await runTest('send requires configured transport + explicit confirmation', async () => {
    const cap = capture();
    const op = new VardhanOperator({
      fetch: fakeFetcher(acmeRoutes()),
      saveArtifact: () => {},
      output: cap.output,
      maxDiscoveryPages: 12,
      discoveryDelayMs: 0,
      observationDelayMs: 0,
      observationProvider: new MockProvider(goEvidence)
    });
    // without SMTP env -> refused
    delete process.env.VARDHAN_SMTP_HOST; delete process.env.VARDHAN_SMTP_USER; delete process.env.VARDHAN_SMTP_PASS;
    await op.dispatch('research https://acme.com');
    cap.buf.length = 0;
    await op.dispatch('send --confirm');
    assert(cap.text().includes('NOT configured'), 'send refused when transport not configured');
    cap.buf.length = 0;
    await op.dispatch('send');
    assert(cap.text().includes('confirmation'), 'send demands explicit confirmation');
  });

  // 15. HUMAN APPROVAL BEFORE SEND — configured but still no auto-delivery
  await runTest('send with transport configured records intent only (no auto-delivery)', async () => {
    const cap = capture();
    process.env.VARDHAN_SMTP_HOST = 'smtp.test';
    process.env.VARDHAN_SMTP_USER = 'user';
    process.env.VARDHAN_SMTP_PASS = 'pass';
    const op = new VardhanOperator({
      fetch: fakeFetcher(acmeRoutes()),
      saveArtifact: () => {},
      output: cap.output,
      maxDiscoveryPages: 12,
      discoveryDelayMs: 0,
      observationDelayMs: 0,
      observationProvider: new MockProvider(goEvidence)
    });
    await op.dispatch('research https://acme.com');
    cap.buf.length = 0;
    await op.dispatch('send --confirm');
    const out = cap.text();
    assert(out.includes('Intent recorded'), 'send records intent only');
    assert(!out.toLowerCase().includes('sent successfully') && !out.toLowerCase().includes('email delivered'), 'never auto-delivers');
    delete process.env.VARDHAN_SMTP_HOST; delete process.env.VARDHAN_SMTP_USER; delete process.env.VARDHAN_SMTP_PASS;
  });

  // ── NEW: deep-path verbs + discover (fully offline via MockProvider/fake fetcher) ─

  // 16. discover <company> — PublicLinkDiscovery + classifications + sameAs
  await runTest('discover <company> — discovered pages + classifications + sameAs (offline)', async () => {
    const cap = capture();
    const op = new VardhanOperator({
      fetch: fakeFetcher(discoverRoutes()),
      saveArtifact: () => {},
      output: cap.output,
      maxDiscoveryPages: 20,
      discoveryDelayMs: 0,
      discoveryTimeoutMs: 2000,
      observationDelayMs: 0,
    });
    await op.dispatch('discover https://acme.com');
    const out = cap.text();
    assert(out.includes('=== DISCOVERY:'), 'discover prints discovery header');
    assert(out.includes('Discovered pages:'), 'discover prints discovered pages section');
    assert(out.includes('/team'), 'discover shows /team page');
    assert(out.includes('team_people'), 'discover shows team_people category');
    assert(out.includes('engineering'), 'discover shows engineering category');
    assert(out.includes('Classifications:'), 'discover prints classifications section');
    assert(out.includes('sameAs'), 'discover prints sameAs section');
    assert(out.includes('https://github.com/acme'), 'discover finds GitHub sameAs from JSON-LD');
    assert(out.includes('https://linkedin.com/company/acme'), 'discover finds LinkedIn sameAs from JSON-LD');
    assert(out.includes('https://twitter.com/acme'), 'discover finds Twitter sameAs from JSON-LD');
    // domain-only form (no http://) is accepted
    cap.buf.length = 0;
    await op.dispatch('discover acme.com');
    assert(cap.text().includes('=== DISCOVERY: acme.com'), 'discover accepts bare domain (acme.com)');
  });

  // 17. show findings (deep) — currentDeep.findings + deep_finding with evidence_ids
  await runTest('show findings (deep) — deep_finding carries evidence_ids', async () => {
    const cap = capture();
    const op = new VardhanOperator({
      fetch: fakeFetcher(acmeRoutes()),
      saveArtifact: () => {},
      artifactsDir: os.tmpdir(),
      output: cap.output,
      maxDiscoveryPages: 20, discoveryDelayMs: 0, observationDelayMs: 0,
      observationProvider: new MockProvider(goEvidence)
    });
    await op.dispatch('deep research https://acme.com');
    cap.buf.length = 0;
    await op.dispatch('show findings');
    const out = cap.text();
    assert(out.includes('DEEP FINDINGS'), 'deep show findings header present');
    assert(out.includes('ev_go_test'), 'deep show findings surfaces evidence_ids');
    assert(out.includes('POSSIBLE_SENSITIVE_METADATA_EXPOSURE'), 'deep show findings shows finding_type');
    assert(out.includes('evidence_ids:'), 'deep show findings labels evidence_ids');
    assert(out.includes('provenance:'), 'deep show findings shows provenance');
  });

  // 18. show people (deep) — currentDeep.people + selected_owner
  await runTest('show people (deep) — people + selected_owner (DeepOwner)', async () => {
    const cap = capture();
    const op = new VardhanOperator({
      fetch: fakeFetcher(acmeRoutes()),
      saveArtifact: () => {},
      artifactsDir: os.tmpdir(),
      output: cap.output,
      maxDiscoveryPages: 20, discoveryDelayMs: 0, observationDelayMs: 0,
      observationProvider: new MockProvider(goEvidence)
    });
    await op.dispatch('deep research https://acme.com');
    cap.buf.length = 0;
    await op.dispatch('show people');
    const out = cap.text();
    assert(out.includes('DEEP PEOPLE'), 'deep show people header present');
    assert(out.includes('Jane Doe'), 'deep show people lists Jane Doe');
    assert(out.includes('Selected owner (DeepOwner)'), 'deep show people shows selected owner section');
    assert(out.includes('owner_evidence:'), 'deep show people shows owner_evidence');
    assert(out.includes('finding_link:'), 'deep show people shows finding_link');
  });

  // 19. why owner (deep) — owner_evidence + confidence + finding_link
  await runTest('why owner (deep) — owner_evidence + confidence + finding_link', async () => {
    const cap = capture();
    const op = new VardhanOperator({
      fetch: fakeFetcher(acmeRoutes()),
      saveArtifact: () => {},
      artifactsDir: os.tmpdir(),
      output: cap.output,
      maxDiscoveryPages: 20, discoveryDelayMs: 0, observationDelayMs: 0,
      observationProvider: new MockProvider(goEvidence)
    });
    await op.dispatch('deep research https://acme.com');
    cap.buf.length = 0;
    await op.dispatch('why owner');
    const out = cap.text();
    assert(out.includes('WHY OWNER (DEEP)'), 'deep why owner header present');
    assert(out.includes('Owner evidence:'), 'deep why owner shows owner_evidence');
    assert(out.includes('Confidence:'), 'deep why owner shows confidence');
    assert(out.includes('Finding link:'), 'deep why owner shows finding_link');
    assert(out.includes('public API surface'), 'deep why owner finding_link resolves to a subsystem');
  });

  // 20. draft email (deep, OUTREACH_READY) — 9-section body + CLAIM→EVIDENCE map
  await runTest('draft email (deep, OUTREACH_READY) — 9-section body + CLAIM→EVIDENCE map', async () => {
    const cap = capture();
    const op = new VardhanOperator({
      fetch: fakeFetcher(deepReadyRoutes()),
      saveArtifact: () => {},
      artifactsDir: os.tmpdir(),
      output: cap.output,
      maxDiscoveryPages: 20, discoveryDelayMs: 0, observationDelayMs: 0,
      observationProvider: new MockProvider(goEvidence)
    });
    await op.dispatch('deep research https://acme.com');
    cap.buf.length = 0;
    await op.dispatch('draft email');
    const out = cap.text();
    assert(out.includes('DEEP EMAIL DRAFT'), 'deep draft email header present');
    assert(out.includes('9-section body'), 'deep draft email labels 9-section body');
    assert(out.includes('CLAIM'), 'deep draft email shows CLAIM→EVIDENCE map');
    assert(out.includes('solo founder'), 'deep draft email preserves founder identity');
    assert(out.includes('NEVER AUTO-SENT'), 'deep draft email reminds never-auto-sent');
    assert(out.includes('ev_go_test'), 'deep draft email claims reference evidence ids');
  });

  // 21. draft email (deep, RESEARCH_MORE) — blocked
  await runTest('draft email (deep, non-OUTREACH_READY) — blocked with reason', async () => {
    const cap = capture();
    const op = new VardhanOperator({
      fetch: fakeFetcher(acmeRoutes()),          // no /developers contact page
      saveArtifact: () => {},
      artifactsDir: os.tmpdir(),
      output: cap.output,
      maxDiscoveryPages: 20, discoveryDelayMs: 0, observationDelayMs: 0,
      observationProvider: new MockProvider(goEvidence)
    });
    await op.dispatch('deep research https://acme.com');
    cap.buf.length = 0;
    await op.dispatch('draft email');
    const out = cap.text();
    assert(out.includes('EMAIL DRAFT BLOCKED (DEEP)'), 'deep non-READY draft shows blocked header');
    assert(out.includes('Decision:'), 'deep non-READY draft shows decision');
    assert(out.includes('OUTREACH_READY'), 'deep non-READY draft references OUTREACH_READY gate');
  });

  // 22. Send gate on deep path — send requires --confirm, blocks non-READY, never auto-sends
  await runTest('send gate (deep) — requires --confirm; --confirm on OUTREACH_READY records intent only', async () => {
    // Without transport configured
    delete process.env.VARDHAN_SMTP_HOST; delete process.env.VARDHAN_SMTP_USER; delete process.env.VARDHAN_SMTP_PASS;
    const cap = capture();
    const op = new VardhanOperator({
      fetch: fakeFetcher(deepReadyRoutes()),
      saveArtifact: () => {},
      artifactsDir: os.tmpdir(),
      output: cap.output,
      maxDiscoveryPages: 20, discoveryDelayMs: 0, observationDelayMs: 0,
      observationProvider: new MockProvider(goEvidence)
    });
    await op.dispatch('deep research https://acme.com');
    cap.buf.length = 0;
    await op.dispatch('send');
    const noConfirm = cap.text();
    assert(noConfirm.includes('Send requires explicit confirmation'), 'deep send without --confirm refused');
    cap.buf.length = 0;
    await op.dispatch('send --confirm');
    const notConf = cap.text();
    assert(notConf.includes('NOT configured'), 'deep send --confirm on OUTREACH_READY without transport refused');
    // With transport configured + OUTREACH_READY + email generated
    process.env.VARDHAN_SMTP_HOST = 'smtp.test';
    process.env.VARDHAN_SMTP_USER = 'user';
    process.env.VARDHAN_SMTP_PASS = 'pass';
    const op2 = new VardhanOperator({
      fetch: fakeFetcher(deepReadyRoutes()),
      saveArtifact: () => {},
      artifactsDir: os.tmpdir(),
      output: cap.output,
      maxDiscoveryPages: 20, discoveryDelayMs: 0, observationDelayMs: 0,
      observationProvider: new MockProvider(goEvidence)
    });
    await op2.dispatch('deep research https://acme.com');
    cap.buf.length = 0;
    await op2.dispatch('send --confirm');
    const sentOut = cap.text();
    assert(sentOut.includes('Intent recorded'), 'deep send --confirm on OUTREACH_READY records intent');
    assert(!sentOut.toLowerCase().includes('sent successfully') && !sentOut.toLowerCase().includes('email delivered'), 'deep send never auto-delivers');
    delete process.env.VARDHAN_SMTP_HOST; delete process.env.VARDHAN_SMTP_USER; delete process.env.VARDHAN_SMTP_PASS;
  });

  // ── results ───────────────────────────────────────────────────────────────
  console.log('\n==================================================');
  console.log('VARDHAN OPERATOR TEST RESULTS');
  console.log('==================================================');
  console.log(`Pass: ${passCount}`);
  console.log(`Fail: ${failCount}`);
  if (failCount > 0) {
    console.error('\nFAILURES:');
    failures.forEach(f => console.error('  - ' + f));
    expect(typeof fail !== 'undefined' ? fail : (typeof failed !== 'undefined' ? failed : 0)).toBe(0);
  } else {
    console.log('\nALL TESTS PASSED.');
  }
}

main().catch((e) => { console.error(e); expect(typeof fail !== 'undefined' ? fail : (typeof failed !== 'undefined' ? failed : 0)).toBe(0); });

  });
});