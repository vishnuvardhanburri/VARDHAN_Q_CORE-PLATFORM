import { describe, expect, it } from 'vitest';
import { keccak256Utf8, sha256Utf8 } from '../src/hash.js';

describe('hash helpers', () => {
  it('keccak256 of empty string matches the known digest', () => {
    expect(keccak256Utf8('')).toBe(
      '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    );
  });

  it('keccak256 of "abc" matches the known digest', () => {
    expect(keccak256Utf8('abc')).toBe(
      '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
    );
  });

  it('sha256 of empty string matches the known digest', () => {
    expect(sha256Utf8('')).toBe(
      '0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('produces 0x-prefixed 64-char hex', () => {
    expect(keccak256Utf8('x')).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sha256Utf8('x')).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
