/**
 * KeyRing — a rotating set of Ed25519 signing keys (ADR-0009).
 *
 * - One key is **active** (used for signing); older keys are retained so
 *   previously issued signatures remain verifiable (key history).
 * - `rotation` is a monotonic counter; `keyVersion` in the envelope
 *   signature section mirrors it (informational).
 * - Persisted via JSON (private keys included — keep the file at 0600;
 *   see `keystore.ts`).
 * - `maxRetainedKeys` bounds history; the active key is never evicted.
 */

import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { KEY_ID_PATTERN } from '@zkpe/proof-format';
import {
  computeKeyId,
  generateKeyPair,
  importPrivateJwk,
  publicJwkFromPrivateJwk,
  toNodeJwk,
  validatePrivateJwk,
  validatePublicJwk,
  type KeyPair,
  type PublicKey,
} from './keypair.js';
import { KeyringCorruptError, NoActiveKeyError, UnknownKeyError } from './errors.js';
import type { EdJwk } from './keypair.js';

/** One stored key entry. */
export interface KeyringEntry {
  keyId: string;
  publicJwk: EdJwk;
  /** Private key; undefined for verification-only entries. */
  privateJwk?: EdJwk;
  /** Epoch ms when the key was added. */
  createdAt: number;
  /** Monotonic rotation counter (mirrors signature.keyVersion). */
  rotation: number;
}

export interface KeyRingOptions {
  /** Max retained keys (default 8); the active key is never evicted. */
  maxRetainedKeys?: number;
}

export interface KeyRingJson {
  version: 1;
  entries: KeyringEntry[];
  activeKeyId?: string;
}

const DEFAULT_MAX_KEYS = 8;

export class KeyRing {
  private readonly entries = new Map<string, KeyringEntry>();
  private activeKeyIdInternal: string | undefined;
  private nextRotation = 1;
  private readonly maxRetainedKeys: number;

  private constructor(options: KeyRingOptions = {}) {
    this.maxRetainedKeys = options.maxRetainedKeys ?? DEFAULT_MAX_KEYS;
  }

  /** An empty key ring. */
  static create(options: KeyRingOptions = {}): KeyRing {
    return new KeyRing(options);
  }

