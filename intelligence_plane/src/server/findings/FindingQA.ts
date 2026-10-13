/**
 * VARDHAN — ADVERSARIAL FINDING QA (§16)
 * ─────────────────────────────────────────────────────────────────────────────
 * Before a finding becomes OUTREACH_READY, run adversarial QA.
 *
 * Asks:
 * - Is this actually observed?
 * - Is evidence current?
 * - Is it reproducible?
 * - Is evidence sufficient?
 * - Is this merely normal behavior?
 * - Is this generic technology information?
 * - Is the source stale?
 * - Is there contradictory evidence?
 * - Are we confusing an external observation with an internal problem?
 * - Can every email claim be traced to evidence?
 */

import type { Evidence } from '../IntelligenceCase';
import type { DeepSignal } from '../DeepTypes';
import type { FindingNode } from './FindingGraph';
import { VardhanNoiseFilter } from './VardhanNoiseFilter';
import { FreshnessEngine } from '../FreshnessEngine';

export interface QAResult {
  pass: boolean;
  /** Specific QA checks that failed. */
  failures: string[];
  /** Warnings (checks that passed but with caveats). */
  warnings: string[];
  /** Summary score (0–1). */
  score: number;
  /** Detailed check-by-check results. */
  checks: { name: string; passed: boolean; note: string }[];
  /** If false, the finding should be RESEARCH_MORE or REJECT, not outreach-ready. */
  outreachReady: boolean;
}

export interface QAContext {
  finding: FindingNode;
  evidence: Evidence[];
  signals: DeepSignal[];
  owner: { name: string; confidence: string } | null;
  contacts: any[];
}

