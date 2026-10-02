/**
 * Batch prospect hunt — Round 2: 25 companies with higher likelihood of
 * observable technical surfaces (public APIs on main domain, status pages,
 * developer portals).
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

// 25 real companies — tech companies with public-facing APIs, status pages,
// or less-sophisticated infra that may expose observable technical behavior
const TARGETS = [
  'https://www.stripe.com',
  'https://www.postman.com',
  'https://www.twilio.com',
  'https://www.sendgrid.com',
  'https://www.intercom.com',
  'https://www.notion.so',
  'https://www.figma.com',
  'https://www.canva.com',
  'https://www.atlassian.com',
  'https://www.docker.com',
  'https://www.hashicorp.com',
  'https://www.jesthq.com',
  'https://www.npmjs.com',
  'https://www.vercel.com',
  'https://www.netlify.com',
  'https://www.cloudflare.com',
  'https://www.newrelic.com',
  'https://www.datadoghq.com',
  'https://www.elastic.co',
  'https://www.mongodb.com',
  'https://www.redis.io',
  'https://www.rabbitmq.com',
  'https://www.postgresql.org',
  'https://www.mysql.com',
  'https://www.nginx.com',
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vardhan-batch2-'));
  const builder = new DeepProspectBuilder({
    fetcher: realFetch,
    observationProvider: new LivePublicObservationProvider({ delayMs: 100, fetcher: realFetch }) as any,
    saveArtifact: (p, d) => { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, d, 'utf8'); } catch {} },
    artifactsBaseDir: tmpDir,
    maxDiscoveryPages: 15,
    discoveryDelayMs: 200,
    discoveryTimeoutMs: 8000,
    observationDelayMs: 100,
    onProgress: () => {},
    logger: () => {},
  });

  const result: BatchResult = {
    company: '', url: target, decision: '', confidence: '',
    finding: '', finding_confidence: '', diagnostic_opportunity: false,
    evidence_count: 0, signals: [], email_generated: false,
    blocked_reason: '', card: '', out: '', errors: [],
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
    result.card = card ? OutreachCardPrinter.printCard(card) : '(no card — non-defensive finding or no finding)';

    // Collect evidence provenance for any OBSERVED_/POSSIBLE_ findings
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
  console.log(`🎯 Batch 2: ${TARGETS.length} companies\n`);

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
    // Flush results periodically
    fs.writeFileSync('/tmp/vardhan-batch2-results.json', JSON.stringify(results, null, 2));
  }

  // ── Funnel ──
  const total = results.length;
  const researched = results.filter(r => r.evidence_count > 0 || r.signals.length > 0).length;
  const qualifiedSignals = results.filter(r => r.signals.length > 0).length;
  const actionableFindings = results.filter(r => r.finding.startsWith('OBSERVED_') || r.finding.startsWith('POSSIBLE_')).length;
  const outreachReady = results.filter(r => r.decision === 'OUTREACH_READY').length;
  const researchMore = results.filter(r => r.decision === 'RESEARCH_MORE').length;
  const noGo = results.filter(r => r.decision === 'NO_GO').length;

  console.log('\n\n══════════════════════════════════════════════════');
  console.log('BATCH 2 METRICS');
  console.log('══════════════════════════════════════════════════');
  console.log(`Companies researched:       ${total}`);
  console.log(`Companies with evidence:    ${researched}`);
  console.log(`Companies with signals:     ${qualifiedSignals}`);
  console.log(`Observations (total):       ${results.reduce((s, r) => s + r.evidence_count, 0)}`);
  console.log(`Qualified signals:          ${results.reduce((s, r) => s + r.signals.length, 0)}`);
  console.log(`Actionable findings:        ${actionableFindings}`);
  console.log(`Diagnostic opportunities:   ${results.filter(r => r.diagnostic_opportunity).length}`);
  console.log(`OUTREACH_READY:             ${outreachReady}`);
  console.log(`RESEARCH_MORE:              ${researchMore}`);
  console.log(`NO_GO:                      ${noGo}`);

  const candidates = results.filter(r => r.decision === 'OUTREACH_READY' && r.diagnostic_opportunity && r.card !== '(no card — non-defensive finding or no finding)');
  console.log('\n══════════════════════════════════════════════════');
  console.log('REAL_PROSPECT_CANDIDATES');
  console.log('══════════════════════════════════════════════════');
  if (candidates.length === 0) {
    console.log('None in this batch.');
    console.log('No defensible actionable finding was identified on the');
    console.log('public surfaces examined during this run.');
  } else {
    candidates.forEach((c, i) => {
      console.log(`\n[${i + 1}] ${c.company} (${c.url})`);
      console.log(c.card);
    });
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log('FULL 25-COMPANY FUNNEL');
  console.log('══════════════════════════════════════════════════');
  results.forEach(r => {
    const star = (r.finding.startsWith('OBSERVED_') || r.finding.startsWith('POSSIBLE_')) ? ' ★' : '';
    console.log(`  ${r.url.padEnd(32)} → ${r.decision.padEnd(15)} ${r.finding}${star}`);
  });

  // Save all results
  fs.writeFileSync('/tmp/vardhan-batch2-results.json', JSON.stringify(results, null, 2));
  console.log('\nResults saved to /tmp/vardhan-batch2-results.json');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
