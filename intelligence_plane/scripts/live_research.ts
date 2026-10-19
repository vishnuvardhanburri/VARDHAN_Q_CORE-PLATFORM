/**
 * Live research script — runs DeepProspectBuilder on a real company URL.
 * Usage: npx tsx scripts/live_research.ts https://vercel.com
 */
import { DeepProspectBuilder } from '../src/server/DeepProspectBuilder';
import { OutreachCardPrinter } from '../src/server/OutreachCardPrinter';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const realFetch = (async (url: string, init?: any): Promise<Response> => {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        ...(init?.headers || {}),
      },
      signal: init?.signal,
    });
    return res as any;
  } catch (e: any) {
    console.error(`[fetch-error] ${url}: ${e.message}`);
    return new Response('', { status: 0, statusText: e.message }) as any;
  }
}) as any;

async function main() {
  const target = process.argv[2] || 'https://vercel.com';
  const verbose = process.argv.includes('--verbose');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vardhan-live-'));

  console.log(`🎯 Target: ${target}\n`);

  const builder = new DeepProspectBuilder({
    fetcher: realFetch,
    saveArtifact: (p, d) => { try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch {}; fs.writeFileSync(p, d, 'utf8'); },
    artifactsBaseDir: tmpDir,
    maxDiscoveryPages: 25,
    discoveryDelayMs: 300,
    discoveryTimeoutMs: 10000,
    observationDelayMs: 200,
    onProgress: (stage, msg) => {
      if (verbose || ['people', 'owners', 'email', 'findings', 'evidence', 'decision'].includes(stage)) {
        console.log(`[${stage}] ${msg}`);
      }
    },
    logger: () => {},
  });

  try {
    const result = await builder.build(target);
    const { prospect } = result;

    console.log('\n=== RESULT ===');
    console.log('decision:', prospect.decision);
    console.log('confidence:', prospect.confidence);
    console.log('finding:', prospect.deep_finding?.finding_type || prospect.findings?.finding_type || 'NONE');
    console.log('diagnostic_opportunity:', prospect.diagnostic_opportunity ? prospect.diagnostic_opportunity.problem_type : 'NONE');
    if (prospect.diagnostic_opportunity) {
      console.log('  commercial_relevance:', prospect.diagnostic_opportunity.commercial_relevance);
      console.log('  technical_area:', prospect.diagnostic_opportunity.technical_area);
      console.log('  recommended_responsibility:', prospect.diagnostic_opportunity.recommended_responsibility);
      console.log('  questions:', prospect.diagnostic_opportunity.diagnostic_questions.length);
    }
    console.log('selected_owner:', prospect.selected_owner ? `${prospect.selected_owner.name} (${prospect.selected_owner.role})` : 'NONE');
    console.log('contact_status:', prospect.contact_status);
    console.log('email generated:', prospect.email_draft?.generated);
    if (!prospect.email_draft?.generated) {
      console.log('email blocked_reason:', prospect.email_draft?.blocked_reason || 'none');
    }

    // Print the formatted outreach card (only for defensible findings)
    const card = OutreachCardPrinter.buildCard(prospect);
    if (card) {
      console.log('\n' + OutreachCardPrinter.printCard(card));
    } else if (prospect.decision === 'RESEARCH_MORE') {
      console.log('\n🔍 No outreach card — finding not defensible (RESEARCH_MORE).');
      console.log('   finding:', prospect.deep_finding?.finding_type || prospect.findings?.finding_type || 'NONE');
      console.log('   Reasons:', (prospect.qualification_reasons || []).join('; ') || 'none');
    } else {
      console.log('\n❌ No outreach card — prospect not ready.');
      console.log('   decision:', prospect.decision);
      console.log('   Reasons:', prospect.qualification_reasons || []);
    }
  } catch (e: any) {
    console.error('Fatal error:', e.message);
    console.error(e.stack);
  }
}

main();
