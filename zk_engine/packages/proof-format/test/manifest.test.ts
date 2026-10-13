import { describe, expect, it } from 'vitest';
import {
  computeManifestHash,
  validateManifest,
} from '../src/manifest.js';
import type { CircuitManifest } from '../src/types.js';

type ManifestParts = Omit<CircuitManifest, 'manifestHash'>;

function baseManifest(): ManifestParts {
  return {
    manifestVersion: 1,
    circuitId: 'sha256-preimage',
    circuitVersion: '1.0.0',
    scheme: 'groth16',
    curve: 'bn254',
    inputs: [{ id: 'digest', type: 'field', arity: 8 }],
    privateInputs: [{ id: 'preimage', type: 'field', arity: 16 }],
    outputs: [{ id: 'isValid', type: 'u1', arity: 1 }],
    artifacts: {
      r1cs: '0x' + '1'.repeat(64),
      wasm: '0x' + '2'.repeat(64),
      zkey: '0x' + '3'.repeat(64),
      vk: { vkHash: '0x' + '4'.repeat(64), sha256: '0x' + '5'.repeat(64) },
    },
    constraints: { estimated: 5700, max: 16384 },
    compatibility: { minEngine: '1.0.0', minProofFormat: '1.0.0' },
  };
}

function withHash(m: ManifestParts): CircuitManifest {
  return { ...m, manifestHash: computeManifestHash(m) };
}

describe('manifest', () => {
  it('valid manifest validates clean and hash is deterministic', () => {
    const a = withHash(baseManifest());
    const b = withHash(baseManifest());
    expect(validateManifest(a)).toEqual([]);
    expect(b.manifestHash).toBe(a.manifestHash);
    expect(a.manifestHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('manifestHash is sensitive to contents', () => {
    const m = withHash(baseManifest());
    const changed = withHash({ ...baseManifest(), circuitVersion: '1.0.1' });
    expect(changed.manifestHash).not.toBe(m.manifestHash);
  });

  it('rejects unknown scheme or curve', () => {
    expect(validateManifest(withHash({ ...baseManifest(), scheme: 'plonk' as never }))).toContain(
      'scheme must be one of groth16',
    );
    expect(validateManifest(withHash({ ...baseManifest(), curve: 'secp256k1' as never }))).toContain(
      'curve must be one of bn254',
    );
  });

  it('rejects bad artifact digests', () => {
    expect(
      validateManifest(withHash({ ...baseManifest(), artifacts: { ...baseManifest().artifacts, r1cs: 'zzz' } })),
    ).toContain('artifacts.r1cs must be a 0x-prefixed sha256 digest');
  });

  it('rejects bad constraints and compatibility', () => {
    expect(
      validateManifest(withHash({ ...baseManifest(), constraints: { estimated: 0, max: 10 } })),
    ).toContain('constraints.estimated must be a positive integer');
  });

  it('rejects stale manifestHash', () => {
    const m = withHash(baseManifest());
    m.circuitId = 'merkle-inclusion';
    expect(validateManifest(m)).toContain(
      'manifestHash does not match canonical manifest contents',
    );
  });

  it('rejects bad input specs', () => {
    const bad = baseManifest();
    bad.inputs = [{ id: '', type: 'field', arity: 1 }];
    expect(validateManifest(bad)).toContain('inputs schema invalid');
  });
});
