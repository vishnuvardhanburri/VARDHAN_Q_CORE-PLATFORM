/**
 * VARDHAN — Bank Opportunity Evaluation Script
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Main entry point for evidence-backed bank problem discovery.
 *
 * Usage:
 *   npx tsx scripts/evaluate_bank_opportunities.ts
 *
 * Outputs:
 *   - intelligence_plane/.research/bank/opportunities.json  (machine-readable)
 *   - intelligence_plane/.research/bank/dossiers/            (per-institution dossiers)
 *   - intelligence_plane/.research/bank/SHORTLIST.md         (human-readable report)
 *
 * Pipeline stages (separated by design):
 *   1. DISCOVERY      — reads BankSignalDatabase (real public signals)
 *   2. QUALIFICATION   — BankQualificationEngine scores each signal group
 *   3. DOSSIER         — BankProblemDossierGenerator produces 10-section dossiers
 *   4. APPROVAL GATE   — ALL results require human approval before any outreach
 *
 * No automated outreach is ever triggered.
 */

import { BANK_SIGNAL_GROUPS, BANK_SIGNAL_DATABASE } from '../src/server/bank/intelligence/BankSignalDatabase';
import { BankQualificationEngine, QualifiedBankOpportunity } from '../src/server/bank/intelligence/BankQualificationEngine';
import { BankProblemDossierGenerator, BankProblemDossier } from '../src/server/bank/intelligence/BankProblemDossierGenerator';
import { getSponsors } from '../src/server/bank/intelligence/BankSponsorRoleMap';
import { BankSignalGroup } from '../src/server/bank/intelligence/BankSignalModel';
import * as fs from 'fs';
import * as path from 'path';

// ── Get git HEAD for provenance ──────────────────────────────────────────────

function getGitHead(): string {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim().slice(0, 7);
  } catch {
    return 'unknown';
  }
}

// ── Output paths ─────────────────────────────────────────────────────────────
// ES module compatible path resolution

import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OUTPUT_DIR = path.join(__dirname, '..', '.research', 'bank');
const DOSSIER_DIR = path.join(OUTPUT_DIR, 'dossiers');

// ── Main pipeline ─────────────────────────────────────────────────────────────

interface EvaluationResult {
  institution: string;
  opportunity: QualifiedBankOpportunity;
  dossier: BankProblemDossier;
}

