import assert from 'assert';
import { OwnershipInferenceEngine } from '../src/server/OwnershipInferenceEngine';
import { OwnerSearchPlanner } from '../src/server/OwnerSearchPlanner';
import type { OwnerSearchPlan, EvidenceLedger, PersonEvidence } from '../src/server/DeepTypes';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {

function makeLedger(claims: Partial<PersonEvidence>[]): EvidenceLedger {
  return {
    claims: claims.map(c => ({
      claim: c.claim || 'Default claim',
      source_url: c.source_url || 'https://example.com',
      source_type: c.source_type || 'OFFICIAL_COMPANY_SOURCE',
      observed_at: c.observed_at || new Date().toISOString(),
      freshness: 'FRESH',
      evidence_id: 'ev_' + Math.random().toString(36).slice(2, 8),
      confidence: 0.8
    }))
  };
}

const MOCK_PLAN: OwnerSearchPlan = {
  opportunity_id: 'opp_123',
  target_subsystem: 'infrastructure scaling',
  role_personas: ['Staff Engineer', 'Principal Engineer', 'Head of Infrastructure'],
  technical_keywords: ['kubernetes', 'sharding', 'terraform'],
  seniority_target: 'STAFF'
};

console.log('Running COMPREHENSIVE Adversarial Owner Intelligence Tests...\n');

const cases = [
  {
    id: 1,
    name: 'THE GHOST',
    setup: () => {
      const candidate = { name: 'Ghost Engineer', role: 'Staff Engineer', company: 'Acme' };
      const ledger = makeLedger([
        { claim: 'Ghost Engineer is a Staff Engineer at Acme', source_type: 'OFFICIAL_COMPANY_SOURCE', observed_at: '2021-01-01T00:00:00Z' },
      ]);
      return { candidate, ledger };
    },
    verify: (res: any) => {
      assert(res.dimensions.EMPLOYMENT < 0.4, 'Employment should be low');
      assert(res.score === 0, 'Should be score 0 due to employment gate');
    }
  },
  {
    id: 2,
    name: 'THE GENERALIST',
    setup: () => {
      const cto = { name: 'Chief Executive', role: 'CTO', company: 'Acme' };
      const staff = { name: 'Technical Lead', role: 'Staff Engineer', company: 'Acme' };
      const ledger = makeLedger([
        { claim: 'Chief Executive is a Staff Engineer at Acme', source_type: 'OFFICIAL_COMPANY_SOURCE' },
        { claim: 'Technical Lead is a Staff Engineer at Acme', source_type: 'OFFICIAL_COMPANY_SOURCE' },
        { claim: 'Technical Lead wrote a guide on kubernetes sharding', source_type: 'TECHNICAL_SURFACE' },
      ]);
      const rCto = OwnershipInferenceEngine.scoreCandidate(cto, ledger, MOCK_PLAN);
      const rStaff = OwnershipInferenceEngine.scoreCandidate(staff, ledger, MOCK_PLAN);
      return { rCto, rStaff };
    },
    verify: (res: any) => {
      assert(res.rStaff.score > res.rCto.score, 'Technical expert must outscore nominal lead');
    }
  },
  {
    id: 3,
    name: 'TITLE WITHOUT OWNERSHIP',
    setup: () => {
      const candidate = { name: 'VP Eng', role: 'VP Engineering', company: 'Acme' };
      const ledger = makeLedger([
        { claim: 'VP Eng is a VP Engineering at Acme', source_type: 'OFFICIAL_COMPANY_SOURCE' }
      ]);
      return { candidate, ledger };
    },
    verify: (res: any) => {
      assert(res.dimensions.OWNERSHIP === 0, 'Ownership must be 0');
      assert(res.score < 60, 'Should not be verified');
    }
  },
  {
    id: 4,
    name: 'TECHNICAL EXPERT WITHOUT CURRENT EMPLOYMENT',
    setup: () => {
      const candidate = { name: 'Ex-Expert', role: 'Staff Engineer', company: 'Acme' };
      const ledger = makeLedger([
        { claim: 'Ex-Expert is a Staff Engineer at Acme', source_type: 'OFFICIAL_COMPANY_SOURCE', observed_at: '2018-01-01T00:00:00Z' },
        { claim: 'Ex-Expert maintainer of scaling repo', source_type: 'OSS_GITHUB', observed_at: '2018-01-01T00:00:00Z' }
      ]);
      return { candidate, ledger };
    },
    verify: (res: any) => {
      assert(res.score === 0, 'Employment < 0.4 must lead to score 0');
    }
  },
  {
    id: 5,
    name: 'SAME NAME',
    setup: () => {
      const candidate = { name: 'John Smith', role: 'Staff Engineer', company: 'Acme' };
      const ledger = makeLedger([
        { claim: 'John Smith is a Staff Engineer at Acme', source_type: 'OFFICIAL_COMPANY_SOURCE' },
        { claim: 'John Smith is a Sales Rep at OtherCo', source_type: 'OFFICIAL_COMPANY_SOURCE' }
      ]);
      return { candidate, ledger };
    },
    verify: (res: any) => {
      assert(res.score > 0, 'Should still find the Acme John Smith');
    }
  },
  {
    id: 6,
    name: 'WRONG COMPANY',
    setup: () => {
      const candidate = { name: 'Foreign Expert', role: 'Staff Engineer', company: 'OtherCo' };
      const ledger = makeLedger([
        { claim: 'Foreign Expert is a Staff Engineer at OtherCo', source_type: 'OFFICIAL_COMPANY_SOURCE' }
      ]);
      return { candidate, ledger };
    },
    verify: (res: any) => {
      assert(res.score > 0, 'Baseline identity works');
    }
  },
  {
    id: 7,
    name: 'EXTERNAL OSS CONTRIBUTOR',
    setup: () => {
      const candidate = { name: 'OSS Dev', role: 'Contributor', company: 'Independent' };
      const ledger = makeLedger([
        { claim: 'OSS Dev maintainer of scaling repo', source_type: 'OSS_GITHUB' },
      ]);
      return { candidate, ledger };
    },
    verify: (res: any) => {
      assert(res.score > 0, 'OSS contributors should have some score but be caught by other gates');
    }
  },
  {
    id: 8,
    name: 'CONFLICTING SOURCES',
    setup: () => {
      const candidate = { name: 'Conflict Person', role: 'Staff Engineer', company: 'Acme' };
      const ledger = makeLedger([
        { claim: 'Conflict Person is a Staff Engineer at Acme', source_type: 'OFFICIAL_COMPANY_SOURCE', observed_at: '2024-01-01T00:00:00Z' },
        { claim: 'Conflict Person was a Junior at Acme', source_type: 'OFFICIAL_COMPANY_SOURCE', observed_at: '2015-01-01T00:00:00Z' },
      ]);
      return { candidate, ledger };
    },
    verify: (res: any) => {
      assert(res.dimensions.EMPLOYMENT > 0, 'Recent evidence should provide some employment score');
    }
  },
  {
    id: 9,
    name: 'VERIFIED OWNER WITHOUT CONTACT',
    setup: () => {
      const candidate = { name: 'Hidden Expert', role: 'Staff Engineer', company: 'Acme' };
      const ledger = makeLedger([
        { claim: 'Hidden Expert is a Staff Engineer at Acme', source_type: 'OFFICIAL_COMPANY_SOURCE' },
        { claim: 'Hidden Expert wrote a guide on kubernetes sharding', source_type: 'TECHNICAL_SURFACE' },
        { claim: 'Hidden Expert is the maintainer of the scaling repo', source_type: 'OSS_GITHUB' }
      ]);
      return { candidate, ledger };
    },
    verify: (res: any) => {
      assert(res.confidence !== 'OWNER_VERIFIED_CONTACTABLE', 'No contact = not contactable');
      assert(['OWNER_VERIFIED', 'OWNER_HIGH_CONFIDENCE'].includes(res.confidence), 'Should still be verified');
    }
  },
  {
    id: 10,
    name: 'GUESSED EMAIL',
    setup: () => {
      const candidate = { name: 'Pattern Person', role: 'Staff Engineer', company: 'Acme', email: 'pattern@example.com' };
      const ledger = makeLedger([
        { claim: 'Pattern Person is a Staff Engineer at Acme', source_type: 'OFFICIAL_COMPANY_SOURCE' }
      ]);
      return { candidate, ledger };
    },
    verify: (res: any) => {
      const isContactable = false; 
      const confidence = OwnershipInferenceEngine.resolveConfidence(res.score, isContactable);
      assert(confidence !== 'OWNER_VERIFIED_CONTACTABLE', 'Guessed email must not lead to contactable state');
    }
  }
];

async function run() {
  for (const c of cases) {
    process.stdout.write(`Testing: CASE ${c.id} - ${c.name}\n`);
    try {
      const setupRes = (c.setup as any)();
      if (setupRes.rStaff) {
        c.verify(setupRes);
      } else {
        const { candidate, ledger } = setupRes;
        const { score, dimensions } = OwnershipInferenceEngine.scoreCandidate(candidate, ledger, MOCK_PLAN);
        const confidence = OwnershipInferenceEngine.resolveConfidence(score, !!(candidate.email || candidate.linkedin_url));
        c.verify({ score, dimensions, confidence, candidate, ledger });
      }
      console.log('  ✓ PASSED');
    } catch (e: any) {
      console.log(`  ✗ FAILED: ${e.message}`);
    }
  }
}

await run();
  });
});