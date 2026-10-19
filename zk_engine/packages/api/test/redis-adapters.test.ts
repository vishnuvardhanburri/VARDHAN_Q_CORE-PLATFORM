import { describe, it, expect, beforeEach } from 'vitest';
import Redis from 'ioredis-mock';
import { RedisIdempotencyStore } from '../src/infrastructure/auth/RedisIdempotencyStore.js';
import { RedisNonceStore } from '../src/infrastructure/auth/RedisNonceStore.js';
import { RedisJobStore } from '../src/infrastructure/queue/RedisJobStore.js';
import { createJob } from '../src/domain/job.js';

describe('Redis Adapters', () => {
  let redis: import('ioredis').Redis;

  beforeEach(async () => {
    // Fresh mock instance per test
    redis = new Redis();
    await redis.flushall();
  });

  describe('RedisIdempotencyStore', () => {
    it('stores and retrieves records', async () => {
      const store = new RedisIdempotencyStore(redis);
      const record = { payloadHash: 'hash1', result: { ok: true }, at: '2026-08-12T00:00:00Z' };
      
      await store.put('key1', record, 10000);
      const retrieved = await store.get('key1');
      expect(retrieved).toEqual(record);
    });

    it('returns null for missing keys', async () => {
      const store = new RedisIdempotencyStore(redis);
      expect(await store.get('missing')).toBeNull();
    });
  });

  describe('RedisNonceStore', () => {
    it('consumes a nonce and rejects replays', async () => {
      const store = new RedisNonceStore(redis);
      const now = Date.now();
      
      const first = await store.consume('client1', 'nonce1', 10000, now);
      expect(first).toBe(true);
      
      const second = await store.consume('client1', 'nonce1', 10000, now + 100);
      expect(second).toBe(false);
    });

    it('allows the same nonce for different clients', async () => {
      const store = new RedisNonceStore(redis);
      const now = Date.now();
      
      const first = await store.consume('client1', 'nonce1', 10000, now);
      expect(first).toBe(true);
      
      const second = await store.consume('client2', 'nonce1', 10000, now);
      expect(second).toBe(true);
    });
  });

  describe('RedisJobStore', () => {
    it('stores and retrieves jobs', async () => {
      const store = new RedisJobStore(redis);
      const job = createJob({
        tenantId: 'tenant1',
        creatorId: 'creator1',
        circuitId: 'circuit1',
        circuitVersion: 'v1',
      });

      await store.put(job);
      const retrieved = await store.get(job.jobId);
      expect(retrieved?.jobId).toBe(job.jobId);
      expect(retrieved?.tenantId).toBe(job.tenantId);
    });

    it('finds jobs by idempotency key', async () => {
      const store = new RedisJobStore(redis);
      const job = createJob({
        tenantId: 'tenant1',
        creatorId: 'creator1',
        circuitId: 'circuit1',
        circuitVersion: 'v1',
        idempotencyKeyHash: 'idemhash1',
      });

      await store.put(job);
      const retrieved = await store.findByIdempotencyKey('idemhash1', 'tenant1');
      expect(retrieved?.jobId).toBe(job.jobId);

      const missing = await store.findByIdempotencyKey('idemhash1', 'tenant2');
      expect(missing).toBeNull();
    });

    it('lists jobs for a tenant in descending creation order', async () => {
      const store = new RedisJobStore(redis);
      
      const job1 = createJob({ tenantId: 'tenant1', creatorId: 'c1', circuitId: 'c1', circuitVersion: 'v1' });
      job1.createdAt = '2026-08-12T00:00:01Z';
      
      const job2 = createJob({ tenantId: 'tenant1', creatorId: 'c1', circuitId: 'c1', circuitVersion: 'v1' });
      job2.createdAt = '2026-08-12T00:00:02Z';
      
      const jobOther = createJob({ tenantId: 'tenantOther', creatorId: 'c1', circuitId: 'c1', circuitVersion: 'v1' });

      await store.put(job1);
      await store.put(job2);
      await store.put(jobOther);

      const list = await store.list('tenant1');
      expect(list.length).toBe(2);
      // Most recent first
      expect(list[0]!.jobId).toBe(job2.jobId);
      expect(list[1]!.jobId).toBe(job1.jobId);
    });
  });
});
