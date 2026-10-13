import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cmdNew,
  cmdRegister,
  cmdStatus,
  cmdEnvShow,
  parseDeployBroadcast,
  type CliCtx,
} from '../src/commands.js';
import { ProfileStore } from '../src/env.js';
import type { ApiClient } from '@zkpe/api';
import { createEnvelope } from '@zkpe/proof-format';

const VALID_ENVELOPE = createEnvelope({
  circuitId: 'poseidon-preimage',
  circuitVersion: '1.0.0',
  vkHash: '0x' + 'ab'.repeat(32),
  publicInputs: ['42'],
  proof: { pi_a: ['1', '2', '3'] as [string, string, string], pi_b: [['1', '2'], ['3', '4'], ['5', '6']] as [[string, string], [string, string], [string, string]], pi_c: ['1', '2', '3'] as [string, string, string] },
});

function fakeClient(overrides: Partial<Record<keyof ApiClient, unknown>> = {}): ApiClient {
  return {
    listCircuits: vi.fn(async () => ({ circuits: [] })),
    registryInfo: vi.fn(async () => ({
      proxy: '0x' + 'ab'.repeat(20),
      schemaVersion: '1',
      totalProofs: '2',
      paused: false,
      circuits: { 'poseidon-preimage': { verifier: '0x' + 'bb'.repeat(20), vkHash: '0x' + 'ab'.repeat(32), active: true } },
    })),
    verifyProof: vi.fn(async () => ({ verified: true })),
    registerProof: vi.fn(async () => ({ verified: true, publicInputHash: '0x' + 'ef'.repeat(32), txHash: '0x' + '12'.repeat(32) })),
    proofStatus: vi.fn(async () => ({ status: 'proved', provedAt: '1700000000' })),
    ...overrides,
  } as unknown as ApiClient;
}

async function makeCtx(): Promise<{ ctx: CliCtx; dir: string; store: ProfileStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'zk-cmd-'));
  const store = new ProfileStore(join(dir, '.zk'));
  await store.save('dev', { apiUrl: 'http://127.0.0.1:9999', clientId: 'cid', secret: 's'.repeat(40) }, { create: true });
  return { ctx: { env: 'dev', cwd: dir, store }, dir, store };
}

describe('cmdNew', () => {
  it('scaffolds a project with an inputs template', async () => {
    const { ctx, dir } = await makeCtx();
    const r = await cmdNew(ctx, 'poseidon-preimage', 'hello');
    expect(r.inputsFile).toBe(join(dir, 'hello', 'inputs.json'));
    const inputs = JSON.parse(await readFile(r.inputsFile, 'utf8'));
    expect(inputs).toEqual({ preimage: ['0', '0'] });
    await rm(dir, { recursive: true, force: true });
  });
});

describe('cmdRegister', () => {
  it('reads the envelope and delegates the anchor to the API client', async () => {
    const { ctx, dir } = await makeCtx();
    const file = join(dir, 'proof.json');
    await writeFile(file, JSON.stringify(VALID_ENVELOPE));
    const client = fakeClient();
    const out = await cmdRegister(ctx, { proofFile: file, idempotencyKey: 'key-000001', client });
    expect(out.txHash).toBe('0x' + '12'.repeat(32));
    const [submission, key] = vi.mocked(client.registerProof).mock.calls[0]! as [unknown, string];
    expect(key).toBe('key-000001');
    expect((submission as { circuitId: string }).circuitId).toBe('poseidon-preimage');
  });
});

describe('cmdStatus', () => {
  it('returns status + hash from the API client', async () => {
    const { ctx, dir } = await makeCtx();
    const file = join(dir, 'proof.json');
    await writeFile(file, JSON.stringify(VALID_ENVELOPE));
    const client = fakeClient();
    const r = await cmdStatus(ctx, { proofFile: file, client });
    expect(r.status).toBe('proved');
    expect(vi.mocked(client.proofStatus).mock.calls[0]![0]).toBe('poseidon-preimage');
  });
});

describe('cmdEnvShow', () => {
  it('never leaks the secret', async () => {
    const { ctx } = await makeCtx();
    const doc = await cmdEnvShow(ctx, 'dev');
    expect(JSON.stringify(doc)).not.toContain('s'.repeat(40));
    expect(doc['secret']).toContain('<redacted');
  });
});

describe('parseDeployBroadcast', () => {
  it('extracts the registry proxy from a forge broadcast', () => {
    const raw = JSON.stringify({
      transactions: [
        { contractName: 'ERC1967Proxy', contractAddress: '0x' + 'aa'.repeat(20) },
        { contractName: 'VerifierPoseidonPreimage', contractAddress: '0x' + 'bb'.repeat(20) },
      ],
    });
    expect(parseDeployBroadcast(raw).registryProxy).toBe('0x' + 'aa'.repeat(20));
  });

  it('rejects broadcasts without a proxy', () => {
    expect(() => parseDeployBroadcast(JSON.stringify({ transactions: [{ contractName: 'X' }] }))).toThrow(/ERC1967Proxy/);
  });
});