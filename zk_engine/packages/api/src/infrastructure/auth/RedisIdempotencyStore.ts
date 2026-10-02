import type { Redis } from 'ioredis';
import type { IdempotencyRecord } from '../../domain/entities.js';
import type { IdempotencyStorePort } from '../../domain/ports.js';

export class RedisIdempotencyStore implements IdempotencyStorePort {
  constructor(private readonly redis: Redis, private readonly prefix = 'idemp:') {}

  async get(keyHash: string): Promise<IdempotencyRecord | null> {
    const data = await this.redis.get(`${this.prefix}${keyHash}`);
    if (!data) return null;
    try {
      return JSON.parse(data) as IdempotencyRecord;
    } catch {
      return null;
    }
  }

  async put(keyHash: string, record: IdempotencyRecord, ttlMs: number): Promise<void> {
    await this.redis.set(
      `${this.prefix}${keyHash}`,
      JSON.stringify(record),
      'PX',
      ttlMs
    );
  }
}
