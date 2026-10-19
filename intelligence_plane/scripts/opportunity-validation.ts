import { OpportunityDecisionEngine } from '../src/server/discovery/OpportunityDecisionEngine';
import { OutreachEligibilityGate } from '../src/server/discovery/OutreachEligibilityGate';
import { InvestigationHypothesis } from '../src/server/IntelligenceCase';

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN OPPORTUNITY DECISION VALIDATION`);
  console.log(`==================================================`);

  const engine = new OpportunityDecisionEngine();
  const gate = new OutreachEligibilityGate();

  const testCases = [
    {
      name: "Verified Finding Case",
      hypotheses: [{ id: 'h1', claim: 'Public API exposure', status: 'VERIFIED', evidenceIds: ['e1'], confidence: 1.0 } as any],
      evidence: [{ id: 'e1', provenance: { provider: 'CURL' } } as any],
      complexity: { nodes: [{ id: 'n1' }] } as any,
      expected: 'VERIFIED_FINDING'
    },
    {
      name: "Advisory Opportunity Case",
      hypotheses: [{ id: 'h2', claim: 'Scaling transition to GPU cluster', status: 'HYPOTHESIS', evidenceIds: ['e2'], confidence: 0.8 } as any],
      evidence: [{ id: 'e2', provenance: { provider: 'BLOG' } } as any],
      complexity: { nodes: [{ id: 'n1' }] } as any,
      expected: 'ADVISORY_OPPORTUNITY'
    },
    {
      name: "Investigation Case",
      hypotheses: [{ id: 'h3', claim: 'Potential data plane lag', status: 'HYPOTHESIS', evidenceIds: ['e3'], confidence: 0.4 } as any],
      evidence: [{ id: 'e3', provenance: { provider: 'SITES' } } as any],
      complexity: { nodes: [{ id: 'n1' }, { id: 'n2' }] } as any,
      expected: 'INVESTIGATION_OPPORTUNITY'
    },
    {
      name: "No Signal Case",
      hypotheses: [],
      evidence: [],
      complexity: { nodes: [] } as any,
      expected: 'NO_ACTIONABLE_SIGNAL'
    }
  ];

  for (const tc of testCases) {
    console.log(`\nTesting: ${tc.name}`);
    const decision = await engine.decide(
      { name: 'TestOrg' },
      tc.evidence,
      [],
      tc.complexity,
      { nodes: new Map(), edges: [] },
      [],
      [],
      tc.hypotheses,
      [],
      {}
    );
    console.log(`Decision: ${decision.state}`);
    console.log(`Reason: ${decision.reason}`);
    
    const packet = await engine.createEvidencePacket({ name: 'TestOrg', domain: 'test.com' }, decision, {
      signals: ['SIG1'],
      evidenceIds: ['E1'],
      hypotheses: tc.hypotheses,
      sourceUrls: ['url1']
    });

    const eligibility = gate.checkEligibility(packet);
    console.log(`Outreach Eligible: ${eligibility.eligible} ${eligibility.gaps.length ? `(Gaps: ${eligibility.gaps.join(', ')})` : ''}`);
    
    const success = decision.state === tc.expected;
    console.log(`Result: ${success ? '✅ PASS' : '❌ FAIL (Expected ' + tc.expected + ')'}`);
  }
}

main().catch(console.error);
