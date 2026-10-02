/**
 * Session cookies: `v1.<expiry-epoch-ms>.<hex-hmac-sha256(secret, payload)>`.
 * HttpOnly + SameSite=Lax cookies carry no issuer claims — the digest proves
 * the server minted it; expiry is enforced server-side, not by the browser.
 */

import { createHmac, timingSafeEqual, scryptSync } from 'node:crypto';

export interface SessionPayload {
  expiresMs: number;
}

export const COOKIE_NAME = 'zkdash';

export interface Session {
  expiresMs: number;
}

export function signSession(secret: string, expiresMs: number): string {
  return `v1.${expiresMs}.${createHmac('sha256', secret).update(`v1.${expiresMs}`).digest('hex')}`;
}

export function verifySession(secret: string, token: string | undefined, nowMs = Date.now()): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const [_version, expiresRaw, mac] = parts as [string, string, string];
  const expected = createHmac('sha256', secret).update(`v1.${expiresRaw}`).digest('hex');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const expiresMs = Number(expiresRaw);
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) return null;
  return { expiresMs };
}

/** Plain-text password -> constant-time digest comparison via HMAC. */
export function passwordMatches(expected: string, given: string): boolean {
  const a = scryptSync(expected, 'zk-dashboard-salt', 64);
  const b = scryptSync(given, 'zk-dashboard-salt', 64);
  return timingSafeEqual(a, b);
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      out.set(part.slice(0, idx).trim(), decodeURIComponent(part.slice(idx + 1).trim()));
    }
  }
  return out;
}