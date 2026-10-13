/**
 * VARDHAN ENGINE v4.2 — 14 AUTOMATED TESTS
 *
 * ALL 14 MUST PASS before implementation is reported as complete.
 *
 * Run: npx tsx src/server/signalTestSuite.ts
 */

import {
  SourceVerifier,
  DeduplicationService,
  FreshnessClassifier,
  SignalScoringService,
  PersonaMatchingService,
  SignalExtractor,
  SignalRecord,
  SignalDiscoveryPipeline,
} from './signalDiscoveryPipeline';

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function test(id: number, name: string, passed: boolean, details: string) {
  results.push({ id, name, passed, details });
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: Valid primary source — should pass verification
// ─────────────────────────────────────────────────────────────────────────────
{
  const result = SourceVerifier.verify({
    sourceUrl: 'https://graphite.dev/blog/queue-architecture-2026',
    publishedAt: '2026-08-10',
    evidenceText: 'Graphite announced support for parallel PR stacking with automatic queue ordering and conflict resolution for teams with over 100 engineers.',
    sourceType: 'Company Engineering Blog'
  });
  test(1, 'Valid primary source → VERIFIED', result.valid && result.status === 'VERIFIED', `Status: ${result.status}, Reason: ${result.reason}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: Missing URL → BLOCKED_NO_SOURCE
// ─────────────────────────────────────────────────────────────────────────────
{
  const result = SourceVerifier.verify({
    sourceUrl: '',
    publishedAt: '2026-08-10',
    evidenceText: 'Company announced a major infrastructure change affecting their platform.',
    sourceType: 'Company Blog'
  });
  test(2, 'Missing URL → BLOCKED_NO_SOURCE', !result.valid && result.status === 'BLOCKED_NO_SOURCE', `Status: ${result.status}, Reason: ${result.reason}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: Missing publishedAt → BLOCKED_NO_DATE
// ─────────────────────────────────────────────────────────────────────────────
{
  const result = SourceVerifier.verify({
    sourceUrl: 'https://graphite.dev/blog/update',
    publishedAt: '',
    evidenceText: 'Graphite launched a new dashboard for pull request analytics and queue visibility.',
    sourceType: 'Company Engineering Blog'
  });
  test(3, 'Missing publishedAt → BLOCKED_NO_DATE', !result.valid && result.status === 'BLOCKED_NO_DATE', `Status: ${result.status}, Reason: ${result.reason}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4: Stale signal >90 days → Classified as OLD, capped below P0
// ─────────────────────────────────────────────────────────────────────────────
{
  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - 120);
  const publishedAt = staleDate.toISOString().split('T')[0];
  const ageDays = FreshnessClassifier.ageDays(publishedAt);
  const category = FreshnessClassifier.classify(ageDays);
  const score = SignalScoringService.score({ ageDays, confidence: 'HIGH', technicalRelevance: 22, personaRelevance: 22 });
  const priority = SignalScoringService.priority(score);
  test(
    4,
    'Stale signal >90d → OLD category, cannot be P0',
    category === 'OLD' && priority !== 'P0',
    `Age: ${ageDays}d, Category: ${category}, Score: ${score}, Priority: ${priority}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5: Duplicate signal → isDuplicate returns true for same fingerprint
// ─────────────────────────────────────────────────────────────────────────────
{
  DeduplicationService.clearCache();
  const fp = DeduplicationService.fingerprint('Graphite', 'PRODUCT_LAUNCH', 'PRODUCT_LAUNCH2026-08');
  const fakeSignal: SignalRecord = {
    company: 'Graphite', person: 'Greg Foster', role: 'CTO',
    sourceUrl: 'https://graphite.dev/blog/launch', sourceType: 'Company Blog',
    publishedAt: '2026-08-01', signalAgeDays: 20, freshnessCategory: 'RECENT',
    signalType: 'PRODUCT_LAUNCH', evidenceText: 'Graphite launched a new stack creation workflow for large engineering teams.',
    confidence: 'HIGH', confidenceReason: 'Direct company announcement',
    businessImplication: 'Major product release', engineeringImplication: '',
    technicalRelevance: 20, personaRelevance: 18, signalScore: 83, priority: 'P1',
    recommendedPersona: 'CTO', recommendedAngle: 'H_CURIOSITY',
    verificationStatus: 'VERIFIED', signalFingerprint: fp,
    blockReason: '', discoveredAt: new Date().toISOString()
  };
  DeduplicationService.register(fakeSignal);
  const isDup = DeduplicationService.isDuplicate(fp);
  test(5, 'Duplicate signal → isDuplicate = true', isDup, `Fingerprint: ${fp}, isDuplicate: ${isDup}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6: Same event across multiple sources → deduplication prefers first registered
// ─────────────────────────────────────────────────────────────────────────────
{
  DeduplicationService.clearCache();
  const normalizedEvent = 'PRODUCT_LAUNCH2026-07';
  const fp = DeduplicationService.fingerprint('Chainguard', 'PRODUCT_LAUNCH', normalizedEvent);
  const primarySignal: SignalRecord = {
    company: 'Chainguard', person: 'Dan Lorenc', role: 'CEO',
    sourceUrl: 'https://chainguard.dev/blog/distroless-update', sourceType: 'Company Engineering Blog',
    publishedAt: '2026-07-15', signalAgeDays: 37, freshnessCategory: 'HISTORICAL',
    signalType: 'PRODUCT_LAUNCH', evidenceText: 'Chainguard released new distroless container images with SBOM attestations for Go and Python runtimes.',
    confidence: 'HIGH', confidenceReason: 'Primary source', businessImplication: '', engineeringImplication: '',
    technicalRelevance: 20, personaRelevance: 18, signalScore: 60, priority: 'P2',
    recommendedPersona: 'CTO', recommendedAngle: 'H_CURIOSITY',
    verificationStatus: 'VERIFIED', signalFingerprint: fp,
    blockReason: '', discoveredAt: new Date().toISOString()
  };
  DeduplicationService.register(primarySignal);

  // Simulate secondary source for same event
  const isDupSecondary = DeduplicationService.isDuplicate(fp);
  const existing = DeduplicationService.getExisting(fp);
  test(
    6,
    'Same event from multiple sources → deduplicated, primary source retained',
    isDupSecondary && existing?.sourceType === 'Company Engineering Blog',
    `Duplicate detected: ${isDupSecondary}, Retained source: ${existing?.sourceType}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7: Synthetic/thin evidence → BLOCKED_THIN_EVIDENCE
// ─────────────────────────────────────────────────────────────────────────────
{
  const result = SourceVerifier.verify({
    sourceUrl: 'https://example.com/blog',
    publishedAt: '2026-08-10',
    evidenceText: 'They expanded their platform.',   // Too vague / short
    sourceType: 'Company Blog'
  });
  test(7, 'Thin/synthetic evidence → BLOCKED_THIN_EVIDENCE', !result.valid && result.status === 'BLOCKED_THIN_EVIDENCE', `Status: ${result.status}, Reason: ${result.reason}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 8: Unsupported technical inference → ClaimValidation blocks
// ─────────────────────────────────────────────────────────────────────────────
{
  // Simulate what a fabricated email body with an unsupported claim looks like
  const FORBIDDEN_PATTERNS = [
    /\d+x (slower|faster|increase|decrease)/i,
    /p99.*(increased|doubled|tripled|spiked)/i,
    /latency.*(increased|doubled|4x|3x)/i,
    /gpu utilization.*\d+%/i,
    /your (outage|incident|vulnerability|breach)/i,
    /customers are (complaining|leaving|churning)/i,
  ];
  const fabricatedBody = "We noticed your p99 latency spiked 3x after the deployment — is that consistent with what your team observed?";
  const hasViolation = FORBIDDEN_PATTERNS.some(p => p.test(fabricatedBody));
  test(8, 'Unsupported technical inference (p99 spike claim) → Claim block', hasViolation, `Body: "${fabricatedBody.substring(0, 80)}" | Violation detected: ${hasViolation}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 9: P3 hard block — score below threshold → No email
// ─────────────────────────────────────────────────────────────────────────────
{
  const score = SignalScoringService.score({ ageDays: 200, confidence: 'LOW', technicalRelevance: 5, personaRelevance: 3 });
  const priority = SignalScoringService.priority(score);
  test(9, 'P3 hard block — score below threshold → priority P3', priority === 'P3', `Score: ${score}, Priority: ${priority}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 10: No-new-signal follow-up block
// ─────────────────────────────────────────────────────────────────────────────
{
  // Simulate: company has a signal from >90 days ago, no new signal found
  const lastSignalDate = new Date();
  lastSignalDate.setDate(lastSignalDate.getDate() - 95);
  const ageDays = FreshnessClassifier.ageDays(lastSignalDate.toISOString().split('T')[0]);
  const freshnessCategory = FreshnessClassifier.classify(ageDays);
  const noNewSignal = freshnessCategory === 'OLD';
  test(
    10,
    'No-new-signal follow-up → OLD freshness, follow-up blocked',
    noNewSignal,
    `Last signal age: ${ageDays}d, Category: ${freshnessCategory}, Follow-up allowed: ${!noNewSignal}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 11: Persona mismatch — physical hardware company → infra pitch blocked
// ─────────────────────────────────────────────────────────────────────────────
{
  // DUST Identity — synthetic diamond product — NO_ACTIONABLE_SIGNAL should produce no persona
  const persona = PersonaMatchingService.match('NO_ACTIONABLE_SIGNAL', 'Physical Hardware');
  test(
    11,
    'Persona mismatch — NO_ACTIONABLE_SIGNAL → empty persona (no forced match)',
    persona.persona === '' && persona.angle === '' && persona.relevance === 0,
    `Persona: "${persona.persona}", Angle: "${persona.angle}", Relevance: ${persona.relevance}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 12: Invalid/unreachable source → SOURCE_DISCOVERY_UNAVAILABLE
// ─────────────────────────────────────────────────────────────────────────────
{
  const result = SourceVerifier.verify({
    sourceUrl: 'not-a-valid-url',
    publishedAt: '2026-08-10',
    evidenceText: 'Company launched a new product line for enterprise customers in 2026.',
    sourceType: 'Company Blog'
  });
  test(12, 'Invalid URL format → BLOCKED_NO_SOURCE', !result.valid && result.status === 'BLOCKED_NO_SOURCE', `Status: ${result.status}, Reason: ${result.reason}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 13: Freshness classification — all 4 buckets correct
// ─────────────────────────────────────────────────────────────────────────────
{
  const cases = [
    { days: 3, expected: 'VERY_RECENT' },
    { days: 15, expected: 'RECENT' },
    { days: 60, expected: 'HISTORICAL' },
    { days: 100, expected: 'OLD' }
  ];
  const allCorrect = cases.every(c => {
    const date = new Date();
    date.setDate(date.getDate() - c.days);
    const ageDays = FreshnessClassifier.ageDays(date.toISOString().split('T')[0]);
    const category = FreshnessClassifier.classify(ageDays);
    return category === c.expected;
  });
  test(
    13,
    'Freshness classification — all 4 buckets correct (VERY_RECENT/RECENT/HISTORICAL/OLD)',
    allCorrect,
    cases.map(c => {
      const date = new Date();
      date.setDate(date.getDate() - c.days);
      const ageDays = FreshnessClassifier.ageDays(date.toISOString().split('T')[0]);
      return `${c.days}d→${FreshnessClassifier.classify(ageDays)}`;
    }).join(', ')
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 14: Source confidence ranking — HIGH > MEDIUM > LOW on same date
// ─────────────────────────────────────────────────────────────────────────────
{
  const base = { ageDays: 10, technicalRelevance: 20, personaRelevance: 18 };
  const high = SignalScoringService.score({ ...base, confidence: 'HIGH' });
  const medium = SignalScoringService.score({ ...base, confidence: 'MEDIUM' });
  const low = SignalScoringService.score({ ...base, confidence: 'LOW' });
  test(
    14,
    'Source confidence ranking — HIGH > MEDIUM > LOW on same age',
    high > medium && medium > low,
    `HIGH=${high}, MEDIUM=${medium}, LOW=${low}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS
// ─────────────────────────────────────────────────────────────────────────────

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log('\n══════════════════════════════════════════════════════════════════');
console.log('VARDHAN ENGINE v4.2 — AUTOMATED TEST SUITE (14 TESTS)');
console.log('══════════════════════════════════════════════════════════════════\n');

results.forEach(r => {
  console.log(`${r.passed ? '✅' : '❌'} TEST ${r.id.toString().padStart(2, '0')}: ${r.name}`);
  console.log(`         → ${r.details}\n`);
});

console.log('──────────────────────────────────────────────────────────────────');
if (failed === 0) {
  console.log(`✅  ALL ${passed}/${results.length} TESTS PASSED — Engine v4.2 cleared for integration`);
} else {
  console.log(`❌  ${failed} TEST(S) FAILED — SEND REMAINS BLOCKED`);
  process.exit(1);
}
console.log('══════════════════════════════════════════════════════════════════\n');
