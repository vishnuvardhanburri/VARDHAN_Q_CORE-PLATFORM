import { describe, it, expect } from 'vitest';
import { Semaphore } from '../src/infrastructure/util/Semaphore.js';

describe('Semaphore', () => {
  it('rejects limit < 1', () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
  });

  it('allows up to limit concurrent runs', async () => {
    const sem = new Semaphore(3);
    let running = 0;
    let maxObserved = 0;

    const task = () =>
      sem.run(async () => {
        running++;
        maxObserved = Math.max(maxObserved, running);
        await new Promise<void>((r) => setTimeout(r, 10));
        running--;
      });

    await Promise.all([task(), task(), task(), task(), task()]);
    expect(maxObserved).toBeLessThanOrEqual(3);
  });

  it('resolves in order (FIFO queue)', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];

    const make = (n: number) =>
      sem.run(async () => {
        order.push(n);
        await new Promise<void>((r) => setImmediate(r));
      });

    await Promise.all([make(1), make(2), make(3)]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('releases slot even when fn throws', async () => {
    const sem = new Semaphore(1);

    await expect(
      sem.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // Should still be usable
    const result = await sem.run(async () => 42);
    expect(result).toBe(42);
    expect(sem.inflight).toBe(0);
    expect(sem.queued).toBe(0);
  });

  it('reports inflight and queued counts correctly', async () => {
    const sem = new Semaphore(1);
    let resolve1!: () => void;

    // Start first task — occupies the only slot
    const t1 = sem.run(() => new Promise<void>((r) => { resolve1 = r; }));
    // Give the event loop a tick so the first task actually starts
    await new Promise<void>((r) => setImmediate(r));
    expect(sem.inflight).toBe(1);

    // Queue a second task
    let resolve2!: () => void;
    const t2 = sem.run(() => new Promise<void>((r) => { resolve2 = r; }));
    await new Promise<void>((r) => setImmediate(r));
    expect(sem.queued).toBe(1);

    resolve1();
    await t1;
    await new Promise<void>((r) => setImmediate(r));
    expect(sem.inflight).toBe(1);
    expect(sem.queued).toBe(0);

    resolve2();
    await t2;
    expect(sem.inflight).toBe(0);
  });

  it('handles limit=1 as a mutex — no concurrency', async () => {
    const sem = new Semaphore(1);
    const log: string[] = [];

    await Promise.all([
      sem.run(async () => { log.push('a-start'); await new Promise<void>((r) => setTimeout(r, 5)); log.push('a-end'); }),
      sem.run(async () => { log.push('b-start'); log.push('b-end'); }),
    ]);
    expect(log).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });
});
