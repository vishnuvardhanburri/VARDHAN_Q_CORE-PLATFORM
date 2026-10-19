/**
 * Generic hash-provider interface (M1 requirement #3).
 *
 * The engine separates hash algorithms from consumers so new algorithms can be
 * added later (e.g. an in-circuit SHA-256 provider once the toolchain supports
 * it, MiMC, or a Keccak field-hash) without touching prover/verifier code.
 *
 * Two capabilities exist:
 *  - `hash(inputs)` — hashes BN254 field elements into a field element. MUST
 *    match the on-circuit implementation bit-for-bit (this is what makes
 *    off-circuit commitments agree with in-circuit constraints).
 *  - `hashBytes(data)` — hashes raw bytes into a field element. Only
 *    providers that define a byte-encoding implement this; field-only
 *    providers (Poseidon v1) throw {@link NotSupportedError}.
 */

/** Error thrown when a provider does not support a requested capability. */
export class NotSupportedError extends Error {
  constructor(providerId: string, op: string) {
    super(`hash provider ${JSON.stringify(providerId)} does not support ${op}`);
    this.name = 'NotSupportedError';
  }
}

/** Error thrown when a provider id is not registered. */
export class UnknownHashProviderError extends Error {
  constructor(id: string) {
    super(`unknown hash provider: ${JSON.stringify(id)} (registered: none)`);
    this.name = 'UnknownHashProviderError';
  }
}

/** Field-element hashing capability (in-circuit compatible). */
export interface HashProvider {
  /** Stable algorithm id, e.g. `poseidon`. Versioned via `description`. */
  readonly id: string;
  /** Human-readable parameter summary for manifests and audit trails. */
  readonly description: string;
  /**
   * Hash BN254 field elements into a field element. `inputs.length` must be
   * within the provider's arity bounds (Poseidon: 1..15).
   */
  hash(inputs: readonly bigint[]): Promise<bigint>;
}

/** Raw-bytes hashing capability (field-element output). */
export interface ByteHashProvider extends HashProvider {
  /** Hash raw bytes into a field element using the provider's encoding. */
  hashBytes(data: Uint8Array): Promise<bigint>;
}

const registry = new Map<string, HashProvider>();

/** Register a provider under its `id`. Replaces any previous registration. */
export function registerHashProvider(provider: HashProvider): void {
  registry.set(provider.id, provider);
}

/** Look up a provider by id; throws {@link UnknownHashProviderError}. */
export function getHashProvider(id: string): HashProvider {
  const provider = registry.get(id);
  if (!provider) {
    throw new UnknownHashProviderError(id);
  }
  return provider;
}

/** Look up a provider that can hash raw bytes; throws if unavailable. */
export function getByteHashProvider(id: string): ByteHashProvider {
  const provider = getHashProvider(id);
  if (typeof (provider as Partial<ByteHashProvider>).hashBytes !== 'function') {
    throw new NotSupportedError(id, 'hashBytes');
  }
  return provider as ByteHashProvider;
}

/** Registered provider ids, sorted for stable enumeration. */
export function listHashProviders(): string[] {
  return [...registry.keys()].sort();
}
