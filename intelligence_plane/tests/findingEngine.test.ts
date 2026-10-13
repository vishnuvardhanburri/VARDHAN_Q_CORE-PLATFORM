import { DeepProspectBuilder } from '../src/server/DeepProspectBuilder';
import type { Evidence } from '../src/server/IntelligenceCase';
import type { DeepSignal } from '../src/server/DeepTypes';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
// FindingEngine offline tests — deep finding detector (Part B/C, rules R1-R8).

let pass = 0, fail = 0; const failures: string[] = [];
const assert = (c: boolean, m: string) => { if (c) pass++; else { fail++; failures.push(m); console.log('[FAIL] ' + m); } };
const assertEq = <T,>(a: T, b: T, m: string) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (ok) pass++; else { fail++; failures.push(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); console.log('[FAIL] ' + m); } };

const detect = (b: DeepProspectBuilder) => (b as any).detectDeepFinding.bind(b);

const mkEv = (over: Partial<Evidence> & { id: string; observed_behavior?: string; status?: number; sensitive_fields?: string[]; public_url?: string; reproductions?: number; latency_ms?: number; baseline_latency_ms?: number; latency_samples?: number[]; repeatable?: boolean }): Evidence => ({
  evidence_origin: over.evidence_origin ?? 'REAL_PUBLIC_OBSERVATION',
  source_type: over.source_type ?? 'API_ENDPOINT',
  public_url: over.public_url ?? `https://api.acme.com/${over.id}`,
  status: over.status ?? 200,
  observed_behavior: over.observed_behavior ?? 'ok',
  reproductions: over.reproductions ?? 1, repeatable: over.repeatable ?? true,
  tested_without_auth: over.tested_without_auth ?? true,
  not_tested: over.not_tested ?? [],
  retrieved_at: over.retrieved_at ?? new Date().toISOString(),
  evidence_text: over.evidence_text ?? over.observed_behavior ?? 'ok',
  sensitive_fields: over.sensitive_fields, latency_ms: over.latency_ms, baseline_latency_ms: over.baseline_latency_ms, latency_samples: over.latency_samples,
  ...over,
} as Evidence);

const mkSig = (over: Partial<DeepSignal> & { signal_id: string; type: string; source_url: string; excerpt?: string; related_evidence_ids?: string[] }): DeepSignal => ({
  provenance: over.provenance ?? 'DOCUMENTED_FACT',
  signal_strength: over.signal_strength ?? 'MEDIUM',
  relevance: over.excerpt || '',
  ...over,
} as DeepSignal);

const b = new DeepProspectBuilder({ onProgress: () => {}, logger: () => {} });
const find = detect(b);

console.log('\n--- R1: sensitive metadata exposure ---');
{
  const obs = [mkEv({ id: 'E1', observed_behavior: 'response exposes storage_path', sensitive_fields: ['storage_path'], reproductions: 3 })];
  const f = find([], obs);
  assert(f !== null, 'R1 produces a finding');
  assertEq(f?.finding_type, 'POSSIBLE_SENSITIVE_METADATA_EXPOSURE', 'R1 type');
  assert(f?.evidence_ids.includes('E1'), 'R1 evidence id preserved');
  assert(f?.source_urls.length > 0, 'R1 source url present');
}

console.log('\n--- R2: repeated 5xx -> availability issue ---');
{
  const obs = [
    mkEv({ id: 'E1', status: 500, observed_behavior: '500 internal server error' }),
    mkEv({ id: 'E2', status: 502, observed_behavior: '502 bad gateway' }),
  ];
  const f = find([], obs);
  assertEq(f?.finding_type, 'OBSERVED_AVAILABILITY_ISSUE', 'R2 type');
  assert(f?.evidence_ids.length === 2, 'R2 two evidence ids');
}

console.log('\n--- R3: documented incident (PUBLIC_INCIDENT signal w/ incident language + evidence) ---');
{
  const obs = [mkEv({ id: 'E1', observed_behavior: 'status page documents outage', public_url: 'https://acme.com/status', source_type: 'STATUS_PAGE' as any })];
  const sig = mkSig({ signal_id: 'S1', type: 'PUBLIC_INCIDENT', source_url: 'https://acme.com/status', excerpt: 'Major outage resolved yesterday.', related_evidence_ids: ['E1'] });
  const f = find([sig], obs);
  assertEq(f?.finding_type, 'DOCUMENTED_INCIDENT', 'R3 type');
  assert(f?.evidence_ids.includes('E1'), 'R3 links evidence');
}

