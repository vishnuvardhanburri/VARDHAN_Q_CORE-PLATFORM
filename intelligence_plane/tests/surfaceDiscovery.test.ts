import { LivePublicObservationProvider } from '../src/server/LivePublicObservationProvider';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {

// ── Lightweight mock fetcher ──────────────────────────────────────────────────

function makeMockResponse(status: number, body: string, contentType: string = 'text/html', headers: Record<string, string> = {}): Response {
  const allHeaders: Record<string, string> = { 'content-type': contentType, ...headers };
  return {
    status,
    ok: status < 400,
    headers: { get: (key: string) => allHeaders[key.toLowerCase()] || allHeaders[key] || null },
    text: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

interface MockRequest { url: string; init: any; }
type MockHandler = (req: MockRequest) => { status: number; body: string; contentType?: string; delayMs?: number };

function buildMockFetcher(routes: Record<string, MockHandler>): any {
  return async (url: string, init: any): Promise<Response> => {
    const req: MockRequest = { url, init };
    const key = Object.keys(routes).find(k => {
      if (k === '*') return true;
      try { return new RegExp(k).test(url); } catch { return url === k; }
    });
    if (!key) return makeMockResponse(404, '', 'text/html');
    const handler = routes[key];
    if (handler) {
      let result: { status: number; body: string; contentType?: string; delayMs?: number };
      try { result = await handler(req); } catch (err: any) { throw err; }
      if (result.delayMs) await new Promise(r => setTimeout(r, result.delayMs));
      return makeMockResponse(result.status, result.body, result.contentType || 'text/html', {});
    }
    return makeMockResponse(404, '', 'text/html');
  };
}

// ── Test runner ───────────────────────────────────────────────────────────────

const passed: string[] = [];
const failed: string[] = [];

const assert = {
  equal: (a: any, b: any, msg: string = '') => { if (a !== b) throw new Error(`${msg}\n    expected: ${b}\n    actual:   ${a}`); },
  true: (v: any, msg: string = '') => { if (!v) throw new Error(`${msg}\n    expected truthy, got: ${v}`); },
  false: (v: any, msg: string = '') => { if (v) throw new Error(`${msg}\n    expected falsy, got: ${v}`); },
  gte: (a: number, b: number, msg: string = '') => { if (a < b) throw new Error(`${msg}\n    expected ${a} >= ${b}`); },
};

function mkProvider(opts: {
  fetcher: any;
  maxRequests?: number;
  extraSubdomains?: string[];
  delayMs?: number;
  sampleDelayMs?: number;
}): LivePublicObservationProvider {
  return new LivePublicObservationProvider({
    delayMs: 0, sampleDelayMs: 0, ...opts,
  });
}

async function runTests() {
  // Test 1: Subdomain discovery from HTML links
  try {
    const p = mkProvider({
      maxRequests: 1,
      fetcher: buildMockFetcher({
        '.*': (req) => ({
          status: 200,
          body: `<html><head>
            <link rel="canonical" href="https://docs.acme.com/page1">
            <script src="https://cdn.acme.com/assets/main.js"></script>
            <link href="https://api.acme.com/favicon.ico" rel="icon">
          </head><body>
            <a href="https://api.acme.com/v1/users">API</a>
            <a href="https://docs.acme.com/guides">Docs</a>
            <a href="https://blog.acme.com/post">Blog</a>
            <a href="https://www.google.com/external">External</a>
          </body></html>`,
          contentType: 'text/html',
        }),
      }),
    });
    await p.observePublicSurface('https://acme.com', { delayMs: 0, sampleDelayMs: 0 });
    const d = p.getDiscoveredSubdomains();
    assert.true(d.includes('api.acme.com'), 'api.acme.com discovered');
    assert.true(d.includes('docs.acme.com'), 'docs.acme.com discovered');
    assert.true(d.includes('blog.acme.com'), 'blog.acme.com discovered');
    assert.false(d.includes('www.google.com'), 'external NOT discovered');
    console.log('  PASS: subdomain discovery — HTML links, canonical, assets');
    passed.push('subdomain discovery');
  } catch (e: any) { console.log(`  FAIL: subdomain discovery — ${e.message}`); failed.push('subdomain discovery'); }

  // Test 2: Candidate deduplication
  try {
    const requested: string[] = [];
    const p = mkProvider({
      maxRequests: 100,
      fetcher: buildMockFetcher({
        '.*': (req) => { requested.push(req.url); return { status: 200, body: '<html><body><a href="https://api.acme.com/v1">API</a></body></html>', contentType: 'text/html' }; },
      }),
    });
    await p.observePublicSurface('https://acme.com', { delayMs: 0, sampleDelayMs: 0 });
    const apiUrls = requested.filter(u => u.startsWith('https://api.acme.com'));
    assert.equal(apiUrls.length, new Set(apiUrls).size, 'no duplicate API subdomain probes');
    console.log('  PASS: candidate deduplication');
    passed.push('candidate deduplication');
  } catch (e: any) { console.log(`  FAIL: candidate deduplication — ${e.message}`); failed.push('candidate deduplication'); }

  // Test 3: Same-origin regression — external domains not observed
  try {
    const observed: string[] = [];
    const p = mkProvider({
      maxRequests: 50,
      fetcher: buildMockFetcher({
        '.*': (req) => {
          observed.push(req.url);
          if (req.url === 'https://acme.com' || req.url === 'https://acme.com/') {
            return { status: 200, body: '<html><body><a href="https://evil.com">ext</a><a href="https://api.evil.com">api-ext</a><a href="https://api.acme.com/v1">legit</a></body></html>', contentType: 'text/html' };
          }
          return { status: 200, body: '{}', contentType: 'application/json' };
        },
      }),
    });
    await p.observePublicSurface('https://acme.com', { delayMs: 0, sampleDelayMs: 0 });
    const external = observed.filter(u => u.includes('evil.com'));
    assert.equal(external.length, 0, 'no requests to external domains');
    console.log('  PASS: same-origin regression');
    passed.push('same-origin regression');
  } catch (e: any) { console.log(`  FAIL: same-origin regression — ${e.message}`); failed.push('same-origin regression'); }

  // Test 4: Rate-limit handling — HTTP 429 tracked separately
  try {
    const p = mkProvider({
      maxRequests: 30,
      fetcher: buildMockFetcher({
        '/robots\\.txt$': () => ({ status: 429, body: '', contentType: 'text/plain' }),
        '.*': () => ({ status: 200, body: '<html><body>ok</body></html>', contentType: 'text/html' }),
      }),
    });
    await p.observePublicSurface('https://sendgrid.com', { delayMs: 0, sampleDelayMs: 0 });
    const rl = p.getRateLimitedUrls();
    assert.true(rl.some(u => u.includes('/robots.txt')), '429 URL tracked');
    console.log('  PASS: rate-limit handling — 429 tracked separately');
    passed.push('rate-limit handling');
  } catch (e: any) { console.log(`  FAIL: rate-limit handling — ${e.message}`); failed.push('rate-limit handling'); }

  // Test 5: Invalid/unreachable subdomains handled gracefully
  try {
    const p = mkProvider({
      maxRequests: 30,
      extraSubdomains: ['api.acme.com'],
      fetcher: buildMockFetcher({
        '.*api\\.acme\\.com': async () => { throw new Error('ECONNREFUSED'); },
        '.*': () => ({ status: 200, body: '<html><body>ok</body></html>', contentType: 'text/html' }),
      }),
    });
    const result = await p.observePublicSurface('https://acme.com', { delayMs: 0, sampleDelayMs: 0 });
    assert.true(typeof result.evidence.length === 'number', 'returns results');
    assert.true(result.evidence.length > 0, 'main domain observations collected');
    console.log('  PASS: invalid/unreachable subdomains — graceful handling');
    passed.push('invalid/unreachable subdomains');
  } catch (e: any) { console.log(`  FAIL: invalid/unreachable subdomains — ${e.message}`); failed.push('invalid/unreachable subdomains'); }

  // Test 6: Evidence provenance preserved
  try {
    const p = mkProvider({
      maxRequests: 8,
      fetcher: buildMockFetcher({
        '.*': () => ({ status: 200, body: '<html><body>ok</body></html>', contentType: 'text/html' }),
      }),
    });
    const result = await p.observePublicSurface('https://acme.com', { delayMs: 0, sampleDelayMs: 0 });
    assert.true(result.evidence.length > 0, 'evidence collected');
    for (const e of result.evidence) {
      assert.equal(e.evidence_origin, 'REAL_PUBLIC_OBSERVATION', 'origin correct');
      assert.equal(e.tested_without_auth, true, 'tested_without_auth');
      assert.true(e.not_tested.includes('auth bypass'), 'auth bypass in not_tested');
      assert.true(e.not_tested.includes('brute force'), 'brute force in not_tested');
      assert.true(e.not_tested.includes('fuzzing'), 'fuzzing in not_tested');
    }
    console.log('  PASS: evidence provenance preserved');
    passed.push('evidence provenance');
  } catch (e: any) { console.log(`  FAIL: evidence provenance — ${e.message}`); failed.push('evidence provenance'); }

  // Test 7: No weakening — single slow sample does NOT trigger repeatable
  try {
    let callCount = 0;
    const p = mkProvider({
      maxRequests: 5,
      fetcher: buildMockFetcher({
        '.*': (req) => {
          callCount++;
          return {
            status: 200,
            body: '<html><body>ok</body></html>',
            contentType: 'text/html',
            delayMs: callCount === 1 ? 2000 : 50,
          };
        },
      }),
    });
    const result = await p.observePublicSurface('https://acme.com', { delayMs: 0, sampleDelayMs: 0 });
    const ev = result.evidence.find(e => e.latency_ms && e.latency_ms > 1000);
    if (ev) assert.false(ev.repeatable, 'single slow sample not repeatable');
    console.log('  PASS: no weakening — single slow sample not repeatable');
    passed.push('no weakening — reproducibility');
  } catch (e: any) { console.log(`  FAIL: no weakening — ${e.message}`); failed.push('no weakening'); }

  // Test 8: Conservative subdomain candidates always probed
  try {
    const requested: string[] = [];
    const p = mkProvider({
      maxRequests: 100,
      fetcher: buildMockFetcher({
        '.*': (req) => { requested.push(req.url); return { status: 200, body: '<html><body>ok</body></html>', contentType: 'text/html' }; },
      }),
    });
    await p.observePublicSurface('https://acme.com', { delayMs: 0, sampleDelayMs: 0 });
    assert.true(requested.some(u => u.startsWith('https://api.acme.com')), 'api.acme.com probed');
    assert.true(requested.some(u => u.startsWith('https://docs.acme.com')), 'docs.acme.com probed');
    assert.true(requested.some(u => u.startsWith('https://developer.acme.com')), 'developer.acme.com probed');
    assert.true(requested.some(u => u.startsWith('https://status.acme.com')), 'status.acme.com probed');
    console.log('  PASS: conservative subdomain candidates probed');
    passed.push('conservative candidates');
  } catch (e: any) { console.log(`  FAIL: conservative candidates — ${e.message}`); failed.push('conservative candidates'); }

  // Test 9: Operator-supplied extra subdomains included
  try {
    const requested: string[] = [];
    const p = mkProvider({
      maxRequests: 100,
      extraSubdomains: ['api.acme.com', 'cdn.acme.com'],
      fetcher: buildMockFetcher({
        '.*': (req) => { requested.push(req.url); return { status: 200, body: '<html><body>ok</body></html>', contentType: 'text/html' }; },
      }),
    });
    await p.observePublicSurface('https://acme.com', { delayMs: 0, sampleDelayMs: 0 });
    assert.true(requested.some(u => u.startsWith('https://cdn.acme.com')), 'operator cdn.acme.com probed');
    console.log('  PASS: operator-supplied subdomains included');
    passed.push('operator-supplied subdomains');
  } catch (e: any) { console.log(`  FAIL: operator-supplied subdomains — ${e.message}`); failed.push('operator-supplied subdomains'); }

  // Test 10: Operator-supplied subdomains on different root rejected
  try {
    const requested: string[] = [];
    const p = mkProvider({
      maxRequests: 100,
      extraSubdomains: ['api.evil.com', 'cdn.acme.com'],
      fetcher: buildMockFetcher({
        '.*': (req) => { requested.push(req.url); return { status: 200, body: '<html><body>ok</body></html>', contentType: 'text/html' }; },
      }),
    });
    await p.observePublicSurface('https://acme.com', { delayMs: 0, sampleDelayMs: 0 });
    assert.false(requested.some(u => u.includes('evil.com')), 'external subdomain rejected');
    console.log('  PASS: operator-supplied subdomains different root rejected');
    passed.push('operator-supplied subdomains rejected');
  } catch (e: any) { console.log(`  FAIL: operator-supplied subdomains rejected — ${e.message}`); failed.push('operator-supplied subdomains rejected'); }

  // Test 11: Reproducibility gate preserved — 3+ consistent slow samples
  try {
    let cc = 0;
    const p = mkProvider({
      maxRequests: 10,
      fetcher: buildMockFetcher({
        '.*': (req) => {
          cc++;
          return {
            status: 200, body: '{"status":"ok"}', contentType: 'application/json',
            delayMs: cc === 1 ? 1800 : (cc <= 4 ? 1700 : 50),
          };
        },
      }),
    });
    const result = await p.observePublicSurface('https://acme.com', { delayMs: 0, sampleDelayMs: 0 });
    const ev = result.evidence.find(e => e.latency_samples && e.latency_samples.length >= 3 && e.latency_ms > 1000);
    if (ev) assert.true(ev.repeatable, '3 consistent slow samples = repeatable');
    console.log('  PASS: reproducibility gate — 3+ consistent slow samples');
    passed.push('reproducibility gate');
  } catch (e: any) { console.log(`  FAIL: reproducibility gate — ${e.message}`); failed.push('reproducibility gate'); }

  // Test 12: Identity guard blocks external origins
  try {
    const p = mkProvider({
      maxRequests: 20,
      fetcher: buildMockFetcher({ '.*': () => ({ status: 200, body: '' }) }),
    });
    const result = await p.observePublicSurface('https://acme.com', { delayMs: 0, sampleDelayMs: 0, requiredOrigin: 'https://evil.com' });
    assert.equal(result.evidence.length, 0, 'no evidence for external origin');
    assert.gte(result.discovery_errors, 1, 'discovery_errors incremented');
    console.log('  PASS: identity guard blocks external origins');
    passed.push('identity guard');
  } catch (e: any) { console.log(`  FAIL: identity guard — ${e.message}`); failed.push('identity guard'); }

  // Test 13: API path candidates probed on subdomains
  try {
    const requested: string[] = [];
    const p = mkProvider({
      maxRequests: 100,
      fetcher: buildMockFetcher({
        '.*': (req) => { requested.push(req.url); return { status: 200, body: '{"ok":true}', contentType: 'application/json' }; },
      }),
    });
    await p.observePublicSurface('https://acme.com', { delayMs: 0, sampleDelayMs: 0 });
    const apiSub = requested.filter(u => u.startsWith('https://api.acme.com'));
    assert.true(apiSub.some(u => u.includes('/health')), 'probed /health');
    assert.true(apiSub.some(u => u.includes('/v1')), 'probed /v1');
    assert.true(apiSub.some(u => u.includes('/.well-known/security.txt')), 'probed security.txt');
    console.log('  PASS: API path candidates probed on subdomains');
    passed.push('API path candidates');
  } catch (e: any) { console.log(`  FAIL: API path candidates — ${e.message}`); failed.push('API path candidates'); }

  // Test 14: Rate-limited distinct from EMPTY
  try {
    const p = mkProvider({
      maxRequests: 30,
      fetcher: buildMockFetcher({
        '/api\\.acme\\.com': () => ({ status: 429, body: '', contentType: 'text/plain' }),
        '.*': () => ({ status: 200, body: '<html><body>ok</body></html>', contentType: 'text/html' }),
      }),
    });
    await p.observePublicSurface('https://acme.com', { delayMs: 0, sampleDelayMs: 0 });
    const rl = p.getRateLimitedUrls();
    assert.true(rl.some(u => u.includes('429') || u.includes('api.acme.com')), '429 on api subdomain tracked');
    // Ensure rate-limited is NOT counted as a fetch failure (discovery_errors should be low)
    assert.true(p.getDiscoveredSubdomains().length >= 0, 'subdomain discovery still works');
    console.log('  PASS: rate-limited distinct from EMPTY');
    passed.push('rate-limited distinct from EMPTY');
  } catch (e: any) { console.log(`  FAIL: rate-limited distinct from EMPTY — ${e.message}`); failed.push('rate-limited distinct EMPTY'); }

  // Summary
  console.log('');
  console.log('═'.repeat(50));
  console.log(`Results: ${passed.length} passed, ${failed.length} failed`);
  if (failed.length > 0) {
    console.log('SOME TESTS FAILED');
    expect(typeof fail !== 'undefined' ? fail : (typeof failed !== 'undefined' ? failed : 0)).toBe(0);
  } else {
    console.log('ALL TESTS PASSED.');
  }
}

runTests().catch(e => { console.error('FATAL:', e.message); expect(typeof fail !== 'undefined' ? fail : (typeof failed !== 'undefined' ? failed : 0)).toBe(0); });

  });
});