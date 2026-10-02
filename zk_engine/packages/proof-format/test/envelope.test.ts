import { describe, expect, it } from 'vitest';
import {
  createEnvelope,
  computeProofHash,
  validateEnvelope,
} from '../src/envelope.js';
import type { Groth16Proof, ProofEnvelope } from '../src/types.js';

const GOOD_PROOF: Groth16Proof = {
  pi_a: ['1', '2', '3'],
  pi_b: [['1', '2'], ['3', '4'], ['1', '1']],
  pi_c: ['5', '6', '1'],
};

type EnvelopeParts = Omit<ProofEnvelope, 'formatVersion' | 'proofHash'>;

function baseParts(): EnvelopeParts {
  return {
    circuitId: 'sha256-preimage',
    circuitVersion: '1.0.0',
    vkHash: '0x' + 'a'.repeat(64),
    publicInputs: ['7'],
    proof: GOOD_PROOF,
  };
}

function baseEnvelope(): ProofEnvelope {
  return createEnvelope(baseParts());
}

describe('envelope', () => {
  it('createEnvelope computes a deterministic proofHash', () => {
    const e1 = baseEnvelope();
    const e2 = baseEnvelope();
    expect(e1.proofHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(e2.proofHash).toBe(e1.proofHash);
  });

  it('proofHash is sensitive to every binding field', () => {
    const base = baseEnvelope();
    const variants = [
      { ...base, publicInputs: ['8'] },
      { ...base, vkHash: '0x' + 'b'.repeat(64) },
      { ...base, circuitId: 'merkle-inclusion' },
      { ...base, circuitVersion: '1.0.1' },
      { ...base, proof: { ...base.proof, pi_a: ['9', '2', '3'] as [string, string, string] } },
    ];
    for (const v of variants) {
      expect(computeProofHash(v)).not.toBe(base.proofHash);
    }
  });

  it('a valid envelope validates clean', () => {
    expect(validateEnvelope(baseEnvelope())).toEqual([]);
  });

  it('optional proverTimestamp is accepted and validated', () => {
    const withTs = createEnvelope({ ...baseParts(), proverTimestamp: 1_700_000_000 });
    expect(validateEnvelope(withTs)).toEqual([]);
    const badTs = { ...baseEnvelope(), proverTimestamp: 'yesterday' };
    expect(validateEnvelope(badTs)).toContain(
      'proverTimestamp, if present, must be a number',
    );
  });

  it('rejects an unknown formatVersion', () => {
    expect(validateEnvelope({ ...baseEnvelope(), formatVersion: 3 })).toContain(
      'formatVersion must be 1 or 2',
    );
  });

  it('accepts signed v2 envelopes when the signature shape is valid', () => {
    const { formatVersion: _v, proofHash: _h, ...content } = baseEnvelope();
    const signed = {
      ...content,
      formatVersion: 2,
      proofHash: computeProofHash({ ...content, formatVersion: 2 }),
      signature: { algo: 'ed25519', keyId: 'a'.repeat(64), value: 'b'.repeat(128) },
    };
    expect(validateEnvelope(signed)).toEqual([]);
  });

  it('rejects v2 envelopes with malformed signatures', () => {
    const base = { ...baseEnvelope(), formatVersion: 2 };
    const bad = [
      { ...base, signature: { algo: 'ed25519', keyId: 'a'.repeat(64), value: 'xyz' } },
      { ...base, signature: { algo: 'ecdsa', keyId: 'a'.repeat(64), value: 'b'.repeat(128) } },
      { ...base, signature: { algo: 'ed25519', keyId: 'short', value: 'b'.repeat(128) } },
      { ...base, signature: null },
    ];
    for (const b of bad) {
      expect(validateEnvelope(b).length).toBeGreaterThan(0);
    }
  });

  it('rejects v1 envelopes that carry a signature', () => {
    const base = baseEnvelope() as unknown as Record<string, unknown>;
    expect(
      validateEnvelope({ ...base, signature: { algo: 'ed25519', keyId: 'a'.repeat(64), value: 'b'.repeat(128) } }),
    ).toContain('unsigned envelopes (formatVersion 1) must not carry a signature');
  });

  it('rejects a malformed vkHash', () => {
    expect(validateEnvelope({ ...baseEnvelope(), vkHash: 'abc' })).toContain(
      'vkHash must be 0x-prefixed 32-byte hex',
    );
  });

  it('rejects non-canonical field elements in publicInputs', () => {
    expect(validateEnvelope({ ...baseEnvelope(), publicInputs: ['01'] })).toContain(
      'publicInputs must be an array of canonical field elements',
    );
  });

  it('rejects malformed proof coordinates', () => {
    const badProofs = [
      { ...baseEnvelope(), proof: { pi_a: ['1', '2'], pi_b: [], pi_c: ['1', '2', '3'] } },
      { ...baseEnvelope(), proof: { pi_a: ['1', '2', '3'], pi_b: [['1', '2'], ['x', '4'], ['1', '1']], pi_c: ['1', '2', '3'] } },
      { ...baseEnvelope(), proof: null },
    ];
    for (const bad of badProofs) {
      expect(validateEnvelope(bad)).toContain('proof must be a well-formed Groth16 proof');
    }
  });

  it('rejects a stale proofHash (transport tampering)', () => {
    const tampered = baseEnvelope();
    tampered.publicInputs = ['999'];
    expect(validateEnvelope(tampered)).toContain(
      'proofHash does not match canonical envelope contents',
    );
  });

  it('rejects non-object input', () => {
    expect(validateEnvelope(null)).toEqual(['envelope must be an object']);
    expect(validateEnvelope('x')).toEqual(['envelope must be an object']);
  });
});
