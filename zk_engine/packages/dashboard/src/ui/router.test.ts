import { describe, it, expect } from 'vitest';
import { parseHash } from './router.js';

describe('parseHash', () => {
  it('routes overview for empty hash', () => {
    expect(parseHash('')).toEqual({ name: 'overview' });
    expect(parseHash('#/overview')).toEqual({ name: 'overview' });
  });

  it('routes circuit detail with id', () => {
    expect(parseHash('#/circuits')).toEqual({ name: 'circuits' });
    expect(parseHash('#/circuits/poseidon-preimage')).toEqual({ name: 'circuit', circuitId: 'poseidon-preimage' });
  });

  it('routes gatekeeper list and report detail', () => {
    expect(parseHash('#/gatekeeper')).toEqual({ name: 'gatekeeper' });
    expect(parseHash('#/gatekeeper/2026-08-09-registered-pass.json')).toEqual({
      name: 'gatekeeper',
      reportFile: '2026-08-09-registered-pass.json',
    });
  });

  it('ignores query strings and drops trailing slashes', () => {
    expect(parseHash('#/audit?limit=10')).toEqual({ name: 'audit' });
    expect(parseHash('#/')).toEqual({ name: 'overview' });
  });

  it('routes unknown paths', () => {
    expect(parseHash('#/nope')).toEqual({ name: 'unknown', path: '/nope' });
  });
});