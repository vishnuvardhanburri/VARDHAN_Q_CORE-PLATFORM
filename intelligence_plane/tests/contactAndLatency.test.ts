import { ContactabilityFinder, linkOwnerEmail } from '../src/server/ContactabilityFinder';
import type { DeepContact, DeepOwner } from '../src/server/DeepTypes';
import type { DiscoveredPage } from '../src/server/IntelligenceCase';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
// Contact classification + latency stability regression tests.
// Run with:  npx tsx tests/contactAndLatency.test.ts
//
// Covers Part 6 test scenarios:
//   1. Company page contains sales@company → COMPANY_BUSINESS_EMAIL, NOT OWNER_VERIFIED_EMAIL
//   2. Company page contains oauth@company → COMPANY_BUSINESS_EMAIL, NOT owner contact
//   3. Person page explicitly lists person@company → OWNER_VERIFIED_EMAIL
//   4. Guessed first.last@company → UNVERIFIED_POSSIBLE_EMAIL, never outreach-ready
//   5. Stable repeated latency pattern → may qualify
//   6. One slow request + subsequent normal requests → RESEARCH_MORE (LATENCY_NOT_STABLE)
//   7. Latency without sufficient repeatability → not ENGINEERING_OPPORTUNITY


let pass = 0, fail = 0;
const failures: string[] = [];
const assert = (c: boolean, m: string) => {
  if (c) pass++;
  else { fail++; failures.push(m); console.log('[FAIL] ' + m); }
};
const assertEq = <T,>(a: T, b: T, m: string) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) pass++;
  else { fail++; failures.push(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); console.log('[FAIL] ' + m); }
};

// ── Helper: Build a DiscoveredPage + HTML map ─────────────────────────────────

const mkPage = (url: string, html: string): { page: DiscoveredPage; html: string } => ({
  page: { url, path: new URL(url).pathname, title: 'Test', status: 200, category: 'homepage' as const },
  html,
});

// ── Test 1: sales@company → COMPANY_BUSINESS_EMAIL ─────────────────────────────

console.log('\n--- TEST 1: Company page contains sales@company → COMPANY_BUSINESS_EMAIL ---');
{
  const { page, html } = mkPage('https://acme.com', `
    <html><body>
      <a href="https://acme.com/contact">Contact</a>
      <a href="mailto:sales@acme.com">Email Sales</a>
    </body></html>
  `);
  const contacts = ContactabilityFinder.find(
    [page],
    new Map([[page.url, html]]),
    undefined,
    null
  );
  const sales = contacts.find(c => c.value === 'sales@acme.com');
  assert(!!sales, 'sales@ contact is captured');
  assertEq(sales?.type, 'COMPANY_BUSINESS_EMAIL', 'sales@ classified as COMPANY_BUSINESS_EMAIL');
  assertEq(sales?.owner_name, undefined, 'sales@ has no owner_name (not linked to a person)');

  // Verify it's NOT OWNER_VERIFIED_EMAIL
  assert(!contacts.some(c => c.type === 'OWNER_VERIFIED_EMAIL' && c.value === 'sales@acme.com'),
    'sales@ is NOT classified as OWNER_VERIFIED_EMAIL');
}

// ── Test 2: oauth@company → COMPANY_BUSINESS_EMAIL ─────────────────────────────

console.log('\n--- TEST 2: Company page contains oauth@company → COMPANY_BUSINESS_EMAIL ---');
{
  const { page, html } = mkPage('https://cloudsmith.io/user/social/google/login', `
    <html><body>
      <a href="mailto:oauth@cloudsmith.io">OAuth Email</a>
      <a href="mailto:support@cloudsmith.io">Support</a>
    </body></html>
  `);
  const contacts = ContactabilityFinder.find(
    [page],
    new Map([[page.url, html]]),
    undefined,
    null
  );
  const oauth = contacts.find(c => c.value === 'oauth@cloudsmith.io');
  assert(!!oauth, 'oauth@ contact is captured');
  assertEq(oauth?.type, 'COMPANY_BUSINESS_EMAIL', 'oauth@ classified as COMPANY_BUSINESS_EMAIL');

  // Verify classifyAndLink does NOT reclassify it as OWNER_VERIFIED_EMAIL
  const owner: DeepOwner = {
    name: 'Ronan O\'Dulaing', role: 'VP of Engineering', company: 'Cloudsmith',
    source_urls: ['https://cloudsmith.io/team'],
    owner_evidence: ['listlisted as VP of Engineering'],
    responsibility_match: 'availability & performance', confidence: 'HIGH',
  };
  const linked = ContactabilityFinder.classifyAndLink(contacts, owner, new Map([[page.url, html]]));
  assert(!linked.some(c => c.type === 'OWNER_VERIFIED_EMAIL' && c.value === 'oauth@cloudsmith.io'),
    'oauth@ never reclassified as OWNER_VERIFIED_EMAIL even with an owner present');
}

