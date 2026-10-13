import type { Redis } from 'ioredis';
import type { JobStorePort } from '../../application/jobQueue.js';
import type { ProofJob } from '../../domain/job.js';

export class RedisJobStore implements JobStorePort {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'job:',
    private readonly tenantPrefix = 'tenant_jobs:',
    private readonly idemPrefix = 'idem_job:'
  ) {}

  async get(jobId: string): Promise<ProofJob | null> {
    const data = await this.redis.get(`${this.prefix}${jobId}`);
    if (!data) return null;
    try {
      return JSON.parse(data) as ProofJob;
    } catch {
      return null;
    }
  }

  async put(job: ProofJob): Promise<void> {
    const multi = this.redis.multi();
    const data = JSON.stringify(job);
    
    // 1. Store the job
    multi.set(`${this.prefix}${job.jobId}`, data);
    
    // 2. Add to tenant index (ZSET by createdAt timestamp)
    const score = new Date(job.createdAt).getTime();
    multi.zadd(`${this.tenantPrefix}${job.tenantId}`, score, job.jobId);
    
    // 3. Add to idempotency index if present
    if (job.idempotencyKeyHash) {
      multi.set(`${this.idemPrefix}${job.tenantId}:${job.idempotencyKeyHash}`, job.jobId);
    }
    
    await multi.exec();
  }

  async findByIdempotencyKey(keyHash: string, tenantId: string): Promise<ProofJob | null> {
    const jobId = await this.redis.get(`${this.idemPrefix}${tenantId}:${keyHash}`);
    if (!jobId) return null;
    return this.get(jobId);
  }

  async list(tenantId: string, limit = 50): Promise<ProofJob[]> {
    // Get highest scores first (most recent)
    const jobIds = await this.redis.zrevrange(`${this.tenantPrefix}${tenantId}`, 0, limit - 1);
    if (jobIds.length === 0) return [];
    
    const keys = jobIds.map(id => `${this.prefix}${id}`);
    const results = await this.redis.mget(keys);
    
    return results
      .filter((data): data is string => data !== null)
      .map(data => JSON.parse(data) as ProofJob);
  }
}
