/**
 * Batch prospect hunt — runs DeepProspectBuilder on 25 real companies
 * from the Growjo dataset. Produces a finding funnel + qualifying cards.
 */
import { DeepProspectBuilder } from '../src/server/DeepProspectBuilder';
import { OutreachCardPrinter } from '../src/server/OutreachCardPrinter';
import { LivePublicObservationProvider } from '../src/server/LivePublicObservationProvider';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse } from 'csv-parse/sync';

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
    return new Response('', { status: 0, statusText: e.message }) as any;
  }
}) as any;

// 25 real companies from Growjo dataset (tech/SaaS/DevOps focus)
const TARGETS = [
  'https://supabase.com',
  'https://groq.com',
  'https://huggingface.co',
  'https://tailscale.com',
  'https://temporal.io',
  'https://island.io',
  'https://www.vultr.com',
  'https://antithesis.com',
  'https://buildops.com',
  'https://cynomi.com',
  'https://www.tines.com',
  'https://upwind.io',
  'https://secondfront.com',
  'https://tryriot.com',
  'https://www.hebbia.ai',
  'https://pika.art',
  'https://speak.com',
  'https://11x.ai',
  'https://www.hostaway.com',
  'https://www.getnerdio.com',
  'https://www.cyberhaven.com',
  'https://www.dream.com',
  'https://www.bendingspoons.com',
  'https://crescendo.ai',
  'https://halcyon.ai',
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
}

async function runCompany(target: string): Promise<BatchResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vardhan-batch-'));
  const builder = new DeepProspectBuilder({
    fetcher: realFetch,
    observationProvider: new LivePublicObservationProvider({ delayMs: 100, fetcher: realFetch }) as any,
    saveArtifact: (p, d) => { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, d, 'utf8'); } catch {} },
    artifactsBaseDir: tmpDir,
    maxDiscoveryPages: 15,
    discoveryDelayMs: 200,
    discoveryTimeoutMs: 8000,
    observationDelayMs: 100,
    onProgress: (stage: string, msg: string) => {},
    logger: () => {},
  });

  const result: BatchResult = {
    company: '',
    url: target,
    decision: '',
    confidence: '',
    finding: '',
    finding_confidence: '',
    diagnostic_opportunity: false,
    evidence_count: 0,
    signals: [],
    email_generated: false,
    blocked_reason: '',
    card: '',
    out: '',
    errors: [],
  };

  try {
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
    const card = OutreachCardPrinter.buildCard(prospect);
    result.card = card ? OutreachCardPrinter.printCard(card) : '(no card — non-defensible finding or no finding)';
    result.out = `decision=${prospect.decision} finding=${result.finding} diag=${!!prospect.diagnostic_opportunity} evidence=${prospect.evidence.length}`;
  } catch (e: any) {
    result.errors.push(e.message);
    result.out = `ERROR: ${e.message}`;
  }
  return result;
}

async function main() {
  console.log(`🎯 Batch: ${TARGETS.length} companies from Growjo dataset\n`);

  const results: BatchResult[] = [];
  for (let i = 0; i < TARGETS.length; i++) {
    const target = TARGETS[i];
    console.log(`[${i + 1}/${TARGETS.length}] ${target}`);
    const result = await runCompany(target);
    results.push(result);
    console.log(`  → ${result.out}`);
    if (result.errors.length) {
      console.log(`  → ERROR: ${result.errors.join('; ')}`);
    }
  }

  // ── Funnel ────────────────────────────────────────────────────────────────
  const total = results.length;
  const researched = results.filter(r => r.evidence_count > 0 || r.signals.length > 0).length;
  const qualifiedSignals = results.filter(r => r.signals.length > 0).length;
  const actionableFindings = results.filter(r => r.decision === 'OUTREACH_READY' && r.diagnostic_opportunity).length;
  const outreachReady = results.filter(r => r.decision === 'OUTREACH_READY').length;
  const researchMore = results.filter(r => r.decision === 'RESEARCH_MORE').length;
  const noGo = results.filter(r => r.decision === 'NO_GO').length;

  console.log('\n\n──────────────────────────────────────────────────');
  console.log('BATCH METRICS');
  console.log('──────────────────────────────────────────────────');
  console.log(`Companies researched:       ${total}`);
  console.log(`Companies with evidence:    ${researched}`);
  console.log(`Companies with signals:     ${qualifiedSignals}`);
  console.log(`Companies with sources:     ${results.filter(r => r.evidence_count > 0).length}`);
  console.log(`Observations (total):       ${results.reduce((s, r) => s + r.evidence_count, 0)}`);
  console.log(`Qualified signals:          ${results.reduce((s, r) => s + r.signals.length, 0)}`);
  console.log(`Correlations:               N/A (no cross-company correlation in single-company mode)`);
  console.log(`Actionable findings:        ${results.filter(r => r.finding.startsWith('OBSERVED_') || r.finding.startsWith('POSSIBLE_')).length}`);
  console.log(`Diagnostic opportunities:   ${actionableFindings}`);
  console.log(`OUTREACH_READY:             ${outreachReady}`);
  console.log(`RESEARCH_MORE:              ${researchMore}`);
  console.log(`NO_GO:                      ${noGo}`);

  // ── REAL_PROSPECT_CANDIDATES ───────────────────────────────────────────────
  const candidates = results.filter(r => r.decision === 'OUTREACH_READY' && r.diagnostic_opportunity && r.card !== '(no card — non-defensible finding or no finding)');

  console.log('\n──────────────────────────────────────────────────');
  console.log('REAL_PROSPECT_CANDIDATES');
  console.log('──────────────────────────────────────────────────');
  if (candidates.length === 0) {
    console.log('None in this batch. No defensible actionable finding was identified');
    console.log('on the public surfaces examined during this run.');
  } else {
    candidates.forEach((c, i) => {
      console.log(`\n[${i + 1}] ${c.company} (${c.url})`);
      console.log(`  Finding: ${c.finding} (${c.finding_confidence})`);
      console.log(c.card);
    });
  }

  // ── Full funnel ────────────────────────────────────────────────────────────
  console.log('\n──────────────────────────────────────────────────');
  console.log('FULL 25-COMPANY FUNNEL');
  console.log('──────────────────────────────────────────────────');
  results.forEach(r => {
    const marker = r.decision === 'OUTREACH_READY' && r.diagnostic_opportunity ? ' ★' : '';
    console.log(`  ${r.url.padEnd(30)} → ${r.decision.padEnd(15)} finding=${r.finding}${marker}`);
  });

  // Save results
  fs.writeFileSync('/tmp/vardhan-batch-results.json', JSON.stringify(results, null, 2));
  console.log('\nResults saved to /tmp/vardhan-batch-results.json');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
