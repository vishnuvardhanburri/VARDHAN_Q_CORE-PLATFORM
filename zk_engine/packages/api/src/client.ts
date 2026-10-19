/**
 * API client facade — the ONLY place request signing enters client
 * packages (CLI, CI gatekeeper, dashboard). Re-exports the canonical string
 * + HMAC functions from application/auth.ts so there is exactly one
 * request-signing implementation in the repo (ADR-0011 §1).
 *
 * `signedFetch` produces the canonical `x-zk-*` headers using that
 * implementation and returns the parsed response; problem+json bodies are
 * surfaced typed, never swallowed.
 */

import { canonicalString, hmacSha256Hex, type RequestLike } from './application/auth.js';

export interface ApiClientConfig {
  baseUrl: string;
  clientId: string;
  secret: string;
  /** Clock override for tests; defaults to Date/performance.now. */
  nowMs?: () => number;
  fetchImpl?: typeof fetch;
}

export interface ApiErrorDetail {
  type?: string;
  title?: string;
  status?: number;
  code?: string;
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: { path?: string; message?: string }[];
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ApiErrorDetail,
    message?: string,
  ) {
    super(message ?? problem.title ?? problem.code ?? `API error ${status}`);
    this.name = 'ApiClientError';
  }
}

export function normalizeSubmission(submission: unknown): unknown {
  if (typeof submission !== 'object' || !submission) return {};
  const s = submission as Record<string, unknown>;
  
  const safeStr = (v: unknown) => {
    const str = String(v);
    const match = /^([a-zA-Z0-9_\-.]+)$/.exec(str);
    if (!match) throw new Error('Invalid format');
    return match[1]!;
  };
  const safeArr = (arr: unknown) => Array.isArray(arr) ? Array.from(arr).map(safeStr) : [];

  let proof: unknown = undefined;
  if (s.proof && typeof s.proof === 'object') {
    const p = s.proof as Record<string, unknown>;
    if (Array.isArray(p.pi_a) && Array.isArray(p.pi_b) && Array.isArray(p.pi_c)) {
      proof = {
        pi_a: safeArr(p.pi_a),
        pi_b: Array.from(p.pi_b).map(val => Array.isArray(val) ? safeArr(val) : safeStr(val)),
        pi_c: safeArr(p.pi_c),
      };
    }
  }

  return { 
    circuitId: s.circuitId ? safeStr(s.circuitId) : undefined, 
    proof, 
    publicInputs: Array.isArray(s.publicInputs) ? safeArr(s.publicInputs) : undefined 
  };
}

/** Sign and issue a request; returns parsed JSON or throws ApiClientError. */
export async function signedFetch(
  cfg: ApiClientConfig,
  method: 'GET' | 'POST',
  path: string,
  opts: { query?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<unknown> {
  const nowMs = cfg.nowMs ?? Date.now;
  const nonce = `${nowMs()}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  const timestamp = new Date(nowMs()).toISOString();

  const authHeaders: RequestLike['headers'] = {
    'x-zk-key': cfg.clientId,
    'x-zk-nonce': nonce,
    'x-zk-timestamp': timestamp,
  };

  const canonical = canonicalString({
    method,
    path,
    query: opts.query ?? '',
    headers: { ...authHeaders, ...(opts.headers ?? {}) },
    bodyJson: opts.body ?? null,
  });

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...opts.headers,
    'x-zk-key': cfg.clientId,
    'x-zk-nonce': nonce,
    'x-zk-timestamp': timestamp,
    'x-zk-signature': hmacSha256Hex(cfg.secret, canonical),
  };

  let base = cfg.baseUrl;
  while (base.endsWith('/')) {
    base = base.slice(0, -1);
  }
  const url = `${base}${path}${opts.query ? `?${opts.query}` : ''}`;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('API Client: base URL must use http or https');
  }
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    method,
    headers,
    ...(opts.body !== undefined && method === 'POST' ? { body: JSON.stringify(opts.body) } : {}),
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { code: 'NON-JSON', detail: text.slice(0, 200) };
    }
  }

  if (!res.ok) {
    const problem = parsed as ApiErrorDetail | undefined;
    let reason = '';
    if (problem?.detail) reason += ` ${problem.detail}`;
    if (problem?.errors?.length) reason += ` ${problem.errors.map((e) => `${e.path ?? ''}: ${e.message ?? ''}`).join('; ')}`;
    throw new ApiClientError(res.status, problem ?? {}, `API ${res.status} ${path}${reason}`);
  }
  return parsed;
}

export class ApiClient {
  readonly cfg: ApiClientConfig;

  constructor(cfg: ApiClientConfig) {
    const match = /^(https?:\/\/[a-zA-Z0-9\-.:]+(?:\/[a-zA-Z0-9\-./]+)?)/.exec(cfg.baseUrl);
    if (!match) throw new Error('API Client: invalid base URL format');
    this.cfg = { ...cfg, baseUrl: match[1]! };
  }

  async listCircuits(): Promise<unknown> {
    return signedFetch(this.cfg, 'GET', '/v1/circuits');
  }

  async registryInfo(): Promise<unknown> {
    return signedFetch(this.cfg, 'GET', '/v1/registry');
  }

  async verifyProof(submission: unknown): Promise<unknown> {
    return signedFetch(this.cfg, 'POST', '/v1/proofs/verify', { body: normalizeSubmission(submission) });
  }

  async registerProof(submission: unknown, idempotencyKey: string): Promise<unknown> {
    return signedFetch(this.cfg, 'POST', '/v1/proofs/register', {
      body: normalizeSubmission(submission),
      headers: { 'idempotency-key': idempotencyKey },
    });
  }

  async proofStatus(circuitId: string, publicInputHash: string): Promise<unknown> {
    const cidMatch = /^([a-zA-Z0-9_\-.]+)$/.exec(circuitId);
    const hashMatch = /^(0x[a-fA-F0-9]+|[a-fA-F0-9]+)$/.exec(publicInputHash);
    if (!cidMatch || !hashMatch) {
      throw new Error('API Client: invalid circuitId or publicInputHash format');
    }
    return signedFetch(this.cfg, 'GET', `/v1/proofs/status/${cidMatch[1]}/${hashMatch[1]}`);
  }

  async auditLogs(limit = 50): Promise<unknown> {
    return signedFetch(this.cfg, 'GET', `/v1/audit?limit=${limit}`);
  }

  async circuits(): Promise<unknown> {
    return signedFetch(this.cfg, 'GET', '/v1/circuits');
  }
}