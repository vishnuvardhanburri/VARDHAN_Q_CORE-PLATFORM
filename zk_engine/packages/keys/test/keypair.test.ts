/**
 * Unit tests for key generation, validation, export/import, and key ids
 * (`src/keypair.ts`, ADR-0009).
 */

import { describe, expect, it } from 'vitest';
import {
  computeKeyId,
  generateKeyPair,
  importKeyPair,
  importPrivateJwk,
  importPrivateKeyPem,
  importPublicJwk,
  importPublicKeyPem,
  privateKeyToPem,
  publicKeyToPem,
  validatePrivateJwk,
  validatePublicJwk,
  type EdJwk,
} from '../src/keypair.js';
import { InvalidKeyError } from '../src/errors.js';

describe('generateKeyPair', () => {
  it('produces well-formed OKP/Ed25519 JWKs with a stable keyId', () => {
    const kp = generateKeyPair();
    expect(kp.publicJwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519' });
    expect(kp.privateJwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519' });
    expect(kp.privateJwk.d).toBeTruthy();
    expect(kp.publicJwk.d).toBeUndefined();
    expect(kp.keyId).toMatch(/^[0-9a-f]{64}$/);
    expect(computeKeyId(kp.publicJwk)).toBe(kp.keyId);
  });

  it('generates unique keys', () => {
    expect(generateKeyPair().keyId).not.toBe(generateKeyPair().keyId);
  });
});

describe('export/import round trips', () => {
  it('JWK → PEM → JWK preserves the key and keyId', () => {
    const kp = generateKeyPair();
    const privPem = privateKeyToPem(kp.privateJwk);
    const pubPem = publicKeyToPem(kp.publicJwk);
    expect(privPem).toContain('BEGIN PRIVATE KEY');
    expect(pubPem).toContain('BEGIN PUBLIC KEY');

    const re = importPrivateKeyPem(privPem);
    expect(re.keyId).toBe(kp.keyId);
    expect(re.publicJwk.x).toBe(kp.publicJwk.x);

    const pub = importPublicKeyPem(pubPem);
    expect(pub.keyId).toBe(kp.keyId);
  });

  it('importKeyPair dispatches on JWK and PEM material', () => {
    const kp = generateKeyPair();
    expect(importKeyPair(kp.privateJwk)).toMatchObject({ keyId: kp.keyId });
    expect(importKeyPair(kp.publicJwk)).toMatchObject({ keyId: kp.keyId });
    expect(importKeyPair(privateKeyToPem(kp.privateJwk))).toMatchObject({ keyId: kp.keyId });
    expect(importKeyPair(publicKeyToPem(kp.publicJwk))).toMatchObject({ keyId: kp.keyId });
    expect(() => importKeyPair('not a key')).toThrow(InvalidKeyError);
  });
});

describe('validation (negative tests)', () => {
  it('rejects wrong kty/crv and bad x lengths', () => {
    const jwk = generateKeyPair().publicJwk;
    expect(validatePublicJwk({ ...jwk, kty: 'EC' })).toContain('kty must be OKP');
    expect(validatePublicJwk({ ...jwk, crv: 'X25519' })).toContain('crv must be Ed25519');
    expect(validatePublicJwk({ ...jwk, x: 'too-short' })).toContain('x must be a 32-byte base64url value');
    expect(validatePublicJwk({ ...jwk, x: 'a'.repeat(44) })).toContain('x must be a 32-byte base64url value');
    expect(validatePublicJwk(null)).toHaveLength(1);
  });

  it('rejects public JWKs carrying a private component', () => {
    const kp = generateKeyPair();
    expect(validatePublicJwk({ ...kp.publicJwk, d: kp.privateJwk.d })).toContain(
      'public key must not carry a private component (d)',
    );
  });

  it('rejects private JWKs whose d does not match x', () => {
    const kp = generateKeyPair();
    const bad: EdJwk = { ...kp.privateJwk, d: kp.privateJwk.d === 'A'.repeat(43) ? 'B'.repeat(43) : kp.privateJwk.d! };
    const other = generateKeyPair();
    const mismatched: EdJwk = { ...other.privateJwk, x: kp.publicJwk.x };
    expect(validatePrivateJwk(mismatched)).toContain('d does not match x (private/public mismatch)');
    expect(validatePrivateJwk(bad)).toEqual([]);
  });

  it('rejects malformed PEM input', () => {
    expect(() => importPrivateKeyPem('-----BEGIN PRIVATE KEY-----\ngarbage\n-----END PRIVATE KEY-----')).toThrow(InvalidKeyError);
    expect(() => importPublicKeyPem('not pem')).toThrow(InvalidKeyError);
  });

  it('rejects JWKs with missing components', () => {
    expect(() => importPublicJwk({} as EdJwk)).toThrow(InvalidKeyError);
    expect(() => importPrivateJwk({ kty: 'OKP', crv: 'Ed25519' } as EdJwk)).toThrow(InvalidKeyError);
  });
});
