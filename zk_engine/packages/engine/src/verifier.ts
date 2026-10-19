/**
 * Verification (ADR-0008: Groth16 / BN254).
 *
 * `verify` checks a proof against the circuit's certified verification key
 * (loaded from the integrity-checked artifact directory) and the public
 * signals that were proven. It also binds the outcome in a {@link TaskRecord}.
 */

import * as snarkjs from 'snarkjs';
import type { Fr, Groth16Proof } from '@zkpe/proof-format';
import type { Circuit } from './circuit.js';
import type { TaskRecord } from './task.js';
import { hashTaskInputs, runTask } from './task.js';

/** Result of a verification attempt. */
export interface VerifyResult {
  /** True when the proof is valid for the given public signals and vk. */
  valid: boolean;
  task: TaskRecord;
}

/**
 * Verify `proof` against `publicSignals` using the circuit's certified vk.
 * `publicSignals` must be the exact canonical list the proof was generated
 * for (snarkjs fullProve output).
 */
export async function verify(
  circuit: Circuit,
  publicSignals: readonly Fr[],
  proof: Groth16Proof,
): Promise<VerifyResult> {
  const inputHash = hashTaskInputs({
    circuitId: circuit.def.id,
    publicSignals,
    proof,
  });

  const { result, task } = await runTask('verify', circuit, inputHash, () =>
    snarkjs.groth16.verify(circuit.verificationKey, [...publicSignals], proof),
  );

  if (task.status === 'failed') {
    throw new Error(`verify failed: ${task.error}`);
  }

  return { valid: result as boolean, task };
}