console.log('\n--- R4: documented engineering failure (article w/ failure language) ---');
{
  const sig = mkSig({ signal_id: 'S1', type: 'ENGINEERING_ARTICLE', source_url: 'https://acme.com/blog/postmortem', excerpt: 'Postmortem: we rolled back after a critical bug.', related_evidence_ids: [] });
  const obs = [mkEv({ id: 'E1', observed_behavior: 'read article', public_url: 'https://acme.com/blog/postmortem' })];
  const f = find([sig], obs);
  assertEq(f?.finding_type, 'DOCUMENTED_ENGINEERING_FAILURE', 'R4 type');
}

console.log('\n--- R5: documented scaling constraint ---');
{
  const sig = mkSig({ signal_id: 'S1', type: 'ARCHITECTURE_DISCUSSION', source_url: 'https://acme.com/docs/arch', excerpt: 'We rate-limit to 100 req/s per client to protect throughput.', related_evidence_ids: [] });
  const obs = [mkEv({ id: 'E1', observed_behavior: 'read docs', public_url: 'https://acme.com/docs/arch' })];
  const f = find([sig], obs);
  assertEq(f?.finding_type, 'DOCUMENTED_SCALING_CONSTRAINT', 'R5 type');
}

console.log('\n--- R6: observed latency (>=3 slow reproducible samples -> OBSERVED_LATENCY) ---');
{
  const obs = [
    mkEv({ id: 'E1', observed_behavior: 'slow', latency_ms: 2500, baseline_latency_ms: 100, reproductions: 3, latency_samples: [2500, 2200, 2800], repeatable: true }),
    mkEv({ id: 'E2', observed_behavior: 'slow', latency_ms: 2200, baseline_latency_ms: 100, reproductions: 3, latency_samples: [2200, 2100, 2300], repeatable: true }),
    mkEv({ id: 'E3', observed_behavior: 'slow', latency_ms: 3000, baseline_latency_ms: 100, reproductions: 3, latency_samples: [3000, 2900, 3100], repeatable: true }),
  ];
  const f = find([], obs);
  assertEq(f?.finding_type, 'OBSERVED_LATENCY', 'R6 type');
  assertEq(f?.evidence_ids.length, 3, 'R6 evidence ids are preserved (one per sample)');
}

console.log('\n--- R6 regression: <3 slow samples -> no latency finding (threshold is >=3) ---');
{
  const obs = [
    mkEv({ id: 'E1', observed_behavior: 'slow', latency_ms: 2500, baseline_latency_ms: 100, reproductions: 3, latency_samples: [2500, 2200, 2800], repeatable: true }),
    mkEv({ id: 'E2', observed_behavior: 'slow', latency_ms: 3000, baseline_latency_ms: 100, reproductions: 3, latency_samples: [3000, 2900, 3100], repeatable: true }),
  ];
  const f = find([], obs);
  assert(f === null, 'two slow samples do NOT produce OBSERVED_LATENCY');
}

console.log('\n--- R7: public exposure (repeatable unauth + exposure language -> POSSIBLE_PUBLIC_EXPOSURE) ---');
{
  const obs = [mkEv({ id: 'E1', observed_behavior: 'config exposed without auth, accessible to anyone', reproductions: 4 })];
  const f = find([], obs);
  assertEq(f?.finding_type, 'POSSIBLE_PUBLIC_EXPOSURE', 'R7 type');
  assert(f?.evidence_ids.includes('E1'), 'R7 evidence id preserved');
}

console.log('\n--- R8: access issue (repeatable 401/403 + denial language) ---');
{
  const obs = [mkEv({ id: 'E1', status: 403, observed_behavior: 'access denied — authentication required to view this resource', reproductions: 2 })];
  const f = find([], obs);
  assertEq(f?.finding_type, 'POSSIBLE_ACCESS_ISSUE', 'R8 type');
  assertEq(f?.impact_severity, 'LOW', 'R8 severity LOW');
}

console.log('\n--- Part B: generic engineering content NEVER becomes a finding ---');
{
  // Generic platform content with exposure-ish words but no concrete behavior,
  // no security posture, and no incident/failure/scaling language.
  const sig = mkSig({ signal_id: 'S1', type: 'ENGINEERING_ARTICLE', source_url: 'https://acme.com/blog', excerpt: 'Available on AWS, Azure, and GCP.', related_evidence_ids: [] });
  const obs = [mkEv({ id: 'E1', observed_behavior: 'a general blog post', public_url: 'https://acme.com/blog' })];
  const f = find([sig], obs);
  assert(f === null, 'generic "Available on AWS, Azure, GCP" does NOT yield a finding');
}

