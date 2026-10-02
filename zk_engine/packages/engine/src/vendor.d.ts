/**
 * Minimal ambient typings for the untyped vendor packages `snarkjs` and
 * `circomlibjs` (pinned versions 0.7.6 / 0.1.7). These shims cover exactly
 * the surface the engine uses; they are deliberately loose so upstream type
 * changes do not break builds.
 */

declare module 'snarkjs' {
  /** Groth16 proof in snarkjs coordinate layout. */
  export interface SnarkJsProof {
    curve: string;
    pi_a: [string, string, string];
    pi_b: [[string, string], [string, string], [string, string]];
    pi_c: [string, string, string];
    [key: string]: unknown;
  }

  export const groth16: {
    /**
     * Compute the witness (wasm) and generate a Groth16 proof.
     * `publicSignals` values are BigInts in snarkjs 0.7.x.
     */
    fullProve(
      inputs: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string,
    ): Promise<{ proof: SnarkJsProof; publicSignals: bigint[] }>;
    /** Verify a proof against a verification key and public signals. */
    verify(vk: unknown, publicSignals: unknown[], proof: unknown): Promise<boolean>;
  };
}

declare module 'circomlibjs' {
  /**
   * Reference Poseidon implementation over BN254. The callable hash takes
   * field elements (bigint | number | string) and returns a field element in
   * the curve's internal representation; use `F.toString` to get the decimal
   * value.
   */
  export function buildPoseidonReference(): Promise<{
    F: { toString(el: unknown): string };
    (inputs: readonly (bigint | number | string)[]): unknown;
  }>;
}
