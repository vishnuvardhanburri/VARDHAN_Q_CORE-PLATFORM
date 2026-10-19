/**
 * CLI environment profiles (M6: `--env dev|pro`).
 *
 * Profiles live in `~/.zk/<env>.json` (default dev). Secrets are stored
 * stricter than the keyring: file is 0600, refuses group/other-readable
 * files on load, and never echoes secret values in errors or `zk env show`.
 */

import { chmod, mkdir, readFile, rename, writeFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ZkEnvProfile {
  /** API base URL (e.g. http://127.0.0.1:8080). */
  apiUrl: string;
  /** API client id (x-zk-key). */
  clientId: string;
  /** API client secret (HMAC key). */
  secret: string;
  /** Optional registry proxy address (0x…) for offline check shortcuts. */
  registryProxy?: string;
  /** Optional chain RPC for `zk status` when no API is configured. */
  rpcUrl?: string;
}

export class ProfileStore {
  constructor(private readonly dir: string = join(homedir(), '.zk')) {}

  private path(env: string): string {
    return join(this.dir, `${env}.json`);
  }

  /** Load a profile; throws when not found. Never returns partial data. */
  async load(env: string): Promise<ZkEnvProfile> {
    const raw = await readFile(this.path(env), 'utf8');
    await assertSecurePermissions(this.path(env));
    const parsed = JSON.parse(raw) as ZkEnvProfile;
    if (typeof parsed.apiUrl !== 'string' || parsed.apiUrl.length === 0) {
      throw new Error(`profile ${env} is missing "apiUrl"`);
    }
    if (typeof parsed.clientId !== 'string' || parsed.clientId.length === 0) {
      throw new Error(`profile ${env} is missing "clientId"`);
    }
    if (typeof parsed.secret !== 'string' || parsed.secret.length < 32) {
      throw new Error(`profile ${env} is missing a secret (>=32 chars)`);
    }
    return parsed;
  }

  async exists(env: string): Promise<boolean> {
    try {
      await stat(this.path(env));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  /** Create or update (via `zk env set`). Atomic write, 0600. */
  async save(env: string, profile: Partial<ZkEnvProfile>, opts: { create?: boolean } = {}): Promise<void> {
    if (opts.create && (await this.exists(env))) {
      throw new Error(`profile ${env} already exists — edit it directly or delete the file first`);
    }
    let next = profile;
    if (!opts.create) {
      try {
        next = { ...(await this.load(env)), ...profile };
      } catch {
        next = profile;
      }
    }
    await mkdir(this.dir, { recursive: true });
    const tmp = join(this.dir, `.${env}.${Date.now()}.tmp`);
    await writeFile(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    await rename(tmp, this.path(env));
    await chmod(this.path(env), 0o600);
  }

  /** Sanitized view for `zk env show` — never includes the secret. */
  async redacted(env: string): Promise<Record<string, string>> {
    const p = await this.load(env);
    return {
      apiUrl: p.apiUrl,
      clientId: p.clientId,
      secret: `<redacted:${p.secret.length} chars>`,
      ...(p.registryProxy ? { registryProxy: p.registryProxy } : {}),
      ...(p.rpcUrl ? { rpcUrl: p.rpcUrl } : {}),
    };
  }
}

async function assertSecurePermissions(path: string): Promise<void> {
  // Windows has no POSIX mode bits: files created with mode 0o600 still stat
  // as 0666 (only the read-only attribute is honored); real access control
  // is ACL-based (the user profile directory). Gate the 0600 requirement to
  // POSIX platforms, where mode semantics are enforceable.
  if (process.platform === 'win32') return;
  const st = await stat(path);
  if ((st.mode & 0o077) !== 0) {
    throw new Error(
      `profile file ${path} is group/other accessible (mode ${(st.mode & 0o777).toString(8)}); ` +
        'chmod 600 it — it contains API credentials',
    );
  }
}