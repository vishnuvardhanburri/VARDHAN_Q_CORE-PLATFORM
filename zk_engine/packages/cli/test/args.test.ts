import { describe, expect, it } from 'vitest';
import { parseArgs, UsageError } from '../src/args.js';

describe('zk arg parsing', () => {
  it('defaults to help when run bare', () => {
    const a = parseArgs([]);
    expect(a.command).toBe('help');
  });

  it('parses command + positional + flags', () => {
    const a = parseArgs(['prove', 'poseidon-preimage', 'inputs.json', '--out', 'proof.json', '--env', 'prod']);
    expect(a.command).toBe('prove');
    expect(a.positional).toEqual(['poseidon-preimage', 'inputs.json']);
    expect(a.flags['out']).toBe('proof.json');
    expect(a.env).toBe('prod');
  });

  it('defaults env to dev', () => {
    expect(parseArgs(['status', 'x.json']).env).toBe('dev');
  });

  it('parses boolean flags', () => {
    const a = parseArgs(['verify', 'p.json', '--offline']);
    expect(a.flags['offline']).toBe(true);
  });

  it('rejects unknown commands', () => {
    expect(() => parseArgs(['frobnicate'])).toThrow(UsageError);
  });

  it('rejects missing flag values', () => {
    expect(() => parseArgs(['prove', '--env'])).toThrow(UsageError);
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['prove', '--bogus'])).toThrow(UsageError);
  });
});