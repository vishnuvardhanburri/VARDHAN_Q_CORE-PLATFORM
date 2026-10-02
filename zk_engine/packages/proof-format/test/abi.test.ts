/**
 * Canonical ABI encoding regression (TypeScript side).
 *
 * Asserts proof-format's `encodePublicInputValues` / `publicInputHash`
 * byte-for-byte against `contracts/test/fixtures/canonical-vectors.json` —
 * the spec file generated from Solidity's own `abi.encode` output. The
 * Solidity counterpart (`contracts/test/CanonicalHash.t.sol`) asserts the
 * same file, so a divergence between languages fails one side or the other.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  circuitIdBytes32,
  encodeProofRecord,
  encodePublicInputValues,
  proofAnchorFromEnvelope,
  publicInputHash,
  registryProofHash,
} from '../src/abi.js';

/**
 * On-chain leaf captured from the registry on anvil for the CLI `prove`
 * output in `contracts/test/fixtures/live-proof.json` (decimal-string JSON,
 * snarkjs G2 layout). Solidity pins the same constant in
 * CanonicalHash.t.sol — one canonical proofHash, asserted from both sides.
 */
export const LIVE_CLI_PROOF_LEAF =
  '0xa806982c7101c24316a7cc43008fe0f0e72740773d6cb0396da523b4ca54e7e5';

interface Vector {
  label: string;
  values: string[];
  enc: string;
  hash: string;
}

interface ProofRecordVector {
  label: string;
  circuitId: string;
  vkHash: string;
  a: string[];
  b: string[][];
  c: string[];
  publicInputs: string[];
  enc: string;
  hash: string;
}

const specUrl = new URL('../../../contracts/test/fixtures/canonical-vectors.json', import.meta.url);
const spec = JSON.parse(readFileSync(specUrl, 'utf8')) as {
  vectors: Vector[];
  proofRecords: ProofRecordVector[];
};

describe('circuitIdBytes32 (Solidity bytes32 string cast equivalence)', () => {
  it('right-pads like bytes32("poseidon-preimage")', () => {
    expect(circuitIdBytes32('poseidon-preimage')).toBe(
      '0x706f736569646f6e2d707265696d616765000000000000000000000000000000',
    );
  });

  it('rejects circuitIds longer than 32 bytes', () => {
    expect(() => circuitIdBytes32('x'.repeat(33))).toThrow(RangeError);
  });
});

describe('canonical ABI public-input encoding (Solidity ground truth)', () => {
  for (const v of spec.vectors) {
    it(`encodes ${v.label} byte-identically to abi.encode`, () => {
      expect(encodePublicInputValues(v.values)).toBe(v.enc);
    });

    it(`hashes ${v.label} to the Solidity anchor`, () => {
      expect(publicInputHash(v.values)).toBe(v.hash);
    });
  }
});

describe('registry proof record encoding (ZKVerifierRegistry proofHash ground truth)', () => {
  for (const r of spec.proofRecords) {
    const b: [readonly [string, string], readonly [string, string]] = [
      [r.b[0]![0]!, r.b[0]![1]!],
      [r.b[1]![0]!, r.b[1]![1]!],
    ];
    const a: [string, string] = [r.a[0]!, r.a[1]!];
    const c: [string, string] = [r.c[0]!, r.c[1]!];

    it(`encodes ${r.label} byte-identically to abi.encode(...)`, () => {
      expect(encodeProofRecord(circuitIdBytes32(r.circuitId), r.vkHash, r.publicInputs, a, b, c)).toBe(r.enc);
    });

    it(`hashes ${r.label} to the on-chain proofHash`, () => {
      expect(registryProofHash(circuitIdBytes32(r.circuitId), r.vkHash, r.publicInputs, a, b, c)).toBe(r.hash);
    });

    it(`proofAnchorFromEnvelope applies the Fp2 b-swap (snarkjs -> contract order) for ${r.label}`, () => {
      const snarkjsB = [[r.b[0]![1]!, r.b[0]![0]!], [r.b[1]![1]!, r.b[1]![0]!]];
      const envelopeProof = {
        pi_a: a,
        pi_b: snarkjsB,
        pi_c: c,
      };
      expect(proofAnchorFromEnvelope(r.circuitId, r.vkHash, r.publicInputs, envelopeProof)).toBe(r.hash);
    });
  }

  it('routes decimal-string scalars (CLI prove JSON) through word() exactly like hex', () => {
    const r = spec.proofRecords[2]!;
    const b: [readonly [string, string], readonly [string, string]] = [
      [r.b[0]![0]!, r.b[0]![1]!],
      [r.b[1]![0]!, r.b[1]![1]!],
    ];
    expect(registryProofHash(circuitIdBytes32(r.circuitId), r.vkHash, r.publicInputs, [r.a[0]!, r.a[1]!], b, [
      r.c[0]!,
      r.c[1]!,
    ])).toBe(r.hash);
  });

  it('live CLI decimal proof produces the exact on-chain registry leaf (cross-language golden)', () => {
    const fixtureUrl = new URL('../../../contracts/test/fixtures/live-proof.json', import.meta.url);
    const p = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as {
      proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
      publicInputs: string[];
    };
    expect(
      proofAnchorFromEnvelope(
        'poseidon-preimage',
        '0x2daa077c6c6a30539d9fdfe93f116070fac13994f8f5a2a92d1d5c3bdc3986c4',
        p.publicInputs,
        p.proof,
      ),
    ).toBe(LIVE_CLI_PROOF_LEAF);
  });
});