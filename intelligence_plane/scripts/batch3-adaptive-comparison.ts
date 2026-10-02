/**
 * Controlled Comparison Runner — Batch 3 (ADAPTIVE TREATMENT)
 *
 * Runs the SAME 50-company target list as batch3_run_1790873841985 (baseline)
 * with the Adaptive Investigation layer ENABLED (treatment).
 *
 * The baseline run remains untouched at:
 *   /tmp/vardhan-batch3-runs/batch3_run_1790873841985/
 *
 * This run gets a new run_id and writes to a new directory.
 *
 * Artifact schema is NORMALIZED to match the baseline: every canonical field
 * from batch3-immutable.ts is preserved, with adaptive_investigation added
 * as an additive block. This ensures direct comparability between runs.
 *
 * At the end, produces a BASELINE vs ADAPTIVE comparison.
 */
import { DeepProspectBuilder } from '../src/server/DeepProspectBuilder';
import { OutreachCardPrinter } from '../src/server/OutreachCardPrinter';
import { LivePublicObservationProvider } from '../src/server/LivePublicObservationProvider';
import { AdaptiveInvestigationEngine, type AdaptiveInvestigationResult, verifyAggregate } from '../src/server/AdaptiveInvestigationEngine';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const realFetch = (async (url: string, init?: any): Promise<Response> => {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/json',
        ...(init?.headers || {}),
      },
      signal: init?.signal,
    });
    return res as any;
  } catch (e: any) {
    throw e;
  }
}) as any;

// Same 50 targets as baseline
const TARGETS = [
  'https://www.anysphere.inc', 'https://www.elevenlabs.io', 'https://www.mistral.ai',
  'https://www.figure.ai', 'https://www.abridge.com', 'https://www.lightmatter.co',
  'https://www.shield.ai', 'https://www.mercor.com', 'https://www.saronic.com',
  'https://www.together.ai', 'https://www.sandboxaq.com', 'https://www.celestial.ai',
  'https://www.sierra.ai', 'https://www.story.foundation', 'https://www.chainguard.dev',
  'https://www.peregrine.io', 'https://www.koboldmetals.com', 'https://www.supabase.com',
  'https://www.hippocraticai.com', 'https://www.synthesia.io', 'https://www.poolside.ai',
  'https://www.harvey.ai', 'https://www.cognition.ai', 'https://www.decagon.ai',
  'https://www.runwayml.com', 'https://www.halcyon.ai', 'https://www.helionenergy.com',
  'https://www.vultr.com', 'https://www.secondfront.com', 'https://www.radai.com',
  'https://www.lumalabs.ai', 'https://www.groq.com', 'https://www.nekohealth.com',
  'https://www.quera.com', 'https://www.lambdalabs.com', 'https://www.cyberhaven.com',
  'https://www.island.io', 'https://www.n8n.io', 'https://www.baseten.co',
  'https://www.biltrewards.com', 'https://www.hebbia.ai', 'https://www.ridezum.com',
  'https://www.tryriot.com', 'https://www.ayarlabs.com', 'https://www.crusoe.ai',
  'https://www.cynomi.com', 'https://www.windsurf.com', 'https://www.justsalad.com',
  'https://www.tines.com', 'https://www.hightouch.com',
];

const BASELINE_RUN_DIR = '/tmp/vardhan-batch3-runs/batch3_run_1790873841985';

const RUN_ID = `adaptive_run_${Date.now()}`;
const RUN_DIR = `/tmp/vardhan-batch3-runs/${RUN_ID}`;
const MANIFEST_PATH = path.join(RUN_DIR, 'manifest.json');
const RESULTS_PATH = path.join(RUN_DIR, 'results_summary.json');

/**
 * Normalized artifact schema — matches batch3-immutable.ts canonical fields
 * PLUS adaptive_investigation as an additive block.
 */
