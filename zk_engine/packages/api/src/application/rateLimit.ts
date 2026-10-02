/**
 * Rate limiting policy (§10): token bucket per clientId, with a stricter cap
 * for CPU-bound proof verification (T8).
 */

export interface RateLimitConfig {
  capacity: number;
  refillPerWindow: number;
  windowMs: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class TokenBucket {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly cfg: RateLimitConfig) {
    if (cfg.capacity < 1 || cfg.refillPerWindow < 1 || cfg.windowMs < 1) {
      throw new RangeError('rate-limit params must be >= 1');
    }
  }

  private refill(bucket: Bucket, nowMs: number): void {
    const elapsed = nowMs - bucket.lastRefill;
    if (elapsed <= 0) return;
    const tokens = bucket.tokens + (elapsed / this.cfg.windowMs) * this.cfg.refillPerWindow;
    bucket.tokens = Math.min(this.cfg.capacity, tokens);
    bucket.lastRefill = nowMs;
  }

  /** Returns remaining tokens (>= 0 when allowed, negative when blocked). */
  tryConsume(clientId: string, cost = 1, nowMs = Date.now()): number {
    let bucket = this.buckets.get(clientId);
    if (!bucket) {
      bucket = { tokens: this.cfg.capacity, lastRefill: nowMs };
      this.buckets.set(clientId, bucket);
      this.prune(nowMs);
    }
    this.refill(bucket, nowMs);
    if (bucket.tokens < cost) return bucket.tokens - cost;
    bucket.tokens -= cost;
    return bucket.tokens;
  }

  /** Time (ms) until `cost` tokens are available again. */
  retryAfterMs(clientId: string, cost: number): number {
    const bucket = this.buckets.get(clientId);
    if (!bucket) return 0;
    const deficit = cost - bucket.tokens;
    if (deficit <= 0) return 0;
    return Math.ceil((deficit / this.cfg.refillPerWindow) * this.cfg.windowMs);
  }

  private prune(nowMs: number): void {
    if (this.buckets.size <= 10_000) return;
    for (const [id, bucket] of this.buckets) {
      if (nowMs - bucket.lastRefill > this.cfg.windowMs * 2) this.buckets.delete(id);
    }
  }
}

/** Convenience facade combining the per-key bucket + shared verify bucket. */
export class RateLimiter {
  constructor(
    private readonly general: TokenBucket,
    private readonly verify: TokenBucket | null,
  ) {}

  check(clientId: string, verifyCost = false, nowMs = Date.now()): { allowed: boolean; retryAfterMs: number } {
    const bucket = verifyCost && this.verify ? this.verify : this.general;
    const remaining = bucket.tryConsume(clientId, 1, nowMs);
    if (remaining >= 0) return { allowed: true, retryAfterMs: 0 };
    return { allowed: false, retryAfterMs: bucket.retryAfterMs(clientId, 1) };
  }
}