/**
 * Ed25519 key material: generation, validation, export/import (JWK and PEM),
 * and key ids (ADR-0009).
 *
 * - Keys are generated and validated with Node's native `node:crypto`
 *   (Ed25519 / RFC 8032; frozen by ADR-0009).
 * - `keyId` is the SHA-256 thumbprint of the canonical public JWK
 *   (RFC 7638 member order: kty, crv, x) as lowercase hex.
 * - Public JWK shape: `{ kty: 'OKP', crv: 'Ed25519', x: <32B base64url> }`.
 *   Private JWK additionally carries `d` (32B base64url).
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  type JsonWebKey,
} from 'node:crypto';
import { InvalidKeyError } from './errors.js';

/**
 * Ed25519 JWK shape (ADR-0009). `x`/`d` are base64url, 32 bytes each.
 * A local type avoids depending on the DOM lib's `EdJwk`.
 */
export interface EdJwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  d?: string;
}

/** A validated Ed25519 key pair in JWK form. */
export interface KeyPair {
  publicJwk: EdJwk;
  privateJwk: EdJwk;
  keyId: string;
}

/** A public-only key (verification). */
export interface PublicKey {
  publicJwk: EdJwk;
  keyId: string;
}

const CRV = 'Ed25519' as const;
const KTY = 'OKP' as const;

/** Cast our EdJwk into node's JsonWebKey type (they differ only in index signature). */
export function toNodeJwk(jwk: EdJwk): JsonWebKey {
  return jwk as unknown as JsonWebKey;
}

/** Normalize node's exported JWK into our EdJwk shape. */
export function fromNodeJwk(jwk: JsonWebKey): EdJwk {
  const x = jwk.x;
  if (typeof x !== 'string') throw new InvalidKeyError('exported JWK has no x component');
  const out: EdJwk = { kty: 'OKP', crv: 'Ed25519', x };
  if (jwk.d !== undefined) out.d = jwk.d;
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function base64UrlLength(s: unknown): number | null {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const buf = Buffer.from(s, 'base64url');
  return buf.length;
}

/** Errors describing why a public JWK is invalid (empty = valid). */
export function validatePublicJwk(jwk: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(jwk)) return ['public key must be an object'];
  if (jwk['kty'] !== KTY) errors.push(`kty must be ${KTY}`);
  if (jwk['crv'] !== CRV) errors.push(`crv must be ${CRV}`);
  const xLen = base64UrlLength(jwk['x']);
  if (xLen === null || xLen !== 32) errors.push('x must be a 32-byte base64url value');
  if (jwk['d'] !== undefined) errors.push('public key must not carry a private component (d)');
  return errors;
}

/** Errors describing why a private JWK is invalid (empty = valid). */
export function validatePrivateJwk(jwk: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(jwk)) return ['private key must be an object'];
  if (jwk['kty'] !== KTY) errors.push(`kty must be ${KTY}`);
  if (jwk['crv'] !== CRV) errors.push(`crv must be ${CRV}`);
  const xLen = base64UrlLength(jwk['x']);
  if (xLen === null || xLen !== 32) errors.push('x must be a 32-byte base64url value');
  const dLen = base64UrlLength(jwk['d']);
  if (dLen === null || dLen !== 32) errors.push('d must be a 32-byte base64url value');
  if (errors.length === 0) {
    // The private key must derive the claimed public key (x).
    try {
      const derived = publicJwkFromPrivateJwk(jwk as unknown as EdJwk);
      if (derived.x !== jwk['x']) errors.push('d does not match x (private/public mismatch)');
    } catch {
      errors.push('d cannot be interpreted as an Ed25519 private key');
    }
  }
  return errors;
}

/** Derive the public JWK from a private JWK. */
export function publicJwkFromPrivateJwk(privateJwk: EdJwk): EdJwk {
  const priv = createPrivateKey({ key: toNodeJwk(privateJwk), format: 'jwk' });
  return fromNodeJwk(createPublicKey(priv).export({ format: 'jwk' }) as unknown as JsonWebKey);
}

/**
 * Compute the key id: SHA-256 of the canonical public JWK
 * (RFC 7638 thumbprint input: kty, crv, x in that order), lowercase hex.
 */
