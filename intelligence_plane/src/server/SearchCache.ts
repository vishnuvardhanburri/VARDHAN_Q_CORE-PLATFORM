/**
 * VARDHAN — SEARCH CACHE (§16)
 * ─────────────────────────────────────────────────────────────────────────────
 * Avoids repeatedly querying identical search queries. Each cached result carries
 * a TTL; when expired the query is re-issued. Material changes (company changed
 * materially) also force a refresh regardless of TTL.
 */

export interface CachedResult {
  query: string;
  results: SearchResult[];
  retrieved_at: string;
  expires_at: string;
  /** Hash of the result set for change detection. */
  hash: string;
}

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  source: string;
}

/** Simple string hash — deterministic, no external deps. */
function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

export class SearchCache {
  private entries: Map<string, CachedResult> = new Map();
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs: number = 1000 * 60 * 60 * 6) { // 6 hours default
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Retrieve cached results if fresh (not expired). Returns undefined if no
   * cache entry exists or the cache has expired.
   */
  get(query: string): SearchResult[] | undefined {
    const entry = this.entries.get(query.toLowerCase());
    if (!entry) return undefined;
    if (Date.now() > Date.parse(entry.expires_at)) {
      this.entries.delete(query.toLowerCase());
      return undefined;
    }
    return entry.results;
  }

  /** Store results in cache with the given (or default) TTL. */
  set(query: string, results: SearchResult[], ttlMs?: number): void {
    const now = Date.now();
    const ttl = ttlMs ?? this.defaultTtlMs;
    const hash = hashStr(JSON.stringify(results));
    this.entries.set(query.toLowerCase(), {
      query,
      results,
      retrieved_at: new Date(now).toISOString(),
      expires_at: new Date(now + ttl).toISOString(),
      hash,
    });
  }

  /** Check if a query's results have changed (by hash comparison). */
  hasChanged(query: string, newResults: SearchResult[]): boolean {
    const cached = this.entries.get(query.toLowerCase());
    if (!cached) return true;
    return cached.hash !== hashStr(JSON.stringify(newResults));
  }

  /** Force a cache refresh by removing a specific query. */
  invalidate(query: string): void {
    this.entries.delete(query.toLowerCase());
  }

  /** Force a full cache flush. */
  clear(): void {
    this.entries.clear();
  }

  /** Number of cached entries. */
  get size(): number {
    return this.entries.size;
  }
}
