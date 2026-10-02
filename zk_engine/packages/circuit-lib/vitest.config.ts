import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Cryptographic proofs (Groth16 fullProve / verify) can take 5-10s on
    // constrained CI runners (e.g. 2-vCPU Windows runners). 30s is generous.
    testTimeout: 30_000,
  },
});
