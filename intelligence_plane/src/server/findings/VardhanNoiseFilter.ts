/**
 * VARDHAN — NOISE FILTER (§4)
 * ─────────────────────────────────────────────────────────────────────────────
 * Immediately rejects or deprioritizes generic/noisy observations BEFORE they
 * consume deep-research budget.
 *
 * Aggressive in discovery, conservative in conclusions: a single 403, a single
 * 429, generic framework detection, or one latency sample does NOT become a
 * finding.
 */

export type NoiseCategory =
  | 'NORMAL'           // Expected, non-actionable behavior
  | 'INSUFFICIENT_EVIDENCE' // Signal exists but evidence is too thin
  | 'GENERIC_INFORMATION'  // Generic tech/funding/growth data
  | 'STALE'            // Old content, no current relevance
  | 'NON_ACTIONABLE'   // Technically unusual but no outreach path
  | 'DUPLICATE'       // Already observed by VARDHAN
  | 'REAL_CANDIDATE';  // Genuinely interesting signal

export interface NoiseAssessment {
  isNoise: boolean;
  category: NoiseCategory;
  reason: string;
}

export interface RawSignal {
  type: string;
  source_url: string;
  status?: number;
  excerpt: string;
  age_days?: number | null;
  evidence_count: number;
  reproducible: boolean;
  content?: string;
  headers?: Record<string, string>;
}

export class VardhanNoiseFilter {
  /**
   * Assess whether a raw signal is noise or a real candidate.
   * Must be called BEFORE deep research to avoid wasting budget.
   */
  static assess(signal: RawSignal): NoiseAssessment {
    const s = signal;

    // ── Single transient errors ──
    if (s.status === 403 && s.evidence_count < 2) {
      return { isNoise: true, category: 'NORMAL', reason: 'Single 403 — access boundary, not a finding.' };
    }
    if (s.status === 429 && s.evidence_count < 2) {
      return { isNoise: true, category: 'NORMAL', reason: 'Single 429 — rate limit, not a finding.' };
    }
    if (s.status === 408 || s.status === 504 || (s.status && s.status >= 500)) {
      if (s.evidence_count < 2) {
        return { isNoise: true, category: 'INSUFFICIENT_EVIDENCE', reason: 'Single timeout/server error — not reproducible.' };
      }
    }

    // ── Generic technology detection ──
    const genericTech = /cloudflare|nginx|apache|gunicorn|uvicorn|express\.js|next\.js|react|vue\.js|angular|laravel|django|flask|spring|sails/i.test(s.content || '');
    if (genericTech && s.evidence_count < 2 && !s.reproducible) {
      return { isNoise: true, category: 'GENERIC_INFORMATION', reason: 'Generic framework/CDN detection without corroboration.' };
    }

    // ── Generic cloud/CDN headers ──
    if (s.headers) {
      const cdnHeaders = ['cf-ray', 'x-served-by', 'x-fastly', 'x-cache', 'via', 'server', 'x-powered-by'];
      const cdnCount = cdnHeaders.filter(h => s.headers![h.toLowerCase()] || s.headers![h]).length;
      if (cdnCount > 0 && s.evidence_count < 2 && !s.reproducible) {
        return { isNoise: true, category: 'NORMAL', reason: 'Generic cloud/CDN header — ordinary behavior.' };
      }
    }

    // ── Old engineering article alone ──
    if (s.type === 'ENGINEERING_ARTICLE' || s.type === 'BLOG' || s.type === 'NEWS') {
      if (s.age_days && s.age_days > 180 && !s.reproducible) {
        return { isNoise: true, category: 'STALE', reason: `Article is ${s.age_days} days old — no current relevance.` };
      }
    }

    // ── Generic job posting alone ──
    if (s.type === 'TECHNICAL_HIRING' && s.evidence_count < 2) {
      return { isNoise: true, category: 'GENERIC_INFORMATION', reason: 'Single job posting — generic hiring signal, not a finding.' };
    }

    // ── Funding/growth alone ──
    if (s.type === 'BUSINESS_NEWS' || s.type === 'FUNDING_ANNOUNCEMENT') {
      return { isNoise: true, category: 'GENERIC_INFORMATION', reason: 'Funding/growth announcement — not a technical finding.' };
    }

    // ── GitHub existence alone ──
    if (s.type === 'GITHUB_REPO' && s.evidence_count < 2) {
      return { isNoise: true, category: 'GENERIC_INFORMATION', reason: 'GitHub repository existence alone — not a finding.' };
    }

    // ── Single latency sample ──
    if (s.type === 'LATENCY_OBSERVATION' && s.evidence_count < 2) {
      return { isNoise: true, category: 'INSUFFICIENT_EVIDENCE', reason: 'Single latency sample — not reproducible.' };
    }

    // ── Normal API behavior ──
    if (s.type === 'API_ENDPOINT' && s.status === 200 && s.evidence_count < 2) {
      return { isNoise: true, category: 'NORMAL', reason: 'Normal API response — ordinary behavior.' };
    }

    // ── Not noise — real candidate ──
    return { isNoise: false, category: 'REAL_CANDIDATE', reason: 'Signal has technical substance and/or multiple evidence items.' };
  }

  /** Batch-assess a list of signals. Returns only real candidates. */
  static filterSignals(signals: RawSignal[]): { candidates: RawSignal[]; noise: { signal: RawSignal; assessment: NoiseAssessment }[] } {
    const candidates: RawSignal[] = [];
    const noise: { signal: RawSignal; assessment: NoiseAssessment }[] = [];
    for (const s of signals) {
      const a = this.assess(s);
      if (a.isNoise) noise.push({ signal: s, assessment: a });
      else candidates.push(s);
    }
    return { candidates, noise };
  }
}
