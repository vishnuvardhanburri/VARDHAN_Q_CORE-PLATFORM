/**
 * Self-healing policy tests (Phase 4): recovery, fail-closed behavior,
 * exhaustion, and backoff observability.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  withSelfHealing,
  categorizedError,
  type SelfHealingConfig,
} from '../src/application/selfHealing.js';

const FAST_CONFIG: SelfHealingConfig = {
  baseDelayMs: 1,
  maxDelayMs: 10,
  jitterFactor: 0,
  maxAttempts: 3,
};

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

describe('withSelfHealing (success)', () => {
  it('returns result immediately when fn succeeds on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const out = await withSelfHealing(fn, FAST_CONFIG);
    expect(out.recovered).toBe(true);
    if (!out.recovered) throw new Error();
    expect(out.result).toBe('ok');
    expect(out.attempts).toBe(1);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('records metric on recovery (attempt > 1)', async () => {
    let callCount = 0;
    const fn = vi.fn().mockImplementation(async () => {
      if (++callCount < 2) throw categorizedError('TRANSIENT', 'blink');
      return 'recovered';
    });
    const metrics = { inc: vi.fn(), gauge: vi.fn(), duration: vi.fn(), render: vi.fn().mockReturnValue('') };
    const out = await withSelfHealing(fn, FAST_CONFIG, metrics, 'test-op');
    expect(out.recovered).toBe(true);
    if (!out.recovered) throw new Error();
    expect(out.result).toBe('recovered');
    expect(metrics.inc).toHaveBeenCalledWith('self_healing_recoveries_total', 1, { operation: 'test-op' });
  });
});

// ---------------------------------------------------------------------------
// Retryable errors
// ---------------------------------------------------------------------------

describe('withSelfHealing (TRANSIENT retry)', () => {
  it('retries TRANSIENT errors up to maxAttempts', async () => {
    const fn = vi.fn().mockRejectedValue(categorizedError('TRANSIENT', 'RPC timeout'));
    const out = await withSelfHealing(fn, FAST_CONFIG);
    expect(out.recovered).toBe(false);
    if (out.recovered) throw new Error();
    expect(out.category).toBe('PERMANENT_FAILURE');
    expect(out.attempts).toBe(FAST_CONFIG.maxAttempts + 1);
    expect(fn).toHaveBeenCalledTimes(FAST_CONFIG.maxAttempts + 1);
  });

  it('retries RETRYABLE errors', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      if (++calls < 3) throw categorizedError('RETRYABLE', 'cache miss');
      return 'done';
    });
    const out = await withSelfHealing(fn, FAST_CONFIG);
    expect(out.recovered).toBe(true);
    if (!out.recovered) throw new Error();
    expect(out.result).toBe('done');
    expect(out.attempts).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed categories
// ---------------------------------------------------------------------------

describe('withSelfHealing (fail-closed)', () => {
  it('immediately fails on SECURITY_ERROR without retry', async () => {
    const fn = vi.fn().mockRejectedValue(categorizedError('SECURITY_ERROR', 'circuit config tampered'));
    const out = await withSelfHealing(fn, FAST_CONFIG);
    expect(out.recovered).toBe(false);
    if (out.recovered) throw new Error();
    expect(out.category).toBe('SECURITY_ERROR');
    expect(out.attempts).toBe(1); // no retries
    expect(fn).toHaveBeenCalledOnce();
  });

  it('immediately fails on CRYPTOGRAPHIC_ERROR without retry', async () => {
    const fn = vi.fn().mockRejectedValue(categorizedError('CRYPTOGRAPHIC_ERROR', 'vk hash mismatch'));
    const out = await withSelfHealing(fn, FAST_CONFIG);
    expect(out.recovered).toBe(false);
    if (out.recovered) throw new Error();
    expect(out.category).toBe('CRYPTOGRAPHIC_ERROR');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('immediately fails on SECURITY_BLOCKED without retry', async () => {
    const fn = vi.fn().mockRejectedValue(categorizedError('SECURITY_BLOCKED', 'gatekeeper rejected'));
    const out = await withSelfHealing(fn, FAST_CONFIG);
    expect(out.recovered).toBe(false);
    if (out.recovered) throw new Error();
    expect(out.category).toBe('SECURITY_BLOCKED');
    expect(fn).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Non-retryable permanent errors
// ---------------------------------------------------------------------------

describe('withSelfHealing (permanent errors)', () => {
  it('does not retry VALIDATION_ERROR', async () => {
    const fn = vi.fn().mockRejectedValue(categorizedError('VALIDATION_ERROR', 'bad inputs'));
    const out = await withSelfHealing(fn, FAST_CONFIG);
    expect(out.recovered).toBe(false);
    if (out.recovered) throw new Error();
    // VALIDATION_ERROR is not auto-retried; the original category is preserved
    expect(out.category).toBe('VALIDATION_ERROR');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('does not retry CONFIGURATION_ERROR', async () => {
    const fn = vi.fn().mockRejectedValue(categorizedError('CONFIGURATION_ERROR', 'env missing'));
    const out = await withSelfHealing(fn, FAST_CONFIG);
    expect(out.recovered).toBe(false);
    if (out.recovered) throw new Error();
    expect(out.category).toBe('CONFIGURATION_ERROR');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('treats uncategorized errors as PERMANENT_FAILURE', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('something unexpected'));
    const out = await withSelfHealing(fn, FAST_CONFIG);
    expect(out.recovered).toBe(false);
    if (out.recovered) throw new Error();
    expect(out.category).toBe('PERMANENT_FAILURE');
    expect(fn).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

describe('withSelfHealing (metrics)', () => {
  it('emits self_healing_blocked_total for fail-closed errors', async () => {
    const metrics = { inc: vi.fn(), gauge: vi.fn(), duration: vi.fn(), render: vi.fn().mockReturnValue('') };
    await withSelfHealing(
      async () => { throw categorizedError('SECURITY_ERROR', 'blocked'); },
      FAST_CONFIG,
      metrics,
      'my-op',
    );
    expect(metrics.inc).toHaveBeenCalledWith('self_healing_blocked_total', 1, {
      operation: 'my-op',
      category: 'SECURITY_ERROR',
    });
  });

  it('emits self_healing_retries_total on each retry', async () => {
    const metrics = { inc: vi.fn(), gauge: vi.fn(), duration: vi.fn(), render: vi.fn().mockReturnValue('') };
    await withSelfHealing(
      async () => { throw categorizedError('TRANSIENT', 'blink'); },
      { ...FAST_CONFIG, maxAttempts: 2 },
      metrics,
      'my-op',
    );
    const retryCalls = (metrics.inc as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c as string[])[0] === 'self_healing_retries_total',
    );
    expect(retryCalls.length).toBeGreaterThan(0);
  });
});
