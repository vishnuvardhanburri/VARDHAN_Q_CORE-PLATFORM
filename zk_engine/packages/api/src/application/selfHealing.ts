/**
 * Self-healing policy (Phase 4).
 *
 * Defines what the system auto-recovers from vs. what fails closed and
 * requires human intervention. This is the single source of truth for
 * retry decisions across the entire API layer.
 *
 * === ABSOLUTE NON-NEGOTIABLE: FAIL-CLOSED ITEMS ===
 * The following are NEVER automatically retried, NEVER auto-recovered,
 * and ALWAYS require explicit human review before re-submission:
 *
 * - ZK circuit configuration changes
 * - Verification key (vk) changes
 * - Proving parameters / trusted setup changes
 * - Gatekeeper rules and security gates
 * - Contract configuration changes
 * - Scorecard and security workflow configuration
 * - Any SECURITY_BLOCKED, SECURITY_ERROR, or CRYPTOGRAPHIC_ERROR
 *
 * === AUTO-RECOVERABLE (bounded) ===
 * - Transient network timeouts (RPC, HTTP)
 * - Cache misses for artifacts
 * - Ephemeral infrastructure unavailability
 * - Temporary rate limiting from downstream services
 *
 * All recovery is bounded: exhausted retries → PERMANENT_FAILURE,
 * never silent discard.
 */

import {
  AUTO_RETRYABLE,
  FAIL_CLOSED,
  type ErrorCategory,
} from '../domain/job.js';
import type { MetricsSinkPort } from '../domain/ports.js';

// ---------------------------------------------------------------------------
// Self-healing configuration
// ---------------------------------------------------------------------------

export interface SelfHealingConfig {
  /** Base delay in milliseconds for the first retry attempt. */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (caps exponential growth). */
  maxDelayMs: number;
  /** Jitter fraction 0..1 applied to the computed delay. */
  jitterFactor: number;
  /** Maximum number of automatic recovery attempts. */
  maxAttempts: number;
}

export const DEFAULT_SELF_HEALING_CONFIG: SelfHealingConfig = {
  baseDelayMs: 250,
  maxDelayMs: 15_000,
  jitterFactor: 0.25,
  maxAttempts: 5,
};

// ---------------------------------------------------------------------------
// Outcome model
// ---------------------------------------------------------------------------

export type RecoveryOutcome<T> =
  | { recovered: true; result: T; attempts: number }
  | { recovered: false; error: Error; category: ErrorCategory; attempts: number };

// ---------------------------------------------------------------------------
// Self-healing executor
// ---------------------------------------------------------------------------

/**
 * Wraps `fn` with a bounded self-healing retry loop.
 *
 * - Only TRANSIENT and RETRYABLE errors trigger a retry.
 * - SECURITY_ERROR, CRYPTOGRAPHIC_ERROR, and SECURITY_BLOCKED fail
 *   immediately and permanently with no retry.
 * - Exhausted retries produce PERMANENT_FAILURE.
 * - All attempts are counted and surfaced in the outcome.
 *
 * @param fn - The operation to attempt. Must throw an error with a
 *   `category: ErrorCategory` property for category-aware retry decisions.
 * @param config - Retry policy configuration.
 * @param metrics - Optional metrics sink for observability.
 * @param operationName - Used for metrics labels.
 */
export async function withSelfHealing<T>(
  fn: () => Promise<T>,
  config: SelfHealingConfig = DEFAULT_SELF_HEALING_CONFIG,
  metrics?: MetricsSinkPort,
  operationName = 'operation',
): Promise<RecoveryOutcome<T>> {
  let attempt = 0;

  while (attempt <= config.maxAttempts) {
    attempt++;
    try {
      const result = await fn();
      if (attempt > 1) {
        metrics?.inc('self_healing_recoveries_total', 1, { operation: operationName });
      }
      return { recovered: true, result, attempts: attempt };
    } catch (err) {
      const category = getCategoryFromError(err);

      // Fail-closed: never retry security or cryptographic failures
      if (FAIL_CLOSED.has(category)) {
        metrics?.inc('self_healing_blocked_total', 1, { operation: operationName, category });
        return {
          recovered: false,
          error: err instanceof Error ? err : new Error(String(err)),
          category,
          attempts: attempt,
        };
      }

      // Non-retryable permanent errors: fail immediately
      if (!AUTO_RETRYABLE.has(category)) {
        metrics?.inc('self_healing_permanent_failures_total', 1, { operation: operationName, category });
        return {
          recovered: false,
          error: err instanceof Error ? err : new Error(String(err)),
          category,
          attempts: attempt,
        };
      }

      // Retryable error: check if we've exhausted attempts
      if (attempt > config.maxAttempts) {
        metrics?.inc('self_healing_exhausted_total', 1, { operation: operationName, category });
        return {
          recovered: false,
          error: err instanceof Error ? err : new Error(String(err)),
          category: 'PERMANENT_FAILURE',
          attempts: attempt,
        };
      }

      // Apply backoff + jitter before retry
      const delay = computeBackoff(attempt - 1, config);
      metrics?.inc('self_healing_retries_total', 1, { operation: operationName, category, attempt: String(attempt) });
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs a return path
  return {
    recovered: false,
    error: new Error('self-healing: unexpected exhaustion'),
    category: 'PERMANENT_FAILURE',
    attempts: attempt,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCategoryFromError(err: unknown): ErrorCategory {
  if (
    err !== null &&
    typeof err === 'object' &&
    'category' in err &&
    typeof (err as { category: unknown }).category === 'string'
  ) {
    return (err as { category: ErrorCategory }).category;
  }
  return 'PERMANENT_FAILURE';
}

function computeBackoff(attempt: number, config: SelfHealingConfig): number {
  const base = Math.min(config.baseDelayMs * 2 ** attempt, config.maxDelayMs);
  const jitter = base * config.jitterFactor * Math.random();
  return Math.round(base + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Error factory helpers
// ---------------------------------------------------------------------------

/**
 * Creates an error with a category tag for use with withSelfHealing.
 *
 * Usage:
 *   throw categorizedError('TRANSIENT', 'RPC timeout after 30s', originalErr);
 */
export function categorizedError(
  category: ErrorCategory,
  message: string,
  cause?: unknown,
): Error & { category: ErrorCategory } {
  const err = new Error(message) as Error & { category: ErrorCategory };
  err.category = category;
  if (cause !== undefined) (err as Error & { cause: unknown }).cause = cause;
  return err;
}
