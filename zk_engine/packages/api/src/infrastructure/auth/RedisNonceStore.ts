import type { Redis } from 'ioredis';
import type { NonceStorePort } from '../../domain/ports.js';

export class RedisNonceStore implements NonceStorePort {
  constructor(private readonly redis: Redis, private readonly prefix = 'nonce:') {}

  async consume(clientId: string, nonce: string, ttlMs: number, _nowMs: number): Promise<boolean> {
    const key = `${this.prefix}${clientId}:${nonce}`;
    // SET NX PX only sets the key if it does not already exist
    const result = await this.redis.set(key, '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  }
}
