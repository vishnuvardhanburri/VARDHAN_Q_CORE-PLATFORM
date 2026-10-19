/**
 * Tests for `src/inputs.ts` — manifest-driven input validation.
 */

import { describe, expect, it } from 'vitest';
import { getCircuitDefinition } from '@zkpe/circuit-lib';
import type { CircuitManifest } from '@zkpe/proof-format';
import type { Circuit } from '../src/circuit.js';
import { InputValidationError, parseCircuitInputs } from '../src/inputs.js';

function fakeCircuit(def: ReturnType<typeof getCircuitDefinition>): Circuit {
  return {
    def,
    manifest: { circuitId: def.id, circuitVersion: def.version, inputs: [...def.inputs], privateInputs: [...def.privateInputs] } as CircuitManifest,
  } as unknown as Circuit;
}

const preimage = fakeCircuit(getCircuitDefinition('poseidon-preimage'));
const merkle = fakeCircuit(getCircuitDefinition('merkle-inclusion'));

describe('parseCircuitInputs', () => {
  it('normalizes valid field inputs to canonical decimal strings', () => {
    const out = parseCircuitInputs(preimage, { preimage: ['123456789', '987654321'] });
    expect(out).toEqual({ preimage: ['123456789', '987654321'] });
  });

  it('accepts numeric inputs and canonicalizes them', () => {
    const out = parseCircuitInputs(preimage, { preimage: [123, 0] });
    expect(out).toEqual({ preimage: ['123', '0'] });
  });

  it('rejects non-canonical field elements', () => {
    expect(() => parseCircuitInputs(preimage, { preimage: ['0123', '1'] })).toThrow(InputValidationError);
    expect(() => parseCircuitInputs(preimage, { preimage: ['-1', '1'] })).toThrow(InputValidationError);
    expect(() => parseCircuitInputs(preimage, { preimage: ['0x1', '1'] })).toThrow(InputValidationError);
    expect(() => parseCircuitInputs(preimage, { preimage: ['1e5', '1'] })).toThrow(InputValidationError);
    expect(() => parseCircuitInputs(preimage, { preimage: ['1', '2'] })).not.toThrow();
  });

  it('rejects out-of-range field elements (>= r)', () => {
    const r = '21888242871839275222246405745257275088548364400416034343698204186575808495617';
    expect(() => parseCircuitInputs(preimage, { preimage: [r, '0'] })).toThrow(InputValidationError);
  });

  it('rejects wrong arity', () => {
    expect(() => parseCircuitInputs(preimage, { preimage: ['1'] })).toThrow(/arity 2/);
    expect(() => parseCircuitInputs(merkle, { root: '1', leaf: '2', siblings: ['a', 'b', 'c'], pathBits: [0, 0, 0, 0] })).toThrow(/arity 4/);
  });

  it('rejects missing inputs and unknown-typed values', () => {
    expect(() => parseCircuitInputs(preimage, {})).toThrow(/missing input preimage/);
    expect(() => parseCircuitInputs(preimage, { preimage: ['1', { bad: true }] })).toThrow();
  });

  it('validates u1 path bits and u8/u32 ranges', () => {
    const good = { root: '1', leaf: '2', siblings: ['1', '2', '3', '4'], pathBits: [0, 1, 2, 0] };
    expect(() => parseCircuitInputs(merkle, good)).toThrow(/u1/);
    const fine = { root: '1', leaf: '2', siblings: ['1', '2', '3', '4'], pathBits: [0, 1, 1, 0] };
    expect(() => parseCircuitInputs(merkle, fine)).not.toThrow();
  });

  it('merkle root/leaf/siblings accept canonical field strings', () => {
    const out = parseCircuitInputs(merkle, {
      root: '10',
      leaf: '20',
      siblings: ['1', '2', '3', '4'],
      pathBits: [0, 0, 1, 0],
    });
    expect(out.pathBits).toEqual(['0', '0', '1', '0']);
  });
});