async function runEvaluation(): Promise<EvaluationResult[]> {
  const gitHead = getGitHead();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  VARDHAN — Bank Problem Discovery Engine                    ║');
  console.log('║  Stage 1: DISCOVERY → Stage 2: QUALIFICATION → Stage 3: DOSSIER ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // ── Stage 1: Discovery ──────────────────────────────────────────────────
  console.log('📡 STAGE 1: DISCOVERY');
  console.log(`   Signals in database: ${BANK_SIGNAL_DATABASE.length}`);
  console.log(`   Signal groups: ${BANK_SIGNAL_GROUPS.length}`);
  console.log(`   Institutions: ${[...new Set(BANK_SIGNAL_DATABASE.map(s => s.institution))].join(', ')}`);
  console.log('');

  // ── Stage 2: Qualification ──────────────────────────────────────────────
  console.log('⚖️  STAGE 2: QUALIFICATION');
  const results = BankQualificationEngine.qualifyAll(BANK_SIGNAL_GROUPS);

  console.log(`   Total groups analysed: ${results.metrics.total}`);
  console.log(`   Qualified (ready for human approval): ${results.metrics.qualified}`);
  console.log(`   Blocked: ${results.metrics.blocked}`);
  console.log(`   P0: ${results.metrics.p0}, P1: ${results.metrics.p1}, P2: ${results.metrics.p2}, P3: ${results.metrics.p3}`);
  console.log(`   Average score: ${results.metrics.avgScore}/100`);
  console.log('');

  // Print qualified opportunities
  console.log('   ┌────────────────────────────────────────────────────────────┐');
  console.log('   │ QUALIFIED OPPORTUNITIES                                    │');
  console.log('   ├────────────────────────────────────────────────────────────┤');
  for (const opp of results.qualified) {
    console.log(`   │ ${opp.institution.padEnd(20)} | ${opp.problemType.padEnd(25)} | Score: ${String(opp.totalScore).padStart(3)} | ${opp.priority} │`);
    console.log(`   │   Sources: ${opp.sourceCount} | Signals: ${opp.evidenceCount} | Confidence: ${opp.confidence.padEnd(6)} │`);
    console.log(`   │   Status: ${opp.status.padEnd(24)} │`);
    console.log('   ├────────────────────────────────────────────────────────────┤');
  }
  console.log('');

  // Print blocked opportunities
  if (results.blocked.length > 0) {
    console.log('   ┌────────────────────────────────────────────────────────────┐');
    console.log('   │ BLOCKED OPPORTUNITIES                                      │');
    console.log('   ├────────────────────────────────────────────────────────────┤');
    for (const opp of results.blocked) {
      const reason = opp.blockReason?.slice(0, 60) || 'Below threshold';
      console.log(`   │ ${opp.institution.padEnd(20)} | ${opp.problemType.padEnd(25)} | ${reason} │`);
    }
    console.log('   └────────────────────────────────────────────────────────────┘');
    console.log('');
  }

  // ── Stage 3: Dossier Generation ──────────────────────────────────────
  console.log('📁 STAGE 3: DOSSIER GENERATION');

  const allResults: EvaluationResult[] = [];

  // Generate dossiers for qualified opportunities
  for (const opp of results.qualified) {
    const group = BANK_SIGNAL_GROUPS.find(g => g.groupId === opp.signalGroupId);
    if (!group) continue;

    const dossier = BankProblemDossierGenerator.generate(opp, group, { gitHead });
    allResults.push({ institution: opp.institution, opportunity: opp, dossier });

    const dossierPath = path.join(DOSSIER_DIR, `${opp.institution.replace(/\s+/g, '_')}_${opp.problemType}.json`);
    fs.mkdirSync(DOSSIER_DIR, { recursive: true });
    fs.writeFileSync(dossierPath, JSON.stringify(dossier, null, 2));
    console.log(`   ✓ Dossier: ${path.basename(dossierPath)}`);
  }

  // ── Output machine-readable results ──────────────────────────────────
  const outputData = {
    generatedAt: new Date().toISOString(),
    gitHead,
    summary: results.metrics,
    shortlist: results.shortlist.map(opp => ({
      institution: opp.institution,
      businessArea: opp.businessArea,
      problemType: opp.problemType,
      hypothesis: opp.problemHypothesis,
      score: opp.totalScore,
      priority: opp.priority,
      confidence: opp.confidence,
      sourceUrls: opp.sourceUrls,
      sourceCount: opp.sourceCount,
      vardhanCapabilities: opp.vardhanCapabilities,
      recommendedValidationQuestion: opp.recommendedValidationQuestion,
      gate: 'HUMAN_APPROVAL_REQUIRED',
    })),
    allQualified: results.qualified.map(opp => ({
      institution: opp.institution,
      businessArea: opp.businessArea,
      problemType: opp.problemType,
      score: opp.totalScore,
      priority: opp.priority,
      confidence: opp.confidence,
      status: opp.status,
      evidenceGaps: opp.evidenceGaps,
      scoreBreakdown: opp.scoreBreakdown,
    })),
    blocked: results.blocked.map(opp => ({
      institution: opp.institution,
      problemType: opp.problemType,
      reason: opp.blockReason,
      score: opp.totalScore,
      evidenceGaps: opp.evidenceGaps,
    })),
    evidenceGaps: collectAllEvidenceGaps(),
    disqualifiedOpportunities: results.blocked.map(opp => ({
      institution: opp.institution,
      problemType: opp.problemType,
      reason: opp.blockReason,
      score: opp.totalScore,
      evidenceGaps: opp.evidenceGaps,
    })),
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'opportunities.json'),
    JSON.stringify(outputData, null, 2)
  );
  console.log(`   ✓ Written: ${path.join(OUTPUT_DIR, 'opportunities.json')}`);

  // ── Output human-readable shortlist ───────────────────────────────────
  const report = BankDossierReport.generateShortlistReport(results.qualified, results.blocked, results.shortlist, gitHead);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'SHORTLIST.md'), report);
  console.log(`   ✓ Written: ${path.join(OUTPUT_DIR, 'SHORTLIST.md')}`);

  console.log('');
  console.log('🚦 STAGE 4: APPROVAL GATE');
  console.log('   All qualified opportunities require HUMAN APPROVAL before any outreach.');
  console.log('   No automated outreach has been triggered.');
  console.log('');

  return allResults;
}

// ── Helper: collect all evidence gaps ───────────────────────────────────────

function collectAllEvidenceGaps(): string[] {
  const gaps = new Set<string>();
  for (const sig of BANK_SIGNAL_DATABASE) {
    for (const gap of sig.evidenceGaps) {
      gaps.add(`${sig.institution}: ${gap}`);
    }
  }
  return [...gaps];
}

// ── Report generator ────────────────────────────────────────────────────────

