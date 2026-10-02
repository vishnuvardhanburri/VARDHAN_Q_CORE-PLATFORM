/**
 * Concurrency semaphore — limits simultaneous CPU-bound snarkjs verify calls
 * to prevent resource exhaustion under burst load (§6 failure-engineering).
 *
 * Usage:
 *   const sem = new Semaphore(8);
 *   const result = await sem.run(async () => engineVerify(...));
 */
export class Semaphore {
  private readonly waiting: Array<() => void> = [];
  private running = 0;

  constructor(readonly limit: number) {
    if (limit < 1) throw new RangeError('Semaphore limit must be >= 1');
  }

  /** Acquire a slot (waits if at limit), run `fn`, then release. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.running--;
    }
  }

  /** Current number of in-flight operations (for observability). */
  get inflight(): number {
    return this.running;
  }

  /** Current queue length (callers waiting for a slot). */
  get queued(): number {
    return this.waiting.length;
  }
}
