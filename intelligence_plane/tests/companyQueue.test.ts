import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CompanyQueue } from '../src/server/CompanyQueue';
import { GrowjoProvider } from '../src/server/GrowjoProvider';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
// CompanyQueue offline tests — persistent state, dedupe, resume, crash-safety.

let pass = 0, fail = 0; const failures: string[] = [];
const assert = (c: boolean, m: string) => { if (c) pass++; else { fail++; failures.push(m); console.log('[FAIL] ' + m); } };

function makeCsv() {
  const csv = [
    'company,domain,industry,person_name,email',
    'Acme,acme.com,Developer Infra,Jane Doe,jane@acme.com',
    'Beta,betalabs.com,SaaS,Mark Smith,mark@beta.com',
  ].join('\n');
  return GrowjoProvider.parseCsv(csv).companies;
}

console.log('\n--- CompanyQueue persistence + enqueue ---');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vardhan-q-'));
const q = new CompanyQueue(path.join(tmp, 'queue.jsonl'));
{
  const { added, duplicates } = q.enqueue(makeCsv());
  assert(added === 2, `enqueued 2 (got ${added})`);
  assert(duplicates === 0, 'no dupes on first enqueue');
  assert(q.count() === 2, `queue total 2 (got ${q.count()})`);
  assert(q.count('QUEUED') === 2, 'both QUEUED');
}

console.log('\n--- CompanyQueue dedupe by canonical domain ---');
{
  const d = q.enqueue(makeCsv());
  assert(d.added === 0, `re-enqueue adds 0 (got ${d.added})`);
  assert(d.duplicates === 2, `re-enqueue dedupes 2 (got ${d.duplicates})`);
  assert(q.count() === 2, 'still 2 after duplicate enqueue');
}

console.log('\n--- CompanyQueue crash-safe resume (reopen file) ---');
{
  const q2 = new CompanyQueue(path.join(tmp, 'queue.jsonl'));
  assert(q2.count() === 2, `reopened queue has 2 (got ${q2.count()})`);
}

console.log('\n--- CompanyQueue claimNext + markResearched ---');
{
  const row = q.claimNext();
  assert(!!row && row!.state === 'RESOLVING', 'claimNext advances to RESOLVING');
  const id = row!.id;
  q.markResearched(id, 'OUTREACH_READY', 'HIGH', 'POSSIBLE_SENSITIVE_METADATA_EXPOSURE', 'Jane Doe', '/artifacts/acme.json', 'OUTREACH_READY');
  const updated = q.list().find(r => r.id === id);
  assert(updated?.state === 'OUTREACH_READY', `state OUTREACH_READY (got ${updated?.state})`);
  assert(updated?.prospect?.decision === 'OUTREACH_READY', 'prospect decision recorded');
  assert(updated?.prospect?.finding === 'POSSIBLE_SENSITIVE_METADATA_EXPOSURE', 'finding recorded');
  assert(updated?.prospect?.owner === 'Jane Doe', 'owner recorded');
  assert(updated?.artifact_path === '/artifacts/acme.json', 'artifact path recorded');
}

console.log('\n--- CompanyQueue pipeline/resume ---');
{
  assert(q.count('QUEUED') === 1, 'one still QUEUED');
  assert(q.count('OUTREACH_READY') === 1, 'one OUTREACH_READY');
  const pending = q.pending();
  assert(pending.length === 2, `pending includes non-terminal (OUTREACH_READY + QUEUED) (got ${pending.length})`);
  assert(pending.some(r => r.state === 'QUEUED'), 'pending still includes the QUEUED company (Beta)');
}

console.log('\n--- CompanyQueue approve -> APPROVED -> SENT ---');
{
  const id = q.list().find(r => r.state === 'OUTREACH_READY')!.id;
  q.approve(id);
  const approved = q.list().find(r => r.id === id);
  assert(approved?.state === 'APPROVED', 'approve -> APPROVED');
  q.markSent(id);
  const sent = q.list().find(r => r.id === id);
  assert(sent?.state === 'SENT', 'markSent -> SENT');
  // After SENT, only the QUEUED company remains pending.
  assert(q.pending().length === 1, 'pending excludes terminal SENT/APPROVED');
  assert(q.pending()[0].state === 'QUEUED', 'pending returns the remaining QUEUED company');
  assert(q.markSent(q.list().find(r => r.state === 'QUEUED')!.id) === null, 'cannot SENT a non-APPROVED company');
}

