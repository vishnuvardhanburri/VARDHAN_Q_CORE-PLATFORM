/**
 * Batch prospect hunt — Round 3: 50 real companies from the Growjo dataset
 * using the enhanced LivePublicObservationProvider with subdomain discovery.
 *
 * This batch uses companies NOT in the previous two batches, to provide
 * a comparison against the 50-company baseline.
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
    // Re-throw network errors so the provider's observeUrl catch block handles them
    throw e;
  }
}) as any;

// 50 real companies from Growjo dataset — not in previous batches
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

interface BatchResult {
  company: string;
  url: string;
  decision: string;
  confidence: string;
  finding: string;
  finding_confidence: string;
  diagnostic_opportunity: boolean;
  evidence_count: number;
  signals: string[];
  email_generated: boolean;
  blocked_reason: string;
  card: string;
  out: string;
  errors: string[];
  discovered_subdomains: string[];
  rate_limited: string[];
}

async function runCompany(target: string): Promise<BatchResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vardhan-batch3-'));
  const result: BatchResult = {
    company: '', url: target, decision: '', confidence: '',
    finding: '', finding_confidence: '', diagnostic_opportunity: false,
    evidence_count: 0, signals: [], email_generated: false,
    blocked_reason: '', card: '', out: '', errors: [],
    discovered_subdomains: [], rate_limited: [],
  };

  try {
    const provider = new LivePublicObservationProvider({
      delayMs: 150,
      sampleDelayMs: 200,
      maxRequests: 25,
      fetcher: realFetch,
    }) as any;

    const builder = new DeepProspectBuilder({
      fetcher: realFetch,
      observationProvider: provider,
      saveArtifact: (p, d) => { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, d, 'utf8'); } catch {} },
      artifactsBaseDir: tmpDir,
      maxDiscoveryPages: 15,
      discoveryDelayMs: 200,
      discoveryTimeoutMs: 8000,
      observationDelayMs: 150,
      onProgress: () => {},
      logger: () => {},
    });

    const { prospect } = await builder.build(target);
    result.company = prospect.company;
    result.decision = prospect.decision;
    result.confidence = prospect.confidence;
    result.finding = prospect.deep_finding?.finding_type || prospect.findings?.finding_type || 'NONE';
    result.finding_confidence = prospect.deep_finding?.confidence || 'UNKNOWN';
    result.diagnostic_opportunity = !!prospect.diagnostic_opportunity;
    result.evidence_count = prospect.evidence.length;
    result.signals = prospect.technical_signals.map(s => s.type);
    result.email_generated = !!prospect.email_draft?.generated;
    result.blocked_reason = prospect.email_draft?.blocked_reason || '';
    result.discovered_subdomains = provider.getDiscoveredSubdomains();
    result.rate_limited = provider.getRateLimitedUrls();

    const card = OutreachCardPrinter.buildCard(prospect);
    result.card = card ? OutreachCardPrinter.printCard(card) : '(no card — non-defensive finding or no finding)';

    // Evidence provenance for any OBSERVED_/POSSIBLE_ findings
    if (result.finding.startsWith('OBSERVED_') || result.finding.startsWith('POSSIBLE_')) {
      const df = prospect.deep_finding;
      if (df) {
        result.card += `\n\n=== EVIDENCE PROVENANCE ===\n`;
        result.card += `Finding: ${df.finding_type} (${df.confidence})\n`;
        result.card += `Evidence (${df.evidence_ids.length}):\n`;
        prospect.evidence.forEach(ev => {
          if (df.evidence_ids.includes(ev.id)) {
            result.card += `  • id=${ev.id}\n`;
            result.card += `    url=${ev.public_url}\n`;
            result.card += `    origin=${ev.evidence_origin}\n`;
            result.card += `    source_type=${ev.source_type}\n`;
            result.card += `    observed_behavior=${ev.observed_behavior?.slice(0, 200)}\n`;
            result.card += `    reproducible=${ev.repeatable}\n`;
            result.card += `    evidence_text=${ev.evidence_text?.slice(0, 200)}\n`;
            if (ev.latency_samples?.length) result.card += `    latency_samples=${JSON.stringify(ev.latency_samples)}\n`;
            if (ev.sensitive_fields?.length) result.card += `    sensitive_fields=${JSON.stringify(ev.sensitive_fields)}\n`;
            if (ev.observed_fields?.length) result.card += `    observed_fields=${JSON.stringify(ev.observed_fields?.slice(0, 5))}\n`;
            result.card += `\n`;
          }
        });
      }
    }
    result.out = `decision=${prospect.decision} finding=${result.finding} diag=${!!prospect.diagnostic_opportunity} evidence=${prospect.evidence.length}`;
  } catch (e: any) {
    result.errors.push(e.message);
    result.out = `ERROR: ${e.message}`;
  }
  return result;
}

async function main() {
  console.log(`🎯 Batch 3: ${TARGETS.length} companies (enhanced provider)\n`);

  const results: BatchResult[] = [];
  for (let i = 0; i < TARGETS.length; i++) {
    const target = TARGETS[i];
    console.log(`[${i + 1}/${TARGETS.length}] ${target}`);
    const result = await runCompany(target);
    results.push(result);
    console.log(`  → ${result.out}`);
    if (result.discovered_subdomains.length > 0) {
      console.log(`  → subdomains: ${result.discovered_subdomains.join(', ')}`);
    }
    if (result.rate_limited.length > 0) {
      console.log(`  → rate-limited: ${result.rate_limited.join(', ')}`);
    }
    if (result.errors.length) {
      console.log(`  → ERROR: ${result.errors.join('; ')}`);
    }
    fs.writeFileSync('/tmp/vardhan-batch3-results.json', JSON.stringify(results, null, 2));
  }

  // ── Funnel ──
  const total = results.length;
  const researched = results.filter(r => r.evidence_count > 0 || r.signals.length > 0).length;
  const qualifiedSignals = results.filter(r => r.signals.length > 0).length;
  const totalObservations = results.reduce((s, r) => s + r.evidence_count, 0);
  const totalSignals = results.reduce((s, r) => s + r.signals.length, 0);
  const actionableFindings = results.filter(r => r.finding.startsWith('OBSERVED_') || r.finding.startsWith('POSSIBLE_')).length;
  const outreachReady = results.filter(r => r.decision === 'OUTREACH_READY').length;
  const researchMore = results.filter(r => r.decision === 'RESEARCH_MORE').length;
  const noGo = results.filter(r => r.decision === 'NO_GO').length;
  const allSubdomains = [...new Set(results.flatMap(r => r.discovered_subdomains))];
  const allRateLimited = [...new Set(results.flatMap(r => r.rate_limited))];

  console.log('\n\n══════════════════════════════════════════════════');
  console.log('BATCH 3 METRICS (Enhanced Provider)');
  console.log('══════════════════════════════════════════════════');
  console.log(`Companies researched:       ${total}`);
  console.log(`Companies with evidence:    ${researched}`);
  console.log(`Companies with signals:     ${qualifiedSignals}`);
  console.log(`Observations (total):       ${totalObservations}`);
  console.log(`Qualified signals (total):  ${totalSignals}`);
  console.log(`Actionable findings:        ${actionableFindings}`);
  console.log(`Diagnostic opportunities:   ${results.filter(r => r.diagnostic_opportunity).length}`);
  console.log(`OUTREACH_READY:             ${outreachReady}`);
  console.log(`RESEARCH_MORE:              ${researchMore}`);
  console.log(`NO_GO:                      ${noGo}`);
  console.log(`Newly discovered subdomains: ${allSubdomains.length}`);

  if (allSubdomains.length > 0) {
    console.log(`  ${allSubdomains.join('\n  ')}`);
  }
  if (allRateLimited.length > 0) {
    console.log(`Rate-limited targets:       ${allRateLimited.length}`);
    console.log(`  ${allRateLimited.join('\n  ')}`);
  } else {
    console.log('Rate-limited targets:       0');
  }

  // ── Findings breakdown ──
  const findingTypes = results.reduce((acc, r) => {
    if (r.finding) acc[r.finding] = (acc[r.finding] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log('\nFinding types:');
  for (const [k, v] of Object.entries(findingTypes).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  // ── Decisions breakdown ──
  console.log('\nDecisions:');
  console.log(`  OUTREACH_READY: ${outreachReady}`);
  console.log(`  RESEARCH_MORE:  ${researchMore}`);
  console.log(`  NO_GO:          ${noGo}`);
  console.log(`  (other):        ${total - outreachReady - researchMore - noGo}`);

  // ── REAL_PROSPECT_CANDIDATES ──
  const candidates = results.filter(r => r.decision === 'OUTREACH_READY' && r.diagnostic_opportunity && r.card !== '(no card — non-defensive finding or no finding)');
  console.log('\n══════════════════════════════════════════════════');
  console.log('REAL_PROSPECT_CANDIDATES');
  console.log('══════════════════════════════════════════════════');
  if (candidates.length === 0) {
    console.log('None in this batch.');
  } else {
    candidates.forEach((c, i) => {
      console.log(`\n[${i + 1}] ${c.company} (${c.url})`);
      console.log(c.card);
    });
  }

  console.log('\n══════════════════════════════════════════════════');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
