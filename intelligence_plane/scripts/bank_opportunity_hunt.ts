/**
 * VARDHAN — Bank Opportunity Discovery Engine (v2)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * REPLACES the original simulated-evidence version. This script now uses the
 * real, publicly-verifiable BankSignalDatabase with the BankQualificationEngine
 * and BankProblemDossierGenerator.
 *
 * See: scripts/evaluate_bank_opportunities.ts for the full pipeline.
 * This script is a thin wrapper that re-runs the evaluation for convenience.
 */

import { BANK_SIGNAL_GROUPS } from '../src/server/bank/intelligence/BankSignalDatabase';
import { BankQualificationEngine } from '../src/server/bank/intelligence/BankQualificationEngine';

// Re-export from the main evaluation script
export { runEvaluation } from './evaluate_bank_opportunities';

async function runHunt() {
  console.log('🚀 VARDHAN Intelligence: Bank Problem Discovery Engine (v2)');
  console.log('');
  console.log('   NOTE: This replaces the previous simulated-evidence version.');
  console.log('   All signals are real, publicly verifiable, and sourced from');
  console.log('   bank corporate websites, engineering blogs, and public PDFs.');
  console.log('');
  console.log('   Run scripts/evaluate_bank_opportunities.ts for the full pipeline.');
  console.log('');

  // Quick qualification summary
  const results = BankQualificationEngine.qualifyAll(BANK_SIGNAL_GROUPS);

  console.log('── Qualification Summary ───────────────────────────────────');
  console.log(`   Total signal groups: ${results.metrics.total}`);
  console.log(`   Qualified (human approval): ${results.metrics.qualified}`);
  console.log(`   Blocked: ${results.metrics.blocked}`);
  console.log(`   P0: ${results.metrics.p0} | P1: ${results.metrics.p1} | P2: ${results.metrics.p2} | P3: ${results.metrics.p3}`);
  console.log('');

  console.log('── Qualified Opportunities ──────────────────────────────────');
  for (const opp of results.qualified) {
    console.log(`   ${opp.priority} | ${opp.totalScore}/100 | ${opp.institution} | ${opp.problemType}`);
    console.log(`        Sources: ${opp.sourceCount} | Signals: ${opp.evidenceCount} | Confidence: ${opp.confidence}`);
    console.log(`        Capability: ${opp.vardhanCapabilities.join(', ')}`);
    console.log(`        Gate: ${opp.status}`);
    console.log('');
  }

  console.log('── Blocked Opportunities ────────────────────────────────────');
  if (results.blocked.length === 0) {
    console.log('   None.');
  } else {
    for (const opp of results.blocked) {
      console.log(`   ${opp.institution} | ${opp.problemType} | ${opp.blockReason?.slice(0, 80)}...`);
    }
  }
  console.log('');
  console.log('── ⚠️  APPROVAL GATE ──────────────────────────────────────────');
  console.log('   All qualified opportunities require HUMAN APPROVAL.');
  console.log('   NO automated outreach is triggered.');
  console.log('');
}

runHunt().catch(console.error);
