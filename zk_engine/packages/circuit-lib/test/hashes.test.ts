/**
 * Unit tests for `src/hashes.ts` (SHA-256 artifact hashing).
 */

import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { sha256Bytes, sha256File, sha256Utf8 } from '../src/hashes.js';

describe('sha256Bytes', () => {
  it('matches node:crypto for arbitrary bytes', () => {
    const data = randomBytes(4096);
    expect(sha256Bytes(data)).toBe(`0x${createHash('sha256').update(data).digest('hex')}`);
  });

  it('is lowercase hex with 0x prefix', () => {
    const out = sha256Bytes(new Uint8Array(0));
    expect(out).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('sha256Utf8', () => {
  it('matches node:crypto for utf8 strings', () => {
    expect(sha256Utf8('hello')).toBe(`0x${createHash('sha256').update('hello', 'utf8').digest('hex')}`);
  });
});

describe('sha256File', () => {
  it('hashes file bytes identical to sha256Bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zkpe-hashes-'));
    const path = join(dir, 'blob.bin');
    const data = randomBytes(65536);
    writeFileSync(path, data);
    expect(await sha256File(path)).toBe(sha256Bytes(data));
  });

  it('rejects a missing file', async () => {
    await expect(sha256File('/nonexistent/zkpe-file')).rejects.toThrow();
  });
});
