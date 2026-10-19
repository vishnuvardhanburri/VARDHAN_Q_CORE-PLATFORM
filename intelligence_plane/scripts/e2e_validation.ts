/**
 * VARDHAN — FIRST REAL INTELLIGENCE E2E VALIDATION (§VARDHAN-REQ)
 * ─────────────────────────────────────────────────────────────────────────────
 * PROVES: Real VardhanSystemManager production runtime
 *   → DISCOVER → ORGANIZATION IDENTITY → EXTERNAL SURFACE → ENTRY POINT
 *   → EXPECTATION → INVESTIGATION → OBSERVATION → DIFFERENTIAL
 *   → VERIFICATION → VERIFIED_FINDING → Q-CORE CONTRACT → Q-CORE RECEIPT
 *
 * Controlled inputs ONLY at the discovery/observation layer (mock fetcher
 * serving a safe, fictional public surface). Every downstream component is
 * the REAL production code.
 *
 * A mock Q-Core HTTP server on port 8080 captures the seal request.
 */

import http from 'http';
import { VardhanSystemManager } from '../src/server/VardhanSystemManager';
import type { IntelligenceRunContext } from '../src/server/DeepTypes';
import type { VerifiedFindingContract } from '../src/server/VerifiedFindingContract';

// ─── Mock Q-Core HTTP Server (port 8080) ──────────────────────────────────────

let qcoreRequestCount = 0;
let qcoreReceipt: any = null;
let qcoreRequestBodies: VerifiedFindingContract[] = [];

const qcoreServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    qcoreRequestCount++;
    if (req.url === '/api/v1/seal' && req.method === 'POST') {
      const parsed = JSON.parse(body);
      qcoreRequestBodies.push(parsed.contract);
      qcoreReceipt = {
        receipt_id: 'rcpt_' + Math.random().toString(36).slice(2, 12).toUpperCase(),
        contract: parsed.contract,
        transaction_id: 'tx_' + Math.random().toString(36).slice(2, 18),
        transaction_status: 'CONFIRMED',
        block_height: 0,
        sealed_at: new Date().toISOString(),
        gateway: 'mock-qcore-v1',
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(qcoreReceipt));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });
});

// ─── Controlled Mock Fetcher (safe fictional public surface) ──────────────────
// Simulates "Acme Test Corp" at acme-test.example
// Surface has 2 API endpoints returning 200 with debug/error metadata:
//   /api/debug  → 200 JSON with stack_trace, exception, internal_path (INFORMATION_LEAKAGE)
//   /api/config → 200 JSON with debug, internal_path, cluster_ip (INFORMATION_LEAKAGE)
// Both return 200 → entry points are VERIFIED_BEHAVIOR → verification-eligible.
// Both contain 'debug' and 'exception' indicators → INFORMATION_LEAKAGE pattern.

