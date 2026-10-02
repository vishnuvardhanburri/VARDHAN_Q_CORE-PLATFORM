/**
 * Canonical ABI serialization (ADR-0001, cross-language binding).
 *
 * Registry public-input anchoring is defined as
 *
 *     publicInputHash = keccak256(abi.encode(uint256[] publicInputs))   [Solidity]
 *
 * This module is the single shared implementation of that encoding for every
 * non-Solidity consumer (engine, CLI, tooling, integration harness). It MUST
 * byte-for-byte match what Solidity's `abi.encode` produces for a dynamic
 * `uint256[]`: one 32-byte offset word (`0x20`), one 32-byte length word,
 * then N left-padded 32-byte value words. Every word is 32 bytes wide —
 * never the 1-byte shortcut `0x20` — or the digest silently diverges from
 * the chain's.
 */

import { bytesToHex } from '@noble/hashes/utils';
import { keccak_256 } from '@noble/hashes/sha3';

/** Big-endian left-padded 32-byte word (64 hex chars). */
function word(v: bigint | number | string): string {
  const hex = BigInt(v).toString(16);
  if (hex.length > 64) throw new RangeError(`value too large for uint256 word: ${hex}`);
  return '0'.repeat(64 - hex.length) + hex;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * ABI-encode a dynamic `uint256[]`. Returns the same hex as Solidity's
 * `abi.encode(uint256[] memory)` — offset word, length word, value words.
 */
export function encodePublicInputValues(values: readonly (bigint | number | string)[]): string {
  return `0x${word(0x20)}${word(values.length)}${values.map(word).join('')}`;
}

/**
 * Canonical public-input anchor: keccak256 of the ABI encoding.
 * MUST equal Solidity `keccak256(abi.encode(publicInputs))`.
 */
export function publicInputHash(values: readonly (bigint | number | string)[]): string {
  return `0x${bytesToHex(keccak_256(hexToBytes(encodePublicInputValues(values).slice(2))))}`;
}

/**
 * Canonical bytes32 rendering of a circuitId — the exact value produced by
 * Solidity's `bytes32("poseidon-preimage")` (left-aligned string bytes,
 * right-padded with zero bytes, 32 bytes total).
 */
export function circuitIdBytes32(circuitId: string): string {
  const encoded = new TextEncoder().encode(circuitId);
  if (encoded.length > 32) throw new RangeError(`circuitId longer than 32 bytes: ${circuitId}`);
  return `0x${bytesToHex(encoded).padEnd(64, '0')}`;
}

function strip0x(hex: string): string {
  return hex.replace(/^0x/, '');
}

/**
 * ABI-encode one registry proof record — the EXACT value Solidity receives
 * as `abi.encode(bytes32 circuitId, bytes32 vkHash, uint256[] publicInputs,
 * uint256[2] a, uint256[2][2] b, uint256[2] c)`. `b` must already be in the
 * contract's group-element order (real part first per G2 serialization), i.e.
 * `[x_re, x_im]` per compressed point — use `proofAnchorFromEnvelope` for raw
 * snarkjs layouts, which applies the Fp2 swap.
 *
 * Static head: 11 words (circuitId, vkHash, dynamic-array offset `0x160`,
 * a0, a1, b00, b01, b10, b11, c0, c1) followed by the dynamic tail (length +
 * N value words).
 *
 * Scalar inputs (publicInputs, a, b, c) may be 0x-prefixed hex or decimal
 * strings (CLI `prove` emits decimal JSON); every scalar is normalized with
 * `word()` to a 64-char big-endian uint256 before assembly.
 */
export function encodeProofRecord(
  circuitIdBytes: string,
  vkHash: string,
  publicInputs: readonly (bigint | number | string)[],
  a: readonly [string, string],
  b: readonly [readonly [string, string], readonly [string, string]],
  c: readonly [string, string],
): string {
  return (
    '0x' +
    [
      circuitIdBytes,
      vkHash,
      word(0x160),
      ...a.map((v) => word(v)),
      word(b[0][0]),
      word(b[0][1]),
      word(b[1][0]),
      word(b[1][1]),
      ...c.map((v) => word(v)),
      word(publicInputs.length),
      ...publicInputs.map((v) => word(v)),
    ]
      .map(strip0x)
      .join('')
  );
}

/**
 * Canonical on-chain proof anchor: keccak256 of `encodeProofRecord`.
 * MUST equal the `proofHash` Solidity's `ZKVerifierRegistry.registerProof`
 * stores and the key verified against `proofLeaves[proofHash] == true`.
 */
export function registryProofHash(
  circuitIdBytes: string,
  vkHash: string,
  publicInputs: readonly (bigint | number | string)[],
  a: readonly [string, string],
  b: readonly [readonly [string, string], readonly [string, string]],
  c: readonly [string, string],
): string {
  return `0x${bytesToHex(keccak_256(hexToBytes(encodeProofRecord(circuitIdBytes, vkHash, publicInputs, a, b, c).slice(2))))}`;
}

/**
 * Compute the registry proof anchor for a raw engine proof object (snarkjs
 * G2 layout: each `pi_b` row is `[x_im, x_re]`]. Applies the same Fp2 row
 * swap the API adapter and contract witness do, so the result matches the
 * leaf actually written by `ZKVerifierRegistry.registerProof`.
 */
export function proofAnchorFromEnvelope(
  circuitId: string,
  vkHash: string,
  publicInputs: readonly (bigint | number | string)[],
  proof: { pi_a?: readonly string[]; pi_b?: readonly (readonly string[])[]; pi_c?: readonly string[] },
): string {
  const pa = proof.pi_a;
  const pb = proof.pi_b;
  const pc = proof.pi_c;
  if (!pa || !pb || !pc || pa.length < 2 || pb.length < 2 || pb[0]!.length < 2 || pb[1]!.length < 2 || pc.length < 2) {
    throw new RangeError('proof missing snarkjs pi_a/pi_b/pi_c arrays');
  }
  const b00 = pb[0]![1]!;
  const b01 = pb[0]![0]!;
  const b10 = pb[1]![1]!;
  const b11 = pb[1]![0]!;
  const b = [
    [b00, b01],
    [b10, b11],
  ] as const;
  return registryProofHash(circuitIdBytes32(circuitId), vkHash, publicInputs, [pa[0]!, pa[1]!] as const, b, [pc[0]!, pc[1]!] as const);
}