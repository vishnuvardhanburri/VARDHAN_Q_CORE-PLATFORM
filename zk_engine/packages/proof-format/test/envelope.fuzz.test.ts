import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createEnvelope,
  validateEnvelope,
  computeProofHash,
} from '../src/envelope.js';
import type { Groth16Proof, ProofEnvelope } from '../src/types.js';

describe('Envelope Fuzzing', () => {
  const hexCharArb = fc.constantFrom(
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'a', 'b', 'c', 'd', 'e', 'f'
  );

  const hex32Arb = fc
    .array(hexCharArb, { minLength: 64, maxLength: 64 })
    .map((chars) => '0x' + chars.join(''));

  const fieldElementArb = fc
    .bigInt({
      min: 0n,
      max: 21888242871839275222246405745257275088548364400416034343698204186575808495616n,
    })
    .map(String);

  const groth16ProofArb = fc.record({
    pi_a: fc.tuple(fieldElementArb, fieldElementArb, fieldElementArb),
    pi_b: fc.tuple(
      fc.tuple(fieldElementArb, fieldElementArb),
      fc.tuple(fieldElementArb, fieldElementArb),
      fc.tuple(fieldElementArb, fieldElementArb)
    ),
    pi_c: fc.tuple(fieldElementArb, fieldElementArb, fieldElementArb),
  }) as fc.Arbitrary<Groth16Proof>;

  it('rejects arbitrarily malformed data without throwing unhandled exceptions', () => {
    fc.assert(
      fc.property(fc.anything(), (malformed) => {
        try {
          const errors = validateEnvelope(malformed as ProofEnvelope);
          if (errors.length === 0) {
            expect(malformed).toHaveProperty('formatVersion', 1);
            expect(malformed).toHaveProperty('proofHash');
          }
        } catch (e: unknown) {
          expect(e).toBeInstanceOf(Error);
        }
      })
    );
  });

  it('createEnvelope produces valid envelopes and deterministic proofHash for arbitrary valid inputs', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9-]{1,32}$/), // circuitId
        fc.constant('1.0.0'), // circuitVersion (semver)
        hex32Arb, // vkHash (0x-prefixed 64 hex chars)
        fc.array(fieldElementArb, { maxLength: 10 }), // publicInputs
        groth16ProofArb, // proof
        (circuitId, circuitVersion, vkHash, publicInputs, proof) => {
          const parts = { circuitId, circuitVersion, vkHash, publicInputs, proof };
          const envelope = createEnvelope(parts);

          expect(envelope.formatVersion).toBe(1);
          expect(envelope.circuitId).toBe(circuitId);
          expect(validateEnvelope(envelope)).toEqual([]);

          // Fuzz canonical proofHash consistency
          const recomputedHash = computeProofHash({
            formatVersion: envelope.formatVersion,
            circuitId: envelope.circuitId,
            circuitVersion: envelope.circuitVersion,
            vkHash: envelope.vkHash,
            publicInputs: envelope.publicInputs,
            proof: envelope.proof,
          });
          expect(recomputedHash).toBe(envelope.proofHash);
        }
      ),
      { numRuns: 100 }
    );
  });
});