class BankDossierReport {
  static generateShortlistReport(
    qualified: QualifiedBankOpportunity[],
    blocked: QualifiedBankOpportunity[],
    shortlist: QualifiedBankOpportunity[],
    gitHead: string
  ): string {
    const lines: string[] = [];

    lines.push('# VARDHAN — Bank Problem Discovery: Shortlist Report');
    lines.push('');
    lines.push(`**Generated:** ${new Date().toISOString().split('T')[0]}`);
    lines.push(`**Git HEAD:** \`${gitHead}\``);
    lines.push(`**Classification:** INTERNAL — Human Approval Required Before Outreach`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Executive Summary
    lines.push('## 1. Executive Summary');
    lines.push('');
    lines.push(`This report identifies evidence-backed bank problem opportunities from publicly verifiable sources. ${qualified.length} opportunities met the qualification threshold (score ≥ 50/100), and ${shortlist.length} are prioritised as P0/P1 shortlist candidates. All opportunities require human review and approval before any external contact.`);
    lines.push('');

    // Shortlist
    lines.push('## 2. Prioritized Shortlist (P0/P1)');
    lines.push('');
    if (shortlist.length === 0) {
      lines.push('No P0/P1 opportunities identified.');
    }
    for (const opp of shortlist) {
      lines.push(`### ${opp.institution} — ${opp.problemType}`);
      lines.push('');
      lines.push(`- **Score:** ${opp.totalScore}/100 (${opp.priority})`);
      lines.push(`- **Confidence:** ${opp.confidence}`);
      lines.push(`- **Sources:** ${opp.sourceUrls.join(', ')}`);
      lines.push(`- **Vardhan capability:** ${opp.vardhanCapabilities.join(', ')}`);
      lines.push(`- **Hypothesis:** ${opp.problemHypothesis}`);
      lines.push('');
      lines.push(`**Validation question for sponsor:** ${opp.recommendedValidationQuestion}`);
      lines.push('');
      if (opp.evidenceGaps.length > 0) {
        lines.push(`**Evidence gaps:** ${opp.evidenceGaps.join('; ')}`);
        lines.push('');
      }
    }

    // All qualified (P2)
    const p2 = qualified.filter(q => q.priority === 'P2');
    if (p2.length > 0) {
      lines.push('## 3. Qualified Opportunities (P2)');
      lines.push('');
      for (const opp of p2) {
        lines.push(`### ${opp.institution} — ${opp.problemType}`);
        lines.push('');
        lines.push(`- **Score:** ${opp.totalScore}/100 (${opp.priority})`);
        lines.push(`- **Confidence:** ${opp.confidence}`);
        lines.push(`- **Hypothesis:** ${opp.problemHypothesis}`);
        lines.push('');
      }
    }

    // Evidence gaps
    lines.push('## 4. Evidence Gaps');
    lines.push('');
    const allGaps = collectAllEvidenceGaps();
    if (allGaps.length === 0) {
      lines.push('No evidence gaps identified.');
    } else {
      for (const gap of allGaps) {
        lines.push(`- ${gap}`);
      }
    }
    lines.push('');

    // Disqualified
    lines.push('## 5. Disqualified Opportunities');
    lines.push('');
    if (blocked.length === 0) {
      lines.push('No opportunities were blocked.');
    } else {
      for (const opp of blocked) {
        lines.push(`### ${opp.institution} — ${opp.problemType}`);
        lines.push('');
        lines.push(`- **Score:** ${opp.totalScore}/100 (P3)`);
        lines.push(`- **Reason:** ${opp.blockReason}`);
        lines.push('');
      }
    }

    // Sponsor maps
    lines.push('## 6. Sponsor-Role Map');
    lines.push('');
    for (const [inst, map] of Object.entries(getSponsors('JPMorgan Chase') || {})) {
      // This is handled below per institution
    }
    // Build from the qualified opportunities
    const sponsorMapEntries = [...new Set(qualified.map(q => q.institution))];
    for (const inst of sponsorMapEntries) {
      const sm = getSponsors(inst);
      if (sm) {
        lines.push(`### ${inst}`);
        lines.push('');
        lines.push(`- **Jurisdiction:** ${sm.jurisdiction}`);
        lines.push(`- **Website:** ${sm.website}`);
        lines.push('');
        lines.push('| Role | Department | Evidence | Confidence |');
        lines.push('|------|------------|----------|------------|');
        for (const s of sm.sponsorRoles) {
          lines.push(`| ${s.role} | ${s.department} | [Source](${s.evidenceUrl}) | ${s.confidence} |`);
        }
        lines.push('');
        lines.push('**Budget Owner:**');
        for (const b of sm.budgetOwnerRoles) {
          lines.push(`- ${b.role} (${b.department}) — [${b.confidence}]`);
        }
        lines.push('');
      }
    }

    lines.push('---');
    lines.push('');
    lines.push('> ⚠️ All opportunities are in `READY_FOR_HUMAN_APPROVAL` status. No outreach has been initiated.');

    return lines.join('\n');
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  runEvaluation().catch(console.error);
}

export { runEvaluation, collectAllEvidenceGaps };
