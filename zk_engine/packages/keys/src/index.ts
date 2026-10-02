/**
 * `@zkpe/keys` — key management and envelope signing (ADR-0009).
 *
 * - {@link keypair}: Ed25519 generation, validation, JWK/PEM import-export,
 *   keyId thumbprints.
 * - {@link keyring}: rotating key rings (sign / verify / rotate / persist).
 * - {@link keystore}: 0600-permissioned, atomic file persistence.
 * - {@link envelope}: sign / verify versioned (v2) proof envelopes over
 *   canonical bytes (deterministic serialization, ADR-0006/0009).
 */

export * from './errors.js';
export * from './keypair.js';
export * from './keyring.js';
export * from './keystore.js';
export * from './envelope.js';
