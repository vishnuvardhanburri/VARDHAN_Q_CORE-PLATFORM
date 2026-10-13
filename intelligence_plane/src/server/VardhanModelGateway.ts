/**
 * VARDHAN — MODEL GATEWAY (§7, §8)
 * ─────────────────────────────────────────────────────────────────────────────
 * Abstracts local model providers (Ollama, vLLM, future self-hosted VARDHAN model).
 * The rest of VARDHAN never calls a model directly — it goes through this gateway.
 *
 * Model responsibilities (only what deterministic code cannot do):
 *   - page understanding (extract technical content)
 *   - technical classification (signal type)
 *   - signal extraction
 *   - correlation reasoning
 *   - finding explanation
 *   - query generation
 *   - owner reasoning
 *   - email generation
 *   - adversarial QA
 *
 * Deterministic code handles: HTTP, parsing, hashing, timestamps, dedup,
 * provenance, scoring, queueing, budgets, state.
 *
 * Model output must be evidence-bound — never hallucinated findings.
 */

export type ModelCapability =
  | 'page_understanding'
  | 'technical_classification'
  | 'signal_extraction'
  | 'correlation_reasoning'
  | 'finding_explanation'
  | 'query_generation'
  | 'owner_reasoning'
  | 'email_generation'
  | 'adversarial_qa';

export interface ModelMetrics {
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  cost_usd: number;
}

export interface ModelResponse {
  text: string;
  raw?: any;
  metrics: ModelMetrics;
  model: string;
  /** Whether the model refused or produced empty output. */
  refused?: boolean;
  /** Warning if the model output was truncated or suspicious. */
  warning?: string;
}

export interface ModelRequest {
  /** The prompt text. */
  prompt: string;
  /** Maximum tokens to generate. */
  maxTokens?: number;
  /** Temperature (0 = deterministic, 1 = creative). */
  temperature?: number;
  /** The capability being requested (for routing). */
  capability?: ModelCapability;
  /** Optional structured context to prepend. */
  context?: Record<string, any>;
}

export interface ModelProvider {
  readonly name: string;
  readonly available: boolean;
  /** Check if this provider is reachable. */
  checkHealth(): Promise<boolean>;
  /** Generate a response. */
  generate(request: ModelRequest): Promise<ModelResponse>;
  /** List available models. */
  listModels(): Promise<string[]>;
}

/** Prompt registry — centralizes prompts so they can be audited/versioned. */
export class PromptRegistry {
  private static prompts: Record<string, string> = {
    page_understanding: `Extract technical content from this HTML. List:
- technical systems mentioned (platform, infra, languages, frameworks)
- API endpoints
- security-related content
- engineering team/org references
- recent changes/releases
Be conservative — do not invent. Output JSON only.`,

    technical_classification: `Classify this technical signal into one of:
ENGINEERING_ARTICLE, TECHNICAL_DOCUMENTATION, API_REFERENCE, SDK_DOCS,
STATUS_PAGE, PUBLIC_INCIDENT, SECURITY_PAGE, TECHNICAL_HIRING,
ARCHITECTURE_DISCUSSION, BLOG, NEWS.
Output only the category name.`,

    finding_explanation: `Given the evidence, explain why this is or is not a defensible
finding. Reference evidence IDs. Be conservative — do not inflate weak
signals.`,

    query_generation: `Generate 3-5 focused, bounded public research queries for this
company and technical area. Each query should be specific and likely to
return relevant public results.`,

    owner_reasoning: `Given the finding's technical area (subsystem), evaluate which
candidate person is most likely responsible. Reference evidence for each
candidate. Be conservative — do not guess.`,

    email_generation: `Write a concise, evidence-backed outreach email. Cite specific
evidence IDs. Do not make claims not supported by evidence.`,

    adversarial_qa: `Critically review this finding. List any evidence that contradicts
or weakens it. Is the claim supported by reproducible, independent evidence?`,
  };

  static getPrompt(capability: ModelCapability): string {
    return this.prompts[capability] || '';
  }

  static getPromptText(name: string): string {
    return this.prompts[name as ModelCapability] || '';
  }

