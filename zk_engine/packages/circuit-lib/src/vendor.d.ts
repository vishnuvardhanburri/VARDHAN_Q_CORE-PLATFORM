/**
 * Ambient typings for the untyped vendor packages used by circuit-lib tests
 * (`snarkjs` 0.7.6, `circomlibjs` 0.1.7). Loose on purpose; the engine owns
 * the full typed surface of these modules (see @zkpe/engine/src/vendor.d.ts).
 */

declare module 'snarkjs' {
  export const groth16: {
    fullProve(
      inputs: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string,
    ): Promise<{ proof: unknown; publicSignals: unknown[] }>;
    verify(vk: unknown, publicSignals: unknown[], proof: unknown): Promise<boolean>;
  };
}

declare module 'circomlibjs' {
  export function buildPoseidonReference(): Promise<{
    F: { toString(el: unknown): string };
    (inputs: readonly (bigint | number | string)[]): unknown;
  }>;
}
