/**
 * `@zkpe/circuit-lib` — versioned Poseidon circuits, artifact hashing, and
 * certified manifests (ADR-0007, ADR-0008).
 *
 * - {@link circuits}: static circuit declarations (`poseidon-preimage@1`,
 *   `merkle-inclusion@1`).
 * - {@link hashes}: SHA-256 binary hashing for artifact integrity.
 * - {@link manifest}: certified `CircuitManifest` construction and vkHash.
 * - {@link artifacts}: on-disk artifact layout, digests, integrity checks.
 */

export * from './circuits.js';
export * from './hashes.js';
export * from './manifest.js';
export * from './artifacts.js';
