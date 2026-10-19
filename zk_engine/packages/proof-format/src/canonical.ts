/**
 * Deterministic canonical JSON serialization for the envelope and manifest.
 *
 * Rules (subset of RFC 8785 that applies to our types):
 *  - object keys sorted lexicographically (by UTF-16 code units);
 *  - array order preserved (canonical order is semantic in the envelope);
 *  - strings JSON-escaped by the host JSON.stringify;
 *  - numbers: integers only, no exponents, `-0` normalized to `0`;
 *  - booleans/null as-is; no NaN/Infinity allowed.
 * Field elements are always strings, so no floating-point ambiguity exists.
 */

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

function isPlainObject(v: unknown): v is Record<string, JsonValue> {
  return v ? (typeof v === 'object' && !Array.isArray(v)) : false;
}

function stringifyValue(value: unknown, out: string[]): void {
  if (value === null) {
    out.push('null');
    return;
  }
  if (typeof value === 'boolean') {
    out.push(value ? 'true' : 'false');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('canonicalize: non-finite number');
    }
    if (Object.is(value, -0)) {
      out.push('0');
      return;
    }
    out.push(String(value));
    return;
  }
  if (typeof value === 'string') {
    out.push(JSON.stringify(value));
    return;
  }
  if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) out.push(',');
      stringifyValue(value[i]!, out);
    }
    out.push(']');
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    out.push('{');
    for (let i = 0; i < keys.length; i += 1) {
      if (i > 0) out.push(',');
      const key = keys[i]!;
      out.push(JSON.stringify(key), ':');
      stringifyValue(value[key], out);
    }
    out.push('}');
    return;
  }
  throw new TypeError('canonicalize: unsupported value');
}

/** Serialize an envelope-like value into canonical JSON bytes (UTF-8). */
export function canonicalize(value: unknown): string {
  const out: string[] = [];
  stringifyValue(value, out);
  return out.join('');
}
