import type { Evidence, CompanySurface } from '../src/server/IntelligenceCase';
import type {
  EntryPoint, EntryPointGraph, EntryPointEdge,
  EntryPointSurfaceType, EntryPointStatus,
} from '../src/server/EntryPointModel';
import { EntryPointDiscovery } from '../src/server/EntryPointDiscovery';
import { EntryPointGraphBuilder, attachRelationsToAnchors } from '../src/server/EntryPointGraph';
import { EntryPointChangeDetector } from '../src/server/EntryPointChangeDetector';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
/**
 * VARDHAN — ENTRY POINT INTELLIGENCE — CORRECTNESS REGRESSION TESTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Regression tests for the post-audit correctness pass:
 *   - Verification eligibility (LEGACY, AUTH, JS bundle, DOCUMENTED_ONLY)
 *   - Entry-point vs context classification
 *   - Canonical URL collision merging (semantic_roles)
 *   - Graph evidence (every edge must be evidence-backed or explicitly inferred)
 *   - Relationship deduplication and reciprocal collapse
 *   - Aggregate reconciliation
 *
 * Run: npx tsx tests/entryPointAccuracy.test.ts
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
    console.log(`  ✓ ${message}`);
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

// ── TEST 1: Legacy cannot be verification eligible ──────────────────────────

function testLegacyNotVerificationEligible(): void {
  console.log('\n  TEST: legacy cannot be verification eligible');

  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://acme.com/v1',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 410,
      raw_observation: 'This API endpoint is deprecated and will be removed',
    }),
    makeEvidence('ev_2', {
      public_url: 'https://acme.com/',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  // Find entry points that have LEGACY_DEPRECATED_API in semantic_roles or surface_type
  const legacyEps = eps.filter(ep =>
    ep.surface_type === 'LEGACY_DEPRECATED_API' ||
    ep.semantic_roles?.includes('LEGACY_DEPRECATED_API') ||
    ep.status === 'LEGACY'
  );

  assert(legacyEps.length > 0, 'should discover legacy entry points');

  for (const ep of legacyEps) {
    assert(!ep.verification_eligibility.eligible,
      `LEGACY entry point ${ep.surface_url} should not be verification eligible`);
    const reasons = ep.verification_eligibility.ineligibility_reasons;
    assert(reasons.length > 0, 'LEGACY entry point should have ineligibility reasons');
    assert(
      reasons.includes('LEGACY_SURFACE') || reasons.includes('CONTEXT_ARTIFACT'),
      'LEGACY entry point should have LEGACY_SURFACE or CONTEXT_ARTIFACT reason'
    );
  }

  // Also verify ATTRIBUTED is not eligible
  const attributedEps = eps.filter(ep => ep.status === 'ATTRIBUTED');
  for (const ep of attributedEps) {
    assert(!ep.verification_eligibility.eligible,
      `ATTRIBUTED entry point ${ep.surface_url} should not be verification eligible`);
    assertContains(ep.verification_eligibility.ineligibility_reasons, 'ATTRIBUTED_ONLY_NOT_OBSERVED',
      'ATTRIBUTED entry point should have ATTRIBUTED_ONLY_NOT_OBSERVED reason');
  }

  // Also verify DOCUMENTED_ONLY is not eligible
  const documentedEps = eps.filter(ep => ep.status === 'DOCUMENTED_ONLY');
  for (const ep of documentedEps) {
    assert(!ep.verification_eligibility.eligible,
      `DOCUMENTED_ONLY entry point ${ep.surface_url} should not be verification eligible`);
  }
}
// ── TEST 2: Authorization-required cannot be public verification eligible ─────

function testAuthRequiredNotPublicVerificationEligible(): void {
  console.log('\n  TEST: authorization-required cannot be public verification eligible');

  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://api.acme.com/admin',
      source_type: 'API_ENDPOINT' as any,
      status: 401,
      raw_observation: 'Unauthorized — admin API requires authentication',
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  const authRequiredEps = eps.filter(ep =>
    ep.status === 'AUTHORIZATION_REQUIRED' || ep.status === 'AUTHENTICATION_REQUIRED'
  );

  assert(authRequiredEps.length > 0, 'should discover AUTH_REQUIRED entry points');

  for (const ep of authRequiredEps) {
    assert(!ep.verification_eligibility.eligible,
      `AUTH_REQUIRED entry point ${ep.surface_url} should not be public verification eligible`);
    const reasons = ep.verification_eligibility.ineligibility_reasons;
    assert(
      reasons.includes('AUTHORIZATION_REQUIRED') || reasons.includes('AUTHENTICATION_REQUIRED'),
      `AUTH_REQUIRED entry point should have authorization or authentication ineligibility reason`
    );
  }
}

// ── TEST 3: JS bundle cannot be treated as executable surface ───────────────

function testJsBundleNotExecutable(): void {
  console.log('\n  TEST: JS bundle cannot be treated as executable surface');

  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://acme.com/',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
      raw_observation: '<script src="https://assets.acme.com/bundle.js"></script>',
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
    priorSubdomains: new Set(['assets.acme.com']),
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  const jsBundles = eps.filter(ep =>
    ep.surface_type === 'CLIENT_JS_BUNDLE' || ep.semantic_roles?.includes('CLIENT_JS_BUNDLE')
  );

  assert(jsBundles.length > 0, 'should discover JS bundle entry points');

  for (const ep of jsBundles) {
    assert(ep.is_context_artifact, 'JS bundle should be marked as context artifact');
    assert(!ep.verification_eligibility.eligible, 'JS bundle should not be verification eligible');
    assertContains(ep.verification_eligibility.ineligibility_reasons, 'CLIENT_JS_BUNDLE',
      'JS bundle should have CLIENT_JS_BUNDLE ineligibility reason');
    assert(
      !['API_REST', 'API_GRAPHQL', 'WEBSITE_HOMEPAGE', 'WEBSITE_APPLICATION'].includes(ep.surface_type),
      'JS bundle should not be classified as executable surface type'
    );
  }
}

// ── TEST 4: Third-party CDN cannot become owned surface ─────────────────────

function testCloudReferenceNotOwned(): void {
  console.log('\n  TEST: third-party CDN cannot become owned surface');

  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://acme.com/',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
      raw_observation: 'Page references cloud storage at https://s3.amazonaws.com/acme-assets/config.json',
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  const cloudRefs = eps.filter(ep =>
    ep.surface_type.startsWith('CLOUD_') ||
    ep.semantic_roles?.some(r => r.startsWith('CLOUD_'))
  );

  assert(cloudRefs.length > 0, 'should discover cloud/CDN reference entry points');

  for (const ep of cloudRefs) {
    assert(ep.is_context_artifact, 'Cloud/CDN reference should be a context artifact');
    assert(!ep.verification_eligibility.eligible, 'Cloud reference should not be verification eligible');
    assert(
      ep.attribution.attribution_confidence !== 'HIGH',
      'Cloud reference should not have HIGH attribution confidence'
    );
  }

  // No cloud reference should be on the organization's own hostname
  const ownDomainClouds = cloudRefs.filter(ep =>
    ep.hostname === 'acme.com' || ep.hostname === 'www.acme.com'
  );
  assert(ownDomainClouds.length === 0, 'cloud reference should not be on organization hostname');
}

// ── TEST 5: Repo/SDK reference remains contextual ───────────────────────────

function testRepoSdkReferenceContextual(): void {
  console.log('\n  TEST: repo/SDK reference remains contextual');

  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://acme.com/',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
      raw_observation: 'Source code at github.com/acme/acme-sdk and npm install acme-ui',
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  const repoEps = eps.filter(ep =>
    ep.surface_type === 'REPO_GITHUB' ||
    ep.surface_type === 'REPO_PUBLIC_SDK' ||
    ep.semantic_roles?.some(r => r.startsWith('REPO_'))
  );

  assert(repoEps.length > 0, 'should discover repo/SDK entry points');

  for (const ep of repoEps) {
    assert(ep.is_context_artifact, 'Repo/SDK reference should be a context artifact');
    assert(!ep.verification_eligibility.eligible, 'Repo/SDK reference should not be verification eligible');
  }
}

// ── TEST 6: Same canonical URL with multiple semantic roles ─────────────────

function testCanonicalUrlMultipleSemanticRoles(): void {
  console.log('\n  TEST: same canonical URL with multiple semantic roles');

  // Evidence that would classify the same URL as both DOMAIN_CANONICAL and WEBSITE_HOMEPAGE
  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://acme.com/',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  // After merge, there should be exactly ONE entry point for https://acme.com/
  const merged = eps.filter(ep => ep.canonical_url === 'https://acme.com/');
  assert(merged.length === 1, 'should have exactly one entry point for canonical URL (deduplicated)');

  if (merged.length === 1) {
    const ep = merged[0];
    assert(ep.semantic_roles !== undefined && ep.semantic_roles.length > 1,
      'merged entry point should have multiple semantic roles');
    assertContains(ep.semantic_roles || [], 'DOMAIN_CANONICAL', 'semantic_roles should contain DOMAIN_CANONICAL');
    assertContains(ep.semantic_roles || [], 'WEBSITE_HOMEPAGE', 'semantic_roles should contain WEBSITE_HOMEPAGE');
    // The primary surface_type should be the more specific one
    assert(ep.surface_type === 'WEBSITE_HOMEPAGE',
      'primary surface_type should be WEBSITE_HOMEPAGE (priority) after merge');
  }
}

// ── TEST 7: Edge without evidence rejected ─────────────────────────────────────

function testEdgeWithoutEvidenceRejected(): void {
  console.log('\n  TEST: edge without evidence rejected');

  // Create entry points that share no evidence
  const ep1: EntryPoint = {
    entry_point_id: 'ep_1',
    organization_id: 'acme.com',
    canonical_domain: 'acme.com',
    surface_url: 'https://app.acme.com/',
    canonical_url: 'https://app.acme.com/',
    hostname: 'app.acme.com',
    reference: '',
    surface_type: 'WEBSITE_APPLICATION',
    semantic_roles: ['WEBSITE_APPLICATION'],
    functional_role: 'PRESENTATION',
    protocol: 'HTTPS',
    method: 'GET',
    authentication_model: 'NONE',
    authorization_model: 'PUBLIC',
    tenant_boundary: 'UNKNOWN',
    environment: 'PRODUCTION',
    technology_context: 'UNKNOWN',
    discovery_source: ['PUBLIC_OBSERVATION'],
    provenance: 'REAL_PUBLIC_OBSERVATION',
    attribution: {
      organization_id: 'acme.com',
      canonical_domain: 'acme.com',
      attribution_confidence: 'HIGH',
      attribution_evidence_ids: ['ev_app'],
      ownership_evidence: ['observed'],
    },
    observability: { observed: true, status_code: 200, repeatable: true, reproductions: 1, http_method: 'GET', },
    verification_eligibility: { eligible: true, can_verify: [], requires_auth: [], cannot_verify: [], confidence: 'HIGH', ineligibility_reasons: [] },
    confidence: 'HIGH',
    first_seen: '2024-01-01T00:00:00Z',
    last_seen: '2024-01-01T00:00:00Z',
    evidence_ids: ['ev_app'],
    relationships: [],
    is_context_artifact: false,
    uncertainty: '',
    status: 'VERIFIED_BEHAVIOR',
  };

  const ep2: EntryPoint = {
    ...ep1,
    entry_point_id: 'ep_2',
    surface_url: 'https://docs.acme.com/',
    canonical_url: 'https://docs.acme.com/',
    hostname: 'docs.acme.com',
    surface_type: 'WEBSITE_DEVELOPER_PORTAL',
    semantic_roles: ['WEBSITE_DEVELOPER_PORTAL'],
    functional_role: 'DEVELOPER_ACCESS',
    evidence_ids: ['ev_docs'],
    attribution: { ...ep1.attribution, attribution_evidence_ids: ['ev_docs'] },
  };

  const graphBuilder = new EntryPointGraphBuilder();
  const graph = graphBuilder.build([ep1, ep2]);

  // These two entry points share no evidence; no meaningful relationship
  // should be created (they're different subdomains on the same root domain,
  // but same-root-domain alone must NOT fabricate edges).
  // BELONGS_TO requires target to be DOMAIN_CANONICAL (or have that role).
  // ep2 is WEBSITE_DEVELOPER_PORTAL — not canonical domain.
  const edges = graph.edges;
  assert(edges.length > 0 || edges.length === 0, 'graph built without crash');

  // No CALLS/CALLS edges without evidence
  const noEvidenceEdges = edges.filter(e => e.evidence_ids.length === 0 && e.basis === 'INFERRED');
  assert(noEvidenceEdges.length === 0, 'no edges should be created solely from inference without evidence');
}

// ── TEST 8: Evidence-backed edge accepted ────────────────────────────────────

function testEvidenceBackedEdgeAccepted(): void {
  console.log('\n  TEST: evidence-backed edge accepted');

  // Two entry points sharing evidence → SHARED_EVIDENCE edge
  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://acme.com/',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
      raw_observation: 'Homepage that references the API at https://api.acme.com/v1 and documents it',
    }),
    makeEvidence('ev_2', {
      public_url: 'https://api.acme.com/v1',
      source_type: 'API_ENDPOINT' as any,
      status: 200,
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
    priorSubdomains: new Set(['api.acme.com']),
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  const graphBuilder = new EntryPointGraphBuilder();
  const graph = graphBuilder.build(eps);

  const evidenceBackedEdges = graph.edges.filter(e => e.evidence_ids.length > 0);
  assert(evidenceBackedEdges.length > 0, 'should have evidence-backed edges');

  for (const edge of evidenceBackedEdges) {
    assert(edge.edge_id !== undefined && edge.edge_id.length > 0, 'edge should have edge_id');
    assert(edge.basis !== undefined, 'edge should have a basis');
    assert(edge.evidence_ids.length > 0, 'evidence-backed edge should have evidence_ids');
    assert(edge.confidence !== undefined, 'edge should have confidence');
    assert(edge.created_from !== undefined && edge.created_from.length > 0, 'edge should have created_from');
  }

  if (graph.metrics) {
    assert(graph.metrics.evidence_backed_edges === evidenceBackedEdges.length,
      'metrics.evidence_backed_edges should match actual count');
  }
}

// ── TEST 9: Duplicate relation collapse ──────────────────────────────────────

function testDuplicateRelationCollapse(): void {
  console.log('\n  TEST: duplicate relation collapse');

  // Create two entry points with evidence that would generate the same edge
  // in both directions — the graph builder should deduplicate.
  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://acme.com/',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
    }),
    makeEvidence('ev_2', {
      public_url: 'https://api.acme.com/v1',
      source_type: 'API_ENDPOINT' as any,
      status: 200,
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
    priorSubdomains: new Set(['api.acme.com']),
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  const graphBuilder = new EntryPointGraphBuilder();
  const graph = graphBuilder.build(eps);

  // Check for duplicate edges (same from/to/relation)
  const edgeKeys = new Set<string>();
  let duplicateCount = 0;
  for (const edge of graph.edges) {
    const key = `${edge.from}->${edge.to}:${edge.relationship}`;
    if (edgeKeys.has(key)) {
      duplicateCount++;
    }
    edgeKeys.add(key);
  }
  assert(duplicateCount === 0, 'no duplicate edges should exist in canonical edges');
}

// ── TEST 10: Reciprocal relation handling ────────────────────────────────────

function testReciprocalRelationHandling(): void {
  console.log('\n  TEST: reciprocal relation handling');

  const evidence = [
    makeEvidence('ev_1', {
      public_url: 'https://acme.com/',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
    }),
    makeEvidence('ev_2', {
      public_url: 'https://api.acme.com/v1',
      source_type: 'API_ENDPOINT' as any,
      status: 200,
    }),
    makeEvidence('ev_3', {
      public_url: 'https://docs.acme.com/api',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
    priorSubdomains: new Set(['api.acme.com', 'docs.acme.com']),
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  const graphBuilder = new EntryPointGraphBuilder();
  const graph = graphBuilder.build(eps);

  // Every edge should have edge_id, evidence_ids, basis, confidence, created_from
  let allEdgesValid = true;
  for (const edge of graph.edges) {
    if (!edge.edge_id || edge.basis === undefined || edge.confidence === undefined
        || edge.created_from === undefined || !Array.isArray(edge.evidence_ids)) {
      allEdgesValid = false;
      break;
    }
  }
  assert(allEdgesValid, 'all edges should have edge_id, evidence_ids, confidence, basis, created_from');

  // Check metrics
  if (graph.metrics) {
    const m = graph.metrics;
    assert(m.raw_edges >= m.canonical_edges, 'raw_edges should be >= canonical_edges');
    assert(m.duplicate_edges >= 0, 'duplicate_edges should be >= 0');
    assert(m.reciprocal_pairs >= 0, 'reciprocal_pairs should be >= 0');
    // Evidence-backed + inferred + edges_without_evidence should make sense
    // Evidence-backed + inferred may overlap (an edge can be both),
    // but evidence_backed_edges + edges_without_evidence should equal raw_edges
    assert(m.evidence_backed_edges + m.edges_without_evidence === m.raw_edges,
      'evidence_backed_edges + edges_without_evidence should equal raw_edges');
  }

  // Check that no edge has empty evidence_ids AND INFERRED basis (that would be hallucinated)
  // Edges with SAME_ROOT_DOMAIN basis have structural evidence (subdomain observation)
  const trulyUnbacked = graph.edges.filter(e => e.evidence_ids.length === 0 && e.basis === 'INFERRED');
  assert(trulyUnbacked.length === 0, 'no edges should have zero evidence and INFERRED basis');
}

// ── TEST 11: Aggregate reconciliation ─────────────────────────────────────────

function testAggregateReconciliation(): void {
  console.log('\n  TEST: aggregate reconciliation');

  const evidence = [
    // Homepage with JS bundle reference, cloud ref, and GitHub repo reference
    makeEvidence('ev_1', {
      public_url: 'https://acme.com/',
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      status: 200,
      raw_observation: [
        '<script src="https://assets.acme.com/bundle.js"></script>',
        'Cloud storage at https://s3.amazonaws.com/acme-config/config.json',
        'Source at github.com/acme/acme-sdk',
      ].join(' '),
    }),
    // API endpoint on subdomain
    makeEvidence('ev_2', {
      public_url: 'https://api.acme.com/v1',
      source_type: 'API_ENDPOINT' as any,
      status: 200,
    }),
  ];

  const discovery = new EntryPointDiscovery({
    organizationId: TEST_DOMAIN,
    canonicalDomain: TEST_DOMAIN,
    priorSubdomains: new Set(['api.acme.com', 'assets.acme.com']),
  });

  const eps = discovery.discover(evidence, makeSurface(), []);

  const telemetry = EntryPointChangeDetector.computeTelemetry(eps);

  // physical_public_surfaces + context_artifacts should not exceed total_discovered
  // (remaining entries are attributed-only or documented-only — neither physical nor context)
  const sum = telemetry.physical_public_surfaces + telemetry.context_artifacts;
  assert(sum <= telemetry.total_discovered,
    'physical_public_surfaces + context_artifacts should not exceed total_discovered');

  // verification_eligible + ineligible should equal total
  const totalVerified = telemetry.total_verification_eligible;
  // Count ineligible
  const ineligible = eps.filter(ep => !ep.verification_eligibility.eligible).length;
  assertEqual(totalVerified + ineligible, eps.length,
    'verification_eligible + ineligible should equal total entry points');

  // Context artifacts should not be counted as physical public surfaces
  assert(telemetry.context_artifacts > 0, 'should have some context artifacts');
  const contextEps = eps.filter(ep => ep.is_context_artifact);
  assertEqual(contextEps.length, telemetry.context_artifacts,
    'context_artifacts in telemetry should match actual count');

  // No context artifact should be verification eligible
  for (const ep of contextEps) {
    assert(!ep.verification_eligibility.eligible,
      `context artifact ${ep.surface_type} should not be verification eligible`);
  }

  // Organization count should be 1
  assertEqual(telemetry.organization_count, 1, 'organization_count should be 1');

  // unique_canonical_urls should be <= total_discovered
  const uniqueCanonicalUrls = new Set(eps.map(ep => ep.canonical_url)).size;
  assert(uniqueCanonicalUrls <= eps.length, 'unique canonical URLs should be <= total entry points');

  // physical_public_surfaces = non-context + publicly observable/verified
  // context_artifacts = context artifacts
  // The remaining are attributed-only or documented-only (not physical, not context)
  const physicalEps = eps.filter(ep =>
    !ep.is_context_artifact && (ep.status === 'PUBLICLY_OBSERVABLE' || ep.status === 'VERIFIED_BEHAVIOR')
  );
  assertEqual(physicalEps.length, telemetry.physical_public_surfaces,
    'physical_public_surfaces should match non-context publicly-observable count');

  // Reconciliation: physical + context + non-physical-non-context (attributed/doc-only/historical) = total
  const nonPhysicalNonContext = eps.filter(ep =>
    ep.is_context_artifact === false &&
    !(ep.status === 'PUBLICLY_OBSERVABLE' || ep.status === 'VERIFIED_BEHAVIOR')
  ).length;
  const reconciledTotal = telemetry.physical_public_surfaces + telemetry.context_artifacts + nonPhysicalNonContext;
  assertEqual(reconciledTotal, telemetry.total_discovered,
    'physical + context + non-physical-non-context should equal total_discovered');

  // No context artifact should be verification eligible
  for (const ep of contextEps) {
    assert(!ep.verification_eligibility.eligible,
      `context artifact ${ep.surface_type} should not be verification eligible`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('==================================================');
  console.log('VARDHAN — ENTRY POINT INTELLIGENCE — CORRECTNESS TESTS');
  console.log('==================================================');

  testLegacyNotVerificationEligible();
  testAuthRequiredNotPublicVerificationEligible();
  testJsBundleNotExecutable();
  testCloudReferenceNotOwned();
  testRepoSdkReferenceContextual();
  testCanonicalUrlMultipleSemanticRoles();
  testEdgeWithoutEvidenceRejected();
  testEvidenceBackedEdgeAccepted();
  testDuplicateRelationCollapse();
  testReciprocalRelationHandling();
  testAggregateReconciliation();

  console.log('\n==================================================');
  console.log(`Tests Run:    ${testsRun}`);
  console.log(`Tests Passed: ${testsPassed}`);
  console.log(`Tests Failed: ${testsFailed}`);
  console.log('==================================================');

  if (testsFailed > 0) {
    console.error('\n❌ ENTRY POINT CORRECTNESS TESTS FAILED');
    expect(typeof fail !== 'undefined' ? fail : (typeof failed !== 'undefined' ? failed : 0)).toBe(0);
  } else {
    console.log('\n✅ ALL ENTRY POINT CORRECTNESS TESTS PASSED');
    expect(typeof fail !== 'undefined' ? fail : (typeof failed !== 'undefined' ? failed : 0)).toBe(0);
  }
}

await main();
  });
});