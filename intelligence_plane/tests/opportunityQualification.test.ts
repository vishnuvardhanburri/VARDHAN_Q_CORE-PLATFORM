/**
 * VARDHAN — OpportunityQualification tests (STAGE 4).
 * Deterministic, no network. Run with:
 *   npx vitest run tests/opportunityQualification.test.ts
 */
import { describe, test, expect } from 'vitest';
import {
  qualifyOpportunity,
  scoreOpportunity,
  QCORE_CAPABILITY_REGISTRY,
  type OpportunityQualificationInput,
  type CommercialStage,
} from '../src/server/commercial/OpportunityQualification.ts';

const STAGES: CommercialStage[] = [
  {
    stage: 'DISCOVERY_15K',
    buyerOutcome: 'Scoped diagnostic with evidence-backed findings.',
    deliverables: ['Diagnostic report', 'Evidence pack'],
    customerInputs: ['API access to sandbox', 'Architecture overview call'],
    acceptanceCriteria: ['Report delivered in 3 weeks', 'Findings reviewed with sponsor'],
    dependencies: ['NDA signed'],
  },
];

function strongInput(): OpportunityQualificationInput {
  return {
    company: 'Acme Corp',
    sector: 'Developer Infrastructure',
    geography: 'UK',
    workflow: 'Release signing and artifact verification',
    publicFacts: [
      { fact: 'Acme migrated its build pipeline to signed artifacts.', sourceUrl: 'https://acme.com/blog/signing' },
    ],
    problemHypothesis: 'Release verification is manual and slows down deployments.',
    inferenceVsFact: 'Fact: signed-artifact migration announced. Inference: verification is manual.',
    whyNow: {
      event: 'Acme announced a platform migration program.',
      sourceUrl: 'https://acme.com/blog/migration',
      publishedDate: '2026-09-01',
      relevance: 'Migration creates a window for signing tooling.',
      freshnessDays: 20,
    },
    capabilityMappings: [
      {
        capability: 'sealed-receipts',
        evidenceRef: { sourceFile: 'backend/vardhan_receipt', testName: 'validate-canonical' },
        level: 'DEMONSTRATED',
      },
    ],
    buyerRole: { function: 'VP Engineering', why: 'Owns release velocity.', buyerType: 'ECONOMIC' },
    commercial: STAGES,
  };
}

describe('OpportunityQualification (STAGE 4)', () => {
  test('(a) no whyNow → HOLD/DROP, never GO', () => {
    const out = qualifyOpportunity({ ...strongInput(), whyNow: null });
    expect(out.verdict === 'HOLD' || out.verdict === 'DROP').toBe(true);
    expect(out.verdict).not.toBe('GO');
    expect(out.resolveEvidence ?? out.verdictReason).toBeTruthy();
  });

  test('(b) stale whyNow (freshnessDays 400) → not GO', () => {
    const input = strongInput();
    input.whyNow = { ...input.whyNow!, freshnessDays: 400 };
    const out = qualifyOpportunity(input);
    expect(out.verdict).not.toBe('GO');
    expect(out.verdict).toBe('HOLD');
  });

  test('(c) no capability mapping → not GO', () => {
    const out = qualifyOpportunity({ ...strongInput(), capabilityMappings: [] });
    expect(out.verdict).not.toBe('GO');
  });

  test('(d) NOT_SUPPORTED mapping (multi-node) → DROP', () => {
    const input = strongInput();
    input.capabilityMappings = [
      ...input.capabilityMappings,
      {
        capability: 'multi-node-clustering',
        evidenceRef: { sourceFile: 'NONE', testName: 'NONE' },
        level: 'NOT_SUPPORTED',
      },
    ];
    const out = qualifyOpportunity(input);
    expect(out.verdict).toBe('DROP');
    expect(out.verdictReason.toLowerCase()).toContain('not_supported');
  });

  test('(e) strong input → GO with reason', () => {
    const out = qualifyOpportunity(strongInput());
    expect(out.verdict).toBe('GO');
    expect(out.verdictReason.trim().length).toBeGreaterThan(0);
    expect(scoreOpportunity(strongInput())).toBeGreaterThanOrEqual(80);
  });

  test('(f) speculative wording → HOLD', () => {
    const input = strongInput();
    input.problemHypothesis = 'Acme has a critical vulnerability and control failure causing breach risk.';
    input.publicFacts = [{ fact: 'Acme hired platform engineers.', sourceUrl: 'https://acme.com/careers' }];
    const out = qualifyOpportunity(input);
    expect(out.verdict).toBe('HOLD');
  });

  test('(g) determinism: same input twice → identical verdict+score', () => {
    const input = strongInput();
    const a = qualifyOpportunity(input, '2026-10-17T00:00:00.000Z');
    const b = qualifyOpportunity(input, '2026-10-17T00:00:00.000Z');
    expect(a.verdict).toBe(b.verdict);
    expect(a.verdictReason).toBe(b.verdictReason);
    expect(scoreOpportunity(input)).toBe(scoreOpportunity(structuredClone(input)));
  });

  test('(h) scoring weights: evidence+fit dominate (drop fit → score falls ≥25)', () => {
    const full = scoreOpportunity(strongInput());
    const noFit = scoreOpportunity({ ...strongInput(), capabilityMappings: [] });
    expect(full - noFit).toBeGreaterThanOrEqual(25);
  });

  test('registry: 8 evidenced entries + NOT_SUPPORTED guards', () => {
    const evidenced = QCORE_CAPABILITY_REGISTRY.filter((e) => e.evidenceRef.sourceFile !== 'NONE');
    expect(evidenced.length).toBeGreaterThanOrEqual(8);
    const guard = QCORE_CAPABILITY_REGISTRY.find((e) => e.capability === 'multi-node-clustering');
    expect(guard?.maxClaimLevel).toBe('NOT_SUPPORTED');
  });

  test('planned-as-available for PRODUCTION → DROP', () => {
    const input = strongInput();
    input.capabilityMappings = [
      {
        capability: 'future-connector',
        evidenceRef: { sourceFile: 'roadmap', testName: 'planned' },
        level: 'PLANNED',
      },
    ];
    input.commercial = [
      {
        ...STAGES[0],
        stage: 'PRODUCTION',
        buyerOutcome: 'Full production rollout.',
        deliverables: ['Production deployment'],
        customerInputs: ['Production access'],
        acceptanceCriteria: ['SLOs met'],
        dependencies: [],
      },
    ];
    expect(qualifyOpportunity(input).verdict).toBe('DROP');
  });
});