interface AdaptiveArtifact {
  run_id: string;
  run_timestamp: string;
  company: string;
  url: string;
  terminal_state: { state: string; reason?: string };
  decision: string;
  finding_type: string;
  evidence_count: number;
  evidence?: any[];
  observations?: any[];
  signals: any[];
  discovered_subdomains: string[];
  discovered_domains?: string[];
  decision_state?: string;
  confidence?: string;
  finding_confidence?: string;
  contact_status?: string;
  diagnostic_opportunity?: boolean;
  email_generated?: boolean;
  rate_limited: string[];
  organization_identity?: { name: string; domain: string; homepage: string };
  outreach_eligibility?: { eligible: boolean; reason: string };
  uncertainties?: any[];
  timestamps?: { started: string; completed: string; duration_ms: number };
  provider_statuses?: Record<string, string>;
  hypothesis?: any;
  verification_result?: any;
  finding_card?: string;
  proof_chain?: any;
  artifact_path: string;
  error?: string;
  adaptive_investigation: any;
  /** Entry Point Intelligence — full externally-observable technical perimeter. */
  entry_points?: any[];
  entry_point_telemetry?: any;
  entry_point_graph?: any;
  entry_point_changes?: any[];
}

function ensureRunDir(): void {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.mkdirSync(path.join(RUN_DIR, 'artifacts'), { recursive: true });
}

function writeManifest(manifest: any): void {
  const tmpPath = MANIFEST_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(tmpPath, MANIFEST_PATH);
}

function writeArtifact(artifact: AdaptiveArtifact): void {
  const safeCompany = artifact.company.replace(/[^a-z0-9.-]/gi, '_').toLowerCase() || 'unknown';
  const artifactPath = path.join(RUN_DIR, 'artifacts', `${safeCompany}.json`);
  if (fs.existsSync(artifactPath)) return;
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), 'utf8');
}

function setupGracefulShutdown(manifest: any): void {
  const handler = (signal: string) => {
    console.log(`\n⚠️  Received ${signal} — writing final manifest and exiting...`);
    manifest.status = 'INTERRUPTED';
    manifest.completed_at = new Date().toISOString();
    try { writeManifest(manifest); } catch {}
    process.exit(2);
  };
  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));
}

