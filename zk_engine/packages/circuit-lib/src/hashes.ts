/**
 * Artifact hashing for `@zkpe/circuit-lib` (ADR-0008: SHA-256 for artifact
 * integrity). Binary hashing stays SHA-256 even though in-circuit hashing is
 * Poseidon — artifacts, envelopes, and registries are all binary/external
 * surfaces where SHA-256 is required for compatibility.
 *
 * All digests are lowercase hex with a `0x` prefix, matching
 * `@zkpe/proof-format` hash conventions and the manifest validator.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

function toHex(bytes: Uint8Array): string {
  let out = '0x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** sha256 of a file's raw bytes, `0x`-prefixed lowercase hex. */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(toHex(hash.digest())));
  });
}

/** sha256 of a byte buffer, `0x`-prefixed lowercase hex. */
export function sha256Bytes(data: Uint8Array): string {
  return toHex(createHash('sha256').update(data).digest());
}

/** sha256 of a UTF-8 string, `0x`-prefixed lowercase hex. */
export function sha256Utf8(input: string): string {
  return toHex(createHash('sha256').update(input, 'utf8').digest());
}
