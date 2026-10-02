/**
 * CLI output helpers — human rendering + JSON normalization.
 *
 * Exit code contract (stable, documented, tested):
 *   0 — success
 *   1 — runtime error (engine/API/IO/envelope failures)
 *   2 — usage error (bad flags, unknown command, missing args)
 */

import { UsageError } from './args.js';

export type Output = { kind: 'json'; doc: unknown } | { kind: 'text'; lines: string[] };

export function render(o: Output): void {
  if (o.kind === 'json') {
    process.stdout.write(JSON.stringify(o.doc, null, 2) + '\n');
    return;
  }
  for (const line of o.lines) process.stdout.write(line + '\n');
}

export function errExit(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof UsageError ? 2 : 1;
  process.stderr.write(`zk: ${message}\n`);
  process.exit(code);
}

/** Human line for a status result. */
export function fmtStatus(s: { circuitId: string; status: string; provedAt: string }): string {
  return `${s.circuitId}: ${s.status}${s.provedAt !== '0' ? ` since block ${s.provedAt}` : ''}`;
}