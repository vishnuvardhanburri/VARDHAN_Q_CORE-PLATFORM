/**
 * VARDHAN — CHANGE DETECTOR (§14, §6)
 * ─────────────────────────────────────────────────────────────────────────────
 * Track per-source and per-finding change for incremental research.
 * Instead of fully re-researching unchanged companies, only re-check sources
 * that have changed.
 *
 * Track:
 *   - sourceHash     (content hash of each source)
 *   - contentHash    (hash of extracted technical content)
 *   - lastSeen       (when the source was last observed)
 *   - lastChanged    (when the source content last changed)
 *   - lastResearched (when the company was last researched)
 *   - lastFindingCheck (when findings were last re-evaluated)
 */

import type { Evidence } from '../IntelligenceCase';
import type { DeepSignal } from '../DeepTypes';
import { FreshnessEngine, type FreshSource, type FreshnessLevel } from '../FreshnessEngine';

export type ChangeKind = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'REMOVED' | 'UNKNOWN';

export interface ChangeRecord {
  kind: ChangeKind;
  category: string;
  entity: string;
  /** Human-readable description of the change. */
  change: string;
  /** Evidence IDs related to this change. */
  evidenceIds: string[];
  /** Source URL related to this change. */
  sourceUrl: string | null;
  /** When the change was detected. */
  detectedAt: string;
}

export interface SourceState {
  url: string;
  contentHash: string | null;
  lastSeen: string;
  lastChanged: string | null;
  freshness: FreshSource;
}

export interface CompanyChangeState {
  companyId: string;
  domain: string;
  sources: Map<string, SourceState>;
  signals: Set<string>;
  findings: string[];
  owners: string[];
  people: string[];
  contacts: string[];
  lastResearched: string | null;
  lastFindingCheck: string | null;
  retrievedAt: string;
}

export class ChangeDetector {
  /** Compare current observations against stored state. Returns change records. */
  static compare(current: CompanyChangeState, previous: CompanyChangeState | null): ChangeRecord[] {
    const changes: ChangeRecord[] = [];
    const now = new Date().toISOString();

    if (!previous) {
      // First run — everything is NEW
      for (const [url, source] of current.sources) {
        changes.push({
          kind: 'NEW',
          category: 'source',
          entity: url,
          change: `Source first observed at ${source.lastSeen}`,
          evidenceIds: [],
          sourceUrl: url,
          detectedAt: now,
        });
      }
      for (const s of current.signals) {
        changes.push({
          kind: 'NEW', category: 'signal', entity: s, change: 'Signal first detected',
          evidenceIds: [], sourceUrl: null, detectedAt: now,
        });
      }
      for (const f of current.findings) {
        changes.push({ kind: 'NEW', category: 'finding', entity: f, change: 'Finding first detected', evidenceIds: [], sourceUrl: null, detectedAt: now });
      }
      return changes;
    }

    // Compare sources
    for (const [url, source] of current.sources) {
      const prev = previous.sources.get(url);
      if (!prev) {
        changes.push({ kind: 'NEW', category: 'source', entity: url, change: `Source newly discovered: ${url}`, evidenceIds: [], sourceUrl: url, detectedAt: now });
      } else if (source.contentHash !== prev.contentHash) {
        changes.push({ kind: 'CHANGED', category: 'source', entity: url, change: `Content changed at ${url} (hash: ${prev.contentHash?.slice(0, 8)} → ${source.contentHash?.slice(0, 8) || 'new'})`, evidenceIds: [], sourceUrl: url, detectedAt: now });
      }
      // UNCHANGED sources produce no change record — they are not actionable.
    }

    // Check for removed sources
    for (const [url] of previous.sources) {
      if (!current.sources.has(url)) {
        changes.push({ kind: 'REMOVED', category: 'source', entity: url, change: `Source no longer accessible: ${url}`, evidenceIds: [], sourceUrl: url, detectedAt: now });
      }
    }

    // Compare signals
    for (const s of current.signals) {
      if (!previous.signals.has(s)) {
        changes.push({ kind: 'NEW', category: 'signal', entity: s, change: 'New technical signal detected', evidenceIds: [], sourceUrl: null, detectedAt: now });
      }
    }

    // Compare findings
    for (const f of current.findings) {
      if (!previous.findings.includes(f)) {
        changes.push({ kind: 'NEW', category: 'finding', entity: f, change: 'New finding detected', evidenceIds: [], sourceUrl: null, detectedAt: now });
      }
    }

    // Compare owners
    for (const o of current.owners) {
      if (!previous.owners.includes(o)) {
        changes.push({ kind: 'NEW', category: 'owner', entity: o, change: 'New technical owner identified', evidenceIds: [], sourceUrl: null, detectedAt: now });
      }
    }

    return changes;
  }

  /** Build a CompanyChangeState from current observations. */
  static snapshot(domain: string, company: string, evidence: Evidence[], signals: DeepSignal[], findings: string[], owners: string[], people: string[], contacts: string[]): CompanyChangeState {
    const sources = new Map<string, SourceState>();
    const now = new Date().toISOString();

    for (const ev of evidence) {
      if (!sources.has(ev.public_url)) {
        const fresh = FreshnessEngine.classify(ev.retrieved_at);
        sources.set(ev.public_url, {
          url: ev.public_url,
          contentHash: null, // would need actual content hash
          lastSeen: ev.retrieved_at,
          lastChanged: ev.retrieved_at,
          freshness: {
            source_url: ev.public_url,
            source_type: ev.source_type || 'UNKNOWN',
            first_seen: ev.retrieved_at,
            last_seen: ev.retrieved_at,
            published_at: null,
            retrieved_at: ev.retrieved_at,
            age_days: null,
            freshness: fresh.level,
            freshness_reason: fresh.reason,
          },
        });
      }
    }

    return {
      companyId: domain,
      domain,
      sources,
      signals: new Set(signals.map(s => s.signal_id)),
      findings,
      owners,
      people,
      contacts,
      lastResearched: now,
      lastFindingCheck: now,
      retrievedAt: now,
    };
  }

  /** Should we run a lightweight change scan vs. full re-research? */
  static isLightweightScanNeeded(previous: CompanyChangeState | null, maxAgeHours: number = 24): boolean {
    if (!previous) return false;
    const lastResearch = Date.parse(previous.lastResearched || '');
    if (isNaN(lastResearch)) return false;
    const ageHours = (Date.now() - lastResearch) / (1000 * 60 * 60);
    return ageHours < maxAgeHours;
  }
}
