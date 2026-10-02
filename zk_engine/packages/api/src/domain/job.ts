/**
 * Job entity model (Phase 3 — async job/queue architecture).
 *
 * A ProofJob tracks the full lifecycle of an async proof operation:
 * queued → running → completed | failed | cancelled.
 *
 * Design principles:
 * - Immutable audit trail: status can only move forward (no reverts)
 * - Bounded retries: only TRANSIENT and RETRYABLE errors auto-retry
 * - Tenant isolation: every job carries tenantId, derived from auth
 * - No proof data stored in the job record: only metadata and status
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Error categories — the retry policy
// ---------------------------------------------------------------------------

/**
 * Error category determines whether and how a job is retried.
 *
 * Only TRANSIENT and RETRYABLE are eligible for automatic retry.
 * All others require human intervention or a new submission.
 */
export type ErrorCategory =
  | 'TRANSIENT'           // auto-retry: network blip, RPC timeout, cache miss
  | 'RETRYABLE'           // auto-retry with backoff: ephemeral infra failure
  | 'VALIDATION_ERROR'    // permanent: bad inputs — never retry
  | 'RESOURCE_ERROR'      // permanent: insufficient quota/capacity
  | 'DEPENDENCY_ERROR'    // permanent: missing circuit, verifier, or artifact
  | 'SECURITY_ERROR'      // fail-closed: human intervention required
  | 'CRYPTOGRAPHIC_ERROR' // fail-closed: ZK proof, vk, or witness failure
  | 'CONFIGURATION_ERROR' // permanent: misconfigured env, wrong keys
  | 'PERMANENT_FAILURE'   // permanent: exhausted retries or unrecoverable
  | 'SECURITY_BLOCKED';   // fail-closed: security gate blocked — no retry ever

/** Categories eligible for automatic retry. */
export const AUTO_RETRYABLE: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>([
  'TRANSIENT',
  'RETRYABLE',
]);

/**
 * Categories that are fail-closed: they are never auto-retried and must be
 * explicitly reviewed and re-submitted by an authorized operator.
 */
export const FAIL_CLOSED: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>([
  'SECURITY_ERROR',
  'CRYPTOGRAPHIC_ERROR',
  'SECURITY_BLOCKED',
]);

// ---------------------------------------------------------------------------
// Job status
// ---------------------------------------------------------------------------

export type JobStatus =
  | 'QUEUED'     // waiting in the queue; not yet started
  | 'RUNNING'    // actively being processed by a worker
  | 'COMPLETED'  // successfully finished
  | 'FAILED'     // failed; may be retried depending on error category
  | 'CANCELLED'; // operator-cancelled; no further processing

// Valid forward-only transitions (no reverts ever):
const VALID_TRANSITIONS: ReadonlyMap<JobStatus, ReadonlySet<JobStatus>> = new Map([
  ['QUEUED',    new Set<JobStatus>(['RUNNING', 'CANCELLED'])],
  ['RUNNING',   new Set<JobStatus>(['COMPLETED', 'FAILED', 'CANCELLED'])],
  ['FAILED',    new Set<JobStatus>(['QUEUED'])], // re-queue on retry
  ['COMPLETED', new Set<JobStatus>()],           // terminal
  ['CANCELLED', new Set<JobStatus>()],           // terminal
]);

export function isValidTransition(from: JobStatus, to: JobStatus): boolean {
  return VALID_TRANSITIONS.get(from)?.has(to) ?? false;
}

// ---------------------------------------------------------------------------
// Job entity
// ---------------------------------------------------------------------------

/** Maximum attempts before a job is moved to PERMANENT_FAILURE. */
export const MAX_RETRY_ATTEMPTS = 5;

export interface ProofJob {
  /** Globally unique job identifier. */
  jobId: string;
  /** Tenant that submitted this job. Always server-derived from auth. */
  tenantId: string;
  /** Client that created the job. */
  creatorId: string;
  /** Circuit to prove/verify. */
  circuitId: string;
  /** Circuit version string. */
  circuitVersion: string;
  /** Current lifecycle status. */
  status: JobStatus;
  /** ISO-8601 timestamp when the job was created. */
  createdAt: string;
  /** ISO-8601 timestamp of the most recent status update. */
  updatedAt: string;
  /** ISO-8601 timestamp when the job started running (first time). */
  startedAt?: string;
  /** ISO-8601 timestamp when the job finished (completed or permanently failed). */
  finishedAt?: string;
  /** Number of times this job has been attempted. */
  attemptCount: number;
  /** Error category of the most recent failure, if any. */
  errorCategory?: ErrorCategory;
  /** Human-readable error message (no secrets, no proof data). */
  errorMessage?: string;
  /** Reference to the output artifact (completed jobs only). */
  artifactRef?: string;
  /** Client-supplied idempotency key (hashed — original never stored). */
  idempotencyKeyHash?: string;
}

/** Create a new ProofJob in QUEUED state. */
export function createJob(opts: {
  tenantId: string;
  creatorId: string;
  circuitId: string;
  circuitVersion: string;
  idempotencyKeyHash?: string;
}): ProofJob {
  const now = new Date().toISOString();
  return {
    jobId: `job_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    tenantId: opts.tenantId,
    creatorId: opts.creatorId,
    circuitId: opts.circuitId,
    circuitVersion: opts.circuitVersion,
    status: 'QUEUED',
    createdAt: now,
    updatedAt: now,
    attemptCount: 0,
    ...(opts.idempotencyKeyHash !== undefined ? { idempotencyKeyHash: opts.idempotencyKeyHash } : {}),
  };
}
