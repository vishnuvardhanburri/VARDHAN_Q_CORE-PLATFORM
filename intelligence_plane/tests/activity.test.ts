import { GitHubDiscovery } from '../src/server/GitHubDiscovery';
import { DeepSignalExtractor } from '../src/server/DeepSignalExtractor';
import { ActivityTimeline } from '../src/server/ActivityTimeline';
import { DeepProspectBuilder } from '../src/server/DeepProspectBuilder';
import type { DeepSignal, GithubRepoMeta, ActivityEvent, EvidenceProvenance, SignalStrength } from '../src/server/DeepTypes';
import type { Evidence, DiscoveredPage, FindingClassification } from '../src/server/IntelligenceCase';
import type { GitHubDiscoveryResult } from '../src/server/GitHubDiscovery';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
// tests/activity.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Topology C — technical activity + GitHub discovery offline tests.
//
// Verifies the owned surface contracts:
//   1. GitHubDiscovery — extracts github.com/<org> links ONLY from company HTML
//      (never guessed org names) and honours the unauthenticated rate limit.
//   2. GitHubDiscovery — 403 / 0 remaining -> STOP (no further calls, no crash).
//   3. DeepSignalExtractor — splitByProvenance buckets signals and every signal
//      carries provenance; generic cloud prose stays LOW INFERENCE.
//   4. ActivityTimeline — synthesises provenance-tracked ActivityEvent[] and is
//      sorted most-recent-first.
//   5. Regression (Part B) — generic "Available on AWS/Azure/GCP" engineering/blog
//      content is NOT a finding; a plain blog line is NOT an ARCHITECTURE_DISCUSSION
//      finding. DeepProspectBuilder.detectDeepFinding is consumed read-only here.

let pass = 0, fail = 0; const failures: string[] = [];
const assert = (c: boolean, m: string) => { if (c) pass++; else { fail++; failures.push(m); console.log('[FAIL] ' + m); } };
const assertEq = <T,>(a: T, b: T, m: string) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) pass++; else { fail++; failures.push(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); console.log('[FAIL] ' + m); }
};

// ── helpers ──────────────────────────────────────────────────────────────────

const mkSig = (over: Partial<DeepSignal> & {
  signal_id: string; type: DeepSignal['type']; source_url: string;
  excerpt: string; provenance: EvidenceProvenance; signal_strength: SignalStrength;
}): DeepSignal => ({ relevance: over.excerpt, ...over } as DeepSignal);

const mkEv = (over: Partial<Evidence> & {
  id: string; observed_behavior?: string; public_url?: string; status?: number;
  reproductions?: number; latency_ms?: number; baseline_latency_ms?: number;
}): Evidence => ({
  evidence_origin: over.evidence_origin ?? 'REAL_PUBLIC_OBSERVATION',
  source_type: over.source_type ?? 'API_ENDPOINT',
  public_url: over.public_url ?? `https://api.acme.com/${over.id}`,
  status: over.status ?? 200,
  observed_behavior: over.observed_behavior ?? 'ok',
  reproductions: over.reproductions ?? 1,
  repeatable: over.repeatable ?? true,
  tested_without_auth: over.tested_without_auth ?? true,
  not_tested: over.not_tested ?? [],
  retrieved_at: over.retrieved_at ?? new Date().toISOString(),
  evidence_text: over.evidence_text ?? over.observed_behavior ?? 'ok',
  sensitive_fields: over.sensitive_fields,
  latency_ms: over.latency_ms,
  baseline_latency_ms: over.baseline_latency_ms,
  ...over,
} as Evidence);

const mkResponse = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });

// DeepProspectBuilder.detectDeepFinding is the read-only consumer (Topology E).
// We only call it here to prove signals/extractor output do not over-elevate.
const builder = new DeepProspectBuilder({ onProgress: () => {}, logger: () => {} });
const detectFinding = (builder as any).detectDeepFinding.bind(builder);

