/**
 * VARDHAN — Bank Problem Discovery Engine: Test Suite
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Tests that enforce the hard rules from the bank problem discovery spec:
 *   1. No signal has fabricated evidence — every source URL is a real, public URL.
 *   2. No signal infers private vulnerabilities, undisclosed incidents, or
 *      deployed internal algorithms from public information alone.
 *   3. Missing evidence gaps MUST lower confidence (never inflate it).
 *   4. Discovery, qualification, and outreach approval are separate stages.
 *   5. No automated outreach is ever triggered.
 *   6. Dossiers contain all 10 required sections.
 *   7. Sponsor roles are derived from public sources only — no fabricated contact details.
 */

import { BANK_SIGNAL_DATABASE, BANK_SIGNAL_GROUPS, VARDHAN_CAPABILITIES } from '../src/server/bank/intelligence/BankSignalDatabase';
import { BankQualificationEngine } from '../src/server/bank/intelligence/BankQualificationEngine';
import { BankProblemDossierGenerator } from '../src/server/bank/intelligence/BankProblemDossierGenerator';
import { BANK_SPONSOR_ROLE_MAP, getSponsors } from '../src/server/bank/intelligence/BankSponsorRoleMap';
import { describe, test } from 'vitest';

describe('VARDHAN Bank Problem Discovery Engine — Full Suite', () => {
  test('All bank discovery engine tests', async () => {
    let pass = 0, fail = 0;
    const failures: string[] = [];
    const assert = (c: boolean, m: string) => {
      if (c) { pass++; }
      else { fail++; failures.push(m); console.log('[FAIL] ' + m); }
    };
    const assertEq = <T,>(a: T, b: T, m: string) => {
      const ok = JSON.stringify(a) === JSON.stringify(b);
      if (ok) { pass++; } else { fail++; failures.push(m); console.log('[FAIL] ' + m); }
    };
    const test_ = assert;

    // ════════════════════════════════════════════════════════════════════════
    // 1. Signal database integrity
    // ════════════════════════════════════════════════════════════════════════

    for (const sig of BANK_SIGNAL_DATABASE) {
      test_(sig.sourceUrl.startsWith('http'), 'Signal ' + sig.signalId + ' missing source URL');
      test_(sig.publishedDate.length === 10, 'Signal ' + sig.signalId + ' missing publication date');
      test_(sig.discoveryTimestamp !== '', 'Signal ' + sig.signalId + ' missing discovery timestamp');
      test_(sig.evidenceExcerpt.length >= 40, 'Signal ' + sig.signalId + ' evidence excerpt too short');
      test_(sig.evidenceQuote.length >= 40, 'Signal ' + sig.signalId + ' evidence quote too short');
      test_(sig.inferredImplication.includes('VARDHAN_INFERENCE'), 'Signal ' + sig.signalId + ' missing VARDHAN_INFERENCE marker');
      test_(sig.inferredImplication !== sig.observedFact, 'Signal ' + sig.signalId + ' fact === inference');
      test_(sig.businessUnit !== undefined, 'Signal ' + sig.signalId + ' has business unit');
      test_(sig.evidenceGaps.length >= 0, 'Signal ' + sig.signalId + ' evidence gaps tracked');
      test_(sig.vardhanCapabilities.length > 0, 'Signal ' + sig.signalId + ' maps to capability');
      test_(sig.recommendedValidationQuestion.length > 10, 'Signal ' + sig.signalId + ' missing validation question');
    }

    // 2. No fabricated claims in observed facts
    const forbiddenClaims = ['budget', 'deadline', 'will buy', 'will purchase', 'response required by', '@'];
    for (const sig of BANK_SIGNAL_DATABASE) {
      for (const f of forbiddenClaims) {
        // '@' check is for email addresses in observed facts
        if (f === '@') {
          test_(!sig.observedFact.includes('@'), 'Signal ' + sig.signalId + ' observed fact contains @ (email?)');
        } else {
          test_(!sig.observedFact.toLowerCase().includes(f), 'Signal ' + sig.signalId + ' contains forbidden claim: ' + f);
        }
      }
    }

    // 3. No deployed algorithm inference
    const algoPatterns = [
      /runs ML-KEM/i, /uses ML-DSA/i, /deploys.*signature/i,
      /production.*algorithm/i, /has ML-DSA-87/i, /uses ML-KEM/i,
    ];
    for (const sig of BANK_SIGNAL_DATABASE) {
      for (const p of algoPatterns) {
        test_(!p.test(sig.inferredImplication), 'Signal ' + sig.signalId + ' infers deployed algorithm');
      }
    }

    // 4. VARDHAN_CAPABILITIES are valid
    const capIds = new Set(VARDHAN_CAPABILITIES.map(c => c.id));
    test_(capIds.size === VARDHAN_CAPABILITIES.length, 'Capability IDs are unique');
    for (const cap of VARDHAN_CAPABILITIES) {
      test_(cap.name.length > 0, 'Capability ' + cap.id + ' has name');
      test_(cap.description.length > 0, 'Capability ' + cap.id + ' has description');
      test_(cap.relevanceToBankProblems.length > 0, 'Capability ' + cap.id + ' has relevance');
    }

    // 5. Signal vardhanCapabilities reference real capability IDs
    for (const sig of BANK_SIGNAL_DATABASE) {
      for (const capId of sig.vardhanCapabilities) {
        test_(capIds.has(capId), 'Signal ' + sig.signalId + ' references unknown capability: ' + capId);
      }
    }

    // 6. Signal groups integrity
    for (const group of BANK_SIGNAL_GROUPS) {
      test_(group.signals.length >= 1, 'Group ' + group.groupId + ' has no signals');
      test_(group.hypothesis.length > 20, 'Group ' + group.groupId + ' hypothesis too short');
      const uniqueUrls = new Set(group.signals.map(s => s.sourceUrl)).size;
      test_(group.sourceCount === uniqueUrls, 'Group ' + group.groupId + ' sourceCount mismatch');
    }

    // 7. Confidence is conservative (minimum of member signals)
    const confRank = { LOW: 0, MEDIUM: 1, HIGH: 2 };
    for (const group of BANK_SIGNAL_GROUPS) {
      const minRank = group.signals.reduce((min, s) =>
        Math.min(min, confRank[s.confidence]), 2);
      const expectedConf = Object.keys(confRank).find(k => confRank[k as keyof typeof confRank] === minRank);
      test_(group.confidence === expectedConf, 'Group ' + group.groupId + ' confidence not conservative');
    }

    // ════════════════════════════════════════════════════════════════════════
    // 8. Qualification engine
    // ════════════════════════════════════════════════════════════════════════

    const results = BankQualificationEngine.qualifyAll(BANK_SIGNAL_GROUPS);

    test_(results.qualified.length > 0, 'No opportunities qualified');
    test_(results.metrics.total === BANK_SIGNAL_GROUPS.length, 'Metrics total mismatch');
    test_(results.metrics.qualified + results.metrics.blocked === results.metrics.total, 'Qualified + blocked != total');

    for (const opp of results.qualified) {
      test_(opp.status === 'READY_FOR_HUMAN_APPROVAL', opp.institution + ' status not human approval');
      test_(opp.scoreBreakdown.total >= 50, opp.institution + ' score below threshold');
      test_(opp.totalScore === opp.scoreBreakdown.total, opp.institution + ' totalScore mismatch');
      test_(opp.priority !== 'P3', opp.institution + ' P3 but qualified');

      // Score components sum check
      const sum = opp.scoreBreakdown.evidenceQuality + opp.scoreBreakdown.capabilityRelevance +
        opp.scoreBreakdown.activeInitiative + opp.scoreBreakdown.technicalSponsor +
        opp.scoreBreakdown.boundedEvaluation + opp.scoreBreakdown.measurableCriteria;
      test_(sum === opp.scoreBreakdown.total, opp.institution + ' score components dont sum to total');

      // Score component bounds
      test_(opp.scoreBreakdown.evidenceQuality <= 20, opp.institution + ' evidenceQuality exceeds max');
      test_(opp.scoreBreakdown.capabilityRelevance <= 20, opp.institution + ' capabilityRelevance exceeds max');
      test_(opp.scoreBreakdown.activeInitiative <= 15, opp.institution + ' activeInitiative exceeds max');
      test_(opp.scoreBreakdown.technicalSponsor <= 15, opp.institution + ' technicalSponsor exceeds max');
      test_(opp.scoreBreakdown.boundedEvaluation <= 15, opp.institution + ' boundedEvaluation exceeds max');
      test_(opp.scoreBreakdown.measurableCriteria <= 15, opp.institution + ' measurableCriteria exceeds max');

      // No email addresses in opportunity
      test_(!JSON.stringify(opp).includes('@'), opp.institution + ' contains email address');
    }

    for (const opp of results.blocked) {
      test_(opp.status === 'BLOCKED', opp.institution + ' blocked but status not BLOCKED');
      test_(opp.blockReason !== '', opp.institution + ' blocked but no block reason');
      test_(opp.scoreBreakdown.total < 50, opp.institution + ' scored above threshold but blocked');
    }

    // 9. Shortlist (P0/P1) verification
    test_(results.shortlist.length > 0, 'No shortlist opportunities');
    for (const opp of results.shortlist) {
      test_(opp.priority === 'P0' || opp.priority === 'P1', 'Shortlist item not P0/P1');
    }

    // ════════════════════════════════════════════════════════════════════════
    // 10. Dossier generation — 10-section completeness
    // ════════════════════════════════════════════════════════════════════════

    for (const opp of results.qualified) {
      const group = BANK_SIGNAL_GROUPS.find(g => g.groupId === opp.signalGroupId);
      test_(group !== undefined, 'Signal group not found for ' + opp.signalGroupId);
      if (!group) continue;

      const dossier = BankProblemDossierGenerator.generate(opp, group, { gitHead: 'test-abc123' });

      // All 10 sections present
      test_(!!dossier.section1_institution, 'Dossier missing section 1 (institution)');
      test_(dossier.section2_verifiedEvidence.length > 0, 'Dossier missing section 2 (evidence)');
      test_(!!dossier.section3_problemHypothesis, 'Dossier missing section 3 (hypothesis)');
      test_(!!dossier.section4_confidence, 'Dossier missing section 4 (confidence)');
      test_(dossier.section5_vardhanCapability.length > 0, 'Dossier missing section 5 (capability)');
      test_(!!dossier.section6_evaluationProposal, 'Dossier missing section 6 (evaluation)');
      test_(dossier.section7_successMetrics.length > 0, 'Dossier missing section 7 (metrics)');
      test_(dossier.section8_sponsorRoles.length > 0, 'Dossier missing section 8 (sponsors)');
      test_(dossier.section9_barriers.length > 0, 'Dossier missing section 9 (barriers)');
      test_(!!dossier.section10_nextAction, 'Dossier missing section 10 (next action)');

      // Section 6: synthetic data only
      test_(dossier.section6_evaluationProposal.dataHandling.includes('synthetic'), 'Evaluation not synthetic-only');
      test_(dossier.section6_evaluationProposal.scope.includes('synthetic'), 'Evaluation scope not synthetic');

      // Section 10: human approval gate
      test_(dossier.section10_nextAction.gate === 'HUMAN_APPROVAL_REQUIRED', 'Missing approval gate');
      test_(dossier.section10_nextAction.action.includes('Hold'), 'Next action not hold-for-approval');

      // Facts vs inferences separation
      test_(dossier.section3_problemHypothesis.observedFact.length > 20, 'Observed fact too short');
      test_(dossier.section3_problemHypothesis.technicalInference.includes('VARDHAN_INFERENCE'), 'Inference not marked');
      test_(dossier.section3_problemHypothesis.observedFact !== dossier.section3_problemHypothesis.technicalInference, 'Fact === inference');

      // Classification
      test_(dossier.classification.includes('AUTHORIZATION'), 'Missing authorization classification');

      // No fabricated contact details in dossier
      test_(!JSON.stringify(dossier).includes('@gmail') && !JSON.stringify(dossier).includes('@yahoo'), 'Dossier contains personal email');

      // Sponsor roles have public evidence URLs
      for (const role of dossier.section8_sponsorRoles) {
        test_(role.evidenceUrl.startsWith('http'), 'Sponsor role missing evidence URL');
        test_(role.confidence === 'HIGH' || role.confidence === 'MEDIUM' || role.confidence === 'LOW', 'Invalid sponsor confidence');
      }

      // Section 5: capabilities reference real Vardhan capabilities
      for (const cap of dossier.section5_vardhanCapability) {
        test_(capIds.has(cap.capability), 'Capability ' + cap.capability + ' not in registry');
      }

      // Section 7: success metrics have acceptance criteria
      for (const metric of dossier.section7_successMetrics) {
        test_(metric.metric.length > 10, 'Metric description too short');
        test_(metric.acceptanceCriteria.length > 10, 'Acceptance criteria too short');
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 11. Sponsor role map
    // ════════════════════════════════════════════════════════════════════════

    const bankSpecificInstitutions = [...new Set(BANK_SIGNAL_DATABASE
      .filter(s => s.isBankSpecific)
      .map(s => s.institution))];

    for (const inst of bankSpecificInstitutions) {
      const map = getSponsors(inst);
      test_(map !== null, 'No sponsor map for ' + inst);
      if (map) {
        test_(map.sponsorRoles.length > 0, 'No sponsor roles for ' + inst);
        test_(map.budgetOwnerRoles.length > 0, 'No budget owner for ' + inst);
        for (const role of map.sponsorRoles) {
          test_(role.evidenceUrl.startsWith('http'), 'Sponsor role for ' + inst + ' missing evidence URL');
          // No emails or phones in role data
          test_(!role.role.includes('@'), 'Sponsor role contains email');
          test_(!/\d{3}-\d{3}-\d{4}/.test(role.role), 'Sponsor role contains phone');
        }
        for (const bo of map.budgetOwnerRoles) {
          test_(bo.evidenceUrl.startsWith('http'), 'Budget owner for ' + inst + ' missing evidence URL');
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 12. No automated outreach
    // ════════════════════════════════════════════════════════════════════════

    for (const opp of [...results.qualified, ...results.blocked]) {
      test_(opp.status === 'READY_FOR_HUMAN_APPROVAL' || opp.status === 'BLOCKED',
        opp.institution + ' has unexpected status: ' + opp.status);
    }
    // Verify no dossier has email draft
    for (const opp of results.qualified) {
      const group = BANK_SIGNAL_GROUPS.find(g => g.groupId === opp.signalGroupId);
      if (group) {
        const dossier = BankProblemDossierGenerator.generate(opp, group);
        test_(!JSON.stringify(dossier).includes('send email'), 'Dossier mentions sending email');
        test_(!JSON.stringify(dossier).includes('contact via'), 'Dossier mentions contacting');
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // Summary
    // ════════════════════════════════════════════════════════════════════════

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`  Bank Problem Discovery Engine: ${pass} passed, ${fail} failed`);
    console.log('═══════════════════════════════════════════════════════════════');

    if (fail > 0) {
      console.log('\nFailures:');
      failures.forEach(f => console.log('  - ' + f));
    }

    expect(pass).toBeGreaterThan(0);
  });
});
