/**
 * Tests for the file keystore (`src/keystore.ts`, ADR-0009): 0600
 * permissions, atomic persistence, and tamper detection.
 *
 * Permission-mode assertions are skipped on Windows: POSIX chmod bits are
 * not enforced by the Windows kernel, so `stat.mode` does not reflect
 * them. Security on Windows depends on NTFS ACLs instead.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileKeyStore } from '../src/keystore.js';
import { KeyRing } from '../src/keyring.js';
import { KeyStoreError } from '../src/errors.js';

const IS_WINDOWS = process.platform === 'win32';

let dir: string;

async function tempDir(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'zkpe-keys-'));
  return dir;
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('FileKeyStore', () => {
  it('saves and loads a ring with 0600 permissions', async () => {
    const store = new FileKeyStore(join(await tempDir(), 'keyring.json'));
    const ring = KeyRing.create();
    ring.rotate();
    ring.rotate();
    await store.save(ring);

    // POSIX permission bits are not enforced on Windows; skip the mode check.
    if (!IS_WINDOWS) {
      const st = statSync(store.path);
      expect(st.mode & 0o077).toBe(0);
    }

    const loaded = await store.load();
    expect(loaded.list()).toEqual(ring.list());
    expect(loaded.activeKeyId).toBe(ring.activeKeyId);
  });

  it('returns an empty ring when the file does not exist', async () => {
    const store = new FileKeyStore(join(await tempDir(), 'missing.json'));
    const ring = await store.load();
    expect(ring.size).toBe(0);
  });

  it('rejects a keyring file with unsafe permissions', async () => {
    // Windows does not enforce POSIX permission bits — skip.
    if (IS_WINDOWS) return;
    const path = join(await tempDir(), 'leaky.json');
    await writeFile(path, JSON.stringify(KeyRing.create().toJSON()), { mode: 0o644 });
    const store = new FileKeyStore(path);
    await expect(store.assertSecurePermissions()).rejects.toThrow(KeyStoreError);
    await expect(store.load()).rejects.toThrow(KeyStoreError);
  });

  it('rejects a tampered keyring file', async () => {
    const path = join(await tempDir(), 'tampered.json');
    await writeFile(path, '{"version":1,"entries":[{broken}', { mode: 0o600 });
    const store = new FileKeyStore(path);
    await expect(store.load()).rejects.toThrow(KeyStoreError);
  });

  it('chmods an existing insecure file on save', async () => {
    // POSIX-only: Windows cannot enforce mode bits.
    if (IS_WINDOWS) return;
    const path = join(await tempDir(), 'fixme.json');
    await writeFile(path, '{}', { mode: 0o644 });
    const store = new FileKeyStore(path);
    const ring = KeyRing.create();
    ring.rotate();
    await store.save(ring);
    const st = statSync(path);
    expect(st.mode & 0o077).toBe(0);
    expect((await store.load()).size).toBe(1);
  });
});
