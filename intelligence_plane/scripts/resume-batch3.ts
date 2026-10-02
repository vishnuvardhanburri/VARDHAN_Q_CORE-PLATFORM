/**
 * Resume batch3 — run the remaining 12 companies not covered by the initial run.
 * Merges results with any existing results from /tmp/vardhan-batch3-results.json.
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

// Remaining 12 companies from batch3
const REMAINING = [
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
            result.card += `    observed_behavior=${ev.observed_behavior?.slice(0, 200)}\n`;
            result.card += `    reproducible=${ev.repeatable}\n`;
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
  console.log(`🎯 Resume Batch 3: ${REMAINING.length} companies\n`);

  // Load existing results
  let results: BatchResult[] = [];
  try {
    results = JSON.parse(fs.readFileSync('/tmp/vardhan-batch3-results.json', 'utf8'));
    console.log(`Loaded ${results.length} existing results`);
  } catch {}

  const existingUrls = new Set(results.map(r => r.url));
  const targets = REMAINING.filter(t => !existingUrls.has(t));
  console.log(`Running ${targets.length} remaining companies\n`);

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    console.log(`[${i + 1}/${targets.length}] ${target}`);
    try {
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
    } catch (e: any) {
      console.log(`  → FATAL ERROR: ${e.message}`);
      results.push({
        company: '', url: target, decision: 'NO_GO', confidence: '',
        finding: 'ERROR', finding_confidence: '', diagnostic_opportunity: false,
        evidence_count: 0, signals: [], email_generated: false,
        blocked_reason: '', card: '', out: `FATAL: ${e.message}`, errors: [e.message],
        discovered_subdomains: [], rate_limited: [],
      });
    }
    fs.writeFileSync('/tmp/vardhan-batch3-results.json', JSON.stringify(results, null, 2));
  }

  // Funnel
  const total = results.length;
  const researched = results.filter(r => (r.evidence_count > 0 || r.signals.length > 0) && r.decision !== '').length;
  const noGo = results.filter(r => r.decision === 'NO_GO').length;
  const researchMore = results.filter(r => r.decision === 'RESEARCH_MORE').length;
  const outreachReady = results.filter(r => r.decision === 'OUTREACH_READY').length;
  const candidates = results.filter(r => r.decision === 'OUTREACH_READY' && r.finding.startsWith('OBSERVED'));
  const totalSubdomains = new Set<string>();
  let rateLimitedTargets = 0;
  for (const r of results) {
    r.discovered_subdomains.forEach(s => totalSubdomains.add(s));
    if (r.rate_limited.length > 0) rateLimitedTargets++;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`BATCH 3 FUNNEL (${total} companies)`);
  console.log(`  Researched: ${researched}`);
  console.log(`  NO_GO: ${noGo}`);
  console.log(`  RESEARCH_MORE: ${researchMore}`);
  console.log(`  OUTREACH_READY: ${outreachReady}`);
  console.log(`  REAL_PROSPECT_CANDIDATES: ${candidates.length}`);
  console.log(`  Subdomains discovered: ${totalSubdomains.size}`);
  console.log(`  Rate-limited targets: ${rateLimitedTargets}`);
  if (candidates.length > 0) {
    console.log(`\n  TOP CANDIDATES:`);
    for (const c of candidates) {
      console.log(`    → ${c.company} (${c.url})`);
      console.log(`      finding=${c.finding} evidence=${c.evidence_count} signals=${c.signals.join(',')}`);
      console.log(`      subdomains: ${c.discovered_subdomains.join(', ')}`);
      console.log(`      card:\n${c.card.split('\n').slice(0, 30).join('\n')}`);
    }
  }
  console.log(`\nResults saved to /tmp/vardhan-batch3-results.json`);
}

main().catch(console.error);
