/**
 * Error types for `@zkpe/keys` (ADR-0009 key management).
 */

/** Base class for all key-management errors. */
export class KeyError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'KeyError';
  }
}

/** Thrown for structurally or cryptographically invalid key material. */
export class InvalidKeyError extends KeyError {
  constructor(message: string, readonly details: string[] = []) {
    super(message, 'INVALID_KEY');
    this.name = 'InvalidKeyError';
  }
}

/** Thrown when a key id is unknown to a KeyRing. */
export class UnknownKeyError extends KeyError {
  constructor(keyId: string) {
    super(`unknown key id ${keyId}`, 'UNKNOWN_KEY');
    this.name = 'UnknownKeyError';
  }
}

/** Thrown when a KeyRing has no active signing key. */
export class NoActiveKeyError extends KeyError {
  constructor() {
    super('key ring has no active key', 'NO_ACTIVE_KEY');
    this.name = 'NoActiveKeyError';
  }
}

/** Thrown when persisted keyring JSON is malformed or unsafe. */
export class KeyringCorruptError extends KeyError {
  constructor(message: string) {
    super(message, 'CORRUPT_KEYRING');
    this.name = 'KeyringCorruptError';
  }
}

/** Thrown by FileKeyStore for filesystem permission / integrity problems. */
export class KeyStoreError extends KeyError {
  constructor(message: string) {
    super(message, 'KEYSTORE');
    this.name = 'KeyStoreError';
  }
}

/** Thrown when an envelope signature cannot be verified (policy or crypto). */
export class SignatureVerificationError extends KeyError {
  constructor(readonly reasons: string[]) {
    super(`signature verification failed: ${reasons.join('; ')}`, 'BAD_SIGNATURE');
    this.name = 'SignatureVerificationError';
  }
}
