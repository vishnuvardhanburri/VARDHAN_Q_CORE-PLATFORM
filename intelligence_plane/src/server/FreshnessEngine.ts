/**
 * VARDHAN — FRESHNESS ENGINE (§5)
 * ─────────────────────────────────────────────────────────────────────────────
 * Tracks the freshness of every source/activity/signal and classifies
 * whether information is current or stale. Prefers recent sources.
 * Never silently presents old information as current.
 *
 * Classification:
 *   FRESH     — observed within the recent threshold
 *   AGING     — observed within the stale threshold
 *   STALE     — older than the stale threshold
 *   UNKNOWN   — no timestamp available
 */

import type { Evidence } from './IntelligenceCase';
import type { OwnerCandidate } from './IntelligenceCase';
import type { DeepContact } from './DeepTypes';

export type FreshnessLevel = 'FRESH' | 'AGING' | 'STALE' | 'UNKNOWN';

export interface FreshSource {
  source_url: string;
  source_type: string;
  first_seen: string | null;
  last_seen: string | null;
  /** ISO date the source content was published (if discoverable). */
  published_at: string | null;
  /** When VARDHAN last retrieved/observed this source. */
  retrieved_at: string;
  /** Age in days at last observation. */
  age_days: number | null;
  freshness: FreshnessLevel;
  /** Human-readable reason for the freshness classification. */
  freshness_reason: string;
}

export interface FreshnessOptions {
  freshThresholdDays?: number;
  staleThresholdDays?: number;
}

const DEFAULT_FRESH = 30;   // days — information seen within last 30 days is "fresh"
const DEFAULT_STALE = 180;  // days — information older than 180 days is "stale"

export class FreshnessEngine {
  /**
   * Classify the freshness of a single observation based on its retrieved_at.
   */
  static classify(retrievedAt: string | undefined, publishedAt?: string | null): { level: FreshnessLevel; reason: string; ageDays: number | null } {
    if (!retrievedAt) {
      return { level: 'UNKNOWN', reason: 'No retrieval timestamp available.', ageDays: null };
    }

    const retrieved = Date.parse(retrievedAt);
    if (isNaN(retrieved)) {
      return { level: 'UNKNOWN', reason: 'Invalid retrieval timestamp.', ageDays: null };
    }

    const ageDays = (Date.now() - retrieved) / (1000 * 60 * 60 * 24);

    // Prefer published_at for content freshness, but fall back to retrieved_at
    let contentAge = ageDays;
    if (publishedAt) {
      const pub = Date.parse(publishedAt);
      if (!isNaN(pub)) {
        contentAge = (Date.now() - pub) / (1000 * 60 * 60 * 24);
      }
    }

    if (contentAge <= DEFAULT_FRESH) {
      return { level: 'FRESH', reason: `Observed ${Math.round(contentAge)} days ago (within ${DEFAULT_FRESH}d fresh window).`, ageDays: Math.round(contentAge) };
    }
    if (contentAge <= DEFAULT_STALE) {
      return { level: 'AGING', reason: `Observed ${Math.round(contentAge)} days ago (aging — between fresh and stale).`, ageDays: Math.round(contentAge) };
    }
    return { level: 'STALE', reason: `Observed ${Math.round(contentAge)} days ago (older than ${DEFAULT_STALE}d stale threshold).`, ageDays: Math.round(contentAge) };
  }

  /** Build a FreshSource record from an Evidence observation. */
  static fromEvidence(ev: Evidence): FreshSource {
    const cls = this.classify(ev.retrieved_at, undefined);
    return {
      source_url: ev.public_url,
      source_type: ev.source_type,
      first_seen: ev.retrieved_at,
      last_seen: ev.retrieved_at,
      published_at: null,
      retrieved_at: ev.retrieved_at,
      age_days: cls.ageDays,
      freshness: cls.level,
      freshness_reason: cls.reason,
    };
  }

  /**
   * Evaluate a set of sources and return those that are stale or unknown,
   * indicating live-web research should be triggered.
   */
  static needsRefresh(sources: FreshSource[], opts: FreshnessOptions = {}): { needs_refresh: boolean; stale: FreshSource[]; aging: FreshSource[]; fresh: FreshSource[]; unknown: FreshSource[] } {
    const stale: FreshSource[] = [];
    const aging: FreshSource[] = [];
    const fresh: FreshSource[] = [];
    const unknown: FreshSource[] = [];

    for (const s of sources) {
      switch (s.freshness) {
        case 'STALE': stale.push(s); break;
        case 'AGING': aging.push(s); break;
        case 'FRESH': fresh.push(s); break;
        case 'UNKNOWN': unknown.push(s); break;
      }
    }

    // Trigger refresh if there are STALE sources or all sources are UNKNOWN
    const needs_refresh = stale.length > 0 || (unknown.length > 0 && fresh.length === 0 && aging.length === 0);
    return { needs_refresh, stale, aging, fresh, unknown };
  }

  /**
   * Check if any evidence in the given set is stale or unknown,
   * indicating a refresh is warranted.
   */
  static evidenceNeedsRefresh(evidence: Evidence[]): boolean {
    for (const ev of evidence) {
      const { level } = this.classify(ev.retrieved_at);
      if (level === 'STALE' || level === 'UNKNOWN') return true;
    }
    return false;
  }

  /**
   * Check if any owner candidate's source is stale.
   */
  static ownerNeedsRefresh(owner: OwnerCandidate | null): boolean {
    if (!owner) return false;
    return owner.source_urls.some(u => {
      // We can't determine freshness of a URL alone; treat as unknown
      return true;
    });
  }

  /**
   * Check if any contact's source is stale.
   */
  static contactNeedsRefresh(contacts: DeepContact[]): boolean {
    // Contacts from dataset may be stale; always verify via live web
    return contacts.length > 0;
  }

  static readonly FRESH_DAYS = DEFAULT_FRESH;
  static readonly STALE_DAYS = DEFAULT_STALE;
}
