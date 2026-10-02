/**
 * Server API tests — build a real app over in-memory fakes and drive it via
 * app.inject. Covers: liveness, readiness, HMAC auth + RBAC, nonce replay,
 * proof verification, validation errors, problem+json shape.
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
import type { CircuitInfo, VerifyOutcome } from '../src/domain/entities.js';
import type { EnginePort } from '../src/domain/ports.js';

// ---------- fakes ----------

class FakeEngine implements EnginePort {
  async listCircuits(): Promise<CircuitInfo[]> {
    return [
      { circuitId: 'poseidon-preimage', version: '1.0.0', label: 'poseidon-preimage@1.0.0', nPublic: 1, artifactsReady: true },
    ];
  }

  async verify(): Promise<VerifyOutcome> {
    return { valid: true, circuitId: 'poseidon-preimage' };
  }

  async healthy(): Promise<boolean> {
    return true;
  }
}

const CLIENT_ID = 'client-a';
const SECRET = 'a'.repeat(32);
const AUDITOR_ID = 'auditor-1';
const AUDITOR_SECRET = 'b'.repeat(32);

const ENV = {
  ZK_API_KEYS: `${CLIENT_ID}:${SECRET}:read,submit;${AUDITOR_ID}:${AUDITOR_SECRET}:audit`,
  ZK_OTEL_DISABLED: 'true',
  ZK_LOG_LEVEL: 'error',
};

function buildDeps(): ServerDeps {
  return {
    config: parseConfig(ENV as unknown as NodeJS.ProcessEnv),
    engine: new FakeEngine(),
    registryRead: null,
    registryWrite: null,
    secrets: new EnvSecretStore(ENV.ZK_API_KEYS!),
    nonces: new NonceStore(),
    idempotencyStore: new InMemoryIdempotencyStore(),
    audit: new AuditLog(),
    metrics: new Metrics(),
    clock: { nowMs: () => Date.now() },
    tracer: new NoopTracer(),
  };
}

interface SignedRequest {
  method: string;
  path: string;
  query?: string;
  body?: unknown;
  clientId?: string;
  secret?: string;
}

/** Builds a valid set of HMAC auth headers for a request. */
function signedHeaders(req: SignedRequest): Record<string, string> {
  const clientId = req.clientId ?? CLIENT_ID;
  const secret = req.secret ?? SECRET;
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ts = new Date().toISOString();
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

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer(buildDeps());
  await app.ready();
});

describe('public routes', () => {
  it('GET /v1/health → 200 ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('GET /v1/metrics → 200 text/plain', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
  });

  it('GET /v1/ready → ok with not-configured registry', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json().components.registry).toBe('not-configured');
  });
});

describe('auth + RBAC', () => {
  it('rejects unauthenticated request with 401 problem+json', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/circuits' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json().code).toBe('AUTH-MISSING');
  });

  it('accepts a correctly signed GET on a read route', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/circuits',
      headers: signedHeaders({ method: 'GET', path: '/v1/circuits' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().circuits).toHaveLength(1);
  });

  it('rejects a tampered signature → 401 AUTH-BAD-SIGNATURE', async () => {
    const h = signedHeaders({ method: 'GET', path: '/v1/circuits' });
    // Flip the FIRST hex digit (guaranteed different — flipping the last one
    // was a no-op when it was already '0', a 1/16 flake that returned 200).
    const sig = h['x-zk-signature']!;
    h['x-zk-signature'] = (sig[0] === '0' ? '1' : '0') + sig.slice(1);
    const res = await app.inject({ method: 'GET', url: '/v1/circuits', headers: h });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH-BAD-SIGNATURE');
  });

  it('rejects nonce reuse → 401 AUTH-REPLAY', async () => {
    const h = signedHeaders({ method: 'GET', path: '/v1/circuits' });
    await app.inject({ method: 'GET', url: '/v1/circuits', headers: h });
    const res = await app.inject({ method: 'GET', url: '/v1/circuits', headers: h });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH-REPLAY');
  });

  it('forbids a read-only client from the audit route → 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/audit',
      headers: signedHeaders({ method: 'GET', path: '/v1/audit' }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('AUTH-FORBIDDEN');
  });

  it('allows the auditor on /v1/audit → 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/audit',
      headers: signedHeaders({ method: 'GET', path: '/v1/audit', clientId: AUDITOR_ID, secret: AUDITOR_SECRET }),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().entries)).toBe(true);
  });
});

describe('proofs/verify', () => {
  it('verifies a well-formed proof → 200, hash 0x64', async () => {
    const body = { circuitId: 'poseidon-preimage', proof: VALID_PROOF, publicInputs: ['1'] };
    const res = await app.inject({
      method: 'POST',
      url: '/v1/proofs/verify',
      headers: signedHeaders({ method: 'POST', path: '/v1/proofs/verify', body }),
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().verified).toBe(true);
    expect(res.json().publicInputHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('rejects malformed body → 422 VALIDATION', async () => {
    const body = { circuitId: 'UPPER', proof: VALID_PROOF, publicInputs: [] };
    const res = await app.inject({
      method: 'POST',
      url: '/v1/proofs/verify',
      headers: signedHeaders({ method: 'POST', path: '/v1/proofs/verify', body }),
      payload: body,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('VALIDATION');
  });

  it('honors x-request-id echo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': 'trace-me-1234' },
    });
    expect(res.headers['x-request-id']).toBe('trace-me-1234');
  });
});

describe('validation of route params', () => {
  it('rejects an invalid publicInputHash param → 422', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/proofs/status/poseidon-preimage/not-a-hash',
      headers: signedHeaders({ method: 'GET', path: '/v1/proofs/status/poseidon-preimage/not-a-hash' }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('VALIDATION');
  });
});