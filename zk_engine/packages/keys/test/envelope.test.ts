/**
 * Tests for signed proof envelopes (`src/envelope.ts`, ADR-0009):
 * round trips, golden vector (openssl-verified), deterministic
 * serialization, compatibility, and negative cases.
 */

import { describe, expect, it } from 'vitest';
import { createPrivateKey, sign } from 'node:crypto';
import {
  SIGNED_FORMAT_VERSION,
  createEnvelope,
  signatureInput,
  validateEnvelope,
  type ProofEnvelope,
} from '@zkpe/proof-format';
import { importPrivateKeyPem, importPublicKeyPem, publicKeyToPem, type EdJwk } from '../src/keypair.js';
import { KeyRing } from '../src/keyring.js';
import { signEnvelope, verifyEnvelope } from '../src/envelope.js';
import { assertEnvelopeSignature } from '../src/envelope.js';
import { SignatureVerificationError } from '../src/errors.js';

function baseEnvelope(): ProofEnvelope {
  return createEnvelope({
    circuitId: 'poseidon-preimage',
    circuitVersion: '1.0.0',
    vkHash: '0x' + 'a'.repeat(64),
    publicInputs: ['7'],
    proof: {
      pi_a: ['1', '2', '3'],
      pi_b: [
        ['1', '2'],
        ['3', '4'],
        ['1', '1'],
      ],
      pi_c: ['5', '6', '1'],
    },
    proverTimestamp: 1_700_000_000,
  });
}

function ringWithKey(): { ring: KeyRing; keyId: string } {
  const ring = KeyRing.create();
  const entry = ring.rotate();
  return { ring, keyId: entry.keyId };
}

describe('signEnvelope / verifyEnvelope', () => {
  it('round trips: v2 signed envelope verifies with the key ring', () => {
    const { ring } = ringWithKey();
    const signed = signEnvelope(baseEnvelope(), { kind: 'keyring', ring });
    expect(signed.formatVersion).toBe(SIGNED_FORMAT_VERSION);
    expect(signed.signature.algo).toBe('ed25519');
    expect(signed.signature.value).toMatch(/^[0-9a-f]{128}$/);
    expect(validateEnvelope(signed)).toEqual([]);
    expect(verifyEnvelope(signed, { ring })).toEqual([]);
  });

  it('verifies with an exported PEM public key (cross-format compatibility)', () => {
    const { ring, keyId } = ringWithKey();
    const signed = signEnvelope(baseEnvelope(), { kind: 'keyring', ring });
    const pubPem = publicKeyPemOf(ring.get(keyId).publicJwk);
    const imported = importPublicKeyPem(pubPem);
    expect(verifyEnvelope(signed, { publicJwk: imported.publicJwk })).toEqual([]);
    expect(verifyEnvelope(signed, { publicJwk: imported.publicJwk }, { requireSigned: true })).toEqual([]);
  });

  it('keyVersion mirrors the signing key rotation counter', () => {
    const ring = KeyRing.create();
    ring.rotate();
    const second = ring.rotate();
    const signed = signEnvelope(baseEnvelope(), { kind: 'keyring', ring });
    expect(signed.signature.keyId).toBe(second.keyId);
    expect(signed.signature.keyVersion).toBe(second.rotation);
  });

  it('signs deterministically: same envelope + same key → same signature', () => {
    const ring = KeyRing.create();
    ring.rotate();
    const a = signEnvelope(baseEnvelope(), { kind: 'keyring', ring });
    const b = signEnvelope(baseEnvelope(), { kind: 'keyring', ring });
    expect(a.signature.value).toBe(b.signature.value);
    expect(a.proofHash).toBe(b.proofHash);
  });

  it('serialization is canonical: key order does not change the signature', () => {
    const ring = KeyRing.create();
    ring.rotate();
    const signed = signEnvelope(baseEnvelope(), { kind: 'keyring', ring });
    const shuffled = JSON.parse(JSON.stringify(signed)) as typeof signed;
    shuffled.circuitId = signed.circuitId; // keep shape; rewrite key order:
    const reordered = {
      proof: shuffled.proof,
      circuitId: signed.circuitId,
      signature: shuffled.signature,
      publicInputs: shuffled.publicInputs,
      formatVersion: 2,
      circuitVersion: signed.circuitVersion,
      proverTimestamp: signed.proverTimestamp,
      vkHash: signed.vkHash,
      proofHash: signed.proofHash,
    };
    expect(signatureInput(reordered)).toBe(signatureInput(signed));
    expect(JSON.stringify(Object.keys(reordered))).not.toBe(JSON.stringify(Object.keys(signed)));
  });
});

