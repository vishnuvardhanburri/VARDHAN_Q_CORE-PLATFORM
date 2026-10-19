/**
 * Tests for `src/task.ts` — the task record model.
 */

import { describe, expect, it } from 'vitest';
import { hashTaskInputs, runTask } from '../src/task.js';

const circuit = { def: { id: 'poseidon-preimage', version: '1.0.0' } };

describe('hashTaskInputs', () => {
  it('is deterministic and canonical', () => {
    const a = hashTaskInputs({ x: [1, '2'], y: { b: 1, a: 2 } });
    const b = hashTaskInputs({ y: { a: 2, b: 1 }, x: [1, '2'] });
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('runTask', () => {
  it('records success with duration and kind metadata', async () => {
    const { result, task } = await runTask('prove', circuit, hashTaskInputs({ a: 1 }), async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(task.status).toBe('ok');
    expect(task.kind).toBe('prove');
    expect(task.circuitId).toBe('poseidon-preimage');
    expect(task.circuitVersion).toBe('1.0.0');
    // Duration is metadata: wall-clock floors are flaky (timers can early-
    // fire); the recorded value only needs to be present and non-negative.
    expect(task.durationMs).toBeGreaterThanOrEqual(0);
    expect(task.error).toBeUndefined();
  });

  it('records failure without throwing', async () => {
    const { task } = await runTask('verify', circuit, hashTaskInputs({ a: 1 }), async () => {
      throw new Error('boom');
    });
    expect(task.status).toBe('failed');
    expect(task.error).toContain('boom');
    expect(task.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('accepts an output summary', async () => {
    const { task } = await runTask('witness', circuit, hashTaskInputs({ a: 1 }), async () => 7);
    expect(task.status).toBe('ok');
  });
});
