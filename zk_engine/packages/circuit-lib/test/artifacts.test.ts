/**
 * Unit tests for `src/artifacts.ts` and `src/circuits.ts` — artifact layout,
 * integrity checking, and the circuit registry.
 */

import { describe, expect, it } from 'vitest';
import { getCircuitDefinition, listCircuitIds, CIRCUIT_DEFS } from '../src/circuits.js';
import { buildDir, manifestPath } from '../src/artifacts.js';

describe('CIRCUIT_DEFS registry', () => {
  it('registers exactly the v1 circuit set (ADR-0008)', () => {
    expect(listCircuitIds()).toEqual(['poseidon-preimage', 'merkle-inclusion']);
  });

  it('every definition has a source file, semver version, and budgeted constraints', () => {
    for (const def of CIRCUIT_DEFS) {
      expect(def.file).toMatch(/\.circom$/);
      expect(def.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(def.constraints.max).toBeGreaterThanOrEqual(def.constraints.estimated);
      expect(def.constraints.estimated).toBeGreaterThan(0);
    }
  });

  it('ids are unique and stable', () => {
    const ids = CIRCUIT_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('artifact paths', () => {
  it('resolves the build dir under the package root', () => {
    expect(buildDir().replace(/\\/g, '/')).toMatch(/packages\/circuit-lib\/build$/);
  });

  it('points at the canonical artifact file names', () => {
    const def = getCircuitDefinition('poseidon-preimage');
    expect(manifestPath(def).replace(/\\/g, '/')).toMatch(/poseidon-preimage\.manifest\.json$/);
  });
});
