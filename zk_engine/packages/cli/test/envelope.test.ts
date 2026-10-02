import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInputTemplate, parseDeployBroadcast } from '../src/commands.js';
import { createEnvelope } from '@zkpe/proof-format';
import { readEnvelopeFile, writeEnvelopeFile } from '../src/envelope.js';

describe('buildInputTemplate', () => {
  it('expands field arity to zero strings and u1 to ones', () => {
    const t = buildInputTemplate([
      { id: 'preimage', type: 'field', arity: 2 },
      { id: 'pathBits', type: 'u1', arity: 4 },
    ]);
    expect(t).toEqual({ preimage: ['0', '0'], pathBits: [1, 1, 1, 1] });
  });

  it('falls back to arity 1 for string arity refs', () => {
    const t = buildInputTemplate([{ id: 'leaf', type: 'field', arity: 'siblings' }]);
    expect(t.leaf).toEqual(['0']);
  });
});

describe('parseDeployBroadcast', () => {
  const good = {
    transactions: [
      { contractName: 'ERC1967Proxy', contractAddress: '0x' + 'aa'.repeat(20) },
      { contractName: 'VerifierPoseidonPreimage', contractAddress: '0x' + 'bb'.repeat(20) },
    ],
  };

  it('extracts the registry proxy address', () => {
    const d = parseDeployBroadcast(JSON.stringify(good));
    expect(d.registryProxy).toBe('0x' + 'aa'.repeat(20));
    expect(d.transactions).toHaveLength(2);
  });

  it('rejects a broadcast without the proxy tx', () => {
    expect(() => parseDeployBroadcast(JSON.stringify({ transactions: [] }))).toThrow(/ERC1967Proxy/);
  });

  it('rejects non-JSON', () => {
    expect(() => parseDeployBroadcast('not json')).toThrow();
  });
});

describe('envelope file I/O', () => {
  it('round-trips a valid v1 envelope', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zk-env-'));
    const path = join(dir, 'proof.json');
    const env = createEnvelope({
      circuitId: 'poseidon-preimage',
      circuitVersion: '1.0.0',
      vkHash: '0x' + 'ab'.repeat(32),
      publicInputs: ['42'],
      proof: { pi_a: ['1', '2', '3'] as [string, string, string], pi_b: [['1', '2'], ['3', '4'], ['5', '6']] as [[string, string], [string, string], [string, string]], pi_c: ['1', '2', '3'] as [string, string, string] },
    });
    await writeEnvelopeFile(path, env);
    const loaded = await readEnvelopeFile(path);
    expect(loaded.circuitId).toBe('poseidon-preimage');
    expect(loaded.publicInputs).toEqual(['42']);
    await rm(dir, { recursive: true, force: true });
  });
});