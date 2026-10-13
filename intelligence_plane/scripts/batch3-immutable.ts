/**
 * Immutable Batch 3 Runner — 50 real companies
 *
 * Design principles:
 * - Unique run_id per execution (never overwrites previous runs)
 * - One immutable artifact per company (JSON) — never overwritten
 * - Manifest persisted before, during, and after the run
 * - Timeout-safe: each company is isolated; a timeout never loses prior results
 * - Full proof chain persisted for OUTREACH_READY findings
 * - Reconciliation: completed + failed + timed_out + skipped == 50
 */
import { DeepProspectBuilder } from '../src/server/DeepProspectBuilder';
import { OutreachCardPrinter } from '../src/server/OutreachCardPrinter';
import { LivePublicObservationProvider } from '../src/server/LivePublicObservationProvider';
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

// 50 real companies from Growjo dataset
const TARGETS = [
  'https://www.anysphere.inc',
  'https://www.elevenlabs.io',
  'https://www.mistral.ai',
  'https://www.figure.ai',
  'https://www.abridge.com',
  'https://www.lightmatter.co',
  'https://www.shield.ai',
  'https://www.mercor.com',
  'https://www.saronic.com',
  'https://www.together.ai',
  'https://www.sandboxaq.com',
  'https://www.celestial.ai',
  'https://www.sierra.ai',
  'https://www.story.foundation',
  'https://www.chainguard.dev',
  'https://www.peregrine.io',
  'https://www.koboldmetals.com',
  'https://www.supabase.com',
  'https://www.hippocraticai.com',
  'https://www.synthesia.io',
  'https://www.poolside.ai',
  'https://www.harvey.ai',
  'https://www.cognition.ai',
  'https://www.decagon.ai',
  'https://www.runwayml.com',
  'https://www.halcyon.ai',
  'https://www.helionenergy.com',
  'https://www.vultr.com',
  'https://www.secondfront.com',
  'https://www.radai.com',
  'https://www.lumalabs.ai',
  'https://www.groq.com',
  'https://www.nekohealth.com',
  'https://www.quera.com',
  'https://www.lambdalabs.com',
  'https://www.cyberhaven.com',
  'https://www.island.io',
  'https://www.n8n.io',
  'https://www.baseten.co',
  'https://www.biltrewards.com',
  'https://www.hebbia.ai',
  'https://www.ridezum.com',
  'https://www.tryriot.com',
  'https://www.ayarlabs.com',
  'https://www.crusoe.ai',
  'https://www.cynomi.com',
  'https://www.windsurf.com',
  'https://www.justsalad.com',
  'https://www.tines.com',
  'https://www.hightouch.com',
];

const RUN_ID = `batch3_run_${Date.now()}`;
const RUN_DIR = `/tmp/vardhan-batch3-runs/${RUN_ID}`;
const MANIFEST_PATH = path.join(RUN_DIR, 'manifest.json');
const RESULTS_PATH = path.join(RUN_DIR, 'results_summary.json');

interface TerminalState {
  state: 'COMPLETED' | 'FAILED' | 'TIMED_OUT' | 'SKIPPED';
  reason?: string;
}

interface CompanyArtifact {
  run_id: string;
  run_timestamp: string;
  company: string;
  url: string;
  terminal_state: TerminalState;
  organization_identity?: {
    name: string;
    domain: string;
    homepage?: string;
  };
  discovered_domains?: string[];
  discovered_subdomains?: string[];
  source_records?: any[];
  observations?: any[];
  evidence?: any[];
  signals?: any[];
  hypothesis?: any;
  verification_result?: any;
  decision_state?: string;
  decision?: string;
  confidence?: string;
  finding_type?: string;
  finding_confidence?: string;
  outreach_eligibility?: {
    eligible: boolean;
    reason?: string;
  };
  uncertainties?: any[];
  rate_limited?: string[];
  timestamps?: {
    started: string;
    completed: string;
    duration_ms: number;
  };
  provider_statuses?: Record<string, 'available' | 'unavailable' | 'error'>;
  proof_chain?: any;
  finding_card?: string;
  error?: string;
  error_stack?: string;
}