console.log('\n--- CompanyQueue crash-safe persistence after state change ---');
{
  // Reopen the queue and verify all state transitions persisted to disk.
  const q3 = new CompanyQueue(path.join(tmp, 'queue.jsonl'));
  assert(q3.count() === 2, `reopened queue preserved 2 rows (got ${q3.count()})`);
  assert(q3.count('SENT') === 1, 'SENT state persisted on disk');
  assert(q3.count('QUEUED') === 1, 'QUEUED state persisted on disk');
  const sentRow = q3.list('SENT')[0];
  assert(!!sentRow?.prospect, 'prospect data persisted to disk');
  assert(sentRow?.prospect?.decision === 'OUTREACH_READY', 'prospect decision persisted');
  assert(sentRow?.prospect?.finding === 'POSSIBLE_SENSITIVE_METADATA_EXPOSURE', 'prospect finding persisted');
  assert(sentRow?.prospect?.owner === 'Jane Doe', 'prospect owner persisted');
  assert(sentRow?.artifact_path === '/artifacts/acme.json', 'artifact_path persisted');
  assert(sentRow?.attempt === 1, 'attempt counter persisted');
}

console.log('\n--- CompanyQueue full chain: QUEUED -> RESOLVING -> RESEARCHING -> OUTREACH_READY ---');
{
  // Use a fresh queue for a clean end-to-end transition test.
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'vardhan-q-chain-'));
  const qchain = new CompanyQueue(path.join(tmp2, 'queue.jsonl'));
  qchain.enqueue(makeCsv());
  const id = qchain.list()[0].id;

  // Step 1: claimNext -> RESOLVING
  const r1 = qchain.claimNext();
  assert(r1?.state === 'RESOLVING', 'claimNext -> RESOLVING');
  assert(qchain.count('RESOLVING') === 1, 'exactly 1 RESOLVING');

  // Step 2: markResolving -> RESEARCHING (with a resolution)
  const r2 = qchain.markResolving(id, {
    canonical_name: 'Acme',
    official_domain: 'acme.com',
    resolution_method: 'GROWJO_DOMAIN',
    resolution_source: 'Growjo CSV domain',
    resolution_confidence: 'HIGH',
  });
  assert(r2?.state === 'RESEARCHING', 'markResolving -> RESEARCHING');
  assert(r2?.resolution?.official_domain === 'acme.com', 'resolution persisted');
  assert(qchain.count('RESEARCHING') === 1, 'exactly 1 RESEARCHING');

  // Step 3: markResearched -> OUTREACH_READY
  const r3 = qchain.markResearched(id, 'OUTREACH_READY', 'HIGH', 'TECHNICAL_SIGNAL', 'Jane Doe', '/artifacts/acme.json', 'OUTREACH_READY');
  assert(r3?.state === 'OUTREACH_READY', 'markResearched -> OUTREACH_READY');
  assert(qchain.count('OUTREACH_READY') === 1, 'exactly 1 OUTREACH_READY');

  // Step 4: approve -> APPROVED
  const r4 = qchain.approve(id);
  assert(r4?.state === 'APPROVED', 'approve -> APPROVED');

  // Step 5: markSent -> SENT
  const r5 = qchain.markSent(id);
  assert(r5?.state === 'SENT', 'markSent -> SENT');

  // Verify persistence through the full chain.
  const qchain2 = new CompanyQueue(path.join(tmp2, 'queue.jsonl'));
  assert(qchain2.list('SENT')[0]?.id === id, 'full chain state persisted to disk (SENT)');
}

console.log('\n--- CompanyQueue CONTACT_READY -> APPROVED -> SENT ---');
{
  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'vardhan-q-contact-'));
  const qc = new CompanyQueue(path.join(tmp3, 'queue.jsonl'));
  qc.enqueue(makeCsv());
  const id = qc.list()[0].id;

  // Drive straight to CONTACT_READY via markResearched.
  const r0 = qc.markResearched(id, 'OUTREACH_READY', 'HIGH', 'TECHNICAL_SIGNAL', 'Jane Doe', '/artifacts/acme.json', 'CONTACT_READY');
  assert(r0?.state === 'CONTACT_READY', 'markResearched with CONTACT_READY nextState works');
  assert(qc.count('CONTACT_READY') === 1, 'exactly 1 CONTACT_READY');

  // CONTACT_READY should be approvable.
  const r1 = qc.approve(id);
  assert(r1?.state === 'APPROVED', 'approve works from CONTACT_READY');

  // APPROVED -> SENT
  const r2 = qc.markSent(id);
  assert(r2?.state === 'SENT', 'markSent works after CONTACT_READY -> APPROVED');
  assert(qc.markSent(qc.list().find(r => r.state !== 'SENT')!.id) === null, 'cannot SENT a NON-APPROVED (QUEUED) company');
}