  static setPrompt(capability: ModelCapability, prompt: string): void {
    this.prompts[capability] = prompt;
  }
}

/** Ollama provider — connects to local Ollama server (default localhost:11434). */
export class OllamaProvider implements ModelProvider {
  readonly name = 'OllamaProvider';
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private _available: boolean | null = null;

  constructor(options: { baseUrl?: string; defaultModel?: string } = {}) {
    this.baseUrl = options.baseUrl || (process.env.VARDHAN_OLLAMA_URL || 'http://127.0.0.1:11434');
    this.defaultModel = options.defaultModel || (process.env.VARDHAN_OLLAMA_MODEL || 'gemma3:4b');
  }

  get available(): boolean {
    // Cached availability — checked at first use.
    return this._available ?? false;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      this._available = res.ok;
      return this._available;
    } catch {
      this._available = false;
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return [];
      const data = await res.json() as any;
      return data.models?.map((m: any) => m.name) || [];
    } catch {
      return [];
    }
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (!this.available) {
      return { text: '', model: this.defaultModel, metrics: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, latency_ms: 0, cost_usd: 0 }, refused: true };
    }

    const start = Date.now();
    const prompt = `${PromptRegistry.getPrompt(request.capability || 'page_understanding')}\n\n${request.prompt}`;
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: this.defaultModel,
        prompt,
        stream: false,
        options: {
          temperature: request.temperature ?? 0.2,
          num_predict: request.maxTokens ?? 1024,
        },
      }),
    });

    if (!res.ok) {
      return { text: '', model: this.defaultModel, metrics: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, latency_ms: Date.now() - start, cost_usd: 0 }, refused: true };
    }

    const data = await res.json() as any;
    return {
      text: data.response || '',
      raw: data,
      model: this.defaultModel,
      metrics: {
        total_tokens: data.eval_count || 0,
        prompt_tokens: data.prompt_eval_count || 0,
        completion_tokens: data.eval_count || 0,
        latency_ms: Date.now() - start,
        cost_usd: 0,
      },
    };
  }
}

/** vLLM provider — connects to a vLLM or OpenAI-compatible server. */
export class VllmProvider implements ModelProvider {
  readonly name = 'VllmProvider';
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private _available: boolean | null = null;

  constructor(options: { baseUrl?: string; apiKey?: string; defaultModel?: string } = {}) {
    this.baseUrl = options.baseUrl || (process.env.VARDHAN_VLLM_URL || 'http://127.0.0.1:8000/v1');
    this.apiKey = options.apiKey || '';
    this.defaultModel = options.defaultModel || (process.env.VARDHAN_VLLM_MODEL || 'Qwen3-4B');
  }

  get available(): boolean {
    return this._available ?? false;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(3000),
      });
      this._available = res.ok;
      return this._available;
    } catch {
      this._available = false;
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return [];
      const data = await res.json() as any;
      return data.data?.map((m: any) => m.id) || [];
    } catch {
      return [];
    }
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (!this.available) {
      return { text: '', model: this.defaultModel, metrics: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, latency_ms: 0, cost_usd: 0 }, refused: true };
    }

    const start = Date.now();
    const prompt = `${PromptRegistry.getPrompt(request.capability || 'page_understanding')}\n\n${request.prompt}`;
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: this.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0.2,
      }),
    });

    if (!res.ok) {
      return { text: '', model: this.defaultModel, metrics: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, latency_ms: Date.now() - start, cost_usd: 0 }, refused: true };
    }

    const data = await res.json() as any;
    const content = data.choices?.[0]?.message?.content || '';
    return {
      text: content,
      raw: data,
      model: data.model || this.defaultModel,
      metrics: {
        total_tokens: data.usage?.total_tokens || 0,
        prompt_tokens: data.usage?.prompt_tokens || 0,
        completion_tokens: data.usage?.completion_tokens || 0,
        latency_ms: Date.now() - start,
        cost_usd: 0,
      },
    };
  }
}

