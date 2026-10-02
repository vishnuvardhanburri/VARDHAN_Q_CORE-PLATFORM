/**
 * FileKeyStore — persistent keyring storage (ADR-0009).
 *
 * - Saves with 0600 permissions via atomic write (tmp + rename).
 * - `assertSecurePermissions` fails loudly when the file is group/other
 *   readable or writable (private keys live in the file).
 * - Loads validate the JSON strictly (`KeyRing.fromJSON`).
 *
 * Windows note: POSIX `chmod` and `stat.mode` permission bits are not
 * honoured by Windows. Permission checks are silently skipped on win32;
 * callers should rely on NTFS ACLs or an encrypted credential store instead.
 */

import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { KeyRing } from './keyring.js';
import { KeyStoreError } from './errors.js';

const IS_WINDOWS = process.platform === 'win32';

export class FileKeyStore {
  constructor(readonly path: string) {}

  /** Load the ring; returns an empty ring when the file does not exist. */
  async load(): Promise<KeyRing> {
    try {
      const raw = await readFile(this.path, 'utf8');
      await this.assertSecurePermissions();
      return KeyRing.fromJSON(raw);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return KeyRing.create();
      }
      if (err instanceof KeyStoreError) throw err;
      throw new KeyStoreError(`cannot load keyring: ${(err as Error).message}`);
    }
  }

  /** Save the ring atomically with 0600 permissions. */
  async save(ring: KeyRing): Promise<void> {
    const dir = dirname(this.path);
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    try {
      await writeFile(tmp, JSON.stringify(ring.toJSON(), null, 2) + '\n', { mode: 0o600 });
      await rename(tmp, this.path);
      // chmod is a no-op on Windows; permissions are enforced via NTFS ACLs.
      if (!IS_WINDOWS) {
        await chmod(this.path, 0o600);
      }
    } catch (err) {
      throw new KeyStoreError(`cannot save keyring: ${(err as Error).message}`);
    }
  }

  /** Ensure the keyring file is not group/other accessible (throws).
   *  No-op on Windows where POSIX permission bits are not enforced. */
  async assertSecurePermissions(): Promise<void> {
    if (IS_WINDOWS) return;
    let st;
    try {
      st = await stat(this.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new KeyStoreError(`cannot stat keyring: ${(err as Error).message}`);
    }
    if ((st.mode & 0o077) !== 0) {
      throw new KeyStoreError(
        `keyring file ${this.path} is group/other accessible (mode ${(st.mode & 0o777).toString(8)}); ` +
          'chmod 600 it — it contains private keys',
      );
    }
  }
}