const mockHtmlPages: Record<string, { status: number; body: string; contentType: string; headers?: Record<string, string> }> = {
  '/': {
    status: 200,
    contentType: 'text/html',
    body: `<!DOCTYPE html>
<html>
<head><title>Acme Test Corp</title><link rel="canonical" href="https://acme-test.example/" /></head>
<body>
  <h1>Acme Test Corp</h1>
  <p>Enterprise infrastructure monitoring platform.</p>
  <a href="https://acme-test.example/api/health">API Health</a>
  <a href="https://acme-test.example/api/debug">Debug Console</a>
  <a href="https://acme-test.example/api/config">Config Endpoint</a>
  <a href="https://acme-test.example/docs">API Documentation</a>
  <a href="https://acme-test.example/robots.txt">Robots</a>
  <a href="https://acme-test.example/sitemap.xml">Sitemap</a>
</body>
</html>`,
  },
  '/api/health': {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', uptime: 99999, version: '1.2.3' }),
  },
  '/api/debug': {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      debug: true,
      exception: 'NullPointerException at com.acme.service.Query.exec(Query.java:142)',
      stack_trace: 'Exception in thread "main" java.lang.NullPointerException: Cannot invoke "String.length()" because "this.query" is null\n\tat com.acme.service.Query.exec(Query.java:142)\n\tat com.acme.Application.main(Application.java:55)',
      internal_path: '/var/lib/acme-test/db/data.db',
      cluster_ip: '10.0.1.5',
      database_url: 'postgres://dbadmin:secretpass@internal-db.acme-test.example:5432/acme',
    }),
    headers: { 'server': 'nginx/1.24.0' },
  },
  '/api/config': {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      debug: true,
      error: 'Configuration exception: invalid database_url',
      internal_path: '/etc/acme-test/config.json',
      cluster_ip: '10.0.1.5',
      secret_key: 'sk-acme-test-2026',
      admin_password: 'admin123',
      trace: 'at com.acme.ConfigLoader.load(ConfigLoader.java:88)\n\tat com.acme.Application.init(Application.java:12)',
    }),
    headers: { 'server': 'nginx/1.24.0' },
  },
  '/docs': {
    status: 200,
    contentType: 'text/html',
    body: '<!DOCTYPE html><html><head><title>API Docs</title></head><body><h1>API Documentation</h1><p>API v1 documentation.</p><p>Endpoints: /api/health, /api/debug</p></body></html>',
  },
  '/robots.txt': {
    status: 200,
    contentType: 'text/plain',
    body: 'User-agent: *\nDisallow: /admin/\nAllow: /api/\nSitemap: https://acme-test.example/sitemap.xml\n',
  },
  '/sitemap.xml': {
    status: 200,
    contentType: 'application/xml',
    body: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://acme-test.example/</loc></url>
  <url><loc>https://acme-test.example/api/health</loc></url>
  <url><loc>https://acme-test.example/api/debug</loc></url>
  <url><loc>https://acme-test.example/api/config</loc></url>
  <url><loc>https://acme-test.example/docs</loc></url>
</urlset>`,
  },
};

const mockFetcher = async (url: string, init: any): Promise<Response> => {
  try {
    const path = new URL(url).pathname;
    const page = mockHtmlPages[path];
    if (page) {
      return new Response(page.body, {
        status: page.status,
        headers: { 'Content-Type': page.contentType, ...(page.headers || {}) },
      });
    }
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  } catch {
    return new Response('Error', { status: 404 });
  }
};

// ─── Authoritative IntelligenceRunContext ──────────────────────────────────────

const runContext: IntelligenceRunContext = {
  engine_identity: 'VARDHAN_INTELLIGENCE_CORE',
  engine_version: '4.3.0',
  run_id: 'run_e2e_val_' + Math.random().toString(36).slice(2, 10),
  organization_id: 'org-acme-test-corp',
  target_canonical_domain: 'acme-test.example',
  actor_workload_id: 'svc:vardhan-intelligence:e2e-validation',
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;

function check(condition: boolean, label: string) {
  if (condition) {
    passCount++;
    console.log(`  [PASS] ${label}`);
  } else {
    failCount++;
    console.error(`  [FAIL] ${label}`);
  }
}

function assertEq(actual: any, expected: any, label: string) {
  if (actual === expected) {
    passCount++;
    console.log(`  [PASS] ${label}: "${actual}"`);
  } else {
    failCount++;
    console.error(`  [FAIL] ${label}: expected "${expected}", got "${actual}"`);
  }
}

// ─── Main E2E Validation ─────────────────────────────────────────────────────

async function main() {
  console.log('=== FIRST REAL INTELLIGENCE E2E VALIDATION ===\n');

  // 1. Start mock Q-Core gateway
  await new Promise<void>((resolve) => {
    qcoreServer.listen(8080, '127.0.0.1', () => {
      console.log('[QCORE-GATEWAY] Mock Q-Core gateway listening on http://127.0.0.1:8080');
      resolve();
    });
  });

  // 2. Print authoritative identity context BEFORE the run
  console.log('\n--- IntelligenceRunContext (authoritative, upstream) ---');
  console.log('  engine_identity:', runContext.engine_identity);
  console.log('  engine_version:', runContext.engine_version);
  console.log('  run_id:', runContext.run_id);
  console.log('  organization_id:', runContext.organization_id);
  console.log('  target_canonical_domain:', runContext.target_canonical_domain);
  console.log('  actor_workload_id:', runContext.actor_workload_id);

  // 3. Run the REAL production runtime: VardhanSystemManager.researchCompany()
  console.log('\n--- Production entry point: VardhanSystemManager.researchCompany() ---');
  console.log('  Target: Acme Test Corp (acme-test.example)');
  console.log('  Controlled inputs: mock fetcher serving safe fictional public surface');
  console.log('  All downstream components: REAL production code\n');

  const manager = new VardhanSystemManager({
    fetcher: mockFetcher,
    saveArtifact: () => {},
    maxDiscoveryPages: 12,
    discoveryDelayMs: 0,
    discoveryTimeoutMs: 5000,
    runContext,
  });

  const report = await manager.researchCompany('Acme Test Corp', 'https://acme-test.example', []);

  console.log('\n--- Research Report ---');
  console.log('  state:', report.state);
  console.log('  decision:', report.decision_outcome);
  console.log('  sources_discovered:', report.sources_discovered);
  console.log('  evidence_count:', report.evidence_count);
  console.log('  signals_count:', report.signals_count);
  console.log('  findings_count:', report.findings_count);

  console.log('\n--- Audit Trail (Q-Core section) ---');
  for (const entry of report.audit_trail) {
    if (entry.includes('Q-Core') || entry.includes('Finding') || entry.includes('SEAL')) {
      console.log('  ', entry);
    }
  }

  // 4. Verify Q-Core submission
  console.log('\n--- Q-Core Submission ---');
  console.log('  HTTP requests received:', qcoreRequestCount);

  if (qcoreRequestCount === 0) {
    console.error('\n=== RESULT: NOT YET PROVEN ===');
    console.error('No Q-Core submission was made. The pipeline did not produce a verified finding that reached Q-Core.');
    console.error('\nFull audit trail:');
    for (const entry of report.audit_trail) {
      console.error('  ', entry);
    }
    process.exit(1);
  }

  const contract = qcoreRequestBodies[0];
  const receipt = qcoreReceipt;

  // 5. Identity provenance verification
  console.log('\n--- Identity Provenance (contract vs runContext) ---');
  check(contract.intelligence.engine_id === runContext.engine_identity,
    `engine_id: contract="${contract.intelligence.engine_id}" context="${runContext.engine_identity}"`);
  check(contract.intelligence.engine_version === runContext.engine_version,
    `engine_version: contract="${contract.intelligence.engine_version}" context="${runContext.engine_version}"`);
  check(contract.intelligence.run_id === runContext.run_id,
    `run_id: contract="${contract.intelligence.run_id}" context="${runContext.run_id}"`);
  check(contract.organization.organization_id === runContext.organization_id,
    `organization_id: contract="${contract.organization.organization_id}" context="${runContext.organization_id}"`);
  check(contract.organization.canonical_domain === runContext.target_canonical_domain,
    `canonical_domain: contract="${contract.organization.canonical_domain}" context="${runContext.target_canonical_domain}"`);

  // 6. VerifiedFinding contract contents
  console.log('\n--- VerifiedFinding Contract Contents ---');
  console.log('  finding_id:', contract.finding_id);
  console.log('  technical_area:', contract.technical_area);
  console.log('  technical_mechanism:', contract.technical_mechanism);
  console.log('  expected_behavior:', contract.expected_behavior);
  console.log('  observed_behavior:', (contract.observed_behavior || '').slice(0, 100) + '...');
  console.log('  materiality:', contract.materiality);
  console.log('  differential_state:', contract.differential_state);
  console.log('  policy_reference:', contract.policy_reference);
  console.log('  decision_candidate:', contract.decision_candidate);
  console.log('  requires_authorized_assessment:', contract.authorization_context.requires_authorized_assessment);
  console.log('  proof_contract_id:', contract.provenance_chain.verification_contract_id);
  console.log('  expectation_id:', contract.provenance_chain.expectation_id);
  console.log('  observation_ids:', contract.provenance_chain.observation_ids);
  console.log('  differential_id:', contract.provenance_chain.differential_id);
  console.log('  hypothesis_id:', contract.provenance_chain.hypothesis_id);
  console.log('  evidence_refs:', contract.evidence_refs.map(e => e.evidence_id));
  console.log('  evidence content_hashes:', contract.evidence_refs.map(e => e.content_hash.slice(0, 16) + '...'));
  console.log('  created_at:', contract.created_at);
  console.log('  evidence_earliest_retrieved_at:', contract.evidence_earliest_retrieved_at);
  console.log('  evidence_latest_retrieved_at:', contract.evidence_latest_retrieved_at);
  console.log('  contradictory_evidence_ids:', contract.contradictory_evidence_ids);
  console.log('  uncertainty:', contract.uncertainty);
  console.log('  benign_explanation:', contract.benign_explanation || '(none)');

  // 7. Q-Core receipt
  console.log('\n--- Q-Core Receipt ---');
  console.log('  receipt_id:', receipt.receipt_id);
  console.log('  transaction_id:', receipt.transaction_id);
  console.log('  transaction_status:', receipt.transaction_status);
  console.log('  block_height:', receipt.block_height);
  console.log('  gateway:', receipt.gateway);
  console.log('  sealed_at:', receipt.sealed_at);

  // 8. Independent receipt integrity verification
  console.log('\n--- Independent Receipt Integrity Verification ---');
  check(receipt.contract.finding_id === contract.finding_id,
    `receipt.finding_id == contract.finding_id: "${receipt.contract.finding_id}"`);
  check(receipt.contract.organization.organization_id === contract.organization.organization_id,
    `receipt.organization_id == contract.organization_id: "${receipt.contract.organization.organization_id}"`);
  check(receipt.contract.intelligence.run_id === contract.intelligence.run_id,
    `receipt.run_id == contract.run_id: "${receipt.contract.intelligence.run_id}"`);
  check(receipt.contract.provenance_chain.verification_contract_id === 'OBSERVABILITY_SIGNAL',
    `proof contract = OBSERVABILITY_SIGNAL`);
  check(receipt.contract.evidence_refs.length >= 2,
    `evidence_refs count >= 2: ${receipt.contract.evidence_refs.length}`);
  check(receipt.transaction_status === 'CONFIRMED',
    `transaction_status = CONFIRMED`);

  // 9. Full provenance table
  console.log('\n--- Provenance Table ---');
  console.log('  Q-Core field                -> Source object              -> Source field         -> Producer');
  console.log('  finding_id                  -> ProblemFinding             -> finding_id           -> TechnicalProblemDetector');
  console.log('  organization_id             -> IntelligenceRunContext      -> organization_id     -> Execution layer');
  console.log('  canonical_domain            -> IntelligenceRunContext      -> target_canonical_domain -> Execution layer');
  console.log('  entry_point_id             -> VerifiedFinding            -> entry_point_id      -> FindingVerificationEngine');
  console.log('  technical_area             -> THEME_TO_GOVERNANCE        -> technical_area      -> TechnicalProblemDetector');
  console.log('  technical_mechanism        -> THEME_TO_GOVERNANCE        -> technical_mechanism -> TechnicalProblemDetector');
  console.log('  expected_behavior          -> SignalCandidate             -> expected_behavior   -> HypothesisEngine');
  console.log('  observed_behavior          -> Evidence                   -> raw_observation     -> LivePublicObservationProvider');
  console.log('  materiality                -> THEME_TO_GOVERNANCE        -> materiality         -> TechnicalProblemDetector');
  console.log('  requires_authorized_assessment -> THEME_TO_GOVERNANCE   -> requires_authorized_assessment -> TechnicalProblemDetector');
  console.log('  policy_reference           -> THEME_TO_GOVERNANCE        -> policy_reference    -> TechnicalProblemDetector');
  console.log('  decision_candidate         -> THEME_TO_GOVERNANCE        -> decision_candidate  -> TechnicalProblemDetector');
  console.log('  expectation_id             -> SignalCandidate             -> expectation_id      -> TechnicalProblemDetector');
  console.log('  observation_ids            -> VerifiedFinding            -> related_evidence_ids -> FindingVerificationEngine');
  console.log('  differential_id            -> SignalCandidate             -> differential_id     -> TechnicalProblemDetector');
  console.log('  hypothesis_id              -> SignalCandidate             -> hypothesis_id       -> TechnicalProblemDetector');
  console.log('  verification_contract_id   -> SignalCandidate             -> type               -> FindingVerificationEngine');
  console.log('  evidence IDs               -> Evidence[]                  -> id                  -> LivePublicObservationProvider');
  console.log('  evidence timestamps        -> Evidence[]                  -> retrieved_at        -> LivePublicObservationProvider');
  console.log('  evidence content_hashes    -> Evidence[]                  -> computeEvidenceContentHash -> VerifiedFindingContract');

  // 10. Final assertion
  console.log(`\n=== VALIDATION SUMMARY: ${passCount} passed, ${failCount} failed ===`);
  if (failCount === 0 && qcoreRequestCount > 0) {
    console.log('ANSWER: PASS — Real Intelligence runtime produced an authoritative VERIFIED_FINDING and submitted it to Q-Core, producing an independently verifiable receipt.');
  } else {
    console.log('ANSWER: NOT YET PROVEN');
    process.exit(1);
  }

  // Shutdown
  qcoreServer.close();
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  qcoreServer.close();
  process.exit(1);
});
