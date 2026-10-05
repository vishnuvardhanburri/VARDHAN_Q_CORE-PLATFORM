export type VardhanConfig = {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  maxRetries?: number;
};

export type RequestOptions = { idempotencyKey?: string; correlationId?: string };
export type Plan = { id: string; name: string; tier: string; contact_sales: boolean; entitlements: string[] };
export type Organization = { id: string; name: string; owner: string; created_at_ms: number };
export type Subscription = { organization_id: string; plan_id: string; status: string; provider: string; external_customer_id?: string | null; external_subscription_id?: string | null };
export type Usage = { organization_id: string; transactions: number; bytes_processed: number };
export type Entitlements = { organization_id: string; plan?: Plan; subscription_status: string; entitlements: string[]; activation: string; provider?: string };

export class VardhanApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly requestId?: string) {
    super(message); this.name = 'VardhanApiError';
  }
}

function joinUrl(base: string, path: string): string { return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`; }

export class VardhanClient {
  private readonly baseUrl: string; private readonly token?: string; private readonly timeoutMs: number;
  private readonly maxRetries: number; private readonly transport: typeof globalThis.fetch;
  constructor(config: VardhanConfig) {
    if (!config.baseUrl) throw new TypeError('baseUrl is required');
    this.baseUrl = config.baseUrl; this.token = config.token; this.timeoutMs = config.timeoutMs ?? 15_000;
    this.maxRetries = Math.max(0, Math.min(config.maxRetries ?? 2, 5)); this.transport = config.fetch ?? globalThis.fetch;
    if (!this.transport) throw new Error('Fetch API is unavailable; provide config.fetch');
  }

  private async request<T>(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
    let attempt = 0;
    while (true) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const headers = new Headers(init.headers); headers.set('accept', 'application/json');
      if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
      if (this.token) headers.set('authorization', `Bearer ${this.token}`);
      if (options.idempotencyKey) headers.set('idempotency-key', options.idempotencyKey);
      if (options.correlationId) headers.set('x-correlation-id', options.correlationId);
      headers.set('x-vardhan-sdk', '@vardhan-technologies/sdk/0.2.0');
      try {
        const response = await this.transport(joinUrl(this.baseUrl, path), { ...init, headers, signal: controller.signal });
        const requestId = response.headers.get('x-request-id') ?? undefined;
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < this.maxRetries) {
          const retryAfter = Number(response.headers.get('retry-after') ?? '0');
          const delay = retryAfter > 0 ? Math.min(retryAfter * 1000, 5_000) : Math.min(250 * 2 ** attempt, 5_000);
          attempt++; await new Promise(resolve => setTimeout(resolve, delay)); continue;
        }
        const text = await response.text(); let body: any = undefined;
        if (text) { try { body = JSON.parse(text); } catch { body = undefined; } }
        if (!response.ok) throw new VardhanApiError(response.status, body?.code ?? `HTTP_${response.status}`, body?.error ?? 'Vardhan API request failed', requestId);
        return body as T;
      } catch (error) {
        if (error instanceof VardhanApiError) throw error;
        if (error instanceof Error && error.name === 'AbortError') throw new Error(`Vardhan API request timed out after ${this.timeoutMs}ms`);
        if (attempt < this.maxRetries) { attempt++; await new Promise(resolve => setTimeout(resolve, Math.min(250 * 2 ** (attempt - 1), 5_000))); continue; }
        throw error;
      } finally { clearTimeout(timer); }
    }
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> { return this.request<T>(path, {}, options); }
  post<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> { return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) }, options); }
  health() { return this.get<{ service: string; status: string; mode: string; authentication: string; demo_authentication: boolean }>('/api/v1/platform/health'); }
  me() { return this.get<{ username: string; authenticated: boolean }>('/api/v1/me'); }
  plans() { return this.get<Plan[]>('/api/v1/catalog/plans'); }
  organizations = {
    list: () => this.get<{ organizations: Organization[] }>('/api/v1/organizations'),
    create: (name: string, options?: RequestOptions) => this.post<{ organization: Organization; subscription: Subscription }>('/api/v1/organizations', { name }, options),
    get: (id: string) => this.get<{ organization: Organization }>(`/api/v1/organizations/${encodeURIComponent(id)}`),
    entitlements: (id: string) => this.get<Entitlements>(`/api/v1/organizations/${encodeURIComponent(id)}/entitlements`),
    subscription: (id: string) => this.get<{ subscription: Subscription }>(`/api/v1/organizations/${encodeURIComponent(id)}/subscription`),
    requestPlan: (id: string, planId: string, options?: RequestOptions) => this.post<{ subscription: Subscription; requested_plan: string; activation: string }>(`/api/v1/organizations/${encodeURIComponent(id)}/subscription`, { plan_id: planId }, options),
    usage: (id: string) => this.get<{ usage: Usage }>(`/api/v1/organizations/${encodeURIComponent(id)}/usage`),
    recordUsage: (id: string, transactions: number, bytesProcessed: number, options?: RequestOptions) => this.post<{ usage: Usage }>(`/api/v1/organizations/${encodeURIComponent(id)}/usage/record`, { transactions, bytes_processed: bytesProcessed }, options),
  };
}
export { VardhanClient as Vardhan };