console.log('\n--- 1. GitHubDiscovery: github.com/<org> links ONLY, never guessed org names ---');
{
  // (a) A github.com/<org>/<repo> link on the company page -> org discovered,
  //     exactly one API call scoped to that org, repo metadata returned.
  const calls: string[] = [];
  const res = await GitHubDiscovery.discover({
    fetcher: async (url) => { calls.push(url); return mkResponse(200, [{
      name: 'oss-tool', html_url: 'https://github.com/acme/oss-tool',
      stargazers_count: 3, language: 'Go', description: 'open source tool',
      updated_at: '2025-01-02T03:04:05Z',
    }], { 'x-ratelimit-remaining': '59' }); },
    pages: [{ url: 'https://acme.com/about', html: '<a href="https://github.com/acme/oss-tool">our code</a>' }],
    companyDomain: 'acme.com',
  });
  assertEq(res.repos.map(r => r.org), ['acme'], 'repo link yields org "acme"');
  assertEq(res.repos.map(r => r.repo), ['oss-tool'], 'repo name comes from the API response, not the link');
  assertEq(calls.length, 1, 'exactly one API call for the discovered org');
  assert(calls[0].includes('/orgs/acme/repos'), 'API URL scoped to the discovered org');
  assertEq(res.rate_limited, false, 'happy path is not rate limited');
  assertEq(res.scanned_pages, 1, 'scanned_pages reflects input pages');

  // (b) A bare github.com/<org> link also yields the org.
  const callsB: string[] = [];
  const resB = await GitHubDiscovery.discover({
    fetcher: async (url) => { callsB.push(url); return mkResponse(200, [{
      name: 'oss-tool', html_url: 'https://github.com/acme/oss-tool', stargazers_count: 1,
    }], { 'x-ratelimit-remaining': '58' }); },
    pages: [{ url: 'https://acme.com/team', html: '<a href="https://github.com/acme">engineering</a>' }],
    companyDomain: 'acme.com',
  });
  assertEq(callsB.length, 1, 'bare org link -> exactly one API call');
  assert(callsB[0].includes('/orgs/acme/repos'), 'bare org link resolves to the acme API call');
  assertEq(resB.repos.length, 1, 'bare org link returns a repo from the API');

  // (c) NO github link anywhere on the page -> NEVER guesses the org from the
  //     company domain, zero API calls.
  const callsC: string[] = [];
  const resC = await GitHubDiscovery.discover({
    fetcher: async (url) => { callsC.push(url); return mkResponse(200, [], { 'x-ratelimit-remaining': '57' }); },
    pages: [{ url: 'https://acme.com/about', html: '<p>Acme Corp builds things.</p><p>No GitHub link here.</p>' }],
    companyDomain: 'acme.com',
  });
  assertEq(callsC.length, 0, 'no github link -> zero API calls (org not guessed from domain)');
  assertEq(resC.repos.length, 0, 'no github link -> no repos');
  assertEq(resC.rate_limited, false, 'no github link -> not rate limited');

  // (d) A link to a DIFFERENT org on the company page is extracted because it is
  //     a real published link (not a guess).
  const callsD: string[] = [];
  const resD = await GitHubDiscovery.discover({
    fetcher: async (url) => { callsD.push(url); return mkResponse(200, [], { 'x-ratelimit-remaining': '56' }); },
    pages: [{ url: 'https://acme.com/about', html: '<a href="https://github.com/rivalco">contributed to</a>' }],
    companyDomain: 'acme.com',
  });
  assertEq(callsD.map(u => u.match(/orgs\/([^/]+)/)?.[1]), ['rivalco'], 'a real link to a non-own org is extracted');
  assertEq(resD.repos.length, 0, 'rivalco has no repos in the mocked response');
}

console.log('\n--- 2. GitHubDiscovery: rate-limit guard (403/0 -> STOP, no crash) ---');
{
  const calls: string[] = [];
  let res: GitHubDiscoveryResult | null = null;
  let threw: string | null = null;
  try {
    res = await GitHubDiscovery.discover({
      fetcher: async (url) => {
        calls.push(url);
        return mkResponse(403, { message: 'rate limited' },
          { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '60' });
      },
      pages: [
        { url: 'https://acme.com/about', html: '<a href="https://github.com/acme">a</a>' },
        { url: 'https://acme.com/oss', html: '<a href="https://github.com/widgets">w</a>' },
      ],
      companyDomain: 'acme.com',
    });
  } catch (e: any) { threw = e?.message || String(e); }
  assert(threw === null, '403/0 remaining does not crash the discoverer');
  assertEq(res?.rate_limited, true, '403/0 sets rate_limited = true');
  assertEq(res?.errors?.length, 0, '403/0 is a stop, not recorded as an error');
  assertEq(calls.length, 1, '403/0 stops after the first org (no further API calls)');
  assertEq(res?.repos?.length, 0, 'no repos returned while rate limited');
}

