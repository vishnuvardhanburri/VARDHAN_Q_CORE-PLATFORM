/**
 * Job queue tests (Phase 3): idempotency, tenant isolation, retry policy,
 * fail-closed categories, and concurrent deduplication.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  JobQueue,
  InMemoryJobStore,
  DEFAULT_QUEUE_CONFIG,
  type JobQueueError,
} from '../src/application/jobQueue.js';
import { MAX_RETRY_ATTEMPTS } from '../src/domain/job.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueue() {
  const store = new InMemoryJobStore();
  const queue = new JobQueue(store, {
    ...DEFAULT_QUEUE_CONFIG,
    maxGlobalWorkers: 10,
    maxWorkerPerTenant: 5,
    retryPolicy: {
      baseDelayMs: 1,
      maxDelayMs: 10,
      jitterFactor: 0,
      maxAttempts: MAX_RETRY_ATTEMPTS,
    },
  });
  return { queue, store };
}

function categorizedError(category: string, message: string): Error & JobQueueError {
  const err = new Error(message) as Error & JobQueueError;
  err.category = category as JobQueueError['category'];
  return err;
}

// ---------------------------------------------------------------------------
// Enqueue: basic
// ---------------------------------------------------------------------------

describe('JobQueue.enqueue', () => {
  it('creates a job in QUEUED state', async () => {
    const { queue } = makeQueue();
    const job = await queue.enqueue({
      tenantId: 'tenant-a',
      creatorId: 'client-1',
      circuitId: 'poseidon-preimage',
      circuitVersion: '1.0.0',
    });
    expect(job.status).toBe('QUEUED');
    expect(job.tenantId).toBe('tenant-a');
    expect(job.circuitId).toBe('poseidon-preimage');
    expect(job.attemptCount).toBe(0);
    expect(job.jobId).toMatch(/^job_/);
  });

  it('deduplicates by idempotencyKeyHash within same tenant', async () => {
    const { queue } = makeQueue();
    const opts = {
      tenantId: 'tenant-a',
      creatorId: 'client-1',
      circuitId: 'poseidon-preimage',
      circuitVersion: '1.0.0',
      idempotencyKeyHash: 'abc123',
    };
    const j1 = await queue.enqueue(opts);
    const j2 = await queue.enqueue(opts);
    expect(j2.jobId).toBe(j1.jobId);
  });

  it('does NOT deduplicate across tenants with same idempotency key', async () => {
    const { queue } = makeQueue();
    const j1 = await queue.enqueue({
      tenantId: 'tenant-a', creatorId: 'c1', circuitId: 'c', circuitVersion: '1', idempotencyKeyHash: 'shared',
    });
    const j2 = await queue.enqueue({
      tenantId: 'tenant-b', creatorId: 'c1', circuitId: 'c', circuitVersion: '1', idempotencyKeyHash: 'shared',
    });
    expect(j1.jobId).not.toBe(j2.jobId);
  });

  it('deduplicates concurrent submissions with same idempotency key', async () => {
    const { queue } = makeQueue();
    const opts = {
      tenantId: 'tenant-a', creatorId: 'c1', circuitId: 'c', circuitVersion: '1', idempotencyKeyHash: 'race',
    };
    const [j1, j2, j3] = await Promise.all([
      queue.enqueue(opts),
      queue.enqueue(opts),
      queue.enqueue(opts),
    ]);
    expect(j1.jobId).toBe(j2.jobId);
    expect(j2.jobId).toBe(j3.jobId);
  });
});

// ---------------------------------------------------------------------------
// Dispatch: success
// ---------------------------------------------------------------------------

describe('JobQueue.dispatch (success)', () => {
  it('transitions QUEUED → RUNNING → COMPLETED', async () => {
    const { queue } = makeQueue();
    const job = await queue.enqueue({ tenantId: 'tenant-a', creatorId: 'c1', circuitId: 'c', circuitVersion: '1' });
    const worker = vi.fn().mockResolvedValue({ ok: true });
    const { job: done, result } = await queue.dispatch(job.jobId, worker);
    expect(done.status).toBe('COMPLETED');
    expect(done.attemptCount).toBe(1);
    expect(result).toEqual({ ok: true });
    expect(worker).toHaveBeenCalledOnce();
  });

  it('sets startedAt and finishedAt on completion', async () => {
    const { queue } = makeQueue();
    const job = await queue.enqueue({ tenantId: 'tenant-a', creatorId: 'c1', circuitId: 'c', circuitVersion: '1' });
    const { job: done } = await queue.dispatch(job.jobId, async () => 42);
    expect(done.startedAt).toBeTruthy();
    expect(done.finishedAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Dispatch: error categories
// ---------------------------------------------------------------------------

describe('JobQueue.dispatch (error categories)', () => {
  it('re-queues on TRANSIENT error below max attempts', async () => {
    const { queue } = makeQueue();
    const job = await queue.enqueue({ tenantId: 'tenant-a', creatorId: 'c1', circuitId: 'c', circuitVersion: '1' });
    const { job: result } = await queue.dispatch(job.jobId, async () => {
      throw categorizedError('TRANSIENT', 'RPC timeout');
    });
    expect(result.status).toBe('QUEUED');
    expect(result.errorCategory).toBe('TRANSIENT');
    expect(result.attemptCount).toBe(1);
  });

  it('permanently fails on SECURITY_ERROR (fail-closed)', async () => {
    const { queue } = makeQueue();
    const job = await queue.enqueue({ tenantId: 'tenant-a', creatorId: 'c1', circuitId: 'c', circuitVersion: '1' });
    const { job: result } = await queue.dispatch(job.jobId, async () => {
      throw categorizedError('SECURITY_ERROR', 'unauthorized circuit config change');
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorCategory).toBe('SECURITY_ERROR');
    expect(result.finishedAt).toBeTruthy();
  });

  it('permanently fails on CRYPTOGRAPHIC_ERROR (fail-closed)', async () => {
    const { queue } = makeQueue();
    const job = await queue.enqueue({ tenantId: 'tenant-a', creatorId: 'c1', circuitId: 'c', circuitVersion: '1' });
    const { job: result } = await queue.dispatch(job.jobId, async () => {
      throw categorizedError('CRYPTOGRAPHIC_ERROR', 'vk mismatch');
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorCategory).toBe('CRYPTOGRAPHIC_ERROR');
  });

  it('permanently fails on SECURITY_BLOCKED (fail-closed, no retry)', async () => {
    const { queue } = makeQueue();
    const job = await queue.enqueue({ tenantId: 'tenant-a', creatorId: 'c1', circuitId: 'c', circuitVersion: '1' });
    const { job: result } = await queue.dispatch(job.jobId, async () => {
      throw categorizedError('SECURITY_BLOCKED', 'gatekeeper blocked');
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorCategory).toBe('SECURITY_BLOCKED');
    expect(result.finishedAt).toBeTruthy();
  });

  it('permanently fails on VALIDATION_ERROR (no retry)', async () => {
    const { queue } = makeQueue();
    const job = await queue.enqueue({ tenantId: 'tenant-a', creatorId: 'c1', circuitId: 'c', circuitVersion: '1' });
    const { job: result } = await queue.dispatch(job.jobId, async () => {
      throw categorizedError('VALIDATION_ERROR', 'bad inputs');
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorCategory).toBe('PERMANENT_FAILURE');
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe('Tenant isolation', () => {
  it('list() returns only jobs for the requested tenant', async () => {
    const { queue } = makeQueue();
    await queue.enqueue({ tenantId: 'tenant-a', creatorId: 'c1', circuitId: 'c', circuitVersion: '1' });
    await queue.enqueue({ tenantId: 'tenant-a', creatorId: 'c1', circuitId: 'c', circuitVersion: '1' });
    await queue.enqueue({ tenantId: 'tenant-b', creatorId: 'c2', circuitId: 'c', circuitVersion: '1' });
    const aJobs = await queue.list('tenant-a');
    const bJobs = await queue.list('tenant-b');
    expect(aJobs).toHaveLength(2);
    expect(aJobs.every((j) => j.tenantId === 'tenant-a')).toBe(true);
    expect(bJobs).toHaveLength(1);
    expect(bJobs[0]?.tenantId).toBe('tenant-b');
  });
});

// ---------------------------------------------------------------------------
// Worker limits
// ---------------------------------------------------------------------------

describe('Worker limits', () => {
  it('worker count increments and decrements correctly', async () => {
    const { queue } = makeQueue();
    expect(queue.workerCount).toBe(0);
    const job = await queue.enqueue({ tenantId: 'tenant-a', creatorId: 'c1', circuitId: 'c', circuitVersion: '1' });
    let sawCount = 0;
    await queue.dispatch(job.jobId, async () => {
      sawCount = queue.workerCount;
    });
    expect(sawCount).toBe(1);
    expect(queue.workerCount).toBe(0);
  });
});
