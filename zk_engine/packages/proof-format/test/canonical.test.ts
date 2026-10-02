import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/canonical.js';

describe('canonicalize', () => {
  it('sorts object keys lexicographically', () => {
    const input = { b: 1, a: 'x', c: [1, 2] };
    expect(canonicalize(input)).toBe('{"a":"x","b":1,"c":[1,2]}');
  });

  it('is stable under key-order permutation of nested objects', () => {
    const a = { root: { z: '1', a: '2' }, arr: [{ y: true, x: null }] };
    const b = { arr: [{ x: null, y: true }], root: { a: '2', z: '1' } };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('preserves array order', () => {
    expect(canonicalize(['b', 'a', 'c'])).toBe('["b","a","c"]');
  });

  it('escapes strings like JSON', () => {
    expect(canonicalize({ k: 'a"b\\c\n' })).toBe('{"k":"a\\"b\\\\c\\n"}');
  });

  it('normalizes -0 to 0 and rejects non-finite numbers', () => {
    expect(canonicalize(-0)).toBe('0');
    expect(() => canonicalize(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('rejects unsupported values', () => {
    expect(() => canonicalize(undefined as never)).toThrow(TypeError);
    expect(() => canonicalize(Symbol('x') as never)).toThrow(TypeError);
  });

  it('handles the golden envelope-shaped fixture deterministically', () => {
    const envelope = {
      formatVersion: 1,
      circuitId: 'merkle-inclusion',
      publicInputs: ['42'],
      proof: { pi_a: ['1', '2', '3'], pi_b: [['1', '2'], ['3', '4'], ['1', '1']], pi_c: ['5', '6', '1'] },
      proofHash: '0x' + '0'.repeat(64),
    };
    const first = canonicalize(envelope);
    const permuted = canonicalize({ ...envelope, proof: { pi_c: envelope.proof.pi_c, pi_b: envelope.proof.pi_b, pi_a: envelope.proof.pi_a } });
    expect(first).toBe(permuted);
  });
});