console.log('\n--- CompanyQueue pending() excludes terminal states ---');
{
  const tmp4 = fs.mkdtempSync(path.join(os.tmpdir(), 'vardhan-q-pending-'));
  const qp = new CompanyQueue(path.join(tmp4, 'queue.jsonl'));
  const companies = makeCsv();
  qp.enqueue(companies);
  const acmeId = qp.list().find(r => r.company === 'Acme')!.id;
  const betaId = qp.list().find(r => r.company === 'Beta')!.id;

  // Drive Acme: QUEUED -> RESOLVING -> RESEARCHING -> NO_GO
  qp.claimNext();
  qp.markResolving(acmeId, { canonical_name: 'Acme', official_domain: 'acme.com', resolution_method: 'GROWJO_DOMAIN', resolution_source: null, resolution_confidence: 'HIGH' });
  qp.markResearched(acmeId, 'NO_GO', 'LOW', null, null, null, 'NO_GO');

  // Drive Beta: QUEUED -> RESOLVING -> RESEARCHING -> RESEARCH_MORE
  qp.claimNext();
  qp.markResolving(betaId, { canonical_name: 'Beta', official_domain: 'betalabs.com', resolution_method: 'GROWJO_DOMAIN', resolution_source: null, resolution_confidence: 'HIGH' });
  qp.markResearched(betaId, 'RESEARCH_MORE', 'LOW', null, null, null, 'RESEARCH_MORE');

  // NO_GO is terminal and should NOT appear in pending().
  const pending = qp.pending();
  assert(pending.length === 1, `pending() returns 1 (NO_GO excluded) (got ${pending.length})`);
  assert(pending.some(r => r.state === 'RESEARCH_MORE'), 'pending includes RESEARCH_MORE');
  assert(!pending.some(r => r.state === 'NO_GO'), 'pending excludes NO_GO');
  assert(qp.count('NO_GO') === 1, 'NO_GO count is 1');
}

console.log('\n--- CompanyQueue resume across close/reopen with mixed states ---');
{
  const tmp5 = fs.mkdtempSync(path.join(os.tmpdir(), 'vardhan-q-resume-'));
  const qr = new CompanyQueue(path.join(tmp5, 'queue.jsonl'));
  qr.enqueue(makeCsv());
  const acmeId = qr.list().find(r => r.company === 'Acme')!.id;
  const betaId = qr.list().find(r => r.company === 'Beta')!.id;

  // Set Acme to OUTREACH_READY, Beta stays QUEUED.
  qr.claimNext(); // claims Acme (first QUEUED)
  qr.markResearched(acmeId, 'OUTREACH_READY', 'HIGH', 'TECHNICAL_SIGNAL', 'Jane Doe', '/artifacts/acme.json', 'OUTREACH_READY');
  // Beta still QUEUED.

  // Close and reopen — simulate a crash/interruption.
  const qr2 = new CompanyQueue(path.join(tmp5, 'queue.jsonl'));
  assert(qr2.count() === 2, 'reopened queue has 2 rows');
  assert(qr2.count('OUTREACH_READY') === 1, 'reopened preserves OUTREACH_READY');
  assert(qr2.count('QUEUED') === 1, 'reopened preserves QUEUED (Beta)');
  assert(qr2.count('APPROVED') === 0, 'no APPROVED after reopen');

  // Resume: claimNext should pick up the remaining QUEUED company.
  const next = qr2.claimNext();
  assert(next?.company === 'Beta', 'claimNext after resume picks up Beta (got ' + next?.company + ')');
  assert(next?.state === 'RESOLVING', 'resumed claimNext -> RESOLVING');
}

console.log('\n==================================================');
console.log(`CompanyQueue tests: ${pass} passed, ${fail} failed.`);
if (fail === 0) console.log('ALL TESTS PASSED.');
else { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
expect(fail).toBe(0);

  });
});