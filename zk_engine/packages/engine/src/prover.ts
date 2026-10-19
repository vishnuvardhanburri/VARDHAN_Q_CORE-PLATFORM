/**
 * Proving (ADR-0008: Groth16 / BN254).
 *
 * `prove` validates inputs against the certified manifest, computes the
 * witness in the wasm witness calculator, and produces a Groth16 proof via
 * the pinned `snarkjs` runtime. Results are returned alongside a
 * {@link TaskRecord} so callers (API, CLI, gatekeeper) can build audit
 * trails without re-measuring.
 */

import * as snarkjs from 'snarkjs';
import type { Fr, Groth16Proof } from '@zkpe/proof-format';
import type { Circuit } from './circuit.js';
import { parseCircuitInputs } from './inputs.js';
import type { TaskRecord } from './task.js';
import { runTask } from './task.js';

/** Result of a successful proof generation. */
export interface ProveResult {
  proof: Groth16Proof;
  /** Public signals in canonical order (the values `verify` consumes). */
  publicSignals: Fr[];
  /** Audit record: input hash, duration, status. */
  task: TaskRecord;
}

/**
 * Generate a Groth16 proof for `circuit` over validated inputs.
 * The raw inputs follow the manifest schema, e.g. for `merkle-inclusion@1`:
 * `{ root, leaf, siblings: [4], pathBits: [4] }` (field elements as decimal
 * strings, u1 as 0/1).
 */
export async function prove(
  circuit: Circuit,
  rawInputs: Record<string, unknown>,
): Promise<ProveResult> {
  const witnessInputs = parseCircuitInputs(circuit, rawInputs);
  const inputHash = await taskInputHash(circuit, witnessInputs);

  const { result, task } = await runTask('prove', circuit, inputHash, () =>
    snarkjs.groth16.fullProve(
      witnessInputs,
      circuit.artifactPaths.wasm,
      circuit.artifactPaths.zkey,
    ),
  );

  if (task.status === 'failed') {
    throw new Error(`prove failed: ${task.error}`);
  }

  return {
    proof: result.proof as Groth16Proof,
    publicSignals: result.publicSignals.map((s: bigint | string) => BigInt(s).toString()),
    task,
  };
}

import { canonicalize, keccak256Utf8 } from '@zkpe/proof-format';

/** keccak256 of the canonical witness inputs (audit binding). */
async function taskInputHash(
  circuit: Circuit,
  witnessInputs: Record<string, string | string[]>,
): Promise<string> {
  return keccak256Utf8(canonicalize({ circuitId: circuit.def.id, inputs: witnessInputs }));
}
