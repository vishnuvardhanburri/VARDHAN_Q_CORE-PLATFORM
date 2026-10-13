/**
 * Tests for the `HashProvider` registry and capability model (M1 req #3).
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  NotSupportedError,
  UnknownHashProviderError,
  getByteHashProvider,
  getHashProvider,
  listHashProviders,
  registerHashProvider,
} from '../src/hash/hash-provider.js';

const fake = {
  id: 'fake-field',
  description: 'test provider',
  hash: async (inputs: readonly bigint[]) => inputs.reduce((a, b) => a + b, 0n),
};

describe('hash provider registry', () => {
  beforeEach(() => registerHashProvider(fake));

  it('registers, lists, and resolves providers by id', async () => {
    expect(listHashProviders()).toContain('fake-field');
    expect(await getHashProvider('fake-field').hash([1n, 2n])).toBe(3n);
  });

  it('throws UnknownHashProviderError for unregistered ids', () => {
    expect(() => getHashProvider('nope')).toThrow(UnknownHashProviderError);
  });

  it('rejects getByteHashProvider for field-only providers', () => {
    expect(() => getByteHashProvider('fake-field')).toThrow(NotSupportedError);
  });

  it('lists ids deterministically', () => {
    registerHashProvider({ ...fake, id: 'aaa' });
    registerHashProvider({ ...fake, id: 'zzz' });
    const ids = listHashProviders();
    expect([...ids].sort()).toEqual(ids);
  });

  it('re-registration replaces the previous provider', async () => {
    registerHashProvider({ ...fake, hash: async () => 42n });
    expect(await getHashProvider('fake-field').hash([1n])).toBe(42n);
  });
});
