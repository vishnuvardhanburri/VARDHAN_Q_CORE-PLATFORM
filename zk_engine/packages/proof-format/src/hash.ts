import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha2';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return `0x${out}`;
}

/** keccak256 of raw bytes, 0x-prefixed hex. */
export function keccak256Bytes(bytes: Uint8Array): string {
  return toHex(keccak_256(bytes));
}

/** keccak256 of a UTF-8 string, 0x-prefixed hex. */
export function keccak256Utf8(input: string): string {
  return keccak256Bytes(new TextEncoder().encode(input));
}

/** sha256 of raw bytes, 0x-prefixed hex. */
export function sha256Bytes(bytes: Uint8Array): string {
  return toHex(sha256(bytes));
}

/** sha256 of a UTF-8 string, 0x-prefixed hex. */
export function sha256Utf8(input: string): string {
  return sha256Bytes(new TextEncoder().encode(input));
}
