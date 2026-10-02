/**
 * Nonce store — single-use nonces per client with TTL, bounded memory
 * (ADR-0005 replay protection).
 */

import type { NonceStorePort } from '../../domain/ports.js';

interface NonceEntry {
  nonce: string;
  expiresAtMs: number;
}

const MAX_ENTRIES = 100_000;

export class NonceStore implements NonceStorePort {
  private readonly byClient = new Map<string, NonceEntry[]>();

  constructor(private readonly clockMs: () => number = Date.now) {}

  async consume(clientId: string, nonce: string, ttlMs: number, nowMs: number): Promise<boolean> {
    let entries = this.byClient.get(clientId);
    if (!entries) {
      entries = [];
      this.byClient.set(clientId, entries);
    }

    // lazy expiry of this client's list
    const live = entries.filter((e) => e.expiresAtMs > nowMs);
    if (live.length !== entries.length) {
      entries = live;
      this.byClient.set(clientId, entries);
    }

    const seen = entries.some((e) => e.nonce === nonce);
    if (seen) return false;

    // bounded per-client cap to prevent memory leaks from millions of nonces
    if (entries.length >= MAX_ENTRIES) {
      entries.shift(); // remove oldest
    }

    entries.push({ nonce, expiresAtMs: nowMs + ttlMs });
    this.prune(nowMs);
    return true;
  }

  private prune(nowMs: number): void {
    if (this.byClient.size <= MAX_ENTRIES) return;
    for (const [clientId, entries] of this.byClient) {
      this.byClient.set(
        clientId,
        entries.filter((e) => e.expiresAtMs > nowMs),
      );
    }
  }
}