function ensureRunDir(): void {
  fs.mkdirSync(RUN_DIR, { recursive: true });
}

/** Handle process signals: write final manifest and exit cleanly. */
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

function writeManifest(manifest: any): void {
  // Atomic write — write to temp then rename
  const tmpPath = MANIFEST_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(tmpPath, MANIFEST_PATH);
}

function writeArtifact(artifact: CompanyArtifact): void {
  const safeCompany = artifact.company.replace(/[^a-z0-9.-]/gi, '_').toLowerCase() || 'unknown';
  const artifactPath = path.join(RUN_DIR, 'artifacts', `${safeCompany}.json`);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  // Never overwrite existing artifacts within this run
  if (fs.existsSync(artifactPath)) {
    console.log(`  ⚠️  Artifact already exists for ${safeCompany}, skipping write (resume-safe)`);
    return;
  }
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), 'utf8');
}

/** Check if an artifact already exists for a given company in this run. */
function artifactExists(companyName: string): boolean {
  const safeCompany = companyName.replace(/[^a-z0-9.-]/gi, '_').toLowerCase() || 'unknown';
  const artifactPath = path.join(RUN_DIR, 'artifacts', `${safeCompany}.json`);
  return fs.existsSync(artifactPath);
}

async function runCompanyWithTimeout(target: string, timeoutMs: number): Promise<CompanyArtifact> {
  const started = new Date().toISOString();
  const startTime = Date.now();

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  const artifact: CompanyArtifact = {
    run_id: RUN_ID,
    run_timestamp: started,
    company: '',
    url: target,
    terminal_state: { state: 'COMPLETED' },
    timestamps: { started, completed: '', duration_ms: 0 },
  };

  try {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vardhan-batch3-artifact-'));

    const provider = new LivePublicObservationProvider({
      delayMs: 150,
      sampleDelayMs: 200,
      maxRequests: 25,
      fetcher: realFetch,
    }) as any;

    const builder = new DeepProspectBuilder({
      fetcher: realFetch,
      observationProvider: provider,
      saveArtifact: (p: string, d: string) => {
        try {
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, d, 'utf8');
        } catch {}
      },
      artifactsBaseDir: tmpDir,
      maxDiscoveryPages: 15,
      discoveryDelayMs: 200,
      discoveryTimeoutMs: 8000,
      observationDelayMs: 150,
      onProgress: () => {},
      logger: () => {},
    });

    const { prospect } = await builder.build(target);
    const completed = new Date().toISOString();

    artifact.company = prospect.company || target.replace('https://www.', '').replace(/\/$/, '');
    artifact.organization_identity = {
      name: prospect.company || '',
      domain: target.replace('https://', '').replace(/\/$/, ''),
      homepage: prospect.company_surface?.homepage || prospect.company_surface?.company_homepage || '',
    };
    artifact.discovered_domains = [artifact.organization_identity.domain];
    artifact.discovered_subdomains = provider.getDiscoveredSubdomains();
    artifact.evidence = prospect.evidence;
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
      qa_status: prospect.qa_status,
      qa_blocked_reason: prospect.qa_blocked_reason,
      decision_reason: prospect.decision_reason,
      gating_outcome: prospect.gating_outcome,
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
      reason: prospect.decision_reason || '',
    };
    artifact.uncertainties = prospect.uncertainties || [];
    artifact.timestamps = { started, completed, duration_ms: Date.now() - startTime };
    artifact.provider_statuses = {
      LivePublicObservationProvider: provider.getDiscoveredSubdomains().length > 0 ? 'available' : 'available',
      DeepProspectBuilder: 'available',
    };
    artifact.rate_limited = provider.getRateLimitedUrls();

    // Build full proof chain for OUTREACH_READY findings
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
            sensitive_fields: ev.sensitive_fields,
            observed_fields: ev.observed_fields,
          })),
      };
    }

    artifact.terminal_state = { state: 'COMPLETED' };
  } catch (e: any) {
    const completed = new Date().toISOString();
    artifact.terminal_state = { state: 'FAILED', reason: e.message };
    artifact.error = e.message;
    artifact.error_stack = e.stack;
    artifact.company = target.replace('https://www.', '').replace(/\/$/, '');
    artifact.decision = 'NO_GO';
    artifact.timestamps = { started, completed, duration_ms: Date.now() - startTime };
  } finally {
    clearTimeout(timeoutId);
  }

  return artifact;
}

