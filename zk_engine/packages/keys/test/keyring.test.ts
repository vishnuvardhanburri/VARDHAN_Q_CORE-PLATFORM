/**
 * Tests for the rotating KeyRing (`src/keyring.ts`, ADR-0009).
 */

import { describe, expect, it } from 'vitest';
import { generateKeyPair, importPrivateKeyPem, privateKeyToPem } from '../src/keypair.js';
import { KeyRing } from '../src/keyring.js';
import { KeyringCorruptError, NoActiveKeyError, UnknownKeyError } from '../src/errors.js';

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('KeyRing basics', () => {
  it('signs with the active key and verifies', () => {
    const ring = KeyRing.create();
    ring.rotate();
    const active = ring.activeKeyId!;
    const { signatureHex } = ring.signBytes(utf8('hello'));
    expect(ring.verifyBytes(utf8('hello'), signatureHex, active)).toBe(true);
    expect(ring.verifyBytes(utf8('hellO'), signatureHex, active)).toBe(false);
    expect(ring.verifyBytes(utf8('hello'), signatureHex, '0'.repeat(64))).toBe(false);
  });

  it('throws NoActiveKeyError on an empty ring', () => {
    const ring = KeyRing.create();
    expect(() => ring.signBytes(utf8('x'))).toThrow(NoActiveKeyError);
    expect(ring.activeKeyId).toBeUndefined();
  });

  it('rejects a claimed keyId that does not match the key', () => {
    const ring = KeyRing.create();
    const kp = generateKeyPair();
    expect(() => ring.addKey({ ...kp, keyId: 'f'.repeat(64) })).toThrow(/keyId mismatch/);
    expect(() => ring.addKey({ ...kp, keyId: 'not-hex' })).toThrow(/keyId mismatch/);
  });

  it('rejects duplicate keys', () => {
    const ring = KeyRing.create();
    const kp = generateKeyPair();
    ring.addKey(kp);
    expect(() => ring.addKey(kp)).toThrow(/duplicate/);
  });

  it('imports via PEM and private JWK', () => {
    const ring = KeyRing.create();
    const kp = generateKeyPair();
    ring.addKey(importPrivateKeyPem(privateKeyToPem(kp.privateJwk)));
    expect(ring.size).toBe(1);
    expect(ring.has(kp.keyId)).toBe(true);
  });
});

describe('rotation', () => {
  it('rotate() makes the new key active but old keys still verify', () => {
    const ring = KeyRing.create();
    const first = ring.rotate();
    const firstSig = ring.signBytes(utf8('m1')).signatureHex;
    const second = ring.rotate();
    expect(ring.activeKeyId).toBe(second.keyId);
    expect(second.rotation).toBeGreaterThan(first.rotation);

    const secondSig = ring.signBytes(utf8('m1')).signatureHex;
    expect(secondSig).not.toBe(firstSig);
    expect(ring.verifyBytes(utf8('m1'), firstSig, first.keyId)).toBe(true);
    expect(ring.verifyBytes(utf8('m1'), secondSig, second.keyId)).toBe(true);
  });

  it('setActiveKey switches signing without rotating', () => {
    const ring = KeyRing.create();
    const a = ring.rotate();
    ring.rotate();
    ring.setActiveKey(a.keyId);
    const { keyId } = ring.signBytes(utf8('x'));
    expect(keyId).toBe(a.keyId);
    expect(() => ring.setActiveKey('c'.repeat(64))).toThrow(UnknownKeyError);
  });

  it('cannot remove the active key; removal prunes history', () => {
    const ring = KeyRing.create();
    const a = ring.rotate();
    const b = ring.rotate();
    expect(() => ring.remove(b.keyId)).toThrow(/active/);
    ring.setActiveKey(b.keyId);
    ring.remove(a.keyId);
    expect(ring.size).toBe(1);
    expect(() => ring.remove(a.keyId)).toThrow(UnknownKeyError);
  });

  it('maxRetainedKeys evicts the oldest non-active keys', () => {
    const ring = KeyRing.create({ maxRetainedKeys: 3 });
    const k1 = ring.rotate().keyId;
    const k2 = ring.rotate().keyId;
    const k3 = ring.rotate().keyId;
    const k4 = ring.rotate().keyId;
    expect(ring.size).toBe(3);
    expect(ring.activeKeyId).toBe(k4);
    expect(ring.has(k3)).toBe(true);
    expect(ring.has(k1)).toBe(false);
    expect(ring.has(k2)).toBe(true);

    const k5 = ring.rotate().keyId;
    expect(ring.size).toBe(3);
    expect(ring.activeKeyId).toBe(k5);
    expect(ring.has(k2)).toBe(false);
  });
});

describe('persistence', () => {
  it('serialize → deserialize round trip preserves keys and active key', () => {
    const ring = KeyRing.create();
    const a = ring.rotate();
    const b = ring.rotate();
    ring.setActiveKey(a.keyId);
    const restored = KeyRing.fromJSON(JSON.stringify(ring.toJSON()));
    expect(restored.activeKeyId).toBe(a.keyId);
    expect(restored.list()).toEqual(ring.list());
    const { signatureHex } = restored.signBytes(utf8('persist'));
    expect(restored.verifyBytes(utf8('persist'), signatureHex, a.keyId)).toBe(true);
    expect(restored.verifyBytes(utf8('persist'), signatureHex, b.keyId)).toBe(false);
  });

  it('fromJSON rejects corrupt documents', () => {
    expect(() => KeyRing.fromJSON('not json')).toThrow(KeyringCorruptError);
    expect(() => KeyRing.fromJSON('{"version":9}')).toThrow(KeyringCorruptError);
    expect(() => KeyRing.fromJSON('{"version":1,"entries":"x"}')).toThrow(KeyringCorruptError);
    expect(() =>
      KeyRing.fromJSON(JSON.stringify({ version: 1, entries: [{ keyId: 'short', rotation: 1, publicJwk: {} }] })),
    ).toThrow(KeyringCorruptError);
    expect(() =>
      KeyRing.fromJSON(JSON.stringify({ version: 1, entries: [], activeKeyId: 'a'.repeat(64) })),
    ).toThrow(KeyringCorruptError);
  });
});