/** Null model provider — used when no local model is configured. Models are optional. */
export class NullModelProvider implements ModelProvider {
  readonly name = 'NullModelProvider';
  readonly available = false;
  async checkHealth(): Promise<boolean> { return false; }
  async listModels(): Promise<string[]> { return []; }
  async generate(_request: ModelRequest): Promise<ModelResponse> {
    return { text: '', model: 'none', metrics: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, latency_ms: 0, cost_usd: 0 }, refused: true };
  }
}

/** Model routing entry — maps a capability to a preferred provider + model. */
export interface ModelRoute {
  capability: ModelCapability;
  /** Ordered list of providers to try (fallback). */
  providers: string[];
  /** Per-capability temperature override. */
  temperature?: number;
  /** Per-capability max tokens override. */
  maxTokens?: number;
}

/**
 * VardhanModelGateway — the stable interface all of VARDHAN uses.
 * Routes requests to the appropriate local model provider based on capability.
 * Models are OPTIONAL — if no model is available, returns refused responses
 * and the deterministic engine continues without hallucination.
 */
export class VardhanModelGateway {
  private readonly providers: Map<string, ModelProvider> = new Map();
  private readonly routes: Map<ModelCapability, ModelRoute> = new Map();
  private readonly auditLog: ModelMetrics[] = [];
  private healthChecked = false;

  constructor(providers: ModelProvider[] = []) {
    for (const p of providers) this.providers.set(p.name, p);
    this.setDefaultRoutes();
  }

  private setDefaultRoutes(): void {
    const caps: ModelCapability[] = [
      'page_understanding', 'technical_classification', 'signal_extraction',
      'correlation_reasoning', 'finding_explanation', 'query_generation',
      'owner_reasoning', 'email_generation', 'adversarial_qa',
    ];
    for (const cap of caps) {
      this.routes.set(cap, { capability: cap, providers: ['OllamaProvider', 'VllmProvider'], temperature: 0.2, maxTokens: 1024 });
    }
  }

  /** Add or replace a model provider. */
  addProvider(provider: ModelProvider): void {
    this.providers.set(provider.name, provider);
    this.healthChecked = false;
  }

  /** Set routing for a specific capability. */
  setRoute(capability: ModelCapability, route: ModelRoute): void {
    this.routes.set(capability, route);
  }

  /** Check health of all providers. */
  async checkHealth(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const [name, provider] of this.providers) {
      results[name] = await provider.checkHealth();
    }
    this.healthChecked = true;
    return results;
  }

  /** Generate a response for a capability — tries providers in order. */
  async generate(request: ModelRequest): Promise<ModelResponse> {
    const cap = request.capability || 'page_understanding';
    const route = this.routes.get(cap);
    const providerNames = route?.providers || ['OllamaProvider', 'VllmProvider'];

    for (const pname of providerNames) {
      const provider = this.providers.get(pname);
      if (!provider || !provider.available) continue;
      try {
        const result = await provider.generate(request);
        this.auditLog.push(result.metrics);
        if (!result.refused && result.text.length > 0) return result;
      } catch {
        // Try next provider
      }
    }

    // No model available — return refused (deterministic engine handles it)
    return {
      text: '',
      model: 'none',
      metrics: { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, latency_ms: 0, cost_usd: 0 },
      refused: true,
      warning: 'No model provider available — deterministic fallback used.',
    };
  }

  /** Get model audit metrics (token usage, cost, latency). */
  getAuditMetrics(): { totalTokens: number; totalCost: number; totalLatency: number; calls: number } {
    const total = this.auditLog.reduce((acc, m) => ({
      totalTokens: acc.totalTokens + m.total_tokens,
      totalCost: acc.totalCost + m.cost_usd,
      totalLatency: acc.totalLatency + m.latency_ms,
      calls: acc.calls + 1,
    }), { totalTokens: 0, totalCost: 0, totalLatency: 0, calls: 0 });
    return total;
  }

  /** List all available models across all providers. */
  async listAllModels(): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};
    for (const [name, provider] of this.providers) {
      result[name] = await provider.listModels();
    }
    return result;
  }

  /** Whether any model provider is available. */
  get hasAvailableModel(): boolean {
    return Array.from(this.providers.values()).some(p => p.available);
  }
}
