/**
 * Shared request-signing client (used by CLI) against the REAL server over
 * real HTTP. Proves the single implementation of the canonical string works
 * end-to-end (ADR-0011 §1): response-based axios path, typed problem+json
 * errors, no raw 500 leakage.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { buildServer, type ServerDeps } from '../src/api/buildServer.js';
import { parseConfig } from '../src/config.js';
import { NoopTracer } from '../src/telemetry/telemetry.js';
import { EnvSecretStore } from '../src/infrastructure/auth/EnvSecretStore.js';
import { NonceStore } from '../src/infrastructure/auth/NonceStore.js';
import { InMemoryIdempotencyStore } from '../src/infrastructure/auth/IdempotencyStore.js';
import { AuditLog } from '../src/infrastructure/observability/AuditLog.js';
import { Metrics } from '../src/infrastructure/observability/Metrics.js';
import { ApiClient, ApiClientError } from '../src/client.js';
import type { CircuitInfo, VerifyOutcome } from '../src/domain/entities.js';
import type { EnginePort } from '../src/domain/ports.js';

class FakeEngineWithVerify implements EnginePort {
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

const READ_ID = 'client-read';
const READ_SECRET = 'r'.repeat(32);
const SUBMIT_ID = 'client-submit';
const SUBMIT_SECRET = 's'.repeat(32);

const ENV = {
  ZK_API_KEYS: `${READ_ID}:${READ_SECRET}:read;${SUBMIT_ID}:${SUBMIT_SECRET}:submit`,
  ZK_OTEL_DISABLED: 'true',
  ZK_LOG_LEVEL: 'silent',
};

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  const deps: ServerDeps = {
    config: parseConfig(ENV as unknown as NodeJS.ProcessEnv),
    engine: new FakeEngineWithVerify(),
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
  app = await buildServer(deps);
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
});

const SUBMISSION = {
  circuitId: 'poseidon-preimage',
  proof: {
    pi_a: ['1', '2', '3'],
    pi_b: [['1', '2'], ['3', '4'], ['5', '6']],
    pi_c: ['1', '2', '3'],
  },
  publicInputs: ['0'],
};

describe('shared client (real HTTP)', () => {
  it('GET /v1/circuits round-trips through the shared canonical string', async () => {
    const client = new ApiClient({ baseUrl, clientId: READ_ID, secret: READ_SECRET });
    const body = (await client.listCircuits()) as { circuits: unknown[] };
    expect(body.circuits).toHaveLength(1);
    expect(body.circuits[0]).toMatchObject({ circuitId: 'poseidon-preimage', artifactsReady: true });
  });

  it('POST /v1/proofs/verify works via signedFetch body path', async () => {
    const client = new ApiClient({ baseUrl, clientId: SUBMIT_ID, secret: SUBMIT_SECRET });
    const body = (await client.verifyProof(SUBMISSION)) as { verified: boolean };
    expect(body.verified).toBe(true);
  });

  it('surfaces problem+json typed — UNKNOWN client → ApiClientError 401', async () => {
    const bad = new ApiClient({ baseUrl, clientId: 'nobody', secret: 'x'.repeat(32) });
    await expect(bad.listCircuits()).rejects.toMatchObject({ status: 401 });
  });

  it('bad payload → typed 422, not a 500', async () => {
    const client = new ApiClient({ baseUrl, clientId: SUBMIT_ID, secret: SUBMIT_SECRET });
    const err = (await client.verifyProof({ circuitId: 'nope' }).catch((e) => e)) as ApiClientError;
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.status).toBe(422);
    expect(err.problem.code).toBe('VALIDATION');
  });

  it('nonce freshness: two requests with the SAME nonce are rejected', async () => {
    const nonce = `${Date.now()}-fixedsame0001`;
    const ts = new Date().toISOString();
    const { canonicalString, hmacSha256Hex } = await import('../src/application/auth.js');
    const canonical = canonicalString({
      method: 'GET',
      path: '/v1/circuits',
      query: '',
      headers: { 'x-zk-key': READ_ID, 'x-zk-nonce': nonce, 'x-zk-timestamp': ts },
      bodyJson: null,
    });
    const headers = {
      'content-type': 'application/json',
      'x-zk-key': READ_ID,
      'x-zk-nonce': nonce,
      'x-zk-timestamp': ts,
      'x-zk-signature': hmacSha256Hex(READ_SECRET, canonical),
    };
    const inject = async () => {
      const res = await fetch(`${baseUrl}/v1/circuits`, { headers });
      return res;
    };
    const first = await inject();
    expect(first.status).toBe(200);
    const second = await inject();
    expect(second.status).toBe(401);
    const body = (await second.json()) as { code?: string };
    expect(body.code).toBe('AUTH-REPLAY');
  });
});