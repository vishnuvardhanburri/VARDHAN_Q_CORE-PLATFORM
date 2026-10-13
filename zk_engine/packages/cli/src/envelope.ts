/**
 * Envelope file I/O — the wire format `zk` commands share (ADR-0006/-0009).
 * `zk prove` writes a file; `zk verify`/`zk register`/`zk status` read it.
 * No crypto here — validation delegates to @zkpe/proof-format.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  validateEnvelope,
  type ProofEnvelope,
  type SignedEnvelope,
} from '@zkpe/proof-format';

export type AnyEnvelope = ProofEnvelope | SignedEnvelope;

/** Read + structurally validate an envelope file (throws on malformed). */
export async function readEnvelopeFile(path: string): Promise<AnyEnvelope> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(`cannot read envelope file ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseEnvelope(raw, path);
}

export function parseEnvelope(raw: string, source = 'input'): AnyEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${source} is not valid JSON`);
  }
  const errors = validateEnvelope(value);
  if (errors.length > 0) {
    throw new Error(`${source} is not a valid envelope: ${errors.join('; ')}`);
  }
  return value as AnyEnvelope;
}

/** Write an envelope file atomically-ish (direct write after mkdir). */
export async function writeEnvelopeFile(path: string, envelope: AnyEnvelope): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
}

export function envelopeCircuitId(envelope: AnyEnvelope): string {
  return envelope.circuitId;
}