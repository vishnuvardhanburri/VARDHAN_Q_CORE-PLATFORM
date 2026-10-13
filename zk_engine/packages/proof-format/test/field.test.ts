import { describe, expect, it } from 'vitest';
import { isValidFieldElement, parseFieldElement } from '../src/field.js';
import { BN254_SCALAR_FIELD_ORDER } from '../src/constants.js';

const ORDER_MINUS_ONE = (BN254_SCALAR_FIELD_ORDER - 1n).toString();

describe('field elements', () => {
  it('accepts 0 and r-1', () => {
    expect(isValidFieldElement('0')).toBe(true);
    expect(isValidFieldElement(ORDER_MINUS_ONE)).toBe(true);
  });

  it('rejects r itself and above', () => {
    expect(isValidFieldElement(BN254_SCALAR_FIELD_ORDER.toString())).toBe(false);
    expect(isValidFieldElement((BN254_SCALAR_FIELD_ORDER + 1n).toString())).toBe(false);
  });

  it('rejects non-canonical and non-decimal strings', () => {
    expect(isValidFieldElement('01')).toBe(false);
    expect(isValidFieldElement('1.5')).toBe(false);
    expect(isValidFieldElement('1e5')).toBe(false);
    expect(isValidFieldElement('-1')).toBe(false);
    expect(isValidFieldElement('')).toBe(false);
    expect(isValidFieldElement(' ')).toBe(false);
    expect(isValidFieldElement('0x1')).toBe(false);
    expect(isValidFieldElement(42)).toBe(false);
    expect(isValidFieldElement(null)).toBe(false);
  });

  it('parseFieldElement returns canonical form and throws otherwise', () => {
    expect(parseFieldElement('123')).toBe('123');
    expect(parseFieldElement('0')).toBe('0');
    expect(() => parseFieldElement('01')).toThrow(RangeError);
    expect(() => parseFieldElement('x')).toThrow(RangeError);
    expect(() => parseFieldElement(BN254_SCALAR_FIELD_ORDER.toString())).toThrow(RangeError);
  });
});
