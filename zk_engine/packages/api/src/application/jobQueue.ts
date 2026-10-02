/**
 * Async proof job queue (Phase 3).
 *
 * Implements a bounded, tenant-aware, idempotent async job queue for
 * CPU-intensive proof operations. Replaces synchronous HTTP timeouts with
 * a proper async model.
 *
 * Design principles:
 * - Per-tenant concurrency limits: prevents noisy-neighbour starvation
 * - Global worker pool: bounded resource consumption
 * - Idempotency: duplicate submissions return the existing job
 * - Exponential backoff + jitter: transient failure recovery
 * - Fail-closed: SECURITY_* categories are never auto-retried
 * - Dead letter: exhausted jobs move to PERMANENT_FAILURE, never silently drop
 *
 * Note: This is a single-process in-memory implementation. For multi-process
 * deployments, replace the InMemoryJobStore port adapter with a Redis/DB-backed
 * implementation without changing this queue logic.
 */

import {
  createJob,
  isValidTransition,
  AUTO_RETRYABLE,
  FAIL_CLOSED,
  MAX_RETRY_ATTEMPTS,
  type ErrorCategory,
  type JobStatus,
  type ProofJob,
} from '../domain/job.js';

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  /** Base delay in milliseconds for the first retry. */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (caps exponential growth). */
  maxDelayMs: number;
  /** Jitter fraction 0..1 applied to the delay. */
  jitterFactor: number;
  /** Maximum number of retry attempts before permanent failure. */
  maxAttempts: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitterFactor: 0.3,
  maxAttempts: MAX_RETRY_ATTEMPTS,
};

/** Compute the backoff delay (ms) for `attempt` (0-indexed). */
export function backoffDelayMs(attempt: number, policy: RetryPolicy): number {
  const base = Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs);
  const jitter = base * policy.jitterFactor * Math.random();
  return Math.round(base + jitter);
}

// ---------------------------------------------------------------------------
// Queue configuration
// ---------------------------------------------------------------------------

export interface JobQueueConfig {
  /** Maximum concurrent workers across all tenants. */
  maxGlobalWorkers: number;
  /** Maximum concurrent workers per tenant. */
  maxWorkerPerTenant: number;
  /** Retry policy for transient failures. */
  retryPolicy: RetryPolicy;
}

export const DEFAULT_QUEUE_CONFIG: JobQueueConfig = {
  maxGlobalWorkers: 4,
  maxWorkerPerTenant: 2,
  retryPolicy: DEFAULT_RETRY_POLICY,
};

// ---------------------------------------------------------------------------
// Port: job store (replaceable with DB/Redis adapter)
// ---------------------------------------------------------------------------

export interface JobStorePort {
  get(jobId: string): Promise<ProofJob | null>;
  put(job: ProofJob): Promise<void>;
  findByIdempotencyKey(keyHash: string, tenantId: string): Promise<ProofJob | null>;
  list(tenantId: string, limit?: number): Promise<ProofJob[]>;
}

// ---------------------------------------------------------------------------
// In-memory job store (single-process)
// ---------------------------------------------------------------------------

export class InMemoryJobStore implements JobStorePort {
  private readonly jobs = new Map<string, ProofJob>();

  async get(jobId: string): Promise<ProofJob | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async put(job: ProofJob): Promise<void> {
    this.jobs.set(job.jobId, { ...job });
  }

  async findByIdempotencyKey(keyHash: string, tenantId: string): Promise<ProofJob | null> {
    for (const job of this.jobs.values()) {
      if (job.idempotencyKeyHash === keyHash && job.tenantId === tenantId) return job;
    }
    return null;
  }

  async list(tenantId: string, limit = 50): Promise<ProofJob[]> {
    const results: ProofJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.tenantId === tenantId) results.push({ ...job });
      if (results.length >= limit) break;
    }
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get size(): number {
    return this.jobs.size;
  }
}

// ---------------------------------------------------------------------------
// Worker: job execution wrapper
// ---------------------------------------------------------------------------

export type JobWorker<T> = (job: ProofJob) => Promise<T>;

export interface JobQueueError extends Error {
  category: ErrorCategory;
}

function isJobQueueError(err: unknown): err is JobQueueError {
  return err instanceof Error && 'category' in err;
}

// ---------------------------------------------------------------------------
// Main queue class
// ---------------------------------------------------------------------------

export class JobQueue {
  private activeWorkers = 0;
  private readonly perTenantWorkers = new Map<string, number>();
  // In-flight serialization for idempotency key dedup
  private readonly inflight = new Map<string, Promise<ProofJob>>();

  constructor(
    private readonly store: JobStorePort,
    private readonly config: JobQueueConfig = DEFAULT_QUEUE_CONFIG,
  ) {}

