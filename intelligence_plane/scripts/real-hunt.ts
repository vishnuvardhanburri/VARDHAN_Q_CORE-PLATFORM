// real-hunt.ts
// --------------
// REAL public-surface deep research on a list of companies (LivePublicObservationProvider).
// Read-only, same-origin, bounded. Honest decisions only (NO_GO / RESEARCH_MORE / OUTREACH_READY).
// Usage: npx tsx scripts/real-hunt.ts [comma-separated domains]

import * as fs from 'fs';
import * as path from 'path';
import { DeepProspectBuilder } from '../src/server/DeepProspectBuilder';

const targets = (process.argv[2] || 'cloudflare.com,supabase.com,vercel.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

function saveArtifact(p: string, data: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data, 'utf8');
}

// Timeout-bounded fetcher so a single slow endpoint can't stall a whole company.
const boundedFetch: typeof fetch = (async (url: string, init: any) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { ...(init || {}), signal: ctrl.signal });
    return res;
  } finally { clearTimeout(t); }
}) as any;

async function runOne(domain: string): Promise<void> {
  const url = `https://www.${domain}`;
  console.log(`\n╔══════════════════════════════════════════════════════════════`);
  console.log(`║ DEEP INTELLIGENCE — ${url}`);
  console.log(`╚══════════════════════════════════════════════════════════════`);
  const builder = new DeepProspectBuilder({
    fetcher: boundedFetch as any,
    saveArtifact,
    artifactsBaseDir: process.cwd(),
    maxDiscoveryPages: 6,
    discoveryDelayMs: 40,
    discoveryTimeoutMs: 6000,
    observationDelayMs: 40,
    onProgress: (stage, msg) => console.log(`  [${stage}] ${msg}`),
    logger: (m) => console.log(`  [discovery] ${m}`),
  });
  try {
    const { prospect, case_ref } = await withTimeout(builder.build(url), 90000);
    console.log(`\n── RESULT: ${prospect.company} → ${prospect.decision} (confidence ${prospect.confidence})`);
    console.log(`     fit:        ${prospect.fit}`);
    console.log(`     industry:   ${prospect.industry}`);
    console.log(`     signals:    ${prospect.technical_signals.length} (${prospect.documented_facts.length} facts / ${prospect.public_observations.length} obs / ${prospect.inferences.length} inferred)`);
    console.log(`     people:     ${prospect.people.length}  owner: ${prospect.selected_owner ? `${prospect.selected_owner.name} (${prospect.selected_owner.role}, ${prospect.selected_owner.confidence})` : '(none)'}`);
    console.log(`     contacts:   ${prospect.contactability.length}`);
    console.log(`     finding:    ${prospect.deep_finding ? `${prospect.deep_finding.finding_type} / ${prospect.deep_finding.confidence} / ${prospect.deep_finding.provenance}` : (prospect.findings ? prospect.findings.finding_type : 'NONE')}`);
    console.log(`     github:     ${prospect.github_activity?.length || 0} public repo(s)`);
    console.log(`     timeline:   ${prospect.activity_timeline?.length || 0} event(s)`);
    console.log(`     email:      ${prospect.email_draft.generated ? 'GENERATED' : 'BLOCKED — ' + (prospect.email_draft.blocked_reason || '')}`);
    if (prospect.email_draft.generated) {
      console.log(`     ───────── PRIMARY SUBJECT ─────────`);
      console.log(`     ${prospect.email_draft.primary_subject}`);
      console.log(`     ───────── EMAIL ─────────`);
      console.log(prospect.email_draft.body.split('\n').map(l => '     ' + l).join('\n'));
    }
    console.log(`     artifact:   ${prospect.artifact_path}`);
    console.log(`     case_ref:   ${case_ref ? `engine=${case_ref.prospect_decision}, claimQA=${case_ref.claim_validation}` : 'none'}`);
  } catch (e: any) {
    console.log(`\n── RESULT: ${domain} → ERROR: ${e?.message || String(e)}`);
  }
}

async function main(): Promise<void> {
  console.log(`VARDHAN REAL HUNT — ${targets.length} target(s)`);
  for (const d of targets) {
    try { await runOne(d); } catch (e: any) { console.log(`\n── ${d} failed: ${e?.message || String(e)}`); }
  }
  console.log('\n═══ DONE ═══');
}

void main();