export function computeKeyId(publicJwk: EdJwk): string {
  const canonical =
    `{"crv":"${publicJwk.crv}","kty":"${publicJwk.kty}","x":"${publicJwk.x}"}`;
  return createHashSha256Hex(canonical);
}

/** SHA-256 of a UTF-8 string, lowercase hex (no 0x prefix). */
export function createHashSha256Hex(utf8: string): string {
  return createHash('sha256').update(utf8, 'utf8').digest('hex');
}

/** Generate a fresh Ed25519 key pair. */
export function generateKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateJwk = privateKey.export({ format: 'jwk' }) as EdJwk;
  const publicJwk = publicKey.export({ format: 'jwk' }) as EdJwk;
  return { publicJwk, privateJwk, keyId: computeKeyId(publicJwk) };
}

/**
 * Import a key pair from a private JWK, a public JWK, or PEM. The private key
 * is fully validated (shape + consistency) and the keyId is recomputed.
 */
export function importKeyPair(material: unknown): KeyPair | PublicKey {
  if (isRecord(material)) {
    if (material['d'] !== undefined) {
      return importPrivateJwk(material as unknown as EdJwk);
    }
    if (material['x'] !== undefined && material['kty'] !== undefined) {
      return importPublicJwk(material as unknown as EdJwk);
    }
  }
  if (typeof material === 'string' && material.includes('PRIVATE KEY')) {
    return importPrivateKeyPem(material);
  }
  if (typeof material === 'string' && material.includes('PUBLIC KEY')) {
    return importPublicKeyPem(material);
  }
  throw new InvalidKeyError('cannot interpret key material', [
    'expected a private JWK, public JWK, or PEM string',
  ]);
}

/** Import from a validated private JWK. */
export function importPrivateJwk(privateJwk: EdJwk): KeyPair {
  const errors = validatePrivateJwk(privateJwk);
  if (errors.length > 0) throw new InvalidKeyError('invalid private JWK', errors);
  const publicJwk = publicJwkFromPrivateJwk(privateJwk);
  return { publicJwk, privateJwk, keyId: computeKeyId(publicJwk) };
}

/** Import from a validated public JWK (verification only). */
export function importPublicJwk(publicJwk: EdJwk): PublicKey {
  const errors = validatePublicJwk(publicJwk);
  if (errors.length > 0) throw new InvalidKeyError('invalid public JWK', errors);
  return { publicJwk, keyId: computeKeyId(publicJwk) };
}

/** Export a public JWK to SPKI PEM. */
export function publicKeyToPem(publicJwk: EdJwk): string {
  return createPublicKey({ key: toNodeJwk(publicJwk), format: 'jwk' }).export({
    format: 'pem',
    type: 'spki',
  }) as string;
}

/** Export a private JWK to PKCS8 PEM. */
export function privateKeyToPem(privateJwk: EdJwk): string {
  return createPrivateKey({ key: toNodeJwk(privateJwk), format: 'jwk' }).export({
    format: 'pem',
    type: 'pkcs8',
  }) as string;
}

/** Import a key pair from PKCS8 PEM. */
export function importPrivateKeyPem(pem: string): KeyPair {
  try {
    const privateKey = createPrivateKey({ key: pem, format: 'pem' });
    const privateJwk = privateKey.export({ format: 'jwk' }) as EdJwk;
    return importPrivateJwk(privateJwk);
  } catch (err) {
    throw new InvalidKeyError(`invalid PKCS8 PEM: ${(err as Error).message}`);
  }
}

/** Import a public key from SPKI PEM (verification only). */
export function importPublicKeyPem(pem: string): PublicKey {
  try {
    const publicKey = createPublicKey({ key: pem, format: 'pem' });
    const publicJwk = publicKey.export({ format: 'jwk' }) as EdJwk;
    return importPublicJwk(publicJwk);
  } catch (err) {
    throw new InvalidKeyError(`invalid SPKI PEM: ${(err as Error).message}`);
  }
}

/** Generate a fresh key pair with an explicit random id label. */
export function generateNamedKeyPair(): KeyPair & { id: string } {
  return { ...generateKeyPair(), id: randomUUID() };
}