  /**
   * Submit a job to the queue.
   *
   * Returns an existing job if the same idempotencyKeyHash was already
   * submitted by the same tenant. Otherwise creates a new QUEUED job.
   */
  async enqueue(opts: {
    tenantId: string;
    creatorId: string;
    circuitId: string;
    circuitVersion: string;
    idempotencyKeyHash?: string;
  }): Promise<ProofJob> {
    // Idempotency: deduplicate by key hash + tenantId
    if (opts.idempotencyKeyHash) {
      const dedupKey = `${opts.tenantId}:${opts.idempotencyKeyHash}`;
      const prior = this.inflight.get(dedupKey) ?? Promise.resolve(null);
      const run: Promise<ProofJob> = prior.then(async () => {
        const existing = await this.store.findByIdempotencyKey(opts.idempotencyKeyHash!, opts.tenantId);
        if (existing) return existing;
        const job = createJob(opts);
        await this.store.put(job);
        return job;
      }).finally(() => {
        if (this.inflight.get(dedupKey) === run) this.inflight.delete(dedupKey);
      });
      this.inflight.set(dedupKey, run);
      return run;
    }

    const job = createJob(opts);
    await this.store.put(job);
    return job;
  }

  /**
   * Dispatch a job to a worker function with retry logic.
   *
   * The job must already be in the store (created via enqueue). This method
   * manages the QUEUED → RUNNING → COMPLETED/FAILED transitions and applies
   * the retry policy for transient errors.
   */
  async dispatch<T>(jobId: string, worker: JobWorker<T>): Promise<{ job: ProofJob; result?: T }> {
    const job = await this.store.get(jobId);
    if (!job) throw new Error(`job ${jobId} not found`);

    // Check global and per-tenant worker limits
    if (this.activeWorkers >= this.config.maxGlobalWorkers) {
      return { job }; // caller should re-queue later
    }
    const tenantWorkers = this.perTenantWorkers.get(job.tenantId) ?? 0;
    if (tenantWorkers >= this.config.maxWorkerPerTenant) {
      return { job }; // per-tenant limit exceeded
    }

    if (!isValidTransition(job.status, 'RUNNING')) {
      return { job }; // already running or terminal
    }

    // Transition to RUNNING
    const now = new Date().toISOString();
    const running: ProofJob = {
      ...job,
      status: 'RUNNING',
      updatedAt: now,
      startedAt: job.startedAt ?? now,
      attemptCount: job.attemptCount + 1,
    };
    await this.store.put(running);

    this.activeWorkers++;
    this.perTenantWorkers.set(job.tenantId, tenantWorkers + 1);

    try {
      const result = await worker(running);
      const completed: ProofJob = {
        ...running,
        status: 'COMPLETED',
        updatedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      };
      await this.store.put(completed);
      return { job: completed, result };
    } catch (err) {
      const category = isJobQueueError(err)
        ? err.category
        : 'PERMANENT_FAILURE' as ErrorCategory;

      const isRetryable = AUTO_RETRYABLE.has(category)
        && !FAIL_CLOSED.has(category)
        && running.attemptCount < this.config.retryPolicy.maxAttempts;

      const finalStatus: JobStatus = isRetryable ? 'FAILED' : 'FAILED';
      const finalCategory: ErrorCategory = isRetryable
        ? category
        : (FAIL_CLOSED.has(category) ? category : 'PERMANENT_FAILURE');

      const failed: ProofJob = {
        ...running,
        status: finalStatus,
        updatedAt: new Date().toISOString(),
        ...(isRetryable ? {} : { finishedAt: new Date().toISOString() }),
        errorCategory: finalCategory,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
      await this.store.put(failed);

      if (isRetryable) {
        // Re-queue with backoff (caller is responsible for scheduling)
        const delay = backoffDelayMs(running.attemptCount - 1, this.config.retryPolicy);
        await new Promise((resolve) => setTimeout(resolve, delay));
        const requeued: ProofJob = { ...failed, status: 'QUEUED', updatedAt: new Date().toISOString() };
        await this.store.put(requeued);
        return { job: requeued };
      }

      return { job: failed };
    } finally {
      this.activeWorkers--;
      const current = this.perTenantWorkers.get(job.tenantId) ?? 1;
      this.perTenantWorkers.set(job.tenantId, Math.max(0, current - 1));
    }
  }

  /** Get a job by ID. */
  async get(jobId: string): Promise<ProofJob | null> {
    return this.store.get(jobId);
  }

  /** List jobs for a tenant. */
  async list(tenantId: string, limit?: number): Promise<ProofJob[]> {
    return this.store.list(tenantId, limit);
  }

  /** Current number of active workers. */
  get workerCount(): number {
    return this.activeWorkers;
  }
}
