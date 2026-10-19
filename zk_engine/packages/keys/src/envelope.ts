/**
 * Signed proof envelopes (ADR-0009) built on `@zkpe/proof-format`.
 *
 * Signing order (resolves the proofHash ↔ signature circularity):
 *   1. content = v2 fields minus proofHash and signature
 *   2. proofHash = keccak256(canonical(content))         ← binds content
 *   3. sigInput  = canonical(content + proofHash)         ← binds version + hash
 *   4. signature = Ed25519(sigInput)
 *
 * Verification therefore recomputes proofHash over the content (signature
 * excluded — proof-format's validateEnvelope does this) and verifies the
 * signature over the envelope minus the signature section.
 */

import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import {
  SIGNED_FORMAT_VERSION,
  computeProofHash,
  isValidSignatureShape,
  signatureInput,
  validateEnvelope,
  type SignedEnvelope,
} from '@zkpe/proof-format';
import { InvalidKeyError, SignatureVerificationError } from './errors.js';
import type { EdJwk } from './keypair.js';
import { importPrivateJwk, importPublicJwk, toNodeJwk, validatePrivateJwk, validatePublicJwk } from './keypair.js';
import { KeyRing } from './keyring.js';

export type SigningMaterial =
  | { kind: 'keyring'; ring: KeyRing; keyId?: string }
  | { kind: 'privateJwk'; privateJwk: EdJwk };

/** Sign a v1 (or v2-shaped content) envelope into a signed v2 envelope. */
export function signEnvelope(
  envelope: Omit<SignedEnvelope, 'formatVersion' | 'signature'>,
  material: SigningMaterial,
): SignedEnvelope {
  let privateJwk: EdJwk;
  let keyId: string;
  let keyVersion: number | undefined;

  if (material.kind === 'keyring') {
    const key = material.keyId ?? material.ring.activeKeyId;
    if (!key) throw new Error('key ring has no active key');
    const entry = material.ring.get(key);
    if (!entry.privateJwk) throw new Error(`key ${key} has no private key`);
    privateJwk = entry.privateJwk;
    keyId = entry.keyId;
    keyVersion = entry.rotation;
  } else {
    const errors = validatePrivateJwk(material.privateJwk);
    if (errors.length > 0) throw new InvalidKeyError('invalid private JWK', errors);
    keyId = importPrivateJwk(material.privateJwk).keyId;
    privateJwk = material.privateJwk;
  }

  const { proofHash: _ph, ...content } = envelope;
  const proofHash = computeProofHash({ ...content, formatVersion: SIGNED_FORMAT_VERSION });
  const signature: SignedEnvelope['signature'] = { algo: 'ed25519', keyId, value: '' };
  if (keyVersion !== undefined) signature.keyVersion = keyVersion;
  const signed: SignedEnvelope = {
    ...content,
    formatVersion: SIGNED_FORMAT_VERSION,
    proofHash,
    signature,
  };
  signed.signature.value = signCanonical(signed, privateJwk);
  return signed;
}

/**
 * Verify a signed envelope. Returns a list of reasons (empty = valid and
 * properly signed). `requireSigned` makes v1 envelopes a policy failure.
 */
export function verifyEnvelope(
  envelope: unknown,
  verifier: { ring?: KeyRing; publicJwk?: EdJwk } = {},
  options: { requireSigned?: boolean } = {},
): string[] {
  const reasons = validateEnvelope(envelope);
  if (reasons.length > 0) return reasons;

  const e = envelope as Record<string, unknown>;
  if (e['formatVersion'] !== SIGNED_FORMAT_VERSION) {
    if (options.requireSigned === true) {
      return ['unsigned envelope (formatVersion 1) rejected: signatures required'];
    }
    return [];
  }
  if (!isValidSignatureShape(e['signature'])) {
    return ['malformed signature section'];
  }
  const sig = e['signature'] as SignedEnvelope['signature'];
  if (sig.algo !== 'ed25519') {
    return [`unsupported signature algorithm ${sig.algo}`];
  }

  let publicJwk: EdJwk;
  if (verifier.publicJwk) {
    const errors = validatePublicJwk(verifier.publicJwk);
    if (errors.length > 0) return [`invalid verifier public key: ${errors.join('; ')}`];
    if (importPublicJwk(verifier.publicJwk).keyId !== sig.keyId) {
      return ['signature keyId does not match the provided public key'];
    }
    publicJwk = verifier.publicJwk;
  } else if (verifier.ring) {
    if (!verifier.ring.has(sig.keyId)) {
      return [`unknown signing key ${sig.keyId} (not in key ring)`];
    }
    publicJwk = verifier.ring.get(sig.keyId).publicJwk;
  } else {
    return ['no verification key supplied (pass a key ring or public key)'];
  }

  const canonical = signatureInput(e);
  const valid = verifyCanonical(canonical, sig.value, publicJwk);
  return valid ? [] : ['signature does not verify over the canonical envelope'];
}

/** Throw-friendly variant of verifyEnvelope. */
export function assertEnvelopeSignature(
  envelope: unknown,
  verifier: { ring?: KeyRing; publicJwk?: EdJwk } = {},
  options: { requireSigned?: boolean } = {},
): void {
  const reasons = verifyEnvelope(envelope, verifier, options);
  if (reasons.length > 0) throw new SignatureVerificationError(reasons);
}

function signCanonical(signed: SignedEnvelope, privateJwk: EdJwk): string {
  const privateKey = createPrivateKey({ key: toNodeJwk(privateJwk), format: 'jwk' });
  const data = Buffer.from(signatureInput(signed), 'utf8');
  return sign(null, data, privateKey).toString('hex');
}

function verifyCanonical(canonical: string, signatureHex: string, publicJwk: EdJwk): boolean {
  const publicKey = createPublicKey({ key: toNodeJwk(publicJwk), format: 'jwk' });
  return verify(null, Buffer.from(canonical, 'utf8'), publicKey, Buffer.from(signatureHex, 'hex'));
}