async function runCompanyWithTimeout(target: string, timeoutMs: number): Promise<AdaptiveArtifact> {
  const started = new Date().toISOString();
  const startTime = Date.now();
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  const artifact: AdaptiveArtifact = {
    run_id: RUN_ID,
    run_timestamp: started,
    company: '', url: target,
    terminal_state: { state: 'COMPLETED' },
    decision: '', finding_type: '', evidence_count: 0,
    discovered_subdomains: [], signals: [], rate_limited: [],
    artifact_path: '',
    adaptive_investigation: { attempted: false, records: [], aggregate: {} },
  };

  try {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vardhan-adaptive-'));

    // Create provider — same config as baseline
    const provider = new LivePublicObservationProvider({
      delayMs: 150, sampleDelayMs: 200, maxRequests: 25,
      fetcher: realFetch,
    }) as any;

    // Build with ADAPTIVE INVESTIGATION ENABLED
    const builder = new DeepProspectBuilder({
      fetcher: realFetch,
      observationProvider: provider,
      saveArtifact: (p, d) => { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, d, 'utf8'); } catch {} },
      artifactsBaseDir: tmpDir,
      maxDiscoveryPages: 15, discoveryDelayMs: 200, discoveryTimeoutMs: 8000,
      observationDelayMs: 150, onProgress: () => {}, logger: () => {},
      enableAdaptiveInvestigation: true,
      adaptiveInvestigationOptions: {
        fetcher: realFetch,
        maxPivots: 3,
        maxPivotRequests: 10,
        delayMs: 150,
        onProgress: () => {},
      },
    });

    const { prospect } = await builder.build(target);
    const completed = new Date().toISOString();

    // FIX 4: Normalized artifact schema — retains ALL canonical fields from baseline
    // PLUS adaptive_investigation as an additive block
    artifact.company = prospect.company || target.replace('https://www.', '').replace(/\/$/, '');
    artifact.url = target;
    artifact.organization_identity = {
      name: prospect.company || '',
      domain: target.replace('https://', '').replace(/\/$/, ''),
      homepage: (prospect as any).company_surface?.homepage || (prospect as any).company_surface?.company_homepage || '',
    };
    artifact.discovered_domains = [artifact.organization_identity.domain];
    artifact.discovered_subdomains = provider.getDiscoveredSubdomains();
    artifact.evidence = prospect.evidence;
    artifact.evidence_count = prospect.evidence.length;
    artifact.observations = prospect.evidence.map((e: any) => ({
      url: e.public_url,
      status: e.status,
      latency_samples: e.latency_samples,
      observed_behavior: e.observed_behavior,
      repeatable: e.repeatable,
      evidence_origin: e.evidence_origin,
      source_type: e.source_type,
    }));
    artifact.signals = prospect.technical_signals.map((s: any) => ({
      type: s.type,
      confidence: s.confidence,
      description: s.description,
    }));
    artifact.hypothesis = prospect.deep_finding ? {
      finding_type: prospect.deep_finding.finding_type,
      confidence: prospect.deep_finding.confidence,
      explanation: prospect.deep_finding.explanation,
      recommendation: prospect.deep_finding.recommendation,
      evidence_ids: prospect.deep_finding.evidence_ids,
    } : undefined;
    artifact.verification_result = {
      qa_status: (prospect as any).qa_status,
      qa_blocked_reason: (prospect as any).qa_blocked_reason,
      decision_reason: (prospect as any).decision_reason,
      gating_outcome: (prospect as any).gating_outcome,
      is_defensible: prospect.deep_finding ? !['DOCUMENTED_SECURITY_POSTURE', 'DOCUMENTED_SCALING_CONSTRAINT',
        'DOCUMENTED_INCIDENT', 'DOCUMENTED_ENGINEERING_FAILURE', 'GENERIC_ENGINEERING_ARTICLE',
        'UNEXPECTED_PUBLIC_BEHAVIOR', 'CONFLICTING_EVIDENCE'].includes(prospect.deep_finding.finding_type) : false,
    };
    artifact.decision_state = prospect.decision;
    artifact.decision = prospect.decision;
    artifact.confidence = prospect.confidence;
    artifact.finding_type = prospect.deep_finding?.finding_type || prospect.findings?.finding_type || 'NONE';
    artifact.finding_confidence = prospect.deep_finding?.confidence || 'UNKNOWN';
    artifact.outreach_eligibility = {
      eligible: prospect.decision === 'OUTREACH_READY',
      reason: (prospect as any).decision_reason || '',
    };
    artifact.uncertainties = (prospect as any).uncertainties || [];
    artifact.timestamps = { started, completed, duration_ms: Date.now() - startTime };
    artifact.provider_statuses = {
      LivePublicObservationProvider: provider.getDiscoveredSubdomains().length > 0 ? 'available' : 'available',
      DeepProspectBuilder: 'available',
    };
    artifact.rate_limited = provider.getRateLimitedUrls();

    // Build full proof chain for OUTREACH_READY findings (same as baseline)
    if (prospect.decision === 'OUTREACH_READY' && prospect.deep_finding) {
      const card = OutreachCardPrinter.buildCard(prospect);
      artifact.finding_card = card ? OutreachCardPrinter.printCard(card) : '(card not available)';
      artifact.proof_chain = {
        finding_type: prospect.deep_finding.finding_type,
        confidence: prospect.deep_finding.confidence,
        severity_basis: prospect.deep_finding.severity_basis,
        evidence_ids: prospect.deep_finding.evidence_ids,
        source_urls: prospect.deep_finding.source_urls,
        provenance: prospect.deep_finding.provenance,
        strength: prospect.deep_finding.strength,
        explanation: prospect.deep_finding.explanation,
        recommendation: prospect.deep_finding.recommendation,
        evidence_pack: prospect.evidence
          .filter((ev: any) => prospect.deep_finding.evidence_ids.includes(ev.id))
          .map((ev: any) => ({
            id: ev.id,
            url: ev.public_url,
            origin: ev.evidence_origin,
            source_type: ev.source_type,
            observed_behavior: ev.observed_behavior,
            reproducible: ev.repeatable,
            latency_samples: ev.latency_samples,
          })),
      };
    }

    // Adaptive investigation (ADDITIVE — does not affect canonical fields)
    artifact.adaptive_investigation = prospect.adaptive_investigation || { attempted: false, records: [], aggregate: { boundary_observations: 0, pivots_suggested: 0, pivots_executed: 0, alternate_surfaces_found: 0, new_evidence_found: 0, new_verification_targets: 0, verified_from_adaptive_path: 0, no_useful_result: 0 } };
    // FIX 6: Immutable audit invariant — verify aggregate before persisting
    if (artifact.adaptive_investigation.attempted) {
      const audit = verifyAggregate(artifact.adaptive_investigation as AdaptiveInvestigationResult);
      if (!audit.valid) {
        console.error(`  ⚠ AUDIT FAILED for ${artifact.company}: ${audit.errors.join('; ')}`);
        for (const rec of artifact.adaptive_investigation.records || []) {
          console.error(`    record ${rec.investigation_id}: ${rec.new_evidence_ids.length} ev, ${rec.new_target_ids.length} targets`);
        }
      }
    }

    artifact.artifact_path = (prospect as any).artifact_path || '';
    artifact.terminal_state = { state: 'COMPLETED' };

    // Entry Point Intelligence (ADDITIVE — does not affect canonical fields)
    if ((prospect as any).entry_points) {
      artifact.entry_points = (prospect as any).entry_points;
      artifact.entry_point_telemetry = (prospect as any).entry_point_telemetry;
      artifact.entry_point_graph = (prospect as any).entry_point_graph;
      artifact.entry_point_changes = (prospect as any).entry_point_changes;
    }
  } catch (e: any) {
    const completed = new Date().toISOString();
    artifact.terminal_state = { state: 'FAILED', reason: e.message };
    artifact.company = target.replace('https://www.', '').replace(/\/$/, '');
    artifact.decision = 'NO_GO';
    artifact.error = e.message;
    artifact.adaptive_investigation = { attempted: false, records: [], aggregate: { error: e.message, boundary_observations: 0, pivots_suggested: 0, pivots_executed: 0, alternate_surfaces_found: 0, new_evidence_found: 0, new_verification_targets: 0, verified_from_adaptive_path: 0, no_useful_result: 0 } };
  } finally {
    clearTimeout(timeoutId);
  }

  return artifact;
}

