import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileStore } from '../src/env.js';

let dir: string;
let store: ProfileStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zk-env-'));
  store = new ProfileStore(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SECRET = 's'.repeat(40);

describe('ProfileStore', () => {
  it('create → save → load round-trip', async () => {
    await store.save('dev', { apiUrl: 'http://127.0.0.1:8080', clientId: 'cli', secret: SECRET }, { create: true });
    const p = await store.load('dev');
    expect(p.apiUrl).toBe('http://127.0.0.1:8080');
    expect(p.secret).toBe(SECRET);
    expect(await store.exists('dev')).toBe(true);
  });

  it('refuses duplicated create', async () => {
    await store.save('dev', { apiUrl: 'http://a', clientId: 'c', secret: SECRET }, { create: true });
    await expect(
      store.save('dev', { apiUrl: 'http://b', clientId: 'd', secret: SECRET }, { create: true }),
    ).rejects.toThrow(/already exists/);
  });

  // Windows NTFS does not enforce POSIX permission bits — skip on Windows
  const itUnix = process.platform === 'win32' ? it.skip : it;
  itUnix('refuses file with group/other permissions (0600 enforcement)', async () => {
    const p = join(dir, 'dev.json');
    await writeFile(p, JSON.stringify({ apiUrl: 'http://a', clientId: 'c', secret: SECRET }), { mode: 0o644 });
    await store.load('dev').catch(() => {});
    // file on disk respects what we wrote; the store must refuse the read
    await expect(store.load('dev')).rejects.toThrow(/group\/other accessible/);
  });

  it('secret never appears in redacted view', async () => {
    await store.save('prod', { apiUrl: 'https://zk.example', clientId: 'gate', secret: SECRET }, { create: true });
    const redacted = await store.redacted('prod');
    expect(JSON.stringify(redacted)).not.toContain(SECRET);
    expect(redacted.secret).toContain('<redacted');

    const raw = await readFile(join(dir, 'prod.json'), 'utf8');
    expect(raw).toContain(SECRET); // stored on disk for real use
    expect(JSON.stringify(redacted)).not.toContain(SECRET);
  });

  // Windows NTFS does not honour chmod 0600 — skip on Windows
  itUnix('file mode is 0600 after create', async () => {
    await store.save('dev', { apiUrl: 'http://a', clientId: 'c', secret: SECRET }, { create: true });
    const { stat } = await import('node:fs/promises');
    const st = await stat(join(dir, 'dev.json'));
    expect(st.mode & 0o777).toBe(0o600);
  });

  it('round-trips registryProxy optional fields', async () => {
    await store.save('dev', { apiUrl: 'http://a', clientId: 'c', secret: SECRET }, { create: true });
    await store.save('dev', { registryProxy: '0x' + 'ab'.repeat(20) });
    const p = await store.load('dev');
    expect(p.registryProxy).toBe('0x' + 'ab'.repeat(20));
  });

  it('load of missing env throws a clear error', async () => {
    await expect(store.load('nope')).rejects.toThrow();
  });
});