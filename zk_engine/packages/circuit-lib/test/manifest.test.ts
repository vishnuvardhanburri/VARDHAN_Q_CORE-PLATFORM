/**
 * Unit tests for `src/manifest.ts` — certified manifest construction and
 * vkHash computation (ADR-0007, ADR-0008).
 */

import { describe, expect, it } from 'vitest';
import { validateManifest } from '@zkpe/proof-format';
import { getCircuitDefinition } from '../src/circuits.js';
import { buildManifest, computeVkHash, manifestMatchesArtifacts } from '../src/manifest.js';

const H1 = '0x' + 'a'.repeat(64);
const H2 = '0x' + 'b'.repeat(64);
const H3 = '0x' + 'c'.repeat(64);
const H4 = '0x' + 'd'.repeat(64);
const H5 = '0x' + 'e'.repeat(64);

function hashes(overrides: Partial<import('../src/manifest.js').ArtifactHashes> = {}) {
  return { r1cs: H1, wasm: H2, zkey: H3, vkHash: H4, vkSha256: H5, ...overrides };
}

describe('buildManifest', () => {
  for (const def of [getCircuitDefinition('poseidon-preimage'), getCircuitDefinition('merkle-inclusion')]) {
    it(`produces a manifest that validates for ${def.id}`, () => {
      const manifest = buildManifest(def, hashes());
      expect(validateManifest(manifest)).toEqual([]);
      expect(manifest.circuitId).toBe(def.id);
      expect(manifest.scheme).toBe('groth16');
      expect(manifest.curve).toBe('bn254');
      expect(manifest.manifestHash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it(`manifest hash is deterministic for ${def.id}`, () => {
      const a = buildManifest(def, hashes());
      const b = buildManifest(def, hashes());
      expect(b.manifestHash).toBe(a.manifestHash);
    });

    it(`manifest hash is sensitive to artifacts for ${def.id}`, () => {
      const a = buildManifest(def, hashes());
      const b = buildManifest(def, hashes({ r1cs: '0x' + 'f'.repeat(64) }));
      expect(b.manifestHash).not.toBe(a.manifestHash);
    });
  }

  it('rejects a manifest whose artifact digests are not 0x-prefixed hex', () => {
    const def = getCircuitDefinition('poseidon-preimage');
    expect(() => buildManifest(def, hashes({ r1cs: 'not-a-digest' }))).toThrow(TypeError);
    expect(() => buildManifest(def, hashes({ vkHash: 'nope' }))).toThrow(TypeError);
  });

  it('rejects unknown circuit ids', () => {
    expect(() => getCircuitDefinition('nope')).toThrow(RangeError);
  });
});

describe('computeVkHash', () => {
  it('is deterministic over the canonical vk', () => {
    const vk = { alpha: { a: '1' }, beta: ['2', '3'] };
    expect(computeVkHash(vk)).toBe(computeVkHash(vk));
  });

  it('is sensitive to key ordering, not JSON key order', () => {
    const a = computeVkHash({ alpha: 'x', beta: 'y' });
    const b = computeVkHash({ beta: 'y', alpha: 'x' });
    expect(a).toBe(b);
    expect(computeVkHash({ alpha: 'x', beta: 'z' })).not.toBe(a);
  });
});

describe('manifestMatchesArtifacts', () => {
  it('matches identical and rejects differing digests', () => {
    const def = getCircuitDefinition('poseidon-preimage');
    const manifest = buildManifest(def, hashes());
    expect(manifestMatchesArtifacts(manifest, hashes())).toBe(true);
    expect(manifestMatchesArtifacts(manifest, hashes({ wasm: '0x' + 'f'.repeat(64) }))).toBe(false);
  });
});