export class FindingQA {
  /**
   * Run adversarial QA on a finding. Returns pass/fail with detailed checks.
   */
  static validate(ctx: QAContext): QAResult {
    const checks: { name: string; passed: boolean; note: string }[] = [];
    const failures: string[] = [];
    const warnings: string[] = [];

    // Check 1: Is this actually observed?
    const observedEvidence = ctx.evidence.filter(e => e.evidence_origin === 'REAL_PUBLIC_OBSERVATION' || e.evidence_origin === 'DOCUMENTED_SOURCE');
    checks.push({
      name: 'actually_observed',
      passed: observedEvidence.length >= 1,
      note: observedEvidence.length >= 1
        ? `${observedEvidence.length} evidence item(s) are real public observations or documented sources.`
        : 'No directly observed or documented evidence — finding may be inference-only.',
    });
    if (observedEvidence.length === 0) failures.push('No real public observation or documented source backing this finding.');

    // Check 2: Is evidence current?
    const staleCount = ctx.evidence.filter(e => {
      const f = FreshnessEngine.classify(e.retrieved_at);
      return f.level === 'STALE' || f.level === 'AGING';
    }).length;
    checks.push({
      name: 'evidence_freshness',
      passed: staleCount < ctx.evidence.length,
      note: `${staleCount}/${ctx.evidence.length} evidence items are stale or aging.`,
    });
    if (staleCount === ctx.evidence.length && ctx.evidence.length > 0) {
      failures.push('ALL evidence is stale or aging — finding is not current.');
    }

    // Check 3: Is it reproducible?
    const reproducible = ctx.evidence.filter(e => e.repeatable === true && (e.reproductions || 0) > 1).length;
    checks.push({
      name: 'reproducibility',
      passed: reproducible >= 1 || ctx.evidence.length >= 3,
      note: `${reproducible} reproducible evidence item(s), ${ctx.evidence.length} total evidence items.`,
    });
    if (reproducible === 0 && ctx.evidence.length < 3) {
      warnings.push('No reproducible evidence and fewer than 3 evidence items — finding may not be reproducible.');
    }

    // Check 4: Is evidence sufficient?
    checks.push({
      name: 'evidence_sufficiency',
      passed: ctx.evidence.length >= 2,
      note: `${ctx.evidence.length} evidence item(s) total.`,
    });
    if (ctx.evidence.length < 2) {
      failures.push('Insufficient evidence (< 2 items).');
    }

    // Check 5: Is this merely normal behavior? (noise check)
    let noiseFailures = 0;
    for (const e of ctx.evidence) {
      const noise = VardhanNoiseFilter.assess({
        type: 'OBSERVATION',
        source_url: e.public_url,
        excerpt: e.observed_behavior,
        evidence_count: e.reproductions || 0,
        reproducible: e.repeatable === true,
      });
      if (noise.isNoise) noiseFailures++;
    }
    checks.push({
      name: 'not_normal_behavior',
      passed: noiseFailures < ctx.evidence.length / 2,
      note: `${noiseFailures}/${ctx.evidence.length} evidence items would be classified as noise.`,
    });
    if (noiseFailures >= ctx.evidence.length / 2 && ctx.evidence.length > 0) {
      failures.push(`More than half of evidence items are noise (${noiseFailures}/${ctx.evidence.length}).`);
    }

    // Check 6: Source quality
    const highQualitySources = ctx.evidence.filter(e =>
      e.evidence_origin === 'DOCUMENTED_SOURCE' || e.evidence_origin === 'REAL_PUBLIC_OBSERVATION'
    ).length;
    checks.push({
      name: 'source_quality',
      passed: highQualitySources >= 1,
      note: `${highQualitySources}/${ctx.evidence.length} evidence items from observed/documented sources.`,
    });

    // Check 7: Contradictory evidence?
    const hasContradiction = ctx.evidence.some(e =>
      e.observed_behavior.toLowerCase().includes('no ') ||
      e.observed_behavior.toLowerCase().includes('not ') ||
      e.observed_behavior.toLowerCase().includes('unable')
    );
    checks.push({
      name: 'no_contradiction',
      passed: !hasContradiction,
      note: hasContradiction ? 'Some evidence may contain contradictory language.' : 'No contradictory evidence detected.',
    });
    if (hasContradiction) {
      warnings.push('Evidence contains potentially contradictory language — verify.');
    }

    // Check 8: Confusing external observation with internal problem?
    const externalOnly = ctx.evidence.every(e => e.tested_without_auth !== false);
    checks.push({
      name: 'not_internal_assumption',
      passed: externalOnly,
      note: externalOnly ? 'All evidence is from public, authenticated sources — not assuming internal access.' : 'Some evidence was tested with auth — verify it does not assume internal access.',
    });

    // Check 9: Every claim traceable to evidence?
    checks.push({
      name: 'claims_traceable',
      passed: ctx.finding.evidenceIds.length > 0 || ctx.finding.signalIds.length > 0,
      note: `Finding references ${ctx.finding.evidenceIds.length} evidence and ${ctx.finding.signalIds.length} signal IDs.`,
    });
    if (ctx.finding.evidenceIds.length === 0 && ctx.finding.signalIds.length === 0) {
      failures.push('Finding has no traceable evidence or signals.');
    }

    // Check 10: Owner gate
    const ownerVerified = !!ctx.owner && ctx.owner.confidence === 'HIGH';
    checks.push({
      name: 'owner_verified',
      passed: ownerVerified,
      note: ctx.owner
        ? `Owner: ${ctx.owner.name} (confidence: ${ctx.owner.confidence})`
        : 'No technical owner identified.',
    });
    if (!ownerVerified) {
      failures.push('No high-confidence technical owner identified — outreach cannot be attributed.');
    }

    // Check 11: Contact gate
    checks.push({
      name: 'contact_available',
      passed: ctx.contacts.length > 0,
      note: `${ctx.contacts.length} public contact channel(s) found.`,
    });
    if (ctx.contacts.length === 0) {
      warnings.push('No public contact channel found — outreach not possible without one.');
    }

    // Compute overall score
    const passed = checks.filter(c => c.passed).length;
    const score = passed / checks.length;

    // Outreach-ready only if all critical checks pass
    const outreachReady = failures.length === 0 && !!ctx.owner && ctx.owner.confidence === 'HIGH' && ctx.contacts.length > 0;

    return {
      pass: failures.length === 0,
      failures,
      warnings,
      score,
      checks,
      outreachReady,
    };
  }
}
