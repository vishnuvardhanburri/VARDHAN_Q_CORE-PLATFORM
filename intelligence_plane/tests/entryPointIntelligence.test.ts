import type { Evidence, CompanySurface } from '../src/server/IntelligenceCase';
import type { DeepSignal } from '../src/server/DeepTypes';
import type { EntryPoint, EntryPointGraph, EntryPointChange } from '../src/server/EntryPointModel';
import { EntryPointDiscovery } from '../src/server/EntryPointDiscovery';
import { EntryPointGraphBuilder, attachRelationsToAnchors } from '../src/server/EntryPointGraph';
import { EntryPointChangeDetector } from '../src/server/EntryPointChangeDetector';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
/**
 * VARDHAN — ENTRY POINT INTELLIGENCE REGRESSION TESTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests EntryPointDiscovery, EntryPointGraphBuilder, and EntryPointChangeDetector.
 *
 * Run: npx tsx tests/entryPointIntelligence.test.ts
 */


// ── Test Helpers ─────────────────────────────────────────────────────────────

function makeEvidence(
  id: string,
  overrides: Partial<Evidence> = {}
): Evidence {
  return {
    id,
    public_url: overrides.public_url || 'https://example.com/',
    source_type: overrides.source_type || 'PUBLIC_DOCUMENTATION' as any,
    retrieved_at: overrides.retrieved_at || new Date().toISOString(),
    raw_observation: overrides.raw_observation || '',
    evidence_text: overrides.evidence_text || '',
    observed_behavior: overrides.observed_behavior || '200 OK',
    reproductions: overrides.reproductions ?? 1,
    repeatable: overrides.repeatable ?? true,
    tested_without_auth: overrides.tested_without_auth ?? true,
    not_tested: overrides.not_tested || [],
    status: overrides.status ?? 200,
    latency_ms: overrides.latency_ms,
    latency_samples: overrides.latency_samples,
    observation_type: overrides.observation_type,
    evidence_origin: overrides.evidence_origin || 'REAL_PUBLIC_OBSERVATION',
  };
}

const TEST_DOMAIN = 'acme.com';

function makeSurface(overrides: Partial<CompanySurface> = {}): CompanySurface {
  return {
    company: 'Acme Inc',
    origin: 'https://acme.com',
    company_homepage: 'https://acme.com',
    homepage: 'https://acme.com',
    discovered_pages: overrides.discovered_pages || [],
    page_categories: overrides.page_categories || {},
  };
}

