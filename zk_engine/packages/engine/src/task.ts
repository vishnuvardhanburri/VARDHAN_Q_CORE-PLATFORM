/**
 * Task model and runner (used by prover/verifier; the basis for the M8
 * gatekeeper pipeline).
 *
 * A {@link TaskRecord} is the immutable audit entry for one engine operation:
 * what ran, over which inputs (keccak binding), how long it took, and whether
 * it succeeded.
 */

import { keccak256Utf8 } from '@zkpe/proof-format';
import { canonicalize } from '@zkpe/proof-format';

/** Kinds of engine work that produce task records. */
export type TaskKind = 'witness' | 'prove' | 'verify';

/** Status of a task execution. */
export type TaskStatus = 'ok' | 'failed';

/** Audit record for one engine operation. */
export interface TaskRecord {
  kind: TaskKind;
  circuitId: string;
  circuitVersion: string;
  /** keccak256 of canonical inputs/args (never raw values). */
  inputHash: string;
  /** Duration in milliseconds. */
  durationMs: number;
  status: TaskStatus;
  /** Error message when `status === "failed"`. */
  error?: string;
  /** Free-form result summary (e.g. public signal count). */
  outputSummary?: string;
}

/** hash canonical inputs for audit binding. */
export function hashTaskInputs(args: Record<string, unknown>): string {
  return keccak256Utf8(canonicalize(args));
}

/** Run `fn`, wrapping it in a {@link TaskRecord}. Never throws. */
export async function runTask<T>(
  kind: TaskKind,
  circuit: { def: { id: string; version: string } },
  inputHash: string,
  fn: () => Promise<T>,
): Promise<{ result: T; task: TaskRecord }> {
  const startedAt = performance.now();
  const base: Omit<TaskRecord, 'status'> = {
    kind,
    circuitId: circuit.def.id,
    circuitVersion: circuit.def.version,
    inputHash,
    durationMs: 0,
  };
  try {
    const result = await fn();
    const task: TaskRecord = {
      ...base,
      durationMs: Math.round(performance.now() - startedAt),
      status: 'ok',
    };
    return { result, task };
  } catch (error) {
    const task: TaskRecord = {
      ...base,
      durationMs: Math.round(performance.now() - startedAt),
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
    return { result: undefined as T, task };
  }
}
