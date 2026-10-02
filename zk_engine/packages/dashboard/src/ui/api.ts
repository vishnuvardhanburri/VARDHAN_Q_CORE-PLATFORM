/**
 * Typed fetch for the dashboard BFF. Only JSON + problem+json are expected;
 * any non-2xx is surfaced as an Error with code + detail (never rendered
 * as HTML). All requests are same-origin (CSP connect-src 'self').
 */

export interface ApiFailure {
  code: string;
  detail: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ApiFailure,
  ) {
    super(problem.detail || problem.code || `HTTP ${status}`);
    this.name = 'ApiError';
  }
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { code: 'non_json', detail: text.slice(0, 120) };
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, (body as ApiFailure) ?? { code: `http_${res.status}`, detail: 'request failed' });
  }
  return body as T;
}
