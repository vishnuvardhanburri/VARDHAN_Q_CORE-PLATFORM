/**
 * Idempotency policy (§7): client-supplied Idempotency-Key deduplicated via a
 * hashed key + payload fingerprint. Key hashes only — never raw keys stored.
 */

import type { IdempotencyRecord } from '../domain/entities.js';
import { DomainError } from '../domain/errors.js';
import type { IdempotencyStorePort } from '../domain/ports.js';
import { canonicalJson, sha256Hex } from './auth.js';

export class IdempotencyPolicy {
  /** Per-key in-flight serialization (single-process TOCTOU guard). */
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly storePort: IdempotencyStorePort,
    private readonly ttlMs: number,
  ) {}

  keyHash(key: string): string {
    return sha256Hex(key);
  }

  payloadHash(payload: unknown): string {
    return sha256Hex(canonicalJson(payload));
  }

  /** Serializes `fn` per key — replay/register/store become a critical section. */
  async exclusive<T>(keyHash: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.inflight.get(keyHash) ?? Promise.resolve();
    const run = prior.then(fn, fn).finally(() => {
      if (this.inflight.get(keyHash) === run) this.inflight.delete(keyHash);
    });
    this.inflight.set(keyHash, run);
    return run;
  }

  /** Returns the stored record on a matching replay; throws 409 on mismatch. */
  async replay(keyHash: string, payloadHash: string): Promise<IdempotencyRecord | null> {
    const existing = await this.storePort.get(keyHash);
    if (!existing) return null;
    if (existing.payloadHash !== payloadHash) {
      throw new DomainError('STATE-CONFLICT', { detail: 'Idempotency-Key was already used with a different payload' });
    }
    return existing;
  }

  async store(keyHash: string, payloadHash: string, result: unknown): Promise<void> {
    await this.storePort.put(
      keyHash,
      { payloadHash, result, at: new Date().toISOString() },
      this.ttlMs,
    );
  }
}