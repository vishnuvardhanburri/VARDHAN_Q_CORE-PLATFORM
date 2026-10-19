import { 
  createEmptyCompanyIntelligenceProfile, 
  assertValidCompanyIntelligenceProfile,
  Evidence,
  IntelligenceCase
} from '../src/server/IntelligenceCase';
import { BroadIntelligenceOrchestrator } from '../src/server/BroadIntelligenceOrchestrator';
import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';

async function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${name}: PASS`);
  } catch (e: any) {
    console.error(`❌ ${name}: FAIL - ${e.message}`);
    console.error(`Stack: ${e.stack}`);
    process.exit(1);
  }
}

async function main() {
  console.log('Running Profile Synthesis Regression Tests...\n');

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => ({ status: 200, text: () => Promise.resolve('OK'), json: () => Promise.resolve({}) } as any),
    output: { write: (s: string) => {} }
  } as any);
  const orchestrator = new BroadIntelligenceOrchestrator(manager);

  runTest('Case 1: Empty Profile Initialization', () => {
    const profile = createEmptyCompanyIntelligenceProfile('TestCorp', 'testcorp.com');
    assertValidCompanyIntelligenceProfile(profile, 'TestCorp');
  });

  runTest('Case 2: Zero Evidence Synthesis', () => {
    const caseData: any = {
      company: 'TestCorp',
      domain: 'testcorp.com',
      evidence: [],
    };
    const profile = (orchestrator as any).synthesizeProfile(caseData);
    assertValidCompanyIntelligenceProfile(profile, 'TestCorp');
  });

  runTest('Case 3: Evidence Classification Synthesis', () => {
    const caseData: any = {
      company: 'TestCorp',
      domain: 'testcorp.com',
      evidence: [
        { 
          id: 'e1', 
          classification: 'SURFACE', 
          public_url: 'https://api.testcorp.com', 
          provenance: { attribution: 'Direct' } 
        },
        { 
          id: 'e2', 
          factualObservation: 'uses AWS', 
          provenance: { attribution: 'Infrastructure Clue' } 
        },
        { 
          id: 'e3', 
          observed_behavior: 'incident found', 
          provenance: { attribution: 'Reliability Evidence' } 
        }
      ]
    };
    const profile = (orchestrator as any).synthesizeProfile(caseData);
    assertValidCompanyIntelligenceProfile(profile, 'TestCorp');
  });

  console.log('\nAll regression tests passed.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