async function main() {
  ensureRunDir();
  const runStarted = new Date().toISOString();
  console.log(`🎯 Adaptive Comparison Run: ${RUN_ID}`);
  console.log(`   Run directory: ${RUN_DIR}`);
  console.log(`   Baseline (control): ${BASELINE_RUN_DIR}`);
  console.log(`   Targets: ${TARGETS.length}`);
  console.log('');

  const manifest = {
    run_id: RUN_ID,
    run_type: 'treatment_adaptive',
    baseline_run_id: 'batch3_run_1790873841985',
    started_at: runStarted,
    targets: TARGETS,
    target_count: TARGETS.length,
    completed_count: 0, failed_count: 0, timed_out_count: 0, skipped_count: 0,
    decisions: {},
    total_evidence_records: 0, total_subdomains_discovered: 0,
    adaptive_pivots_suggested: 0, adaptive_pivots_executed: 0,
    adaptive_surfaces_found: 0, adaptive_new_evidence: 0,
    adaptive_new_verification_targets: 0, adaptive_verified: 0, adaptive_no_useful: 0,
    status: 'RUNNING' as string,
  };
  writeManifest(manifest);
  setupGracefulShutdown(manifest);

  const allArtifacts: AdaptiveArtifact[] = [];
  const perCompanyTimeoutMs = 180000;

  for (let i = 0; i < TARGETS.length; i++) {
    const target = TARGETS[i];
    console.log(`[${i + 1}/${TARGETS.length}] ${target} — starting...`);

    let artifact: AdaptiveArtifact;
    try {
      const timeoutPromise = new Promise<AdaptiveArtifact>((resolve) => {
        setTimeout(() => resolve({
          run_id: RUN_ID, run_timestamp: new Date().toISOString(),
          company: target.replace('https://www.', '').replace(/\/$/, ''),
          url: target, terminal_state: { state: 'TIMED_OUT', reason: `Exceeded ${perCompanyTimeoutMs/1000}s` },
          decision: 'NO_GO', finding_type: 'TIMEOUT', evidence_count: 0,
          discovered_subdomains: [], signals: [], rate_limited: [],
          artifact_path: '',
          adaptive_investigation: { attempted: false, records: [], aggregate: {} },
        }), perCompanyTimeoutMs);
      });
      const resultPromise = runCompanyWithTimeout(target, perCompanyTimeoutMs);
      artifact = await Promise.race([resultPromise, timeoutPromise]);
    } catch (e: any) {
      artifact = {
        run_id: RUN_ID, run_timestamp: new Date().toISOString(),
        company: target.replace('https://www.', '').replace(/\/$/, ''),
        url: target, terminal_state: { state: 'FAILED', reason: e.message },
        decision: 'NO_GO', finding_type: 'ERROR', evidence_count: 0,
        discovered_subdomains: [], signals: [], rate_limited: [],
        artifact_path: '',
        adaptive_investigation: { attempted: false, records: [], aggregate: {} },
      };
    }

    allArtifacts.push(artifact);
    writeArtifact(artifact);

    const ai = artifact.adaptive_investigation || {};
    const agg = ai.aggregate || {};
    console.log(`  → ${artifact.terminal_state.state} | decision=${artifact.decision} | finding=${artifact.finding_type} | evidence=${artifact.evidence_count} | subs=${artifact.discovered_subdomains.length} | adaptive_pivots=${agg.pivots_executed || 0}`);

    // Update manifest
    manifest.completed_count = allArtifacts.filter(a => a.terminal_state.state === 'COMPLETED').length;
    manifest.failed_count = allArtifacts.filter(a => a.terminal_state.state === 'FAILED').length;
    manifest.timed_out_count = allArtifacts.filter(a => a.terminal_state.state === 'TIMED_OUT').length;
    manifest.skipped_count = allArtifacts.filter(a => a.terminal_state.state === 'SKIPPED').length;

    const decisions: Record<string, number> = {};
    let totalEvidence = 0;
    const allSubs = new Set<string>();
    let pivotsSuggested = 0, pivotsExecuted = 0, surfacesFound = 0, newEvidence = 0, newTargets = 0, verified = 0, noUseful = 0;
    for (const a of allArtifacts) {
      const d = a.decision || 'NONE';
      decisions[d] = (decisions[d] || 0) + 1;
      totalEvidence += a.evidence_count;
      for (const s of a.discovered_subdomains) allSubs.add(s);
      const ag = a.adaptive_investigation?.aggregate || {};
      pivotsSuggested += ag.pivots_suggested || 0;
      pivotsExecuted += ag.pivots_executed || 0;
      surfacesFound += ag.alternate_surfaces_found || 0;
      newEvidence += ag.new_evidence_found || 0;
      newTargets += ag.new_verification_targets || 0;
      verified += ag.verified_from_adaptive_path || 0;
      noUseful += ag.no_useful_result || 0;
    }
    manifest.decisions = decisions;
    manifest.total_evidence_records = totalEvidence;
    manifest.total_subdomains_discovered = allSubs.size;
    manifest.adaptive_pivots_suggested = pivotsSuggested;
    manifest.adaptive_pivots_executed = pivotsExecuted;
    manifest.adaptive_surfaces_found = surfacesFound;
    manifest.adaptive_new_evidence = newEvidence;
    manifest.adaptive_new_verification_targets = newTargets;
    manifest.adaptive_verified = verified;
    manifest.adaptive_no_useful = noUseful;
    writeManifest(manifest);
  }

  const runCompleted = new Date().toISOString();
  manifest.status = 'COMPLETE';
  manifest.completed_at = runCompleted;
  writeManifest(manifest);

  // Write summary
  fs.writeFileSync(RESULTS_PATH, JSON.stringify({
    run_id: RUN_ID, run_type: 'treatment_adaptive', baseline_run_id: 'batch3_run_1790873841985',
    manifest,
    artifacts: allArtifacts.map(a => ({
      company: a.company, url: a.url, terminal_state: a.terminal_state,
      decision: a.decision, finding_type: a.finding_type,
      evidence_count: a.evidence_count, subdomains: a.discovered_subdomains.length,
      signals: a.signals, rate_limited: a.rate_limited.length,
      contact_status: a.contact_status, email_generated: a.email_generated,
      adaptive_investigation: a.adaptive_investigation?.aggregate || {},
    })),
  }, null, 2), 'utf8');

  console.log('');
  console.log('═'.repeat(70));
  console.log(`ADAPTIVE TREATMENT RUN — FINAL REPORT  (${RUN_ID})`);
  console.log('═'.repeat(70));
  console.log(`Targets:     ${manifest.target_count}`);
  console.log(`Completed:   ${manifest.completed_count}`);
  console.log(`Failed:      ${manifest.failed_count}`);
  console.log(`Timed out:   ${manifest.timed_out_count}`);
  console.log(`Skipped:     ${manifest.skipped_count}`);
  const sum = manifest.completed_count + manifest.failed_count + manifest.timed_out_count + manifest.skipped_count;
  console.log(`Reconciliation: ${sum} (expected: ${manifest.target_count})`);
  console.log('');
  console.log('Decision distribution:');
  for (const [d, c] of Object.entries(manifest.decisions).sort()) {
    console.log(`  ${d.padEnd(20)} ${c}`);
  }
  console.log('');
  console.log(`Evidence records: ${manifest.total_evidence_records}`);
  console.log(`Unique subdomains: ${manifest.total_subdomains_discovered}`);
  console.log('');
  console.log('Adaptive investigation aggregates:');
  console.log(`  Pivots suggested:     ${manifest.adaptive_pivots_suggested}`);
  console.log(`  Pivots executed:      ${manifest.adaptive_pivots_executed}`);
  console.log(`  Alternate surfaces:   ${manifest.adaptive_surfaces_found}`);
  console.log(`  New evidence found:   ${manifest.adaptive_new_evidence}`);
  console.log(`  New verif. targets:   ${manifest.adaptive_new_verification_targets}`);
  console.log(`  Verified from pivot:  ${manifest.adaptive_verified}`);
  console.log(`  No useful result:     ${manifest.adaptive_no_useful}`);
  console.log('');
  console.log('Corrected metrics:');
  console.log(`  average_new_evidence_per_pivot = ${manifest.adaptive_new_evidence}/${manifest.adaptive_pivots_executed} = ${manifest.adaptive_pivots_executed > 0 ? (manifest.adaptive_new_evidence / manifest.adaptive_pivots_executed).toFixed(1) : 'N/A'}`);
  console.log(`  average_new_targets_per_pivot  = ${manifest.adaptive_new_verification_targets}/${manifest.adaptive_pivots_executed} = ${manifest.adaptive_pivots_executed > 0 ? (manifest.adaptive_new_verification_targets / manifest.adaptive_pivots_executed).toFixed(1) : 'N/A'}`);
  console.log('');
  console.log(`  Artifact schema: normalized (baseline canonical fields + additive adaptive_investigation)`);
  console.log(`  Report: ${RESULTS_PATH}`);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
