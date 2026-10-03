import { IntelligenceEngine } from '../src/server/IntelligenceEngine';
import { Evidence, EngineMode, EvidenceClaim, PublicObservationProvider, ObservationResult } from '../src/server/IntelligenceCase';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {

class MockProvider implements PublicObservationProvider {
  constructor(private evidenceToReturn: Evidence[]) {}
  async observePublicSurface(url: string): Promise<ObservationResult> {
    return { evidence: this.evidenceToReturn, discovery_errors: 0 };
  }
}

async function runTests() {
  console.log("==================================================");
  console.log("VARDHAN FINAL ENGINE BOUNDARY PASS");
  console.log("==================================================\n");

  let passCount = 0;
  let failCount = 0;
  let testCount = 0;

  const runTest = async (
    testName: string, 
    companyName: string,
    companyWebsite: string,
    mockEvidence: Evidence[], 
    contactName = "Bo Zhao", 
    contactRole = "Director of Data Platform",
    ownerEvidenceString = "", 
    expectedGate: string,
    expectedQa: string = 'PASSED',
    mode: EngineMode = 'TEST',
    injectClaims?: EvidenceClaim[],
    provider?: PublicObservationProvider
  ) => {
    testCount++;
    console.log(`\n--- ${testName} ---`);
    const result = await IntelligenceEngine.run(companyName, companyWebsite, contactName, contactRole, ownerEvidenceString, mockEvidence, mode, { injectClaims }, provider);
    const decision = result.prospect_decision;
    
    console.log(`Classification: ${result.finding_classification?.finding_type || 'NONE'} (Severity: ${result.finding_classification?.impact_severity})`);
    console.log(`Gate Decision:  ${decision}`);
    if (result.claim_validation !== 'N/A') console.log(`Claim QA:       ${result.claim_validation}`);
    
    let assertionsPassed = true;

    if (decision !== expectedGate) {
      console.log(`[FAIL] Expected Gate ${expectedGate} but got ${decision}`);
      assertionsPassed = false;
    }

    if (decision === 'GO' && result.claim_validation !== expectedQa) {
      console.log(`[FAIL] Expected QA ${expectedQa} but got ${result.claim_validation}`);
      assertionsPassed = false;
    }
    
    if (decision === 'NO_GO' && injectClaims && result.claim_validation !== expectedQa) {
       console.log(`[FAIL] Expected QA Failure ${expectedQa} but got ${result.claim_validation}`);
       assertionsPassed = false;
    }

    if (assertionsPassed) {
      console.log(`[PASS] Assertions matched.`);
      passCount++;
    } else {
      failCount++;
    }

    if (decision === 'GO' || (injectClaims && result.claim_validation === 'FAILED')) {
      console.log(`Subject:        ${result.subject}`);
    } else {
      console.log(`Contradictions: ${(result.contradictions || []).join(" | ")}`);
    }
    return result;
  };

  const test1Ev: Evidence[] = [{
    id: 'ev1', evidence_origin: 'DOCUMENTED_SOURCE', public_url: 'https://example.com/blog/scaling', source_type: 'ENGINEERING_BLOG',
    observed_behavior: 'We migrated due to connection pooling constraints.', reproductions: 1, repeatable: true, tested_without_auth: true, not_tested: [], retrieved_at: '2023-10-01', evidence_text: '', owner_source_link: 'Bo Zhao author explicitly matches'
  }];
  const res1 = await runTest("TEST 1: Documented engineering article", "ExampleCo", "https://example.com", test1Ev, "Bo Zhao", "Director", undefined, "GO");

  const test2Ev: Evidence[] = [{
    id: 'ev2', evidence_origin: 'MOCK_TEST', public_url: 'https://api.example.com/v1/users', source_type: 'API_ENDPOINT', status: 200,
    observed_behavior: 'The payload exposes internal metadata fields like storage_path.', sensitive_fields: ['storage_path'], reproductions: 3, repeatable: true, tested_without_auth: true, not_tested: ['access private data'], retrieved_at: '2023-10-01', evidence_text: '', owner_source_link: 'Bo Zhao repository owner'
  }];
  const res2 = await runTest("TEST 2: Real/mock public metadata exposure", "ExampleCo", "https://example.com", test2Ev, "Bo Zhao", "CTO", undefined, "GO");

  const test3Ev: Evidence[] = [{
    id: 'ev3', evidence_origin: 'MOCK_TEST', public_url: 'https://example.com/api/checkout', source_type: 'API_ENDPOINT', status: 500,
    observed_behavior: 'HTTP 500 response', reproductions: 5, repeatable: true, tested_without_auth: true, not_tested: [], retrieved_at: '2023-10-01', evidence_text: '', owner_source_link: 'Bo Zhao author explicitly matches'
  }];
  await runTest("TEST 3: Repeated HTTP 500", "ExampleCo", "https://example.com", test3Ev, "Bo Zhao", "VP", undefined, "GO");

  const test4Ev: Evidence[] = [{
    id: 'ev4', evidence_origin: 'MOCK_TEST', public_url: 'https://example.com/api/search', source_type: 'API_ENDPOINT', status: 200,
    observed_behavior: 'Search endpoint response', latency_ms: 4200, baseline_latency_ms: 180, latency_samples: [4100, 4300],
    reproductions: 10, repeatable: true, tested_without_auth: true, not_tested: [], retrieved_at: '2023-10-01', evidence_text: '', owner_source_link: 'Bo Zhao author explicitly matches'
  }];
  await runTest("TEST 4: Repeatable latency with structured measurements", "ExampleCo", "https://example.com", test4Ev, "Bo Zhao", "Head", undefined, "GO");

  const test5Ev: Evidence[] = [{
    id: 'ev5', evidence_origin: 'MOCK_TEST', public_url: 'https://example.com/blog/culture', source_type: 'ENGINEERING_BLOG',
    observed_behavior: 'We love our engineering culture.', reproductions: 1, repeatable: true, tested_without_auth: true, not_tested: [], retrieved_at: '2023-10-01', evidence_text: '', owner_source_link: 'Bo Zhao author explicitly matches'
  }];
  await runTest("TEST 5: Generic article", "ExampleCo", "https://example.com", test5Ev, "Bo Zhao", "CTO", undefined, "RESEARCH_MORE");

  const test6Ev: Evidence[] = [{
    id: 'ev6', evidence_origin: 'MOCK_TEST', public_url: 'https://example.com/api/data', source_type: 'API_ENDPOINT', status: 200,
    observed_behavior: 'Payload leaked internal IP once.', sensitive_fields: ['internal_ip'], reproductions: 1, repeatable: false, tested_without_auth: true, not_tested: [], retrieved_at: '2023-10-01', evidence_text: '', owner_source_link: 'Bo Zhao author explicitly matches'
  }];
  await runTest("TEST 6: Unrepeatable public observation", "ExampleCo", "https://example.com", test6Ev, "Bo Zhao", "CTO", undefined, "RESEARCH_MORE");

  await runTest("TEST 7: Missing owner", "ExampleCo", "https://example.com", test2Ev, "Unknown User", "Software Engineer", undefined, "RESEARCH_MORE");

  const badClaims: EvidenceClaim[] = [
    { text: `I'm Vishnu, the solo founder building VARDHAN.`, evidence_ids: [], claim_type: 'STANDARD_BLOCK' },
    { text: `While checking https://api.example.com/v1/users, I observed that: The API leaks all user passwords entirely.`, evidence_ids: ['ev2'], claim_type: 'OBSERVATION' }
  ];
  await runTest("TEST 8: Genuine Claim QA failure", "ExampleCo", "https://example.com", test2Ev, "Bo Zhao", "CTO", undefined, "NO_GO", "FAILED", "TEST", badClaims);

  const test9Ev: Evidence[] = [{
    id: 'ev9', evidence_origin: 'MOCK_TEST', public_url: 'https://stripe.com/api/charges', source_type: 'API_ENDPOINT', status: 500,
    observed_behavior: 'HTTP 500 response', reproductions: 5, repeatable: true, tested_without_auth: true, not_tested: [], retrieved_at: '2023-10-01', evidence_text: '', owner_source_link: 'Bo Zhao source explicitly names'
  }];
  await runTest("TEST 9: Mismatched/unrelated company domain", "ExampleCo", "https://example.com", test9Ev, "Bo Zhao", "CTO", undefined, "NO_GO");

  const test10Ev: Evidence[] = [
    { id: 'ev10a', evidence_origin: 'MOCK_TEST', public_url: 'https://example.com/api/checkout', source_type: 'API_ENDPOINT', status: 500, observed_behavior: 'HTTP 500 response', reproductions: 3, repeatable: true, tested_without_auth: true, not_tested: [], retrieved_at: '2023-10-01', evidence_text: '', owner_source_link: 'Bo Zhao repository owner' },
    { id: 'ev10b', evidence_origin: 'MOCK_TEST', public_url: 'https://example.com/api/checkout?region=eu', source_type: 'API_ENDPOINT', status: 502, observed_behavior: 'HTTP 502 response', reproductions: 2, repeatable: true, tested_without_auth: true, not_tested: [], retrieved_at: '2023-10-01', evidence_text: '', owner_source_link: 'Bo Zhao repository owner' }
  ];
  await runTest("TEST 10: Multiple distinct evidence resolving to SAME finding", "ExampleCo", "https://example.com", test10Ev, "Bo Zhao", "CTO", undefined, "GO");

  const test11Ev: Evidence[] = [test2Ev[0], test3Ev[0]]; 
  await runTest("TEST 11: Evidence-origin enforcement / Conflicting findings", "ExampleCo", "https://example.com", test11Ev, "Bo Zhao", "CTO", undefined, "RESEARCH_MORE");

  await runTest("TEST 12: Production mode immediately rejects MOCK_TEST", "ExampleCo", "https://example.com", test2Ev, "Bo Zhao", "CTO", undefined, "NO_GO", "PASSED", "PRODUCTION", undefined, new MockProvider(test2Ev));

  const test13Ev: Evidence[] = [{
    id: 'ev13', evidence_origin: 'MOCK_TEST', public_url: 'https://example.com/api/checkout', source_type: 'API_ENDPOINT', status: 500,
    observed_behavior: 'HTTP 500 response', reproductions: 1, repeatable: true, tested_without_auth: true, not_tested: [], retrieved_at: '2023-10-01', evidence_text: '', owner_source_link: 'Bo Zhao author explicitly matches'
  }];
  await runTest("TEST 13: One-off HTTP 500", "ExampleCo", "https://example.com", test13Ev, "Bo Zhao", "CTO", undefined, "RESEARCH_MORE");

  // DOMAIN VALIDATION TESTS
  await runTest("TEST 14A: Exact domain match", "ExampleCo", "https://example.com", [{...test2Ev[0], public_url: 'https://example.com/api'}], "Bo Zhao", "CTO", undefined, "GO");
  await runTest("TEST 14B: Subdomain match", "ExampleCo", "https://example.com", [{...test2Ev[0], public_url: 'https://api.example.com/api'}], "Bo Zhao", "CTO", undefined, "GO");
  await runTest("TEST 14C: Related but invalid domain", "ExampleCo", "https://example.com", [{...test2Ev[0], public_url: 'https://evil-example.com/api'}], "Bo Zhao", "CTO", undefined, "NO_GO");
  await runTest("TEST 14D: Subdomain spoofing", "ExampleCo", "https://example.com", [{...test2Ev[0], public_url: 'https://example.com.evil.com/api'}], "Bo Zhao", "CTO", undefined, "NO_GO");

  // OWNER VERIFICATION TESTS 
  await runTest("TEST 15A: Explicit Owner Linkage (HIGH)", "ExampleCo", "https://example.com", [{...test2Ev[0], owner_source_link: 'Bo Zhao author explicitly matches'}], "Bo Zhao", "CTO", undefined, "GO");
  await runTest("TEST 15B: Technical Title Only (MEDIUM)", "ExampleCo", "https://example.com", [{...test2Ev[0], owner_source_link: ''}], "Bo Zhao", "CTO", undefined, "RESEARCH_MORE"); 
  await runTest("TEST 15C: Unrelated Title / No Linkage (LOW)", "ExampleCo", "https://example.com", [{...test2Ev[0], owner_source_link: ''}], "Bob", "Accountant", undefined, "RESEARCH_MORE");

  // CLAIM QA OBSERVATION SUPPORT TEST 
  const badObsClaims: EvidenceClaim[] = [
    { text: `I'm Vishnu, the solo founder building VARDHAN.`, evidence_ids: [], claim_type: 'STANDARD_BLOCK' },
    { text: `While checking https://api.example.com/v1/users, I observed that: The API leaks all user passwords entirely.`, evidence_ids: ['ev2'], claim_type: 'OBSERVATION' }
  ];
  await runTest("TEST 16: Claim QA observation mismatch", "ExampleCo", "https://example.com", test2Ev, "Bo Zhao", "CTO", undefined, "NO_GO", "FAILED", "TEST", badObsClaims);

  // PROVIDER TESTS
  await runTest("TEST 17: TEST mode + mockEvidence allowed", "ExampleCo", "https://example.com", test2Ev, "Bo Zhao", "CTO", undefined, "GO", "PASSED", "TEST");
  
  await runTest("TEST 18: PRODUCTION + no provider -> NO_GO", "ExampleCo", "https://example.com", test2Ev, "Bo Zhao", "CTO", undefined, "NO_GO", "PASSED", "PRODUCTION", undefined, undefined);

  const realEv: Evidence[] = [{
    id: 'evReal', evidence_origin: 'REAL_PUBLIC_OBSERVATION', public_url: 'https://api.example.com/v1/users', source_type: 'API_ENDPOINT', status: 200,
    observed_behavior: 'The payload exposes internal metadata fields like storage_path.', sensitive_fields: ['storage_path'], reproductions: 3, repeatable: true, tested_without_auth: true, not_tested: ['access private data'], retrieved_at: '2023-10-01', evidence_text: '', owner_source_link: 'Bo Zhao repository owner'
  }];
  await runTest("SIMULATED_REAL_PUBLIC_OBSERVATION_PROVIDER_TEST", "ExampleCo", "https://example.com", [], "Bo Zhao", "CTO", undefined, "GO", "PASSED", "PRODUCTION", undefined, new MockProvider(realEv));

  const mockFromProvider: Evidence[] = [{ ...realEv[0], evidence_origin: 'MOCK_TEST' }];
  await runTest("TEST 20: PRODUCTION + provider returning MOCK_TEST -> NO_GO", "ExampleCo", "https://example.com", [], "Bo Zhao", "CTO", undefined, "NO_GO", "PASSED", "PRODUCTION", undefined, new MockProvider(mockFromProvider));

  const malformedFromProvider: any[] = [{ ...realEv[0], retrieved_at: undefined }];
  await runTest("TEST 21: PRODUCTION + provider returning malformed evidence -> NO_GO", "ExampleCo", "https://example.com", [], "Bo Zhao", "CTO", undefined, "NO_GO", "PASSED", "PRODUCTION", undefined, new MockProvider(malformedFromProvider));

  // NEW OPERATIONAL TEST
  const test22Ev: Evidence[] = [{
    id: 'ev_sim_real_go', evidence_origin: 'REAL_PUBLIC_OBSERVATION', public_url: 'https://api.example.com/v1/users', source_type: 'API_ENDPOINT', status: 200,
    observed_behavior: 'The payload exposes internal metadata fields like storage_path.', sensitive_fields: ['storage_path'], reproductions: 3, repeatable: true, tested_without_auth: true, not_tested: ['access private data'], retrieved_at: '2023-10-01', evidence_text: ''
  }];
  await runTest("TEST 22: REAL_PUBLIC_OBSERVATION path with supplied owner evidence (GO)", "ExampleCo", "https://api.example.com", [], "Jane Doe", "VP Engineering", "Jane Doe is listed as author explicitly matches", "GO", "PASSED", "PRODUCTION", undefined, new MockProvider(test22Ev));


  console.log("\n==================================================");
  console.log("FINAL RESULTS");
  console.log("==================================================");
  console.log(`Tests Executed: ${testCount}`);
  console.log(`Pass Count: ${passCount}`);
  console.log(`Fail Count: ${failCount}`);

  if (failCount > 0) {
    console.error("TEST SUITE FAILED. ASSERTIONS DID NOT MATCH.");
    expect(failCount).toBe(0);
  }
}

runTests();

  });
});