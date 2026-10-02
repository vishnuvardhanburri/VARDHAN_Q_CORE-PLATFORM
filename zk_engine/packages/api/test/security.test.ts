/**
 * Security review suite (M6 gate):
 *  - threat matrix: unauthenticated access to every protected route
 *  - auth bypass attempts (header mutation, canonical tampering, smuggling)
 *  - RBAC matrix: every role × every protected route
 *  - replay protection (nonce) and idempotency (key) semantics
 *  - fuzz-driven request validation (deterministic PRNG, never crashes)
 *  - concurrency: same-nonce race, same-key idempotency race (TOCTOU)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Groth16Proof } from '@zkpe/proof-format';
import { buildServer, type ServerDeps } from '../src/api/buildServer.js';
import { parseConfig } from '../src/config.js';
import { NoopTracer } from '../src/telemetry/telemetry.js';
import { EnvSecretStore } from '../src/infrastructure/auth/EnvSecretStore.js';
import { NonceStore } from '../src/infrastructure/auth/NonceStore.js';
import { InMemoryIdempotencyStore } from '../src/infrastructure/auth/IdempotencyStore.js';
import { AuditLog } from '../src/infrastructure/observability/AuditLog.js';
import { Metrics } from '../src/infrastructure/observability/Metrics.js';
import { canonicalString, hmacSha256Hex } from '../src/application/auth.js';
import type { VerifyOutcome, RegistryInfo, ProofStatusEntry } from '../src/domain/entities.js';
import type { EnginePort, RegistryReadPort, RegistryWritePort } from '../src/domain/ports.js';

// ---------------------------------------------------------------------------
// deterministic fuzz PRNG (mulberry32)
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.: /\\"\'\u0000\u00e9\u2603[]{}';
const VALID_HASH = '0x' + 'ab'.repeat(32);

function randomScalar(rand: () => number): string {
  return Math.floor(rand() * 1e18).toString();
}

function randomProof(rand: () => number): unknown {
  const f = () => randomScalar(rand);
  return {
    pi_a: [f(), f(), f()],
    pi_b: [
      [f(), f()],
      [f(), f()],
      [f(), f()],
    ],
    pi_c: [f(), f(), f()],
  };
}

function randomString(rand: () => number, maxLen = 16): string {
  let s = '';
  const n = 1 + Math.floor(rand() * maxLen);
  for (let i = 0; i < n; i++) s += CHARS[Math.floor(rand() * CHARS.length)];
  return s;
}

function randomBody(rand: () => number): unknown {
  switch (Math.floor(rand() * 8)) {
    case 0:
      return null;
    case 1:
      return Math.floor(rand() * 1e9);
    case 2:
      return randomString(rand, 40);
    case 3:
      return [randomString(rand, 8), rand()];
    case 4:
      return { circuitId: randomString(rand, 100), proof: randomProof(rand), publicInputs: [randomString(rand, 200)] };
    case 5:
      return { circuitId: 'poseidon-preimage', proof: { pi_a: [], pi_b: [], pi_c: [randomString(rand, 90)] }, publicInputs: [] };
    case 6:
      return { circuitId: 'poseidon-preimage', proof: randomProof(rand), publicInputs: [randomString(rand, 400)], extra: 'junk' };
    default:
      return { circuitId: 'Poseidon-Preimage!', proof: randomProof(rand), publicInputs: ['00', '1e3', '-5'] };
  }
}

// ---------------------------------------------------------------------------
// fakes
// ---------------------------------------------------------------------------

class FakeEngine implements EnginePort {
  verifyCalls = 0;

  async listCircuits() {
    return [
      { circuitId: 'poseidon-preimage', version: '1.0.0', label: 'poseidon-preimage@1.0.0', nPublic: 1, artifactsReady: true },
    ];
  }

  async verify(circuitId: string): Promise<VerifyOutcome> {
    this.verifyCalls += 1;
    return circuitId === 'poseidon-preimage'
      ? { valid: true, circuitId }
      : { valid: false, circuitId, detail: 'engine says no' };
  }

  async healthy(): Promise<boolean> {
    return true;
  }
}

class FakeRegistry implements RegistryReadPort, RegistryWritePort {
  registerCalls = 0;
  private readonly cfg = {
    verifier: '0x0000000000000000000000000000000000000001',
    vkHash: '0x' + 'ab'.repeat(32),
    active: true,
  };

  async getCircuit(_circuitId: string) {
    return this.cfg;
  }

  async healthy(): Promise<boolean> {
    return true;
  }

  async getProofStatus(_circuitId: string, _anchor: string): Promise<ProofStatusEntry> {
    return { status: 'proved', provedAt: '1700000000' };
  }

  async registryInfo(circuitIds: string[]): Promise<RegistryInfo> {
    return {
      proxy: '0x0000000000000000000000000000000000000001',
      schemaVersion: '1',
      totalProofs: '42',
      paused: false,
      circuits: Object.fromEntries(circuitIds.map((id) => [id, this.cfg])),
    };
  }

  async registerProof(): Promise<{ txHash: string }> {
    this.registerCalls += 1;
    return { txHash: '0x' + 'cd'.repeat(32) };
  }
}

const READ_ID = 'read-client';
const READ_SECRET = 'r'.repeat(32);
const SUBMIT_ID = 'submit-client';
const SUBMIT_SECRET = 's'.repeat(32);
const WRITE_ID = 'write-client';
const WRITE_SECRET = 'w'.repeat(32);
const AUDIT_ID = 'audit-client';
const AUDIT_SECRET = 'a'.repeat(32);

const ENV = {
  ZK_API_KEYS: [
    `${READ_ID}:${READ_SECRET}:read`,
    `${SUBMIT_ID}:${SUBMIT_SECRET}:submit`,
    `${WRITE_ID}:${WRITE_SECRET}:write`,
    `${AUDIT_ID}:${AUDIT_SECRET}:audit`,
  ].join(';'),
  ZK_OTEL_DISABLED: 'true',
  ZK_LOG_LEVEL: 'error',
  ZK_RATE_CAPACITY: '10000',
  ZK_RATE_REFILL_PER_MINUTE: '10000',
  ZK_RATE_VERIFY_CAPACITY: '10000',
  ZK_RATE_VERIFY_REFILL_PER_MINUTE: '10000',
};

let app: FastifyInstance;
let engine: FakeEngine;
let registry: FakeRegistry;

interface SignedRequest {
  method: string;
  path: string;
  query?: string;
  body?: unknown;
  clientId?: string;
  secret?: string;
  nonce?: string;
  timestamp?: string;
}

function signedHeaders(req: SignedRequest): Record<string, string> {
  const clientId = req.clientId ?? READ_ID;
  const secret = req.secret ?? READ_SECRET;
  const nonce = req.nonce ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ts = req.timestamp ?? new Date().toISOString();
  const canonical = canonicalString({
    method: req.method,
    path: req.path,
    query: req.query ?? '',
    headers: { 'x-zk-key': clientId, 'x-zk-nonce': nonce, 'x-zk-timestamp': ts },
    bodyJson: req.body ?? null,
  });
  return {
    'content-type': 'application/json',
    'x-zk-key': clientId,
    'x-zk-nonce': nonce,
    'x-zk-timestamp': ts,
    'x-zk-signature': hmacSha256Hex(secret, canonical),
  };
}

const VALID_PROOF: Groth16Proof = {
  pi_a: ['1', '2', '3'],
  pi_b: [
    ['1', '2'],
    ['3', '4'],
    ['5', '6'],
  ],
  pi_c: ['1', '2', '3'],
};

const REGISTER_BODY = { circuitId: 'poseidon-preimage', proof: VALID_PROOF, publicInputs: ['1'] };

beforeAll(async () => {
  engine = new FakeEngine();
  registry = new FakeRegistry();
  app = await buildServer(buildDeps());
  await app.ready();
});

function buildDeps(): ServerDeps {
  return {
    config: parseConfig(ENV as unknown as NodeJS.ProcessEnv),
    engine,
    registryRead: registry,
    registryWrite: registry,
    secrets: new EnvSecretStore(ENV.ZK_API_KEYS!),
    nonces: new NonceStore(),
    idempotencyStore: new InMemoryIdempotencyStore(),
    audit: new AuditLog(),
    metrics: new Metrics(),
    clock: { nowMs: () => Date.now() },
    tracer: new NoopTracer(),
  };
}

const PROTECTED: { method: 'GET' | 'POST'; path: string; body?: unknown }[] = [
  { method: 'GET', path: '/v1/circuits' },
  { method: 'GET', path: `/v1/proofs/status/poseidon-preimage/${VALID_HASH}` },
  { method: 'POST', path: '/v1/proofs/verify', body: REGISTER_BODY },
  { method: 'POST', path: '/v1/proofs/register', body: REGISTER_BODY },
  { method: 'GET', path: '/v1/registry' },
  { method: 'GET', path: '/v1/audit' },
];

// ---------------------------------------------------------------------------
describe('threat matrix: unauthenticated access to protected surface', () => {
  for (const r of PROTECTED) {
    it(`401 for ${r.method} ${r.path}`, async () => {
      const res = await app.inject({
        method: r.method,
        url: r.path,
        headers: { 'content-type': 'application/json' },
        ...(r.body !== undefined ? { payload: JSON.stringify(r.body) } : {}),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('AUTH-MISSING');
    });
  }
});

describe('authentication bypass attempts', () => {
  const missing: [string, (h: Record<string, string>) => void][] = [
    ['x-zk-key', (h) => delete h['x-zk-key']],
    ['x-zk-signature', (h) => delete h['x-zk-signature']],
    ['x-zk-timestamp', (h) => delete h['x-zk-timestamp']],
    ['x-zk-nonce', (h) => delete h['x-zk-nonce']],
  ];
  for (const [name, mutate] of missing) {
    it(`rejects missing ${name}`, async () => {
      const h = signedHeaders({ method: 'GET', path: '/v1/circuits' });
      mutate(h);
      const res = await app.inject({ method: 'GET', url: '/v1/circuits', headers: h });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('AUTH-MISSING');
    });
  }

  it('rejects unknown client id', async () => {
    const h = signedHeaders({ method: 'GET', path: '/v1/circuits', clientId: 'ghost' });
    const res = await app.inject({ method: 'GET', url: '/v1/circuits', headers: h });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH-UNKNOWN-CLIENT');
  });

  it('rejects URL mutation after signing (path mismatch)', async () => {
    const h = signedHeaders({ method: 'GET', path: '/v1/circuits' });
    const res = await app.inject({ method: 'GET', url: '/v1/registry', headers: h });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH-BAD-SIGNATURE');
  });

  it('rejects body mutation after signing', async () => {
    const h = signedHeaders({ method: 'POST', path: '/v1/proofs/verify', body: REGISTER_BODY });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/proofs/verify',
      headers: h,
      payload: { ...REGISTER_BODY, publicInputs: ['2'] },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH-BAD-SIGNATURE');
  });

  it('rejects query mutation after signing', async () => {
    const h = signedHeaders({ method: 'GET', path: '/v1/audit', query: 'limit=1', clientId: AUDIT_ID, secret: AUDIT_SECRET });
    const res = await app.inject({ method: 'GET', url: '/v1/audit?limit=2', headers: h });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH-BAD-SIGNATURE');
  });

  it('accepts uppercase hex signature (server normalizes, compare is constant-time)', async () => {
    const h = signedHeaders({ method: 'GET', path: '/v1/circuits' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/circuits',
      headers: { ...h, 'x-zk-signature': h['x-zk-signature']!.toUpperCase() },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects duplicate-header smuggling (comma-joined values)', async () => {
    const h = signedHeaders({ method: 'GET', path: '/v1/circuits' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/circuits',
      headers: { ...h, 'x-zk-key': `${h['x-zk-key']},${h['x-zk-key']}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects malformed timestamps', async () => {
    for (const ts of ['not-a-date', '0', '99999999999999999', '2020-01-01T00:00:00.000Z']) {
      const h = signedHeaders({ method: 'GET', path: '/v1/circuits', timestamp: ts });
      const res = await app.inject({ method: 'GET', url: '/v1/circuits', headers: h });
      expect([401, 400]).toContain(res.statusCode);
      if (res.statusCode === 401) {
        expect(res.json().code).toBe('AUTH-EXPIRED');
      }
    }
  });

  it('rejects far-future timestamp (clock skew outside window)', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const h = signedHeaders({ method: 'GET', path: '/v1/circuits', timestamp: future });
    const res = await app.inject({ method: 'GET', url: '/v1/circuits', headers: h });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH-EXPIRED');
  });

  it('accepts timestamp within the skew window', async () => {
    const nearPast = new Date(Date.now() - 60_000).toISOString();
    const h = signedHeaders({ method: 'GET', path: '/v1/circuits', timestamp: nearPast });
    const res = await app.inject({ method: 'GET', url: '/v1/circuits', headers: h });
    expect(res.statusCode).toBe(200);
  });

  it('trailing slash must not silently pass the signing of the canonical path', async () => {
    const h = signedHeaders({ method: 'GET', path: '/v1/circuits' });
    // /v1/circuits/ is a different route → 404; it must never return 2xx with
    // a signature made for /v1/circuits.
    const res = await app.inject({ method: 'GET', url: '/v1/circuits/', headers: h });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('RBAC matrix — every role × every protected route', () => {
  const matrix: { id: string; roles: string; secret: string }[] = [
    { id: READ_ID, roles: 'read', secret: READ_SECRET },
    { id: SUBMIT_ID, roles: 'submit', secret: SUBMIT_SECRET },
    { id: WRITE_ID, roles: 'write', secret: WRITE_SECRET },
    { id: AUDIT_ID, roles: 'audit', secret: AUDIT_SECRET },
  ];
  for (const principal of matrix) {
    for (const route of PROTECTED) {
      const required = routeNeeds(route.path);
      const expected = principal.roles === required ? 200 : 403;
      it(`${principal.id} (${principal.roles}) → ${route.method} ${route.path} → ${expected}`, async () => {
        const authHeaders = signedHeaders({
          method: route.method,
          path: route.path,
          clientId: principal.id,
          secret: principal.secret,
          ...(route.body !== undefined ? { body: route.body } : {}),
        });
        const headers: Record<string, string> = { ...authHeaders };
        if (route.path.startsWith('/v1/proofs/register')) headers['idempotency-key'] = `rbac-${principal.id}-${Math.random().toString(36).slice(2)}`;
        const res = await app.inject({
          method: route.method,
          url: route.path,
          headers,
          ...(route.body !== undefined ? { payload: route.body as object } : {}),
        });
        expect(res.statusCode).toBe(expected);
        if (expected === 403) {
          expect(res.json().code).toBe('AUTH-FORBIDDEN');
        }
      });
    }
  }
});

function routeNeeds(path: string): string {
  if (path.startsWith('/v1/proofs/register')) return 'write';
  if (path.startsWith('/v1/proofs/verify')) return 'submit';
  if (path.startsWith('/v1/audit')) return 'audit';
  return 'read';
}

// ---------------------------------------------------------------------------
describe('replay protection (nonce)', () => {
  it('rejects nonce reuse → 401 AUTH-REPLAY', async () => {
    const h = signedHeaders({ method: 'GET', path: '/v1/circuits' });
    await app.inject({ method: 'GET', url: '/v1/circuits', headers: h });
    const res = await app.inject({ method: 'GET', url: '/v1/circuits', headers: h });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH-REPLAY');
  });

  it('rejects nonce reuse across a different path', async () => {
    const nonce = `shared-${Date.now()}`;
    const h1 = signedHeaders({ method: 'GET', path: '/v1/circuits', nonce });
    await app.inject({ method: 'GET', url: '/v1/circuits', headers: h1 });
    const h2 = signedHeaders({ method: 'GET', path: '/v1/registry', nonce });
    const res = await app.inject({ method: 'GET', url: '/v1/registry', headers: h2 });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH-REPLAY');
  });

  it('allows distinct nonces back-to-back', async () => {
    const r1 = await app.inject({ method: 'GET', url: '/v1/circuits', headers: signedHeaders({ method: 'GET', path: '/v1/circuits' }) });
    const r2 = await app.inject({ method: 'GET', url: '/v1/circuits', headers: signedHeaders({ method: 'GET', path: '/v1/circuits' }) });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
  });
});

describe('idempotency semantics (register)', () => {
  it('rejects missing Idempotency-Key → 422 VALIDATION', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/proofs/register',
      headers: signedHeaders({ method: 'POST', path: '/v1/proofs/register', body: REGISTER_BODY, clientId: WRITE_ID, secret: WRITE_SECRET }),
      payload: REGISTER_BODY,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('VALIDATION');
  });

  it('rejects malformed Idempotency-Key values', async () => {
    for (const key of ['short', 'a'.repeat(65), 'has space', 'weird!chars', '']) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/proofs/register',
        headers: {
          ...signedHeaders({ method: 'POST', path: '/v1/proofs/register', body: REGISTER_BODY, clientId: WRITE_ID, secret: WRITE_SECRET }),
          'idempotency-key': key,
        },
        payload: REGISTER_BODY,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('VALIDATION');
    }
  });

  it('replays the same key+payload → identical result, single chain write', async () => {
    registry.registerCalls = 0;
    const key = 'reg-key-replay-0001';
    const first = await app.inject({
      method: 'POST',
      url: '/v1/proofs/register',
      headers: {
        ...signedHeaders({ method: 'POST', path: '/v1/proofs/register', body: REGISTER_BODY, clientId: WRITE_ID, secret: WRITE_SECRET }),
        'idempotency-key': key,
      },
      payload: REGISTER_BODY,
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: '/v1/proofs/register',
      headers: {
        ...signedHeaders({ method: 'POST', path: '/v1/proofs/register', body: REGISTER_BODY, clientId: WRITE_ID, secret: WRITE_SECRET }),
        'idempotency-key': key,
      },
      payload: REGISTER_BODY,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(registry.registerCalls).toBe(1);
  });

  it('conflicts when the same key is used with a different payload → 409', async () => {
    const key = 'reg-key-conflict-02';
    const send = (payload: unknown) =>
      app.inject({
        method: 'POST',
        url: '/v1/proofs/register',
        headers: {
          ...signedHeaders({ method: 'POST', path: '/v1/proofs/register', body: payload, clientId: WRITE_ID, secret: WRITE_SECRET }),
          'idempotency-key': key,
        },
        payload: payload as object,
      });
    const first = await send(REGISTER_BODY);
    expect(first.statusCode).toBe(200);
    const conflict = await send({ ...REGISTER_BODY, publicInputs: ['2'] });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('STATE-CONFLICT');
  });

  it('no replay between distinct keys', async () => {
    registry.registerCalls = 0;
    const payload = { ...REGISTER_BODY, publicInputs: ['7'] };
    const send = (key: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/proofs/register',
        headers: {
          ...signedHeaders({ method: 'POST', path: '/v1/proofs/register', body: payload, clientId: WRITE_ID, secret: WRITE_SECRET }),
          'idempotency-key': key,
        },
        payload,
      });
    await send('key-alpha-000001');
    const res = await send('key-beta-0000012');
    expect(res.statusCode).toBe(200);
    expect(registry.registerCalls).toBe(2);
  });
});

describe('fuzz: request validation never crashes or panics', () => {
  it('300 seeded malformed bodies on verify/register → only defined error codes', async () => {
    const rand = mulberry32(0x5eed);
    const statuses = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const body = randomBody(rand);
      const path = i % 2 === 0 ? '/v1/proofs/verify' : '/v1/proofs/register';
      const res = await app.inject({
        method: 'POST',
        url: path,
        headers: signedHeaders({ method: 'POST', path, body, ...(path.includes('register') ? { clientId: WRITE_ID, secret: WRITE_SECRET } : { clientId: SUBMIT_ID, secret: SUBMIT_SECRET }) }),
        payload: typeof body === 'string' ? JSON.stringify(body) : (body as object),
      });
      statuses.add(res.statusCode);
      expect([200, 400, 401, 403, 409, 413, 422, 428]).toContain(res.statusCode);
      expect(res.body).not.toContain('ENOENT');
      expect(res.body).not.toContain('TypeError');
      expect(res.body).not.toContain('RangeError');
    }
    expect(statuses.has(422)).toBe(true);
  });

  it('oversized payload → 413 PAYLOAD-TOO-LARGE (bodyLimit)', async () => {
    const big = { circuitId: 'x', proof: VALID_PROOF, publicInputs: ['1'.repeat(200_000)] };
    const res = await app.inject({
      method: 'POST',
      url: '/v1/proofs/verify',
      headers: signedHeaders({ method: 'POST', path: '/v1/proofs/verify', body: big, clientId: SUBMIT_ID, secret: SUBMIT_SECRET }),
      payload: JSON.stringify(big),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('PAYLOAD-TOO-LARGE');
  });

  it('garbage non-JSON body → 422/400 problem+json, not 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/proofs/verify',
      headers: { ...signedHeaders({ method: 'POST', path: '/v1/proofs/verify', clientId: SUBMIT_ID, secret: SUBMIT_SECRET }), 'content-type': 'application/json' },
      payload: '{{{not json',
    });
    expect([400, 422]).toContain(res.statusCode);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('deeply nested proof object rejected without crash', async () => {
    let nested: unknown = 'x';
    for (let i = 0; i < 500; i++) nested = [nested];
    const res = await app.inject({
      method: 'POST',
      url: '/v1/proofs/verify',
      headers: signedHeaders({ method: 'POST', path: '/v1/proofs/verify', body: { circuitId: 'a', proof: nested, publicInputs: [] }, clientId: SUBMIT_ID, secret: SUBMIT_SECRET }),
      payload: JSON.stringify({ circuitId: 'a', proof: nested, publicInputs: [] }),
    });
    expect([413, 422, 400]).toContain(res.statusCode);
  });

  it('unknown route and weird methods → 404, never 200', async () => {
    for (const path of ['/v1/nope', '/v1/circuits/extra', '/v1/registry.json', '/v1//circuits', '/v1/%2e%2e/circuits']) {
      const res = await app.inject({ method: 'GET', url: path });
      expect(res.statusCode).toBe(404);
    }
    const res = await app.inject({ method: 'PATCH', url: '/v1/circuits' });
    expect(res.statusCode).toBe(404);
  });
});

describe('concurrency', () => {
  it('parallel requests with distinct nonces all succeed', async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, () =>
        app.inject({ method: 'GET', url: '/v1/circuits', headers: signedHeaders({ method: 'GET', path: '/v1/circuits' }) }),
      ),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
  });

  it('parallel requests with the SAME nonce → exactly one winner', async () => {
    const nonce = `race-${Date.now()}`;
    const headers = () => signedHeaders({ method: 'GET', path: '/v1/circuits', nonce });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => app.inject({ method: 'GET', url: '/v1/circuits', headers: headers() })),
    );
    const ok = results.filter((r) => r.statusCode === 200).length;
    expect(ok).toBe(1);
    expect(results.filter((r) => r.statusCode === 401).length).toBe(19);
  });

  it('parallel register with the SAME idempotency key → one chain write, same result', async () => {
    registry.registerCalls = 0;
    const key = `parallel-${Date.now()}`;
    const headers = () => ({
      ...signedHeaders({ method: 'POST', path: '/v1/proofs/register', body: REGISTER_BODY, clientId: WRITE_ID, secret: WRITE_SECRET }),
      'idempotency-key': key,
    });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => app.inject({ method: 'POST', url: '/v1/proofs/register', headers: headers(), payload: REGISTER_BODY })),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(registry.registerCalls).toBe(1);
    const bodies = results.map((r) => r.json());
    expect(new Set(bodies.map((b) => b.txHash)).size).toBe(1);
  });
});