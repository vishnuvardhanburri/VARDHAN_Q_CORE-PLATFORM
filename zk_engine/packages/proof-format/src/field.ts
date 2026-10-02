import { BN254_SCALAR_FIELD_ORDER } from './constants.js';

const DECIMAL = /^(0|[1-9][0-9]*)$/;

/**
 * True if `value` is a canonical BN254 field element: a decimal string, no
 * leading zeros, in [0, r).
 */
export function isValidFieldElement(value: unknown): value is string {
  if (typeof value !== 'string' || !DECIMAL.test(value)) return false;
  const n = BigInt(value);
  return n < BN254_SCALAR_FIELD_ORDER;
}

/**
 * Normalize a decimal string into canonical field-element form.
 * Throws on invalid input (leading zeros, out of range, non-decimal).
 */
export function parseFieldElement(value: string): string {
  if (!isValidFieldElement(value)) {
    throw new RangeError(`not a canonical BN254 field element: ${JSON.stringify(value)}`);
  }
  return value;
}