console.log('\n--- 3. DeepSignalExtractor: provenance split + provenance on signals ---');
{
  // Generic cloud prose on a *blog* page -> ARCHITECTURE_DISCUSSION but LOW & INFERENCE.
  const blogHtml = '<html><body><article>Available on AWS, Azure, and GCP.</article></body></html>';
  const pages: DiscoveredPage[] = [{ url: 'https://acme.com/blog', path: '/blog', category: 'blog' }];
  const htmlByUrl = new Map([[pages[0].url, blogHtml]]);
  const extracted = DeepSignalExtractor.extract(pages, htmlByUrl, [], 'test', { onProgress: () => {} });
  assert(extracted.every(s => typeof s.provenance === 'string'), 'every extracted signal carries a provenance');

  const arch = extracted.find(s => s.type === 'ARCHITECTURE_DISCUSSION');
  assert(!!arch, 'cloud prose matches the ARCHITECTURE_DISCUSSION detector');
  assertEq(arch?.provenance, 'VARDHAN_INFERENCE', 'blog-page cloud prose is VARDHAN_INFERENCE (not DOCUMENTED_FACT)');
  assertEq(arch?.signal_strength, 'LOW', 'blog-page cloud prose is LOW strength');

  // Split buckets a mixed provenance set.
  const mixed: DeepSignal[] = [
    mkSig({ signal_id: 's1', type: 'API_REFERENCE', source_url: 'https://acme.com/api', excerpt: 'doc', provenance: 'DOCUMENTED_FACT', signal_strength: 'HIGH' }),
    mkSig({ signal_id: 's2', type: 'STATUS_PAGE', source_url: 'https://acme.com/status', excerpt: 'stat', provenance: 'REAL_PUBLIC_OBSERVATION', signal_strength: 'MEDIUM' }),
    mkSig({ signal_id: 's3', type: 'ARCHITECTURE_DISCUSSION', source_url: 'https://acme.com/blog', excerpt: 'c', provenance: 'VARDHAN_INFERENCE', signal_strength: 'LOW' }),
    mkSig({ signal_id: 's4', type: 'BLOG', source_url: 'https://acme.com/blog', excerpt: 'd', provenance: 'DOCUMENTED_FACT', signal_strength: 'MEDIUM' }),
  ];
  const split = DeepSignalExtractor.splitByProvenance(mixed);
  assertEq(split.documented_facts.length, 2, 'documented_facts bucket has two signals');
  assertEq(split.public_observations.length, 1, 'public_observations bucket has one signal');
  assertEq(split.inferences.length, 1, 'inferences bucket has one signal');
  assertEq(split.documented_facts.map(s => s.signal_id), ['s1', 's4'], 'documented_facts preserves insertion order');
  assertEq(split.public_observations[0].signal_id, 's2', 'public_observations holds REAL_PUBLIC_OBSERVATION');
  assertEq(split.inferences[0].signal_id, 's3', 'inferences holds VARDHAN_INFERENCE');
  // Union of all buckets equals the input (no signal lost or duplicated).
  const merged = [...split.documented_facts, ...split.public_observations, ...split.inferences];
  assertEq(merged.length, mixed.length, 'splitByProvenance partitions every signal exactly once');
}

