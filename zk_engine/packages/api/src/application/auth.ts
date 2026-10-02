/**
 * Request authentication (ADR-0005): HMAC-SHA256 over a canonical request.
 *
 * This is the API's transport-auth component — the ONLY place node:crypto
 * HMAC appears in the whole package. Proof verification, hashing, and ABI
 * encoding are never performed here or anywhere else in the API.
 */

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { ApiPrincipal } from '../domain/entities.js';
import { DomainError } from '../domain/errors.js';
import type { ClockPort, NonceStorePort, SecretStorePort } from '../domain/ports.js';

export interface AuthHeaders {
  'x-zk-key'?: string;
  'x-zk-timestamp'?: string;
  'x-zk-nonce'?: string;
  'x-zk-signature'?: string;
}

export interface RequestLike {
  method: string;
  path: string;
  query: string;
  headers: AuthHeaders;
  bodyJson: unknown;
}

/** Canonical JSON: recursively sorted object keys, compact, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(',')}}`;
  }
  if (typeof value === 'bigint') return value.toString();
  return JSON.stringify(value);
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Canonical request string — the exact layout clients must reproduce:
 * METHOD \n path \n canonicalQuery \n key \n nonce \n timestamp \n sha256(canonicalJson(body))
 */
export function canonicalString(req: RequestLike): string {
  const canonicalQuery = req.query
    .split('&')
    .filter((p) => p.length > 0)
    .sort()
    .join('&');
  const bodyHash = sha256Hex(canonicalJson(req.bodyJson));
  return [
    req.method.toUpperCase(),
    req.path,
    canonicalQuery,
    req.headers['x-zk-key'] ?? '',
    req.headers['x-zk-nonce'] ?? '',
    req.headers['x-zk-timestamp'] ?? '',
    bodyHash,
  ].join('\n');
}

export function hmacSha256Hex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

/** RFC3339 timestamp parsing — strict enough for our window checks. */
function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export class Authenticator {
  constructor(
    private readonly secrets: SecretStorePort,
    private readonly nonces: NonceStorePort,
    private readonly clock: ClockPort,
    private readonly ttlMs: number,
  ) {}

  async authenticate(req: RequestLike): Promise<ApiPrincipal> {
    const key = req.headers['x-zk-key'];
    const ts = req.headers['x-zk-timestamp'];
    const nonce = req.headers['x-zk-nonce'];
    const signature = req.headers['x-zk-signature'];

    if (!key || !ts || !nonce || !signature) throw new DomainError('AUTH-MISSING');

    const client = await this.secrets.lookup(key);
    if (!client) throw new DomainError('AUTH-UNKNOWN-CLIENT');

    const tsMs = parseTimestamp(ts);
    if (tsMs === null) throw new DomainError('AUTH-EXPIRED', { detail: 'unparseable X-ZK-Timestamp' });
    const skew = Math.abs(this.clock.nowMs() - tsMs);
    if (skew > this.ttlMs) throw new DomainError('AUTH-EXPIRED', { detail: `skew ${Math.round(skew / 1000)}s` });

    const expected = hmacSha256Hex(client.secret, canonicalString(req));
    const provided = signature.toLowerCase();
    if (!safeEqual(expected, provided)) throw new DomainError('AUTH-BAD-SIGNATURE');

    if (!(await this.nonces.consume(client.clientId, nonce, this.ttlMs, this.clock.nowMs()))) {
      throw new DomainError('AUTH-REPLAY');
    }

    return { clientId: client.clientId, tenantId: client.tenantId, roles: new Set(client.roles) };
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

/** Role gate — single decision point for the whole API. */
export function assertRole(principal: ApiPrincipal, required: string[]): void {
  const granted = new Set<string>(required);
  for (const role of principal.roles) {
    if (granted.has(role)) return;
  }
  throw new DomainError('AUTH-FORBIDDEN', {
    detail: `client "${principal.clientId}" lacks one of: ${required.join(', ')}`,
  });
}