console.log('\n--- evidence_ids required: signal-only findings dropped ---');
{
  // A PUBLIC_INCIDENT signal with incident language but NO corroborating
  // observation evidence must NOT be minted into a finding.
  const sig = mkSig({ signal_id: 'S1', type: 'PUBLIC_INCIDENT', source_url: 'https://acme.com/status', excerpt: 'Outage resolved.', related_evidence_ids: [] });
  const f = find([sig], []);
  assert(f === null, 'incident signal with no observation evidence -> no finding (signal-only dropped)');

  // Even when the signal references an evidence id, if that id does not resolve
  // to a real observation the result is signal-only and must be dropped.
  const sig2 = mkSig({ signal_id: 'S2', type: 'PUBLIC_INCIDENT', source_url: 'https://acme.com/status', excerpt: 'Outage resolved.', related_evidence_ids: ['MISSING'] });
  const f2 = find([sig2], [mkEv({ id: 'E1', observed_behavior: 'ok', public_url: 'https://acme.com/status' })]);
  assert(f2 === null, 'signal referencing a non-existent evidence id -> no finding');
}

console.log('\n--- Adversarial corroboration: conflicting observations on same URL -> CONFLICTING_EVIDENCE (weakened) -> RESEARCH_MORE ---');
{
  // Same resource observed BOTH as exposed-without-auth AND as a 401/403
  // auth-denied boundary. The "corroboration" for an exposure/access claim is
  // adversarial to the claim, so the finding is weakened to CONFLICTING_EVIDENCE
  // (LOW confidence). The build gate maps CONFLICTING_EVIDENCE -> RESEARCH_MORE.
  const obs = [
    mkEv({ id: 'E1', status: 200, observed_behavior: 'config exposed without auth, accessible to anyone', reproductions: 4, public_url: 'https://acme.com/secret' }),
    mkEv({ id: 'E2', status: 403, observed_behavior: 'access denied — authentication required to view this resource', reproductions: 4, public_url: 'https://acme.com/secret' }),
  ];
  const f = find([], obs);
  assertEq(f?.finding_type, 'CONFLICTING_EVIDENCE', 'conflicting same-URL observations -> CONFLICTING_EVIDENCE');
  assert(f?.evidence_ids.length === 2 && f?.evidence_ids.includes('E1') && f?.evidence_ids.includes('E2'), 'conflict carries both contradicting evidence ids');
  assertEq(f?.confidence, 'LOW', 'conflict finding is weakened (LOW confidence)');
  assertEq(f?.impact_severity, 'LOW', 'conflict finding severity is LOW');

  // Same-URL contradiction must NOT also emit a (defeasible) exposure finding.
  assert(f?.finding_type !== 'POSSIBLE_PUBLIC_EXPOSURE' && f?.finding_type !== 'POSSIBLE_ACCESS_ISSUE', 'no exposure/access finding escapes when evidence conflicts');

  // Non-conflicting single observation still yields the normal finding — the
  // weakening is specifically the contradiction, not the exposure behavior.
  const g = find([], [mkEv({ id: 'E1', status: 200, observed_behavior: 'config exposed without auth, accessible to anyone', reproductions: 4, public_url: 'https://acme.com/secret' })]);
  assertEq(g?.finding_type, 'POSSIBLE_PUBLIC_EXPOSURE', 'single exposure observation (no contradiction) -> POSSIBLE_PUBLIC_EXPOSURE');

  // Contradiction across DIFFERENT URLs is not a conflict -> normal findings.
  const h = find([], [
    mkEv({ id: 'E1', status: 200, observed_behavior: 'config exposed without auth, accessible to anyone', reproductions: 4, public_url: 'https://acme.com/secret' }),
    mkEv({ id: 'E2', status: 403, observed_behavior: 'access denied — authentication required', reproductions: 4, public_url: 'https://acme.com/admin' }),
  ]);
  assertEq(h?.finding_type, 'POSSIBLE_PUBLIC_EXPOSURE', 'conflicting postures on different URLs -> no conflict (picks MEDIUM exposure over LOW access)');
}

console.log('\n--- Severity ranking picks highest defensible, breaks ties by evidence count ---');
{
  // sensitive metadata (MEDIUM, 1 evidence) vs two exposure observations (MEDIUM, 2 evidence)
  const obs = [
    mkEv({ id: 'A', observed_behavior: 'exposes storage_path', sensitive_fields: ['storage_path'], reproductions: 3 }),
    mkEv({ id: 'B', observed_behavior: 'config exposed without auth, accessible to anyone', reproductions: 4 }),
    mkEv({ id: 'C', observed_behavior: 'debug config exposed without auth', reproductions: 4 }),
  ];
  const f = find([], obs);
  assert(f !== null, 'picked a finding');
  assertEq(f?.finding_type, 'POSSIBLE_PUBLIC_EXPOSURE', 'picks POSSIBLE_PUBLIC_EXPOSURE (tie-break: more evidence)');
}

console.log('\n==================================================');
console.log(`FindingEngine tests: ${pass} passed, ${fail} failed.`);
if (fail === 0) console.log('ALL TESTS PASSED.');
else { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
expect(fail).toBe(0);

  });
});