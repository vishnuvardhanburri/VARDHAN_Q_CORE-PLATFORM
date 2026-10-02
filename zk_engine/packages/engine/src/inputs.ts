/**
 * Manifest-driven input validation and witness encoding.
 *
 * Raw prover inputs are validated against the certified manifest
 * (ADR-0007 G-Audit): every field element must be canonical (decimal, in
 * [0, r)), every `u1` must be 0 or 1, and arities must match exactly. The
 * output is a normalized witness object with canonical decimal strings —
 * exactly what the wasm witness calculator consumes.
 */

import { parseFieldElement } from '@zkpe/proof-format';
import type { Circuit } from './circuit.js';

/** Thrown when raw inputs do not satisfy the circuit's manifest schema. */
export class InputValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`input validation failed for ${issues.join('; ')}`);
    this.name = 'InputValidationError';
  }
}

function toArity(spec: { id: string; arity: number | string }): number {
  return typeof spec.arity === 'number' ? spec.arity : 1;
}

function normalizeValue(spec: { id: string; type: 'field' | 'u8' | 'u32' | 'u1' }, value: unknown): string {
  const s = String(value);
  if (spec.type === 'field') {
    return parseFieldElement(s);
  }
  if (spec.type === 'u1') {
    if (s !== '0' && s !== '1') {
      throw new InputValidationError([`${spec.id} must be 0 or 1 (u1), got ${JSON.stringify(value)}`]);
    }
    return s;
  }
  // u8/u32: decimal integer within range.
  if (!/^(0|[1-9][0-9]*)$/.test(s)) {
    throw new InputValidationError([`${spec.id} must be a decimal integer, got ${JSON.stringify(value)}`]);
  }
  const max = spec.type === 'u8' ? 255 : 4294967295;
  if (BigInt(s) > BigInt(max)) {
    throw new InputValidationError([`${spec.id} exceeds ${spec.type} range: ${s}`]);
  }
  return s;
}

function normalizeList(spec: { id: string; type: 'field' | 'u8' | 'u32' | 'u1'; arity: number | string }, values: unknown): string[] {
  if (!Array.isArray(values)) {
    throw new InputValidationError([`${spec.id} must be an array of arity ${toArity(spec)}`]);
  }
  const arity = toArity(spec);
  if (values.length !== arity) {
    throw new InputValidationError([`${spec.id} expected arity ${arity}, got ${values.length}`]);
  }
  return values.map((v) => normalizeValue(spec, v));
}

/**
 * Validate raw inputs against the circuit manifest and return a normalized
 * witness object (canonical decimal strings, keyed by signal name).
 * Throws {@link InputValidationError} on any violation.
 */
export function parseCircuitInputs(
  circuit: Circuit,
  raw: Record<string, unknown>,
): Record<string, string | string[]> {
  const issues: string[] = [];
  const out: Record<string, string | string[]> = {};
  const specs = [...circuit.manifest.inputs, ...circuit.manifest.privateInputs];

  for (const spec of specs) {
    const value = raw[spec.id];
    if (value === undefined) {
      issues.push(`missing input ${spec.id}`);
      continue;
    }
    try {
      out[spec.id] = spec.arity === 1 ? normalizeValue(spec, value) : normalizeList(spec, value);
    } catch (err) {
      issues.push(...(err instanceof InputValidationError ? err.issues : [String(err)]));
    }
  }

  if (issues.length > 0) {
    throw new InputValidationError(issues);
  }
  return out;
}
