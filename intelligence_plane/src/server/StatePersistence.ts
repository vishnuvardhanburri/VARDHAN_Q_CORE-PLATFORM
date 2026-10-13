/**
 * VARDHAN — STATE PERSISTENCE (§18, §19)
 * ─────────────────────────────────────────────────────────────────────────────
 * Persists the last-known state of companies, sources, signals, people,
 * owners, findings, and search results so that:
 *   - `resume` can continue interrupted research
 *   - `refresh <company>` can re-research a specific company
 *   - `refresh all` can re-research all companies
 *   - `changes <company>` can diff new vs. previous state
 */

import * as fs from 'fs';
import * as path from 'path';
import type { StoredState } from './ChangeDetector';
import type { CachedResult } from './SearchCache';

export interface PersistedResearchState {
  company: string;
  domain: string;
  /** ISO timestamp of the last completed research run. */
  last_researched_at: string;
  /** Current research stage reached. */
  stage_reached: number;
  /** The last deep prospect summary (for quick display without re-running). */
  last_summary?: {
    decision: string;
    finding: string | null;
    owner: string | null;
    confidence: string;
    people_count: number;
    owner_candidates_count: number;
    evidence_count: number;
    sources_count: number;
    technical_signals_count: number;
  };
  /** Stored state snapshot for change detection. */
  state_snapshot: StoredState;
  /** Cached search results (by query hash). */
  search_cache: CachedResult[];
  /** Any errors from the last run. */
  last_error: string | null;
}

export class StatePersistence {
  private readonly stateDir: string;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    try {
      fs.mkdirSync(stateDir, { recursive: true });
    } catch { /* read-only FS — tests */ }
  }

  /** Persist research state for a company (deduplicated by domain). */
  save(domain: string, state: PersistedResearchState): void {
    const filePath = this.pathFor(domain);
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
    } catch { /* read-only FS — tests */ }
  }

  /** Load the last known state for a company domain. */
  load(domain: string): PersistedResearchState | null {
    const filePath = this.pathFor(domain);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw) as PersistedResearchState;
    } catch {
      return null;
    }
  }

  /** List all persisted states (for `refresh all`). */
  listAll(): PersistedResearchState[] {
    try {
      const files = fs.readdirSync(this.stateDir).filter(f => f.endsWith('.json'));
      const results: PersistedResearchState[] = [];
      for (const f of files) {
        try {
          results.push(JSON.parse(fs.readFileSync(path.join(this.stateDir, f), 'utf8')) as PersistedResearchState);
        } catch { /* skip corrupt */ }
      }
      return results;
    } catch {
      return [];
    }
  }

  /** Delete persisted state for a company. */
  delete(domain: string): void {
    try {
      const filePath = this.pathFor(domain);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }
  }

  /** Clear all persisted state. */
  clearAll(): void {
    try {
      const files = fs.readdirSync(this.stateDir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try { fs.unlinkSync(path.join(this.stateDir, f)); } catch { /* skip */ }
      }
    } catch { /* ignore */ }
  }

  private pathFor(domain: string): string {
    const safe = domain.replace(/[^a-z0-9.\-]/gi, '_').toLowerCase();
    return path.join(this.stateDir, `${safe}.json`);
  }
}
