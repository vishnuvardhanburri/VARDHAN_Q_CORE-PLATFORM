/**
 * Integration: real certified engine artifacts + live API server + CLI
 * commands, end-to-end within one process:
 *
 *   prove (real snarkjs) → envelope file → verify (engine + API) →
 *   register (fake registry write) → status.
 *
 * Skips when certified artifacts are not built (same policy as the engine
 * integration suite).
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { artifactsExist, getCircuitDefinition } from '@zkpe/circuit-lib';
import { buildServer, type ServerDeps } from '@zkpe/api';
import { parseConfig } from '@zkpe/api';
import { NoopTracer } from '@zkpe/api';
import { EnvSecretStore, NonceStore, InMemoryIdempotencyStore, AuditLog, Metrics } from '@zkpe/api';
import { ApiClient } from '@zkpe/api';
import { publicInputHash } from '@zkpe/proof-format';
import { cmdProve, cmdVerify, cmdStatus, type CliCtx } from '../src/commands.js';
import { ProfileStore } from '../src/env.js';
import type { CircuitInfo, VerifyOutcome, RegistryInfo, ProofStatusEntry } from '@zkpe/api';
import type { EnginePort, RegistryReadPort, RegistryWritePort } from '@zkpe/api';

const artifactsReady = getCircuitDefinition('poseidon-preimage');

class FakeEngine implements EnginePort {
  async listCircuits(): Promise<CircuitInfo[]> {
    return [{ circuitId: 'poseidon-preimage', version: '1.0.0', label: 'poseidon-preimage@1.0.0', nPublic: 1, artifactsReady: true }];
  }
  async verify(): Promise<VerifyOutcome> {
    return { valid: true, circuitId: 'poseidon-preimage' };
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
  async getCircuit() {
    return this.cfg;
  }
  async getProofStatus(): Promise<ProofStatusEntry> {
    return { status: 'proved', provedAt: '1700000000' };
  }
  async registryInfo(circuitIds: string[]): Promise<RegistryInfo> {
    return {
      proxy: '0x' + 'cd'.repeat(20),
      schemaVersion: '1',
      totalProofs: String(this.registerCalls),
      paused: false,
      circuits: Object.fromEntries(circuitIds.map((id) => [id, this.cfg])),
    };
  }
  async registerProof() {
    this.registerCalls += 1;
    return { txHash: '0x' + 'ef'.repeat(32) };
  }
  async healthy(): Promise<boolean> {
    return true;
  }
}

describe.skipIf(!artifactsExist(artifactsReady))('CLI integration (real engine + API)', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let dir: string;
  let ctx: CliCtx;
  const READ_ID = 'cli-read';
  const SUBMIT_ID = 'cli-submit';
  const WRITE_ID = 'cli-write';
  const SECRET = (c: string) => c.repeat(32);
  const ENV = {
    ZK_API_KEYS: `${READ_ID}:${SECRET(READ_ID)}:read;${SUBMIT_ID}:${SECRET(SUBMIT_ID)}:submit;${WRITE_ID}:${SECRET(WRITE_ID)}:write`,
    ZK_OTEL_DISABLED: 'true',
    ZK_LOG_LEVEL: 'silent',
  };

  const engine = new FakeEngine();
  const registry = new FakeRegistry();

  beforeAll(async () => {
    app = await buildServer({
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
    } as ServerDeps);
    await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

    dir = await mkdtemp(join(tmpdir(), 'zk-cli-int-'));
    const store = new ProfileStore(join(dir, '.zk'));
    await store.save('dev', { apiUrl: baseUrl, clientId: READ_ID, secret: SECRET(READ_ID) }, { create: true });
    ctx = { env: 'dev', cwd: dir, store };
  });

  afterAll(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function proveLocally(): Promise<string> {
    await writeFile(join(dir, 'inputs.json'), JSON.stringify({ preimage: ['123456789', '987654321'] }));
    const r = await cmdProve(ctx, { circuitId: 'poseidon-preimage', inputsFile: 'inputs.json', outFile: 'proof.json' });
    return r.out;
  }

  it('cmdProve writes a valid envelope with a canonical publicInputHash', async () => {
    const out = await proveLocally();
    const env = JSON.parse(await readFile(out, 'utf8')) as {
      circuitId: string;
      vkHash: string;
      publicInputs: string[];
      artifactHash?: string;
    };
    expect(env.circuitId).toBe('poseidon-preimage');
    expect(env.vkHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(env.publicInputs).toHaveLength(1);
    expect(env.artifactHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(publicInputHash(env.publicInputs)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('cmdVerify verifies locally AND through the API (two paths agree)', async () => {
    await proveLocally();
    const client = new ApiClient({ baseUrl, clientId: SUBMIT_ID, secret: SECRET(SUBMIT_ID) });
    const result = await cmdVerify(ctx, { proofFile: 'proof.json', client });
    expect(result.valid).toBe(true);
    expect((result.api as { verified: boolean }).verified).toBe(true);
  });

  it('tampered envelope is rejected (local path)', async () => {
    await proveLocally();
    const path = join(dir, 'proof.json');
    const env = JSON.parse(await readFile(path, 'utf8')) as { proof: { pi_c: string[] } };
    env.proof.pi_c[1] = (BigInt(env.proof.pi_c[1]!) + 1n).toString();
    await writeFile(path, JSON.stringify(env));
    const client = new ApiClient({ baseUrl, clientId: SUBMIT_ID, secret: SECRET(SUBMIT_ID) });
    let rejected = false;
    try {
      const result = await cmdVerify(ctx, { proofFile: 'proof.json', client });
      rejected = result.valid === false;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it('cmdStatus resolves the on-chain status via the API', async () => {
    await proveLocally();
    const client = new ApiClient({ baseUrl, clientId: READ_ID, secret: SECRET(READ_ID) });
    const r = await cmdStatus(ctx, { proofFile: 'proof.json', client });
    expect(r.status).toBe('proved');
    expect(r.publicInputHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});