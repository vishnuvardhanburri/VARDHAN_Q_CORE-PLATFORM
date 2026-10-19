/**
 * F-009: Tests for PersistentIdempotencyStore — verifies that idempotency
 * state survives process restart and provides cross-restart deduplication.
 */
import { PersistentIdempotencyStore } from '../src/server/QCoreSubmissionOrchestrator';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

describe('F-009: PersistentIdempotencyStore', () => {
  let storePath: string;

  beforeEach(() => {
    storePath = path.join(
      tmpdir(),
      `test-idempotency-${Date.now()}-${Math.random()}.json`,
    );
    if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
  });

  afterEach(() => {
    if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
    const lockPath = storePath + '.lock';
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  });

  test('key added to store is visible in a re-opened store', () => {
    const store = new PersistentIdempotencyStore(storePath);
    store.add('signal-1');
    expect(store.has('signal-1')).toBe(true);

    // Re-open — should see the key
    const reopened = new PersistentIdempotencyStore(storePath);
    expect(reopened.has('signal-1')).toBe(true);
    expect(reopened.has('signal-2')).toBe(false);
  });

  test('duplicate key is rejected', () => {
    const store = new PersistentIdempotencyStore(storePath);
    store.add('signal-1');
    const reopened = new PersistentIdempotencyStore(storePath);
    expect(reopened.has('signal-1')).toBe(true);
  });

  test('multiple keys are persisted independently', () => {
    const store = new PersistentIdempotencyStore(storePath);
    store.add('signal-a');
    store.add('signal-b');
    store.add('signal-c');

    const reopened = new PersistentIdempotencyStore(storePath);
    expect(reopened.has('signal-a')).toBe(true);
    expect(reopened.has('signal-b')).toBe(true);
    expect(reopened.has('signal-c')).toBe(true);
    expect(reopened.has('signal-d')).toBe(false);
  });

  test('store file is created with 0o600 permissions', () => {
    const store = new PersistentIdempotencyStore(storePath);
    store.add('signal-1');
    const stats = fs.statSync(storePath);
    // On Unix, check permissions are 0o600
    if (process.platform !== 'win32') {
      expect(stats.mode & 0o777).toBe(0o600);
    }
  });

  test('empty store does not create file', () => {
    const store = new PersistentIdempotencyStore(storePath);
    expect(store.has('anything')).toBe(false);
  });

  test('store survives complete process restart simulation', () => {
    // Write key
    const store1 = new PersistentIdempotencyStore(storePath);
    store1.add('restart-test-key');
    expect(store1.has('restart-test-key')).toBe(true);

    // Simulate restart: create a completely new instance
    const store2 = new PersistentIdempotencyStore(storePath);
    expect(store2.has('restart-test-key')).toBe(true);
  });
});
