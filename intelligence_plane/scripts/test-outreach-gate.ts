import { OutreachEligibilityGate } from '../src/server/discovery/OutreachEligibilityGate';
import { OpportunityEvidencePacket } from '../src/server/discovery/SemanticTypes';

async function runTests() {
  const gate = new OutreachEligibilityGate();
  const results: any[] = [];

  const testCases = [
    {
      name: "CASE 1: 0 evidence, RESEARCH_MORE",
      packet: {
        organization: 'Test Org',
        domain: 'test.com',
        supportingEvidence: [],
        decision: { state: 'RESEARCH_MORE', reason: 'More info needed' },
        provenance: 'Web',
        decisionReason: 'More info needed'
      } as any,
      expected: false
    },
    {
      name: "CASE 2: 1 evidence, RESEARCH_MORE",
      packet: {
        organization: 'Test Org',
        domain: 'test.com',
        supportingEvidence: ['e1'],
        decision: { state: 'RESEARCH_MORE', reason: 'More info needed' },
        provenance: 'Web',
        decisionReason: 'More info needed'
      } as any,
      expected: false
    },
    {
      name: "CASE 3: valid evidence, ADVISORY_OPPORTUNITY",
      packet: {
        organization: 'Test Org',
        domain: 'test.com',
        supportingEvidence: ['e1'],
        decision: { state: 'ADVISORY_OPPORTUNITY', reason: 'Scaling signal' },
        provenance: 'Web',
        decisionReason: 'Scaling signal'
      } as any,
      expected: true
    },
    {
      name: "CASE 4: valid evidence, VERIFIED_FINDING",
      packet: {
        organization: 'Test Org',
        domain: 'test.com',
        supportingEvidence: ['e1'],
        decision: { state: 'VERIFIED_FINDING', reason: 'Confirmed exposure' },
        provenance: 'Web',
        decisionReason: 'Confirmed exposure'
      } as any,
      expected: true
    }
  ];

  console.log(`\n==================================================`);
  console.log(`OUTREACH GATE UNIT TESTS`);
  console.log(`==================================================`);

  for (const tc of testCases) {
    const res = gate.checkEligibility(tc.packet);
    const passed = res.eligible === tc.expected;
    console.log(`${passed ? '✅' : '❌'} ${tc.name} | Expected: ${tc.expected} | Actual: ${res.eligible} ${res.gaps.length ? `(${res.gaps.join(', ')})` : ''}`);
  }
}

runTests().catch(console.error);
