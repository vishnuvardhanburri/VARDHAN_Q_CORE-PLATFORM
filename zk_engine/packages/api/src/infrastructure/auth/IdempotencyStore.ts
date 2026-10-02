/**
 * In-memory idempotency store (§7) — TTL ring of key hashes → results.
 * Single process only; multi-instance deployments should swap in Redis.
 */

import type { IdempotencyRecord } from '../../domain/entities.js';
import type { IdempotencyStorePort } from '../../domain/ports.js';

const DEFAULT_CAP = 10_000;

export class InMemoryIdempotencyStore implements IdempotencyStorePort {
  private readonly entries = new Map<string, { record: IdempotencyRecord; expiresAtMs: number }>();

  constructor(private readonly clockMs: () => number = Date.now, private readonly cap = DEFAULT_CAP) {}

  async get(keyHash: string): Promise<IdempotencyRecord | null> {
    const entry = this.entries.get(keyHash);
    if (!entry) {
      this.prune();
      return null;
    }
    if (entry.expiresAtMs <= this.clockMs()) {
      this.entries.delete(keyHash);
      this.prune();
      return null;
    }
    return entry.record;
  }

  async put(keyHash: string, record: IdempotencyRecord, ttlMs: number): Promise<void> {
    this.entries.set(keyHash, { record, expiresAtMs: this.clockMs() + ttlMs });
    this.prune();
  }

  private prune(): void {
    if (this.entries.size <= this.cap) return;
    const now = this.clockMs();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMs <= now) this.entries.delete(key);
    }
  }
}