async function main() {
  ensureRunDir();

  const runStarted = new Date().toISOString();
  console.log(`🎯 Batch 3 — Immutable Run: ${RUN_ID}`);
  console.log(`   Run directory: ${RUN_DIR}`);
  console.log(`   Targets: ${TARGETS.length}`);
  console.log('');

  const manifest = {
    run_id: RUN_ID,
    started_at: runStarted,
    targets: TARGETS,
    target_count: TARGETS.length,
    completed_count: 0,
    failed_count: 0,
    timed_out_count: 0,
    skipped_count: 0,
    decisions: {},
    total_evidence_records: 0,
    total_subdomains_discovered: 0,
    total_rate_limited_urls: 0,
    rate_limited_targets: 0,
    status: 'RUNNING',
  };

  writeManifest(manifest);
  setupGracefulShutdown(manifest);

  const allArtifacts: CompanyArtifact[] = [];
  const perCompanyTimeoutMs = 180000; // 3 minutes per company

  for (let i = 0; i < TARGETS.length; i++) {
    const target = TARGETS[i];
    console.log(`[${i + 1}/${TARGETS.length}] ${target} — starting...`);

    let artifact: CompanyArtifact;
    try {
      // Race against timeout
      const timeoutPromise = new Promise<CompanyArtifact>((resolve) => {
        setTimeout(() => {
          resolve({
            run_id: RUN_ID,
            run_timestamp: new Date().toISOString(),
            company: target.replace('https://www.', '').replace(/\/$/, ''),
            url: target,
            terminal_state: { state: 'TIMED_OUT', reason: `Exceeded ${perCompanyTimeoutMs / 1000}s per-company timeout` },
            decision: 'NO_GO',
            timestamps: { started: '', completed: new Date().toISOString(), duration_ms: perCompanyTimeoutMs },
          });
        }, perCompanyTimeoutMs);
      });

      const resultPromise = runCompanyWithTimeout(target, perCompanyTimeoutMs);
      artifact = await Promise.race([resultPromise, timeoutPromise]);
    } catch (e: any) {
      artifact = {
        run_id: RUN_ID,
        run_timestamp: new Date().toISOString(),
        company: target.replace('https://www.', '').replace(/\/$/, ''),
        url: target,
        terminal_state: { state: 'FAILED', reason: e.message },
        decision: 'NO_GO',
        error: e.message,
        timestamps: { started: '', completed: new Date().toISOString(), duration_ms: 0 },
      };
    }

    allArtifacts.push(artifact);
    writeArtifact(artifact);

    console.log(`  → ${artifact.terminal_state.state} | decision=${artifact.decision || 'N/A'} | finding=${artifact.finding_type || 'N/A'} | evidence=${artifact.evidence?.length || 0} | subs=${artifact.discovered_subdomains?.length || 0}`);

    // Update manifest incrementally
    manifest.completed_count = allArtifacts.filter(a => a.terminal_state.state === 'COMPLETED').length;
    manifest.failed_count = allArtifacts.filter(a => a.terminal_state.state === 'FAILED').length;
    manifest.timed_out_count = allArtifacts.filter(a => a.terminal_state.state === 'TIMED_OUT').length;
    manifest.skipped_count = allArtifacts.filter(a => a.terminal_state.state === 'SKIPPED').length;

    const decisions: Record<string, number> = {};
    let totalEvidence = 0;
    let totalRateLimited = 0;
    const allSubs = new Set<string>();
    const rateLimitedTargets = new Set<string>();
    for (const a of allArtifacts) {
      const d = a.decision || 'NONE';
      decisions[d] = (decisions[d] || 0) + 1;
      totalEvidence += a.evidence?.length || 0;
      for (const s of (a.discovered_subdomains || [])) allSubs.add(s);
      if ((a.rate_limited || []).length > 0) {
        totalRateLimited += a.rate_limited!.length;
        rateLimitedTargets.add(a.url);
      }
    }
    manifest.decisions = decisions;
    manifest.total_evidence_records = totalEvidence;
    manifest.total_subdomains_discovered = allSubs.size;
    manifest.total_rate_limited_urls = totalRateLimited;
    manifest.rate_limited_targets = rateLimitedTargets.size;
    writeManifest(manifest);
  }

  const runCompleted = new Date().toISOString();
  manifest.status = 'COMPLETE';
  manifest.completed_at = runCompleted;
  writeManifest(manifest);

  // ── Compare with previous batch3 results ──
  let previousResults: any[] = [];
  try {
    previousResults = JSON.parse(fs.readFileSync('/tmp/vardhan-batch3-results.json', 'utf8'));
    console.log(`\n📊 Comparison with previous Batch 3 run (${previousResults.length} companies):`);
  } catch {
    console.log(`\n📊 No previous Batch 3 results found at /tmp/vardhan-batch3-results.json for comparison.`);
  }

  // Write summary
  fs.writeFileSync(RESULTS_PATH, JSON.stringify({
    run_id: RUN_ID,
    manifest,
    artifacts: allArtifacts.map(a => ({
      company: a.company,
      url: a.url,
      terminal_state: a.terminal_state,
      decision: a.decision,
      finding_type: a.finding_type,
      evidence_count: a.evidence?.length || 0,
      subdomains: a.discovered_subdomains?.length || 0,
      artifact_file: a.company.replace(/[^a-z0-9.-]/gi, '_').toLowerCase() + '.json',
    })),
  }, null, 2), 'utf8');

  // Print funnel
  console.log('');
  console.log('═'.repeat(70));
  console.log(`BATCH 3 IMMUTABLE RUN — FINAL REPORT  (${RUN_ID})`);
  console.log('═'.repeat(70));
  console.log(`Targets:     ${manifest.target_count}`);
  console.log(`Completed:   ${manifest.completed_count}`);
  console.log(`Failed:      ${manifest.failed_count}`);
  console.log(`Timed out:   ${manifest.timed_out_count}`);
  console.log(`Skipped:     ${manifest.skipped_count}`);
  console.log(`Reconciliation: ${manifest.completed_count} + ${manifest.failed_count} + ${manifest.timed_out_count} + ${manifest.skipped_count} = ${manifest.completed_count + manifest.failed_count + manifest.timed_out_count + manifest.skipped_count} (target: ${manifest.target_count})`);
  console.log('');
  console.log('Decision distribution:');
  for (const [d, c] of Object.entries(manifest.decisions).sort()) {
    console.log(`  ${d.padEnd(20)} ${c}`);
  }
  console.log('');
  console.log(`Total evidence records: ${manifest.total_evidence_records}`);
  console.log(`Total unique subdomains discovered: ${manifest.total_subdomains_discovered}`);
  console.log('');

  const candidates = allArtifacts.filter(a => a.decision === 'OUTREACH_READY' && a.finding_type?.startsWith('OBSERVED'));
  if (candidates.length > 0) {
    console.log(`REAL_PROSPECT_CANDIDATES: ${candidates.length}`);
    for (const c of candidates) {
      console.log(`  → ${c.company} (${c.url})`);
      console.log(`    finding=${c.finding_type} confidence=${c.finding_confidence} evidence=${c.evidence?.length}`);
      console.log(`    subdomains: ${(c.discovered_subdomains || []).join(', ')}`);
    }
    console.log('');
    console.log('Proof chains persisted as individual artifact files in:');
    console.log(`  ${RUN_DIR}/artifacts/`);
  }

  console.log('');
  console.log(`Artifacts:   ${RUN_DIR}/artifacts/`);
  console.log(`Manifest:    ${MANIFEST_PATH}`);
  console.log(`Summary:     ${RESULTS_PATH}`);

  // ── Comparison with previous batch3 results ──
  if (previousResults.length > 0) {
    console.log('');
    console.log('═'.repeat(70));
    console.log('COMPARISON WITH PREVIOUS BATCH 3 RUN');
    console.log('═'.repeat(70));
    const prevByUrl: Record<string, any> = {};
    for (const r of previousResults) {
      if (r.url) prevByUrl[r.url.toLowerCase()] = r;
    }
    const currentByUrl: Record<string, any> = {};
    for (const a of allArtifacts) {
      if (a.url) currentByUrl[a.url.toLowerCase()] = a;
    }
    const prevCandidates = previousResults.filter(r => r.decision === 'OUTREACH_READY' && (r.finding || r.finding_type || '').startsWith('OBSERVED'));
    const currCandidates = allArtifacts.filter(a => a.decision === 'OUTREACH_READY' && a.finding_type?.startsWith('OBSERVED'));
    console.log(`Previous run: ${previousResults.length} companies, ${prevCandidates.length} REAL_PROSPECT_CANDIDATES`);
    console.log(`Current run:  ${allArtifacts.length} companies, ${currCandidates.length} REAL_PROSPECT_CANDIDATES`);

    // Compare decisions for companies in both runs
    const compared = [];
    for (const [url, prev] of Object.entries(prevByUrl)) {
      const curr = currentByUrl[url];
      if (curr) {
        const prevFinding = prev.finding || prev.finding_type || 'NONE';
        const currFinding = curr.finding_type || 'NONE';
        const prevEvidence = prev.evidence_count || (prev.evidence || []).length || 0;
        const currEvidence = curr.evidence?.length || 0;
        const prevSubs = prev.discovered_subdomains || prev.subdomains || 0;
        const currSubs = curr.discovered_subdomains?.length || 0;
        const decisionChanged = prev.decision !== curr.decision;
        const findingChanged = prevFinding !== currFinding;
        const evidenceChanged = prevEvidence !== currEvidence;
        const subsChanged = prevSubs !== currSubs;
        if (decisionChanged || findingChanged || evidenceChanged || subsChanged) {
          compared.push({ url, prev: { decision: prev.decision, finding: prevFinding, evidence: prevEvidence, subs: prevSubs }, curr: { decision: curr.decision, finding: currFinding, evidence: currEvidence, subs: currSubs }, changes: { decisionChanged, findingChanged, evidenceChanged, subsChanged } });
        }
      }
    }
    if (compared.length > 0) {
      console.log(`\nMaterial differences (decisions that changed, findings that changed, evidence/subs counts that differ):`);
      for (const c of compared) {
        const changes: string[] = [];
        if (c.changes.decisionChanged) changes.push(`decision ${c.prev.decision}→${c.curr.decision}`);
        if (c.changes.findingChanged) changes.push(`finding ${c.prev.finding}→${c.curr.finding}`);
        if (c.changes.evidenceChanged) changes.push(`evidence ${c.prev.evidence}→${c.curr.evidence}`);
        if (c.changes.subsChanged) changes.push(`subdomains ${c.prev.subs}→${c.curr.subs}`);
        console.log(`  ${c.url}: ${changes.join(', ')}`);
      }
    } else {
      console.log('No material differences in decisions, findings, evidence counts, or subdomain counts.');
    }

    // Companies in previous but not current
    const notInCurrent = Object.keys(prevByUrl).filter(u => !currentByUrl[u]);
    if (notInCurrent.length > 0) {
      console.log(`\nIn previous run but not current: ${notInCurrent.join(', ')}`);
    }
    // Companies in current but not previous
    const notInPrev = Object.keys(currentByUrl).filter(u => !prevByUrl[u]);
    if (notInPrev.length > 0) {
      console.log(`\nIn current run but not previous: ${notInPrev.join(', ')}`);
    }
  }
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