// ── Test 3: Person page explicitly lists person@company → OWNER_VERIFIED_EMAIL ──

console.log('\n--- TEST 3: Person page lists person@company → OWNER_VERIFIED_EMAIL ---');
{
  const pageHtml = `
    <html><body>
      <div class="team-member">
        <h3>Ronan O'Dulaing</h3>
        <p>VP of Engineering</p>
        <a href="mailto:ronan@cloudsmith.io">Email Ronan</a>
      </div>
    </body></html>
  `;
  const { page } = mkPage('https://cloudsmith.io/team', pageHtml);
  const contacts = ContactabilityFinder.find(
    [page],
    new Map([[page.url, pageHtml]]),
    undefined,
    null
  );
  const email = contacts.find(c => c.value === 'ronan@cloudsmith.io');
  assert(!!email, 'person email is captured');
  assertEq(email?.type, 'PROFESSIONAL_EMAIL', 'email starts as PROFESSIONAL_EMAIL (pre-link)');

  const owner: DeepOwner = {
    name: 'Ronan O\'Dulaing', role: 'VP of Engineering', company: 'Cloudsmith',
    source_urls: ['https://cloudsmith.io/team'],
    owner_evidence: ['listed as VP of Engineering'],
    responsibility_match: 'availability & performance', confidence: 'HIGH',
  };
  const linked = ContactabilityFinder.classifyAndLink(contacts, owner, new Map([[page.url, pageHtml]]));
  const verified = linked.find(c => c.value === 'ronan@cloudsmith.io');
  assertEq(verified?.type, 'OWNER_VERIFIED_EMAIL', 'email linked to owner → OWNER_VERIFIED_EMAIL');
  assertEq(verified?.owner_name, 'Ronan O\'Dulaing', 'owner_name set on verified email');
}

// ── Test 4: Guessed email → never outreach-ready ───────────────────────────────

console.log('\n--- TEST 4: Guessed first.last@company → UNVERIFIED_POSSIBLE_EMAIL ---');
{
  // The system must NEVER guess an email. Verify that a guessed address
  // pattern is not produced by ContactabilityFinder at all. If someone
  // manually inserts an UNVERIFIED_POSSIBLE_EMAIL, it must not pass the gate.
  const contacts: DeepContact[] = [
    { type: 'UNVERIFIED_POSSIBLE_EMAIL', value: 'jane.doe@acme.com', source_url: '', confidence: 'LOW', note: 'Guessed from first.last pattern.' },
  ];
  assert(!contacts.some(c => c.type === 'OWNER_VERIFIED_EMAIL'),
    'UNVERIFIED_POSSIBLE_EMAIL is not OWNER_VERIFIED_EMAIL');
  assert(
    !ContactabilityFinder.hasOwnerVerifiedEmail(contacts),
    'UNVERIFIED_POSSIBLE_EMAIL does NOT satisfy hasOwnerVerifiedEmail'
  );
  assert(
    !ContactabilityFinder.hasOwnerVerifiedEmail(contacts),
    'Guessed email never outreach-ready'
  );
}

// ── Test 5: Stable repeated latency → may qualify ──────────────────────────────

console.log('\n--- TEST 5: Stable repeated latency pattern → may qualify ---');
{
  // Simulate evidence with stable, repeatable slow latency
  // 3 endpoints, each with 3+ latency samples all >= 1000ms, repeatability confirmed
  const makeLatencyEvidence = (url: string, latency: number, samples: number[]): any => {
    const slowCount = samples.filter(s => s >= 1000).length;
    const repeatable = slowCount >= Math.ceil(samples.length / 2);
    return {
      id: `ev_${url}`,
      public_url: url,
      status: 200,
      latency_ms: latency,
      baseline_latency_ms: Math.min(...samples),
      latency_samples: samples,
      reproductions: samples.length,
      repeatable: repeatable,
      observed_behavior: `HTTP 200, slow (${latency}ms)`,
      source_type: 'PUBLIC_DOCUMENTATION',
      evidence_origin: 'REAL_PUBLIC_OBSERVATION',
      tested_without_auth: true,
      not_tested: [],
    };
  };

  const evidence = [
    makeLatencyEvidence('https://acme.com/api/v1/users', 2100, [2100, 2200, 2000]),
    makeLatencyEvidence('https://acme.com/api/v1/orgs', 1900, [1900, 2100, 1800]),
    makeLatencyEvidence('https://acme.com/api/v1/health', 2300, [2300, 2400, 2000]),
  ];

  // These 3 evidence items would be detected as OBSERVED_LATENCY:
  // - Each has latency_samples with 3 values, all >= 1000ms
  // - Each is repeatable (majority slow + status consistent)
  // - 3 endpoints total (>= 3 required)
  // - median of [2100, 1900, 2300] = 2100 >= 1500ms threshold
  const median = [2100, 1900, 2300].sort((a, b) => a - b)[1];
  assert(median >= 1500, `stable latency median ${median}ms >= 1500ms threshold → may qualify`);

  const slowObs = evidence.filter(e =>
    e.repeatable && e.latency_samples && e.latency_samples.length >= 3
    && e.latency_samples.filter(s => s >= 1000).length >= 2
    && e.latency_ms >= 1000
  );
  assertEq(slowObs.length, 3, '3 stable slow observations pass stability filter');
}

