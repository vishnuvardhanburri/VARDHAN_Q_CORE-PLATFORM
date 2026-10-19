/**
 * `@zkpe/engine` — the ZK proof engine runtime (ADR-0006..0008).
 *
 * Public modules:
 * - {@link hash}: `HashProvider` interface + registry (extensible; Poseidon v1)
 * - {@link circuit}: `Circuit` — certified manifest + artifact handle
 * - {@link inputs}: manifest-driven input validation / witness encoding
 * - {@link prover}: `prove()` — witness + Groth16 proof
 * - {@link verifier}: `verify()` — Groth16 verification against certified vk
 * - {@link keys}: dev keygen (checksum-verified deterministic PTau)
 * - {@link task}: `TaskRecord` audit model + `runTask`
 */

export * from './hash/hash-provider.js';
export * from './hash/poseidon.js';
export * from './circuit.js';
export * from './inputs.js';
export * from './prover.js';
export * from './verifier.js';
export * from './keys.js';
export * from './task.js';
