/**
 * Poseidon hash provider (ADR-0008: Poseidon is the v1 in-circuit hash).
 *
 * Backed by `circomlibjs`'s reference Poseidon implementation, which has been
 * verified against the certified circuits in `@zkpe/circuit-lib` (see
 * `test/poseidon.test.ts` and the circuit-lib integration tests): the provider
 * output equals the circuit's `digest` public signal.
 *
 * Parameters (must match the circuits):
 *   - t = inputs.length + 1, nRoundsF = 8, nRoundsP = N_ROUNDS_P[t-2]
 *   - Poseidon(2) with t=3 ⇒ nRoundsP=57 (used by poseidon-preimage@1 and
 *     merkle-inclusion@1).
 *
 * Poseidon does not define a raw-byte encoding in v1, so `hashBytes` is not
 * supported (throws {@link NotSupportedError}); add a provider with a byte
 * encoding (e.g. in-circuit SHA-256) when one is certified.
 */

import { buildPoseidonReference } from 'circomlibjs';
import type { ByteHashProvider, HashProvider } from './hash-provider.js';
import { NotSupportedError, registerHashProvider } from './hash-provider.js';

export const POSEIDON_HASH_PROVIDER_ID = 'poseidon' as const;

type PoseidonFn = Awaited<ReturnType<typeof buildPoseidonReference>>;

let singleton: PoseidonHashProvider | undefined;

/** The Poseidon field-hash provider (`id: "poseidon"`). */
export class PoseidonHashProvider implements HashProvider {  readonly id = POSEIDON_HASH_PROVIDER_ID;
  readonly description =
    'Poseidon (BN254, t = nInputs+1, nRoundsF=8, nRoundsP per table 2/8 of the Hades whitepaper)';

  private poseidon?: PoseidonFn;

  private async getPoseidon(): Promise<PoseidonFn> {
    this.poseidon ??= await buildPoseidonReference();
    return this.poseidon;
  }

  async hash(inputs: readonly bigint[]): Promise<bigint> {
    if (inputs.length === 0 || inputs.length > 15) {
      throw new RangeError(`Poseidon supports 1..15 inputs, got ${inputs.length}`);
    }
    const poseidon = await this.getPoseidon();
    const out = poseidon(inputs);
    return BigInt(poseidon.F.toString(out));
  }

  /** @throws {@link NotSupportedError} — Poseidon v1 defines no byte encoding. */
  async hashBytes(_data: Uint8Array): Promise<bigint> {
    throw new NotSupportedError(this.id, 'hashBytes');
  }
}

/**
 * Get the shared `poseidon` provider, registering it on first use.
 * All callers share one instance (the underlying curve is built once).
 */
export function getPoseidonProvider(): PoseidonHashProvider {
  singleton ??= new PoseidonHashProvider();
  return singleton;
}

/** Register the default `poseidon` provider in the global registry. */
export function registerDefaultHashProviders(): void {
  registerHashProvider(getPoseidonProvider());
}

export type { ByteHashProvider };