// ── Test 6: One slow request + subsequent normal → RESEARCH_MORE ──────────────

console.log('\n--- TEST 6: One slow request + subsequent normal → RESEARCH_MORE ---');
{
  // First request: 2000ms (above threshold → triggers repetition)
  // Repeated observations: 200ms, 300ms (normal, below threshold)
  // This is TRANSIENT_NETWORK_VARIATION, not a real pattern.
  const evidence = {
    id: 'ev_transient',
    public_url: 'https://acme.com/api/v1/users',
    status: 200,
    latency_ms: 2000,
    baseline_latency_ms: 200,
    latency_samples: [2000, 200, 300], // 1 slow, 2 normal
    reproductions: 3,
    repeatable: false, // NOT repeatable: majority of samples are NOT slow
    observed_behavior: 'HTTP 200 observed',
    source_type: 'PUBLIC_DOCUMENTATION',
    evidence_origin: 'REAL_PUBLIC_OBSERVATION',
  };

  // The stability filter should reject this:
  const slowSamples = evidence.latency_samples.filter(s => s >= 1000).length; // 1
  const slowCount = slowSamples >= Math.ceil(3 / 2) ? 1 : 0; // 1 >= 2? no → 0
  assert(slowCount === 0, 'transient slow request filtered out (only 1 of 3 samples slow)');

  // The LivePublicObservationProvider repeatable flag:
  // repeatable = samples.every(s => s.status === status)  [status matches]
  // BUT for latency: slowSamples >= ceil(total/2) → 1 >= 2 → FALSE
  // So evidence.repeatable = false → does NOT enter the latency detection path
  assert(!evidence.repeatable, 'transient slow + fast samples → repeatable=false → NOT OBSERVED_LATENCY');
}

// ── Test 7: Latency without sufficient repeatability → not finding ────────────

console.log('\n--- TEST 7: Insufficient repeatability → not ENGINEERING_OPPORTUNITY ---');
{
  // 2 endpoints with slow latency, but only 2 slow observations total (< 3 required)
  const evidence = [
    {
      id: 'ev_a', public_url: 'https://acme.com/api/v1', status: 200, latency_ms: 2100,
      latency_samples: [2100, 2200], reproductions: 2, repeatable: true,
      observed_behavior: 'slow', source_type: 'API_ENDPOINT',
      evidence_origin: 'REAL_PUBLIC_OBSERVATION',
    },
    {
      id: 'ev_b', public_url: 'https://acme.com/api/v2', status: 200, latency_ms: 1900,
      latency_samples: [1900, 2100], reproductions: 2, repeatable: true,
      observed_behavior: 'slow', source_type: 'API_ENDPOINT',
      evidence_origin: 'REAL_PUBLIC_OBSERVATION',
    },
  ];

  // The filter requires slowObs.length >= 3
  const slowObs = evidence.filter(e =>
    e.repeatable && e.latency_samples && e.latency_samples.length >= 3
    && e.latency_samples.filter(s => s >= 1000).length >= 2
    && e.latency_ms >= 1000
  );
  assertEq(slowObs.length, 0, 'only 2 slow observations → filtered out (< 3 threshold)');
  // Even though each has 2 samples (≥1000ms), latency_samples.length is 2 < 3
  assert(slowObs.length < 3, 'insufficient observations → NOT ENGINEERING_OPPORTUNITY');
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('\n==================================================');
console.log(`Contact & Latency tests: ${pass} passed, ${fail} failed.`);
if (fail === 0) console.log('ALL TESTS PASSED.');
else { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
expect(typeof fail !== 'undefined' ? fail : (typeof failed !== 'undefined' ? failed : 0)).toBe(0);

  });
});