// ── Test Counters ────────────────────────────────────────────────────────────

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string): void {
  testsRun++;
  if (condition) {
    testsPassed++;
  } else {
    testsFailed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertContains<T>(arr: T[], item: T, message: string): void {
  assert(arr.includes(item), `${message} — expected ${JSON.stringify(item)} in array`);
}

// ── TEST 1: Canonical domain discovery ──────────────────────────────────────

function testCanonicalDomainDiscovery(): void {
  console.log('  TEST: canonical domain discovery');

  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://acme.com/',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
      tested_without_auth: true,
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  // After canonical URL collision merge, DOMAIN_CANONICAL is a semantic_role
  // on the merged entry point (surface_type = WEBSITE_HOMEPAGE, priority 0)
  const canonical = eps.find(ep =>
    ep.surface_type === 'DOMAIN_CANONICAL' ||
    ep.semantic_roles?.includes('DOMAIN_CANONICAL')
  );

  assert(!!canonical, 'should find canonical domain entry point');
  assertEqual(canonical!.hostname, 'acme.com', 'canonical hostname should be acme.com');
  assertEqual(canonical!.surface_type, 'WEBSITE_HOMEPAGE', 'canonical should be merged with homepage (priority)');
  assert(
    canonical!.semantic_roles!.includes('DOMAIN_CANONICAL'),
    'canonical domain should be in semantic_roles'
  );
  assertEqual(canonical!.confidence, 'HIGH', 'should be HIGH confidence');
  assertEqual(canonical!.status, 'VERIFIED_BEHAVIOR', 'should be verified behavior (repeatable observation)');
  assertEqual(canonical!.provenance, 'REAL_PUBLIC_OBSERVATION', 'should be real observation');
  assertContains(canonical!.evidence_ids, 'ev_1', 'should link to evidence');
}

// ── TEST 2: Subdomain discovery from evidence ───────────────────────────────

function testSubdomainDiscovery(): void {
  console.log('  TEST: subdomain discovery from evidence');

  const evidence = [
    makeEvidence('ev_1', { public_url: 'https://acme.com/', source_type: 'PUBLIC_DOCUMENTATION' as any, status: 200 }),
    makeEvidence('ev_2', {
      public_url: 'https://api.acme.com/v1/users',
      source_type: 'API_ENDPOINT' as any,
      status: 200,
      tested_without_auth: true,
    }),
    makeEvidence('ev_3', {
      public_url: 'https://docs.acme.com/guides',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
      tested_without_auth: true,
    }),
    makeEvidence('ev_4', {
      public_url: 'https://status.acme.com',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
      tested_without_auth: true,
      raw_observation: '<html><body>Status page</body></html>',
      evidence_text: 'status.acme.com returns 200',
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);
  const apiSub = eps.find(ep => ep.hostname === 'api.acme.com');
  const docsSub = eps.find(ep => ep.hostname === 'docs.acme.com');
  const statusSub = eps.find(ep => ep.hostname === 'status.acme.com');

  assert(!!apiSub, 'should discover api.acme.com subdomain');
  assertEqual(apiSub?.surface_type, 'DOMAIN_API', 'api subdomain should be DOMAIN_API');
  assertEqual(apiSub?.confidence, 'MEDIUM', 'api subdomain should be MEDIUM confidence');
  assertContains(apiSub!.evidence_ids, 'ev_2', 'api subdomain should link to ev_2');

  assert(!!docsSub, 'should discover docs.acme.com subdomain');
  assertEqual(docsSub?.surface_type, 'DOMAIN_DOCUMENTATION', 'docs subdomain should be DOMAIN_DOCUMENTATION');

  assert(!!statusSub, 'should discover status.acme.com subdomain');
}

// ── TEST 3: URL classification for web surfaces ───────────────────────────────

function testWebSurfaceClassification(): void {
  console.log('  TEST: web surface URL classification');

  const evidence = [
    makeEvidence('ev_1', { public_url: 'https://acme.com/', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_2', { public_url: 'https://acme.com/login', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_3', { public_url: 'https://acme.com/signup', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_4', { public_url: 'https://acme.com/password/reset', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_5', { public_url: 'https://acme.com/dashboard', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_6', { public_url: 'https://acme.com/admin', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_7', { public_url: 'https://acme.com/docs/api', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_8', { public_url: 'https://acme.com/playground', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);
  const byUrl = (url: string) => eps.find(ep => ep.surface_url === normalizeUrl(url));
  const byUrlAndType = (url: string, type: string) => eps.find(ep => ep.surface_url === normalizeUrl(url) && ep.surface_type === type);

  assertEqual(byUrlAndType('https://acme.com/', 'WEBSITE_HOMEPAGE')?.surface_type, 'WEBSITE_HOMEPAGE', 'homepage classification');
  assertEqual(byUrl('https://acme.com/login')?.surface_type, 'WEBSITE_LOGIN', 'login classification');
  assertEqual(byUrl('https://acme.com/signup')?.surface_type, 'WEBSITE_SIGNUP', 'signup classification');
  assertEqual(byUrlAndType('https://acme.com/password/reset', 'IDENTITY_PASSWORD_RESET')?.surface_type, 'IDENTITY_PASSWORD_RESET', 'password recovery classification');
  assertEqual(byUrl('https://acme.com/dashboard')?.surface_type, 'WEBSITE_ACCOUNT_PORTAL', 'dashboard classification');
  assertEqual(byUrl('https://acme.com/admin')?.surface_type, 'WEBSITE_ADMIN_INTERFACE', 'admin classification');
  assertEqual(byUrl('https://acme.com/docs/api')?.surface_type, 'WEBSITE_DEVELOPER_PORTAL', 'docs classification');
  assertEqual(byUrl('https://acme.com/playground')?.surface_type, 'WEBSITE_PLAYGROUND', 'playground classification');
}

// ── TEST 4: API surface classification ────────────────────────────────────────

function testApiSurfaceClassification(): void {
  console.log('  TEST: API surface classification');

  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://api.acme.com/v1/users',
      source_type: 'API_ENDPOINT' as any,
      status: 200,
      tested_without_auth: true,
    }),
    makeEvidence('ev_2', {
      public_url: 'https://api.acme.com/graphql',
      source_type: 'API_ENDPOINT' as any,
      status: 200,
      tested_without_auth: true,
    }),
    makeEvidence('ev_3', {
      public_url: 'https://hooks.acme.com/webhook/github',
      source_type: 'API_ENDPOINT' as any,
      status: 200,
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  const restEp = eps.find(ep => ep.surface_url === 'https://api.acme.com/v1/users');
  const graphqlEp = eps.find(ep => ep.surface_url === 'https://api.acme.com/graphql');
  const webhookEp = eps.find(ep => ep.surface_url === 'https://hooks.acme.com/webhook/github');

  assert(!!restEp, 'should find REST API endpoint');
  assert(!!graphqlEp, 'should find GraphQL API endpoint');
  assert(!!webhookEp, 'should find webhook endpoint');
}

// ── TEST 5: Identity surface discovery ────────────────────────────────────────

function testIdentitySurfaceDiscovery(): void {
  console.log('  TEST: identity surface discovery');

  const evidence = [
    makeEvidence('ev_1', { public_url: 'https://acme.com/oauth/authorize', source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_2', { public_url: 'https://acme.com/oidc/.well-known/openid-configuration', source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_3', { public_url: 'https://acme.com/sso/saml', source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_4', {
      public_url: 'https://acme.com/password/reset',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      raw_observation: '{"reset_url": "https://acme.com/reset"}',
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  const oauthEp = eps.find(ep => ep.surface_url === 'https://acme.com/oauth/authorize');
  const oidcEp = eps.find(ep => ep.surface_url === 'https://acme.com/oidc/.well-known/openid-configuration');
  const ssoEp = eps.find(ep => ep.surface_url === 'https://acme.com/sso/saml');
  const resetEp = eps.find(ep => ep.surface_url === 'https://acme.com/password/reset');

  assert(!!oauthEp, 'should find OAuth identity surface');
  assertEqual(oauthEp?.surface_type, 'IDENTITY_OAUTH', 'OAuth classification');
  assertEqual(oauthEp?.functional_role, 'AUTHENTICATION', 'OAuth role should be authentication');

  assert(!!oidcEp, 'should find OIDC discovery surface');
  assertEqual(oidcEp?.surface_type, 'IDENTITY_OIDC', 'OIDC classification');

  assert(!!ssoEp, 'should find SSO surface');
  assertEqual(ssoEp?.surface_type, 'IDENTITY_SSO', 'SSO classification');
}

// ── TEST 6: Client-side surface discovery (JS bundles, API URLs in JS) ────────

function testClientSideDiscovery(): void {
  console.log('  TEST: client-side surface discovery');

  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://acme.com/',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
      raw_observation: '<html><script src="/app.bundle.js"></script><script src="https://cdn.acme.com/static/main.js"></script></html>',
      evidence_text: 'Homepage contains JS bundle references',
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  const bundleEps = eps.filter(ep => ep.surface_type === 'CLIENT_JS_BUNDLE');
  assert(bundleEps.length >= 1, 'should discover at least 1 JS bundle entry point');
  assert(bundleEps.some(ep => ep.surface_url.includes('cdn.acme.com')), 'should find CDN JS bundle');
}

// ── TEST 7: Security surface discovery ────────────────────────────────────────

function testSecuritySurfaceDiscovery(): void {
  console.log('  TEST: security surface discovery');

  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://acme.com/.well-known/security.txt',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
      tested_without_auth: true,
    }),
    makeEvidence('ev_2', {
      public_url: 'https://status.acme.com',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
      tested_without_auth: true,
      raw_observation: 'This is the Acme status page',
    }),
  ];

  const surface = makeSurface({
    discovered_pages: [
      { url: 'https://status.acme.com', path: '/status', category: 'status_ops' },
    ],
  });

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, surface, []);

  const secTxt = eps.find(ep => ep.surface_url === 'https://acme.com/.well-known/security.txt');
  assert(!!secTxt, 'should discover security.txt');
  assertEqual(secTxt?.surface_type, 'SECURITY_TXT', 'security.txt classification');

  const statusPage = eps.find(ep => ep.surface_url === 'https://status.acme.com');
  // The security status page may come from evidence or discovered pages
  const statusEps = eps.filter(ep => ep.surface_type === 'SECURITY_STATUS_PAGE' && ep.hostname === 'status.acme.com');
  assert(statusEps.length > 0, 'should discover status page from security surfaces');
}

// ── TEST 8: Attribution — every entry point must have evidence links ─────────

function testAttributionEvidenceLinks(): void {
  console.log('  TEST: attribution evidence links');

  const evidence = [
    makeEvidence('ev_1', { public_url: 'https://acme.com/', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_2', { public_url: 'https://acme.com/api/v1', source_type: 'API_ENDPOINT' as any, status: 200 }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  for (const ep of eps) {
    assert(
      ep.attribution.attribution_evidence_ids.length > 0,
      `entry point ${ep.entry_point_id} should have attribution evidence IDs`
    );
    assert(
      ep.attribution.attribution_confidence === 'HIGH' || ep.attribution.attribution_confidence === 'MEDIUM',
      `entry point ${ep.entry_point_id} should have valid attribution confidence`
    );
  }
}

// ── TEST 9: No hostname-in-HTML treated as org-owned (no bare hostname claims) ─

function testNoHostnameGuesses(): void {
  console.log('  TEST: no hostname guesses from HTML content');

  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://acme.com/',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
      raw_observation: '<a href="https://random-site.com">Partner</a><a href="https://cdn.jsdelivr.net/npm/react@18">React</a>',
      evidence_text: 'Homepage references external links',
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  // None of the discovered entry points should be for random-site.com or jsdelivr.net
  const foreignEps = eps.filter(ep => !ep.hostname.includes('acme.com'));
  assert(foreignEps.length === 0, 'should not discover entry points for foreign hostnames');
}

// ── TEST 10: URL normalization (strip tracking params, fragments) ─────────────

function testUrlNormalization(): void {
  console.log('  TEST: URL normalization');

  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://acme.com/login?utm_source=email&utm_medium=click&token=abc#section',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
    }),
    makeEvidence('ev_2', {
      public_url: 'https://acme.com?utm_campaign=launch&gclid=test123',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  const loginEp = eps.find(ep => ep.surface_url.includes('/login'));
  assert(!!loginEp, 'should find login entry point');
  assert(
    !loginEp!.surface_url.includes('utm_'),
    'tracking params should be stripped from surface URL'
  );
  assert(
    !loginEp!.surface_url.includes('#'),
    'fragment should be stripped from surface URL'
  );

  const canonicalEp = eps.find(ep => ep.surface_type === 'DOMAIN_CANONICAL');
  if (canonicalEp) {
    assert(
      !canonicalEp.surface_url.includes('utm_'),
      'tracking params should be stripped from canonical URL'
    );
  }
}

// ── TEST 11: Graph builder — relationship edges ──────────────────────────────

function testGraphBuilder(): void {
  console.log('  TEST: graph builder relationship edges');

  const evidence = [
    makeEvidence('ev_1', { public_url: 'https://acme.com/', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_2', { public_url: 'https://acme.com/login', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_3', { public_url: 'https://api.acme.com/v1', source_type: 'API_ENDPOINT' as any, status: 200 }),
    makeEvidence('ev_4', { public_url: 'https://acme.com/docs/api', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  const graphBuilder = new EntryPointGraphBuilder();
  const graph = graphBuilder.build(eps);

  assert(graph.nodes.length === eps.length, 'graph should have one node per entry point');
  assert(graph.edges.length > 0, 'should have at least one edge in the graph');

  // Check for BELONGS_TO relationship from api subdomain to canonical domain
  const belongsToEdges = graph.edges.filter(e => e.relationship === 'BELONGS_TO');
  assert(belongsToEdges.length > 0, 'should have BELONGS_TO edges from subdomains to canonical domain');

  // Verify reverse relations are attached
  attachRelationsToAnchors(eps, graph);
  const canonicalEp = eps.find(ep => ep.surface_type === 'DOMAIN_CANONICAL' || ep.semantic_roles?.includes('DOMAIN_CANONICAL'));
  const hasRelations = !!canonicalEp && canonicalEp.relationships.some(r => r.relationship === 'BELONGS_TO' || r.relationship === 'HOSTS');
  assert(hasRelations, 'canonical domain should have relationships attached');
}

// ── TEST 12: Change detection — new, removed, changed ────────────────────────

function testChangeDetection(): void {
  console.log('  TEST: change detection across runs');

  const evidence = [
    makeEvidence('ev_1', { public_url: 'https://acme.com/', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_2', { public_url: 'https://api.acme.com/v1', source_type: 'API_ENDPOINT' as any, status: 200 }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  // Baseline run
  const baseline = discovery.discover(evidence, makeSurface(), []);

  // New run: added a login page, removed the API, changed homepage status
  const newEvidence = [
    makeEvidence('ev_1', { public_url: 'https://acme.com/', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_3', { public_url: 'https://acme.com/login', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
  ];
  const current = discovery.discover(newEvidence, makeSurface(), []);

  const changes = EntryPointChangeDetector.detect(current, baseline);

  const newChanges = changes.filter(c => c.change_type === 'NEW');
  const removedChanges = changes.filter(c => c.change_type === 'REMOVED');

  // Login should be new, API should be removed
  assert(newChanges.length > 0, 'should detect at least 1 new entry point');
  assert(removedChanges.length > 0, 'should detect at least 1 removed entry point');

  // Check that the new entry point has the right surface URL
  const loginNew = newChanges.find(c => c.surface_url === 'https://acme.com/login');
  assert(!!loginNew, 'should detect login as NEW entry point');
}

// ── TEST 13: Telemetry computation ────────────────────────────────────────────

function testTelemetryComputation(): void {
  console.log('  TEST: telemetry computation');

  const evidence = [
    makeEvidence('ev_1', { public_url: 'https://acme.com/', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any, tested_without_auth: true }),
    makeEvidence('ev_2', { public_url: 'https://api.acme.com/v1', source_type: 'API_ENDPOINT' as any, status: 200, tested_without_auth: true }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);
  const telemetry = EntryPointChangeDetector.computeTelemetry(eps);

  assert(telemetry.total_discovered > 0, 'total_discovered should be > 0');
  assert(telemetry.total_attributed > 0, 'total_attributed should be > 0');
  assert(Object.keys(telemetry.by_surface_type).length > 0, 'by_surface_type should be populated');
  assert(Object.keys(telemetry.by_discovery_source).length > 0, 'by_discovery_source should be populated');
}

// ── TEST 14: Canonicalization — no tracking URL variants as separate endpoints ─

function testNoTrackingUrlVariants(): void {
  console.log('  TEST: no tracking URL variants as separate endpoints');

  const evidence = [
    makeEvidence('ev_1', { public_url: 'https://acme.com/', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_2', { public_url: 'https://acme.com/?utm_source=twitter', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_3', { public_url: 'https://acme.com/?gclid=abc123', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  // After normalization, all the homepage URLs should map to the same entry point
  const homepageEps = eps.filter(ep =>
    ep.surface_type === 'WEBSITE_HOMEPAGE' &&
    ep.surface_url === 'https://acme.com/'
  );
  assert(homepageEps.length >= 1, 'should have at least one homepage entry point');
  assert(homepageEps.length <= 1, 'tracking URL variants should not create duplicate endpoints');
}

// ── TEST 15: Cloud reference — not treated as org-owned ───────────────────────

function testCloudReferenceNonOwnership(): void {
  console.log('  TEST: cloud reference not treated as org-owned');

  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://acme.com/',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
      raw_observation: 'Our assets are stored on https://s3.amazonaws.com/acme-assets and served via https://cdn.acme.com.',
      evidence_text: 'Documentation mentions AWS S3 bucket',
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  // Cloud references should be discovered but NOT attributed as org-owned
  const cloudEps = eps.filter(ep => ep.surface_type === 'CLOUD_PUBLIC_REFERENCE');
  assert(cloudEps.length > 0, 'should discover cloud reference from documentation');

  for (const cloudEp of cloudEps) {
    assert(
      cloudEp.attribution.attribution_confidence !== 'HIGH' ||
      cloudEp.attribution.attribution_evidence_ids.length > 0,
      'cloud reference should always have evidence linking it (never bare hostname)'
    );
    assert(
      cloudEp.verification_eligibility.eligible === false ||
      cloudEp.verification_eligibility.can_verify.length === 0 ||
      cloudEp.status === 'VERIFIED_BEHAVIOR' ||
      cloudEp.status === 'PUBLICLY_OBSERVABLE',
      'cloud reference should not be eligible for independent verification as ownership'
    );
  }
}

// ── TEST 16: No fragment-as-endpoint ─────────────────────────────────────────

function testNoFragmentAsEndpoint(): void {
  console.log('  TEST: no fragment-as-endpoint');

  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://acme.com/docs/getting-started',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
      raw_observation: '<a href="#api-section">API</a><a href="#authentication">Auth</a>',
      evidence_text: 'Documentation has fragment links',
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  // No entry point should be a bare fragment
  for (const ep of eps) {
    assert(
      !ep.surface_url.startsWith('#') && !ep.surface_url.includes('#'),
      `entry point ${ep.entry_point_id} should not be a fragment: ${ep.surface_url}`
    );
  }
}

// ── TEST 17: Verification eligibility ─────────────────────────────────────────

function testVerificationEligibility(): void {
  console.log('  TEST: verification eligibility');

  const evidence = [
    makeEvidence('ev_public', {
      public_url: 'https://acme.com/',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
      tested_without_auth: true,
      repeatable: true,
    }),
    makeEvidence('ev_auth', {
      public_url: 'https://acme.com/admin',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 403,
      tested_without_auth: true,
    }),
    makeEvidence('ev_doc', {
      public_url: 'https://acme.com/docs',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
      tested_without_auth: false,
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  for (const ep of eps) {
    // Verification eligibility should have meaningful content
    const ve = ep.verification_eligibility;
    assert(
      typeof ve.eligible === 'boolean',
      `verification eligibility should be boolean for ${ep.entry_point_id}`
    );
    assert(
      Array.isArray(ve.can_verify) || Array.isArray(ve.requires_auth) || Array.isArray(ve.cannot_verify),
      `verification eligibility should have at least one check array for ${ep.entry_point_id}`
    );
  }
}

// ── TEST 18: Adaptive pivot surfaces (when enabled) ───────────────────────────

function testAdaptivePivotSurfaces(): void {
  console.log('  TEST: adaptive pivot surfaces');

  const evidence = [
    makeEvidence('ev_1', { public_url: 'https://acme.com/', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_2', {
      public_url: 'https://api.acme.com/v2',
      source_type: 'API_ENDPOINT' as any,
      status: 200,
      evidence_origin: 'REAL_PUBLIC_OBSERVATION' as any,
      observation_type: 'ADAPTIVE_INVESTIGATION_PIVOT',
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
    includeAdaptive: true,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  const adaptiveEps = eps.filter(ep =>
    ep.discovery_source.includes('ADAPTIVE_PIVOT' as any)
  );
  assert(adaptiveEps.length > 0, 'should discover adaptive pivot entry point when includeAdaptive=true');
}

// ── TEST 19: No adaptive pivots when disabled ─────────────────────────────────

function testNoAdaptiveWhenDisabled(): void {
  console.log('  TEST: no adaptive surfaces when disabled');

  const evidence = [
    makeEvidence('ev_1', { public_url: 'https://acme.com/', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
    makeEvidence('ev_2', {
      public_url: 'https://api.acme.com/v2',
      source_type: 'API_ENDPOINT' as any,
      status: 200,
      evidence_origin: 'REAL_PUBLIC_OBSERVATION' as any,
      observation_type: 'ADAPTIVE_INVESTIGATION_PIVOT',
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
    includeAdaptive: false,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  const adaptiveEps = eps.filter(ep =>
    ep.discovery_source.includes('ADAPTIVE_PIVOT' as any)
  );
  assert(adaptiveEps.length === 0, 'should NOT discover adaptive pivot when includeAdaptive=false');
}

// ── TEST 20: Evidence-backed entry points only ──────────────────────────────

function testOnlyEvidenceBacked(): void {
  console.log('  TEST: only evidence-backed entry points');

  const evidence = [
    makeEvidence('ev_1', { public_url: 'https://acme.com/', status: 200, source_type: 'PUBLIC_DOCUMENTATION' as any }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  // Every entry point must have at least one evidence ID
  for (const ep of eps) {
    assert(
      ep.evidence_ids.length > 0 || ep.discovery_source.includes('ADAPTIVE_PIVOT'),
      `entry point ${ep.entry_point_id} (${ep.surface_url}) must have evidence IDs`
    );

    // Attribution must have evidence
    assert(
      ep.attribution.attribution_evidence_ids.length > 0,
      `entry point ${ep.entry_point_id} must have attribution evidence`
    );
  }
}

// ── Helper ───────────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    const params = new URLSearchParams(u.search);
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', '_gl', '_ga', 'fbclid', 'gclid']) {
      params.delete(k);
    }
    u.search = params.toString();
    return u.toString();
  } catch {
    return url;
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('==================================================');
  console.log('VARDHAN — ENTRY POINT INTELLIGENCE REGRESSION TESTS');
  console.log('==================================================');
  console.log('');

  const tests = [
    testCanonicalDomainDiscovery,
    testSubdomainDiscovery,
    testWebSurfaceClassification,
    testApiSurfaceClassification,
    testIdentitySurfaceDiscovery,
    testClientSideDiscovery,
    testSecuritySurfaceDiscovery,
    testAttributionEvidenceLinks,
    testNoHostnameGuesses,
    testUrlNormalization,
    testGraphBuilder,
    testChangeDetection,
    testTelemetryComputation,
    testNoTrackingUrlVariants,
    testCloudReferenceNonOwnership,
    testNoFragmentAsEndpoint,
    testVerificationEligibility,
    testAdaptivePivotSurfaces,
    testNoAdaptiveWhenDisabled,
    testOnlyEvidenceBacked,
  ];

  for (const test of tests) {
    test();
    console.log('');
  }

  console.log('==================================================');
  console.log(`Tests Run:    ${testsRun}`);
  console.log(`Tests Passed: ${testsPassed}`);
  console.log(`Tests Failed: ${testsFailed}`);
  console.log('==================================================');

  if (testsFailed > 0) {
    console.error('\n❌ ENTRY POINT INTELLIGENCE TESTS FAILED');
    expect(testsFailed).toBe(0);
  } else {
    console.log('\n✅ ALL ENTRY POINT INTELLIGENCE TESTS PASSED');
  }
}

await main();
  expect(testsFailed).toBe(0);
  });
});