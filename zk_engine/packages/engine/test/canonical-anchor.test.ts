/**
 * Engine-side canonical-anchor regression.
 *
 * The engine consumes serialization from @zkpe/proof-format; this pins the
 * exposed public-input anchor to the Solidity-generated spec exactly as the
 * contracts side does, so engine ↔ chain anchoring cannot drift.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { publicInputHash, encodePublicInputValues } from '@zkpe/proof-format';

interface Vector {
  label: string;
  values: string[];
  enc: string;
  hash: string;
}

const specUrl = new URL('../../../contracts/test/fixtures/canonical-vectors.json', import.meta.url);
const spec = JSON.parse(readFileSync(specUrl, 'utf8')) as { vectors: Vector[] };

describe('engine canonical anchoring (via @zkpe/proof-format)', () => {
  for (const v of spec.vectors) {
    it(`public anchor for ${v.label} matches the chain spec`, () => {
      expect(publicInputHash(v.values)).toBe(v.hash);
      expect(encodePublicInputValues(v.values)).toBe(v.enc);
    });
  }
});