console.log('\n--- 4. ActivityTimeline: synthesis + provenance tracking + sort ---');
{
  const signals: DeepSignal[] = [
    mkSig({ signal_id: 'SIG1', type: 'PUBLIC_INCIDENT', source_url: 'https://acme.com/status',
      excerpt: 'Major outage resolved yesterday.', provenance: 'DOCUMENTED_FACT', signal_strength: 'MEDIUM' }),
  ];
  const evidence: Evidence[] = [
    mkEv({ id: 'E1', public_url: 'https://acme.com/api/x',
      observed_behavior: '500 internal server error', status: 500,
      evidence_origin: 'REAL_PUBLIC_OBSERVATION' }),
  ];
  const github: GithubRepoMeta[] = [{
    org: 'acme', repo: 'oss', url: 'https://github.com/acme/oss',
    discovered_via: 'https://acme.com/about', stars: 1, language: 'Go', description: 'tool',
    updated_at: '2024-01-01T00:00:00Z',
  }];
  const finding: FindingClassification = {
    finding_type: 'POSSIBLE_PUBLIC_EXPOSURE',
    impact_severity: 'MEDIUM',
    severity_basis: 'exposure language on a public endpoint',
  };

  const events = ActivityTimeline.synthesize({
    company: 'Acme', domain: 'acme.com', signals, evidence, github, finding,
    observedAt: '2025-06-01T00:00:00Z',
  });

  // 1 signal + 1 evidence + 1 github repo + 1 finding anchor = 4 events.
  assertEq(events.length, 4, 'one event per signal/evidence/github-plus-finding anchor');

  // Provenance is traced into each event.
  const timeOf = (e: ActivityEvent) => e.published_at ?? e.observed_at;
  const ordered = events.every((e, i, arr) => i === 0 || timeOf(arr[i - 1]) >= timeOf(e));
  assert(ordered, 'timeline is sorted most-recent-first');

  // github event (published_at 2024) is the oldest -> last.
  assertEq(events[3].type, 'ENGINEERING_RELEASE', 'github repo -> ENGINEERING_RELEASE event (oldest)');
  assertEq(events[3].published_at, '2024-01-01T00:00:00Z', 'github event carries the repo updated_at as published_at');
  assertEq(events[3].provenance, 'DOCUMENTED_FACT', 'github event is DOCUMENTED_FACT');

  // The signal and the finding anchor both map to PUBLIC_INCIDENT.
  const pubIncident = events.filter(e => e.type === 'PUBLIC_INCIDENT');
  assertEq(pubIncident.length, 2, 'signal + finding anchor both map to PUBLIC_INCIDENT');
  assert(pubIncident.every(e => e.provenance === 'DOCUMENTED_FACT'), 'PUBLIC_INCIDENT events are DOCUMENTED_FACT');
  const anchor = events.find(e => e.strength === 'HIGH');
  assertEq(anchor?.type, 'PUBLIC_INCIDENT', 'finding anchor is the HIGH-strength headline event');

  // Repeatable 5xx evidence -> STATUS_DEGRADATION, REAL_PUBLIC_OBSERVATION.
  const evEvt = events.find(e => e.related_evidence_ids.includes('E1'));
  assertEq(evEvt?.type, 'STATUS_DEGRADATION', 'repeatable 5xx evidence -> STATUS_DEGRADATION');
  assertEq(evEvt?.provenance, 'REAL_PUBLIC_OBSERVATION', 'observed 5xx evidence -> REAL_PUBLIC_OBSERVATION provenance');
  assertEq(evEvt?.strength, 'MEDIUM', 'repeatable real 5xx observation -> MEDIUM strength');

  // Every event carries a non-empty evidence trace string (never fabricated).
  assert(events.every(e => typeof e.evidence === 'string' && e.evidence.length > 0), 'every event carries an evidence trace');
  // Every event is tied back to an evidence id list (may be empty, never undefined-missing).
  assert(events.every(e => Array.isArray(e.related_evidence_ids)), 'every event carries a related_evidence_ids array');
}

console.log('\n--- 5. Regression: generic cloud prose / plain blog line are NOT findings (Part B) ---');
{
  const blogHtml = '<html><body><article>Available on AWS, Azure, and GCP.</article></body></html>';
  const pages: DiscoveredPage[] = [{ url: 'https://acme.com/blog', path: '/blog', category: 'blog' }];
  const htmlByUrl = new Map([[pages[0].url, blogHtml]]);
  const sigs = DeepSignalExtractor.extract(pages, htmlByUrl, [], 'test', { onProgress: () => {} });

  const arch = sigs.find(s => s.type === 'ARCHITECTURE_DISCUSSION');
  assert(!!arch, 'generic cloud prose still registers an ARCHITECTURE_DISCUSSION signal');
  assertEq(arch?.provenance, 'VARDHAN_INFERENCE', 'AWS/Azure/GCP prose stays VARDHAN_INFERENCE (LOW), not a documented fact');
  assertEq(arch?.signal_strength, 'LOW', 'AWS/Azure/GCP prose stays LOW strength');
  const split = DeepSignalExtractor.splitByProvenance(sigs);
  assertEq(split.inferences.length, sigs.length, 'generic cloud prose is inferred, not a documented fact');
  // The read-only finding consumer must NOT turn this into a finding.
  assert(detectFinding(sigs, []) === null, 'generic "Available on AWS/Azure/GCP" does NOT become a finding');

  // A plain blog line with no architecture content -> not ARCHITECTURE_DISCUSSION, not a finding.
  const plainHtml = '<html><body><article>We shipped a new feature this week to improve customer experience.</article></body></html>';
  const plainPages: DiscoveredPage[] = [{ url: 'https://acme.com/blog', path: '/blog', category: 'blog' }];
  const plainSigs = DeepSignalExtractor.extract(plainPages, new Map([[plainPages[0].url, plainHtml]]), [], 'test', { onProgress: () => {} });
  assertEq(plainSigs.find(s => s.type === 'ARCHITECTURE_DISCUSSION'), undefined, 'plain blog line is NOT categorised as ARCHITECTURE_DISCUSSION');
  assert(detectFinding(plainSigs, []) === null, 'plain blog line does NOT become a finding');
}

console.log('\n==================================================');
console.log(`Activity tests: ${pass} passed, ${fail} failed.`);
if (fail === 0) console.log('ALL TESTS PASSED.');
else { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
expect(typeof fail !== 'undefined' ? fail : (typeof failed !== 'undefined' ? failed : 0)).toBe(0);

  });
});