describe('golden vector (openssl-verified)', () => {
  it('reproduces the recorded signature for the recorded key', () => {
    const privPem = [
      '-----BEGIN PRIVATE KEY-----',
      'MC4CAQAwBQYDK2VwBCIEIDvRkQNosMdE5dRzN6ee1JeVNfk/rB04jT0HCiK3sh15',
      '-----END PRIVATE KEY-----',
    ].join('\n');
    const kp = importPrivateKeyPem(privPem);
    expect(kp.keyId).toBe('3f6cb63b565b2d16699ddbb481c7ba040734f7edddf9993511ce124eec4ab499');
    const sig = sign(null, Buffer.from('M2 golden vector', 'utf8'), createPrivateKey({ key: privPem, format: 'pem' }));
    expect(sig.toString('hex')).toBe(
      '2308cb3d7a7839a10438172d9746f26768058abd0c37ea39aa93456655f8c80ebcef28df1d90ae1c12aedabf1e39ab37a1954fe20ea5328055391f3bd5514f09',
    );
  });
});

describe('negative tests', () => {
  it('rejects tampered payloads', () => {
    const { ring } = ringWithKey();
    const signed = signEnvelope(baseEnvelope(), { kind: 'keyring', ring });
    const tampered = structuredClone(signed);
    tampered.publicInputs = ['999'];
    expect(verifyEnvelope(tampered, { ring })).not.toEqual([]);
  });

  it('rejects a downgrade attempt (v2 → v1 strip)', () => {
    const { ring } = ringWithKey();
    const signed = signEnvelope(baseEnvelope(), { kind: 'keyring', ring });
    const v1 = baseEnvelope();
    expect(v1.formatVersion).toBe(1);
    expect(verifyEnvelope(v1, { ring })).toEqual([]); // structurally fine…
    expect(verifyEnvelope(v1, { ring }, { requireSigned: true })).not.toEqual([]); // …policy rejects
    expect(() => assertEnvelopeSignature(v1, { ring }, { requireSigned: true })).toThrow(
      SignatureVerificationError,
    );
    expect(signed.signature.value.length).toBe(128);
  });

  it('rejects signatures from an unknown key', () => {
    const { ring } = ringWithKey();
    const other = KeyRing.create();
    other.rotate();
    const signed = signEnvelope(baseEnvelope(), { kind: 'keyring', ring });
    expect(verifyEnvelope(signed, { ring: other })).toEqual([
      `unknown signing key ${signed.signature.keyId} (not in key ring)`,
    ]);
  });

  it('rejects a mutated signature value', () => {
    const { ring } = ringWithKey();
    const signed = signEnvelope(baseEnvelope(), { kind: 'keyring', ring });
    const tampered = structuredClone(signed);
    const flip = tampered.signature.value.startsWith('00') ? '01' : '00';
    tampered.signature.value = flip + tampered.signature.value.slice(2);
    expect(verifyEnvelope(tampered, { ring })).not.toEqual([]);
  });

  it('rejects a keyId that does not match the provided public key', () => {
    const { ring } = ringWithKey();
    const other = KeyRing.create();
    other.rotate();
    const signed = signEnvelope(baseEnvelope(), { kind: 'keyring', ring });
    const otherPub = other.get(other.activeKeyId!).publicJwk;
    const reasons = verifyEnvelope(signed, { publicJwk: otherPub });
    expect(reasons).toContain('signature keyId does not match the provided public key');
  });

  it('rejects structurally broken envelopes before crypto', () => {
    const { ring } = ringWithKey();
    const signed = signEnvelope(baseEnvelope(), { kind: 'keyring', ring });
    const broken = structuredClone(signed);
    broken.vkHash = 'nope';
    expect(verifyEnvelope(broken, { ring })).toContain('vkHash must be 0x-prefixed 32-byte hex');
  });

  it('requires a verification key', () => {
    const { ring } = ringWithKey();
    const signed = signEnvelope(baseEnvelope(), { kind: 'keyring', ring });
    expect(verifyEnvelope(signed, {})).toEqual(['no verification key supplied (pass a key ring or public key)']);
  });

  it('assertEnvelopeSignature throws with the reasons', () => {
    const { ring } = ringWithKey();
    const signed = signEnvelope(baseEnvelope(), { kind: 'keyring', ring });
    const tampered = structuredClone(signed);
    tampered.circuitId = 'merkle-inclusion';
    try {
      assertEnvelopeSignature(tampered, { ring });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SignatureVerificationError);
      expect((err as SignatureVerificationError).reasons.length).toBeGreaterThan(0);
    }
  });
});

function publicKeyPemOf(publicJwk: EdJwk): string {
  return publicKeyToPem(publicJwk);
}
