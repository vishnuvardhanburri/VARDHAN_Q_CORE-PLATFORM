/**
 * VARDHAN — OutreachDrafting tests (STAGE 6).
 * Deterministic, no network. Run with:
 *   npx vitest run tests/outreachDrafting.test.ts
 */
import { describe, test, expect } from 'vitest';
import {
  BODY_MAX_WORDS,
  BODY_MIN_WORDS,
  OUTREACH_CTA,
  checkSimilarity,
  containsUnsupportedClaim,
  countWords,
  draftOutreach,
  draftOutreachWithReason,
  jaccardSimilarity,
  type OutreachDraft,
} from '../src/server/commercial/OutreachDrafting.ts';
import type {
  CommercialStage,
  QualifiedOpportunity,
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

function strongOpp(): QualifiedOpportunity {
  return {
    company: 'Acme Corp',
    sector: 'Developer Infrastructure',
    geography: 'UK',
    workflow: 'Release signing and artifact verification',
    publicFacts: [
      {
        fact: 'Acme migrated its build pipeline to signed artifacts in August 2026.',
        sourceUrl: 'https://acme.com/blog/signing',
      },
    ],
    problemHypothesis: 'Release verification is manual and slows down deployments.',
    inferenceVsFact:
      'Fact: signed-artifact migration announced. Inference: verification is manual.',
    whyNow: {
      event: 'announced a platform migration program to modernize its build infrastructure',
      sourceUrl: 'https://acme.com/blog/migration',
      publishedDate: '2026-09-01',
      relevance: 'Migration creates review load for the signing workflow.',
      freshnessDays: 46,
    },
    capabilityMappings: [
      {
        capability: 'sealed-receipts',
        evidenceRef: { sourceFile: 'backend/vardhan_receipt', testName: 'validate-canonical' },
        level: 'DEMONSTRATED',
      },
    ],
    buyerRole: {
      function: 'Head of Platform Engineering',
      why: 'Owns release verification and deployment tooling.',
      buyerType: 'TECHNICAL',
    },
    commercial: STAGES,
    verdict: 'GO',
    verdictReason: 'Qualified fixture.',
  };
}

/** Same company, genuinely different signal / fact / hypothesis. */
function altSignalOpp(): QualifiedOpportunity {
  const opp: QualifiedOpportunity = strongOpp();
  return {
    ...opp,
    publicFacts: [
      {
        fact: 'Acme hired forty platform engineers across its infrastructure teams this year.',
        sourceUrl: 'https://acme.com/blog/hiring',
      },
    ],
    problemHypothesis: 'Release volume now strains manual review capacity across services.',
    whyNow: {
      event: 'opened a new platform engineering hub and doubled its weekly release cadence',
      sourceUrl: 'https://acme.com/news/engineering-hub',
      publishedDate: '2026-08-12',
      relevance: 'Higher release volume increases review load.',
      freshnessDays: 66,
    },
  };
}

function countChar(text: string, ch: string): number {
  let n = 0;
  for (const c of text) {
    if (c === ch) n += 1;
  }
  return n;
}

describe('outreach drafting (STAGE 6)', () => {
  test('(a) GO + strong evidence drafts a 60-100 word body with verbatim CTA', () => {
    const draft: OutreachDraft | null = draftOutreach(strongOpp());
    expect(draft).not.toBeNull();
    if (draft === null) return;
    expect(draft.wordCount).toBeGreaterThanOrEqual(BODY_MIN_WORDS);
    expect(draft.wordCount).toBeLessThanOrEqual(BODY_MAX_WORDS);
    expect(draft.wordCount).toBe(countWords(draft.body));
    expect(draft.body).toContain(OUTREACH_CTA);
    expect(draft.cta).toBe('Would it be worth a 10-minute review?');
    // Exactly one question: the verbatim CTA owns the single '?'.
    expect(countChar(draft.body, '?')).toBe(1);
    expect(draft.body.toLowerCase()).toContain('we hypothesize');
    expect(draft.body).toContain('your existing controls may already cover this');
    expect(draft.signalUrl).toBe('https://acme.com/blog/migration');
    expect(draft.signalDate).toBe('2026-09-01');
    expect(draft.templateHash).toMatch(/^[0-9a-f]{8}$/);
  });

  test('(b) HOLD verdict returns null (brief-without-email)', () => {
    const opp: QualifiedOpportunity = { ...strongOpp(), verdict: 'HOLD', verdictReason: 'Holding.' };
    expect(draftOutreach(opp)).toBeNull();
    const withReason = draftOutreachWithReason(opp);
    expect(withReason.draft).toBeNull();
    expect(withReason.reason).not.toBeNull();
  });

  test('(c) missing whyNow returns null', () => {
    const opp: QualifiedOpportunity = {
      ...strongOpp(),
      whyNow: null,
      verdictReason: 'Fixture with no trigger.',
    };
    expect(draftOutreach(opp)).toBeNull();
    expect(draftOutreachWithReason(opp).reason).toMatch(/WHY_NOW/);
  });

  test('(d) same company, different signals stay under the similarity threshold', () => {
    const first: OutreachDraft | null = draftOutreach(strongOpp());
    const second: OutreachDraft | null = draftOutreach(altSignalOpp());
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (first === null || second === null) return;
    expect(jaccardSimilarity(first.body, second.body)).toBeLessThan(0.55);
  });

  test('(e) identical input twice exercises the tooSimilar path', () => {
    const opp: QualifiedOpportunity = strongOpp();
    const first: OutreachDraft | null = draftOutreach(opp);
    expect(first).not.toBeNull();
    if (first === null) return;
    // Direct check: the body is maximally similar to itself.
    const self: { maxSim: number; tooSimilar: boolean } = checkSimilarity(first, [first.body]);
    expect(self.maxSim).toBe(1);
    expect(self.tooSimilar).toBe(true);
    // Second draft with the first as prior: blocked or rewritten, never a silent duplicate.
    const again = draftOutreachWithReason(opp, [first.body], [first.templateHash]);
    if (again.draft !== null) {
      expect(checkSimilarity(again.draft, [first.body]).tooSimilar).toBe(false);
    } else {
      expect(again.reason).toMatch(/template reuse blocked/i);
    }
  });

  test('(f) unsupported claim blocks the draft', () => {
    expect(containsUnsupportedClaim('Our production-ready multi-node cluster')).toBe(true);
    const opp: QualifiedOpportunity = {
      ...strongOpp(),
      problemHypothesis:
        'Release verification needs our production-ready multi-node platform for scale.',
    };
    expect(draftOutreach(opp)).toBeNull();
    expect(draftOutreachWithReason(opp).reason).toMatch(/Unsupported claim blocked/);
  });

  test('(g) no price appears by default', () => {
    const draft: OutreachDraft | null = draftOutreach(strongOpp());
    expect(draft).not.toBeNull();
    if (draft === null) return;
    for (const token of ['$', '€', '£', 'USD', 'price', 'Price', 'cost', '15K', '15k', '60K', '60k']) {
      expect(draft.body).not.toContain(token);
    }
    expect(draft.body).not.toMatch(/\b\d+\s?(USD|EUR|GBP|dollars)\b/);
  });
});