  /** Deserialize a persisted key ring (throws KeyringCorruptError). */
  static fromJSON(raw: string): KeyRing {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new KeyringCorruptError('keyring JSON is not parseable');
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new KeyringCorruptError('keyring must be a JSON object');
    }
    const doc = parsed as Record<string, unknown>;
    if (doc['version'] !== 1) {
      throw new KeyringCorruptError(`unsupported keyring version ${String(doc['version'])}`);
    }
    if (!Array.isArray(doc['entries'])) {
      throw new KeyringCorruptError('keyring entries must be an array');
    }
    const options: KeyRingOptions = {};
if (typeof doc['maxRetainedKeys'] === 'number') options.maxRetainedKeys = doc['maxRetainedKeys'];
const ring = new KeyRing(options);
    for (const entry of doc['entries']) {
      const e = entry as Partial<KeyringEntry>;
      if (typeof e.keyId !== 'string' || !KEY_ID_PATTERN.test(e.keyId)) {
        throw new KeyringCorruptError('entry has an invalid keyId');
      }
      const publicErrors = validatePublicJwk(e.publicJwk);
      if (publicErrors.length > 0) {
        throw new KeyringCorruptError(`entry ${e.keyId} has an invalid public key`);
      }
      if (e.privateJwk !== undefined) {
        const privateErrors = validatePrivateJwk(e.privateJwk);
        if (privateErrors.length > 0) {
          throw new KeyringCorruptError(`entry ${e.keyId} has an invalid private key`);
        }
      }
      if (typeof e.rotation !== 'number' || !Number.isInteger(e.rotation) || e.rotation < 1) {
        throw new KeyringCorruptError(`entry ${e.keyId} has an invalid rotation counter`);
      }
      const normalized: KeyringEntry = {
        keyId: e.keyId,
        publicJwk: e.publicJwk as EdJwk,
        createdAt: typeof e.createdAt === 'number' ? e.createdAt : Date.now(),
        rotation: e.rotation,
      };
      if (e.privateJwk !== undefined) normalized.privateJwk = e.privateJwk as EdJwk;
      if (ring.entries.has(normalized.keyId)) {
        throw new KeyringCorruptError(`duplicate entry ${normalized.keyId}`);
      }
      ring.entries.set(normalized.keyId, normalized);
      ring.nextRotation = Math.max(ring.nextRotation, normalized.rotation + 1);
    }
    const active = doc['activeKeyId'];
    if (active !== undefined) {
      if (typeof active !== 'string' || !ring.entries.has(active)) {
        throw new KeyringCorruptError('activeKeyId does not reference a stored key');
      }
      ring.activeKeyIdInternal = active;
    }
    return ring;
  }

  /** Serialize the ring (contains private keys — protect the file). */
  toJSON(): KeyRingJson {
    const sorted = [...this.entries.values()].sort((a, b) => a.rotation - b.rotation);
    const json: KeyRingJson = { version: 1, entries: sorted };
    if (this.activeKeyIdInternal !== undefined) json.activeKeyId = this.activeKeyIdInternal;
    return json;
  }

  /** Active signing key id, or undefined when the ring is empty. */
  get activeKeyId(): string | undefined {
    return this.activeKeyIdInternal;
  }

  /** Number of stored keys. */
  get size(): number {
    return this.entries.size;
  }

  /** All key ids, oldest rotation first. */
  list(): string[] {
    return [...this.entries.values()]
      .sort((a, b) => a.rotation - b.rotation)
      .map((e) => e.keyId);
  }

  /** Fetch an entry (throws UnknownKeyError). */
  get(keyId: string): KeyringEntry {
    const entry = this.entries.get(keyId);
    if (!entry) throw new UnknownKeyError(keyId);
    return entry;
  }

  /** True if the key id is present. */
  has(keyId: string): boolean {
    return this.entries.has(keyId);
  }

  /**
   * Add a key pair (generated or imported). A fresh rotation counter is
   * assigned; the first key becomes active automatically. The claimed keyId
   * must equal the one derived from the private key (integrity).
   */
  addKey(pair: KeyPair | PublicKey): KeyringEntry {
    if ('privateJwk' in pair) {
      const privateErrors = validatePrivateJwk(pair.privateJwk);
      if (privateErrors.length > 0) {
        throw new Error(`invalid private key: ${privateErrors.join('; ')}`);
      }
      const derived = computeKeyId(publicJwkFromPrivateJwk(pair.privateJwk));
      if (derived !== pair.keyId) {
        throw new Error(`keyId mismatch: derived ${derived} !== claimed ${pair.keyId}`);
      }
      return this.addEntry({
        keyId: pair.keyId,
        publicJwk: pair.publicJwk,
        privateJwk: pair.privateJwk,
      });
    }
    const publicErrors = validatePublicJwk(pair.publicJwk);
    if (publicErrors.length > 0) {
      throw new Error(`invalid public key: ${publicErrors.join('; ')}`);
    }
    return this.addEntry({ keyId: pair.keyId, publicJwk: pair.publicJwk });
  }

  /** Generate a fresh key and make it active (rotation). */
  rotate(): KeyringEntry {
    const entry = this.addKey(generateKeyPair());
    this.activeKeyIdInternal = entry.keyId;
    return entry;
  }

  /** Make a stored key the active signing key. */
  setActiveKey(keyId: string): void {
    if (!this.entries.has(keyId)) throw new UnknownKeyError(keyId);
    this.activeKeyIdInternal = keyId;
  }

  /** Remove a non-active key from the ring (history pruning). */
  remove(keyId: string): void {
    if (!this.entries.has(keyId)) throw new UnknownKeyError(keyId);
    if (keyId === this.activeKeyIdInternal) {
      throw new Error('cannot remove the active key; rotate first');
    }
    this.entries.delete(keyId);
  }

  /**
   * Sign raw bytes with the active key (or an explicit key id).
   * `keyVersion` reflects the signing key's rotation counter.
   */
  signBytes(
    data: Uint8Array,
    keyId: string = this.requireActive(),
  ): { signatureHex: string; keyId: string; keyVersion: number } {
    const entry = this.entries.get(keyId);
    if (!entry) throw new UnknownKeyError(keyId);
    if (!entry.privateJwk) throw new Error(`key ${keyId} has no private key (verification-only)`);
    const privateKey = createPrivateKey({ key: toNodeJwk(entry.privateJwk), format: 'jwk' });
    const signatureHex = sign(null, data, privateKey).toString('hex');
    return { signatureHex, keyId, keyVersion: entry.rotation };
  }

  /** Verify a signature (hex) over raw bytes with a stored key. */
  verifyBytes(data: Uint8Array, signatureHex: string, keyId: string): boolean {
    const entry = this.entries.get(keyId);
    if (!entry) return false;
    try {
      const publicKey = createPublicKey({ key: toNodeJwk(entry.publicJwk), format: 'jwk' });
      return verify(null, data, publicKey, Buffer.from(signatureHex, 'hex'));
    } catch {
      return false;
    }
  }

  /** Verify with an external public key (JWK) not stored in the ring. */
  verifyBytesWithPublicKey(data: Uint8Array, signatureHex: string, publicJwk: EdJwk): boolean {
    try {
      const publicKey = createPublicKey({ key: toNodeJwk(publicJwk), format: 'jwk' });
      return verify(null, data, publicKey, Buffer.from(signatureHex, 'hex'));
    } catch {
      return false;
    }
  }

  /** Import a private JWK into the ring (alias of addKey). */
  importPrivate(privateJwk: EdJwk): KeyringEntry {
    return this.addKey(importPrivateJwk(privateJwk));
  }

  private requireActive(): string {
    if (this.activeKeyIdInternal === undefined) throw new NoActiveKeyError();
    return this.activeKeyIdInternal;
  }

  private addEntry(partial: Pick<KeyringEntry, 'keyId' | 'publicJwk'> & { privateJwk?: EdJwk }): KeyringEntry {
    if (this.entries.has(partial.keyId)) {
      throw new Error(`duplicate key ${partial.keyId}`);
    }
    const entry: KeyringEntry = {
      keyId: partial.keyId,
      publicJwk: partial.publicJwk,
      createdAt: Date.now(),
      rotation: this.nextRotation++,
    };
    if (partial.privateJwk !== undefined) entry.privateJwk = partial.privateJwk;
    this.entries.set(entry.keyId, entry);
    if (this.activeKeyIdInternal === undefined) this.activeKeyIdInternal = entry.keyId;
    this.evict();
    return entry;
  }

  private evict(): void {
    if (this.entries.size <= this.maxRetainedKeys) return;
    const candidates = [...this.entries.values()]
      .filter((e) => e.keyId !== this.activeKeyIdInternal)
      .sort((a, b) => a.rotation - b.rotation);
    const toEvict = this.entries.size - this.maxRetainedKeys;
    for (const e of candidates.slice(0, toEvict)) {
      this.entries.delete(e.keyId);
    }
  }
}
