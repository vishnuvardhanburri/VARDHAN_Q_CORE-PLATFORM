/**
 * Tests for the Poseidon hash provider (ADR-0008). The provider must match
 * the certified circuits bit-for-bit — this is asserted against the
 * independent `circomlibjs` oracle AND the circuit witness in the integration
 * suite.
 */

import { describe, expect, it } from 'vitest';
import { buildPoseidonReference } from 'circomlibjs';
import { NotSupportedError } from '../src/hash/hash-provider.js';
import {
  POSEIDON_HASH_PROVIDER_ID,
  PoseidonHashProvider,
  getPoseidonProvider,
  registerDefaultHashProviders,
} from '../src/hash/poseidon.js';

describe('PoseidonHashProvider', () => {
  const provider = new PoseidonHashProvider();

  it('has the stable id and descriptive params', () => {
    expect(provider.id).toBe(POSEIDON_HASH_PROVIDER_ID);
    expect(provider.description).toMatch(/Poseidon.*nRoundsF=8/);
  });

  it('matches the reference oracle for 1..4 inputs', async () => {
    const oracle = await buildPoseidonReference();
    for (const inputs of [
      [7n],
      [123456789n, 987654321n],
      [1n, 2n, 3n],
      [1n, 2n, 3n, 4n],
    ]) {
      const expected = BigInt(oracle.F.toString(oracle(inputs)));
      expect(await provider.hash(inputs)).toBe(expected);
    }
  });

  it('rejects out-of-range arity', async () => {
    await expect(provider.hash([])).rejects.toThrow(RangeError);
    await expect(provider.hash(new Array(16).fill(1n))).rejects.toThrow(RangeError);
  });

  it('does not support byte hashing in v1', async () => {
    await expect(provider.hashBytes(new Uint8Array([1]))).rejects.toThrow(NotSupportedError);
  });

  it('the singleton is shared and registered by default', async () => {
    expect(getPoseidonProvider()).toBe(getPoseidonProvider());
    registerDefaultHashProviders();
    const { getHashProvider, listHashProviders } = await import('../src/hash/hash-provider.js');
    expect(listHashProviders()).toContain('poseidon');
    expect(getHashProvider('poseidon')).toBe(getPoseidonProvider());
  });
});
