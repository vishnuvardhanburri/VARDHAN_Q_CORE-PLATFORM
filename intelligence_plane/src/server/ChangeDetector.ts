/**
 * VARDHAN — CHANGE DETECTOR (§6)
 * ─────────────────────────────────────────────────────────────────────────────
 * Compares new observations against stored state to detect:
 *   NEW, CHANGED, UNCHANGED, REMOVED, UNKNOWN
 *
 * Never assumes a missing result means something was deleted — requires
 * affirmative evidence of removal (e.g. page now 404 that was 200).
 */

import type { DeepProspect, DeepSignal, ActivityEvent } from './DeepTypes';
import type { Evidence, OwnerCandidate } from './IntelligenceCase';

export type ChangeKind = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'REMOVED' | 'UNKNOWN';

export interface ChangeRecord {
  kind: ChangeKind;
  entity: string;
  /** Category of the entity (e.g. 'source', 'signal', 'finding', 'owner', 'person', 'contact'). */
  category: string;
  /** What changed (brief description). */
  change: string;
  /** Current value (if applicable). */
  current?: string;
  /** Previous value (if applicable). */
  previous?: string;
}

/** Minimal stored state snapshot for comparison. */
export interface StoredState {
  company: string;
  domain: string;
  sources: Set<string>;
  signals: Array<{ signal_id: string; type: string; source_url: string; excerpt: string }>;
  findings: string[];
  owners: string[];
  people: string[];
  contacts: string[];
  activities: Array<{ activity_id: string; type: string; title: string }>;
  evidence_ids: string[];
  retrieved_at: string;
}

/** Build a compact state snapshot from a DeepProspect result. */
export function snapshotFromProspect(prospect: DeepProspect | null): StoredState | null {
  if (!prospect) return null;
  return {
    company: prospect.company,
    domain: prospect.domain,
    sources: new Set((prospect.public_surface?.discovered_pages || []).map(p => p.url)),
    signals: (prospect.technical_signals || []).map(s => ({
      signal_id: s.signal_id,
      type: s.type,
      source_url: s.source_url,
      excerpt: s.excerpt,
    })),
    findings: [
      prospect.findings?.finding_type || '',
      prospect.deep_finding?.finding_type || '',
    ].filter(Boolean),
    owners: prospect.selected_owner ? [prospect.selected_owner.name] : [],
    people: (prospect.people || []).map(p => p.name),
    contacts: (prospect.contactability || []).map(c => c.value),
    activities: (prospect.activity_timeline || []).map(a => ({
      activity_id: a.activity_id,
      type: a.type,
      title: a.title,
    })),
    evidence_ids: (prospect.evidence || []).map(e => e.id),
    retrieved_at: new Date().toISOString(),
  };
}

export class ChangeDetector {
  /**
   * Compare a new deep prospect against the previously stored state.
   * Returns a list of changes. Does NOT assume missing = deleted.
   */
  static detect(
    current: DeepProspect | null,
    previous: StoredState | null
  ): ChangeRecord[] {
    if (!previous) return this.firstRun(current);
    if (!current) return [];

    const changes: ChangeRecord[] = [];
    const currentSnap = snapshotFromProspect(current);
    if (!currentSnap) return changes;

    // Sources
    const prevSources = previous.sources;
    const currSources = currentSnap.sources;
    for (const src of currSources) {
      if (!prevSources.has(src)) {
        changes.push({ kind: 'NEW', entity: src, category: 'source', change: 'New public source discovered.' });
      }
    }
    for (const src of prevSources) {
      if (!currSources.has(src)) {
        // Only report as REMOVED if we actually re-observed the page or got a non-200
        // Since we can't always confirm deletion, classify as CHANGED/UNKNOWN
        changes.push({ kind: 'CHANGED', entity: src, category: 'source', change: 'Source no longer in discovery surface (may be reorganized, not deleted).' });
      }
    }

    // Signals
    const prevSignals = new Map(previous.signals.map(s => [s.signal_id, s]));
    const currSignals = new Map(currentSnap.signals.map(s => [s.signal_id, s]));
    for (const [id, sig] of currSignals) {
      if (!prevSignals.has(id)) {
        changes.push({ kind: 'NEW', entity: id, category: 'signal', change: `${sig.type}: ${sig.excerpt.slice(0, 80)}` });
      } else {
        const prev = prevSignals.get(id)!;
        if (prev.excerpt !== sig.excerpt || prev.type !== sig.type) {
          changes.push({ kind: 'CHANGED', entity: id, category: 'signal', change: `${sig.type} content changed.` });
        } else {
          changes.push({ kind: 'UNCHANGED', entity: id, category: 'signal', change: `${sig.type}: no change.` });
        }
      }
    }

    // Findings
    const prevFindings = new Set(previous.findings || []);
    const currFindings = new Set(currentSnap.findings);
    for (const f of currFindings) {
      if (!prevFindings.has(f)) {
        changes.push({ kind: 'NEW', entity: f, category: 'finding', change: 'New finding type detected.' });
      }
    }
    for (const f of prevFindings) {
      if (!currFindings.has(f) && f) {
        changes.push({ kind: 'CHANGED', entity: f, category: 'finding', change: 'Finding no longer classified (not assumed deleted).' });
      }
    }

    // Owners
    const prevOwners = new Set(previous.owners || []);
    const currOwners = new Set(currentSnap.owners);
    for (const o of currOwners) {
      if (!prevOwners.has(o)) {
        changes.push({ kind: 'NEW', entity: o, category: 'owner', change: 'New technical owner identified.' });
      }
    }
    for (const o of prevOwners) {
      if (!currOwners.has(o)) {
        changes.push({ kind: 'CHANGED', entity: o, category: 'owner', change: 'Owner no longer identified (role change or page reorganization).' });
      }
    }

    // People
    const prevPeople = new Set(previous.people || []);
    const currPeople = new Set(currentSnap.people);
    for (const p of currPeople) {
      if (!prevPeople.has(p)) {
        changes.push({ kind: 'NEW', entity: p, category: 'person', change: 'New person discovered.' });
      }
    }
    for (const p of prevPeople) {
      if (!currPeople.has(p) && p) {
        changes.push({ kind: 'CHANGED', entity: p, category: 'person', change: 'Person no longer identified (role change or page reorganization).' });
      }
    }

    // Contacts
    const prevContacts = new Set(previous.contacts || []);
    const currContacts = new Set(currentSnap.contacts);
    for (const c of currContacts) {
      if (!prevContacts.has(c)) {
        changes.push({ kind: 'NEW', entity: c.slice(0, 40), category: 'contact', change: 'New public contact channel.' });
      }
    }
    for (const c of prevContacts) {
      if (!currContacts.has(c) && c) {
        changes.push({ kind: 'CHANGED', entity: c.slice(0, 40), category: 'contact', change: 'Contact channel no longer available.' });
      }
    }

    // Activities
    const prevActivities = new Map((previous.activities || []).map(a => [a.activity_id, a]));
    const currActivities = new Map(currentSnap.activities.map(a => [a.activity_id, a]));
    for (const [id, act] of currActivities) {
      if (!prevActivities.has(id)) {
        changes.push({ kind: 'NEW', entity: id, category: 'activity', change: `${act.type}: ${act.title.slice(0, 80)}` });
      }
    }

    // Evidence IDs
    const prevEvidence = new Set(previous.evidence_ids || []);
    const currEvidence = new Set(currentSnap.evidence_ids);
    for (const e of currEvidence) {
      if (!prevEvidence.has(e)) {
        changes.push({ kind: 'NEW', entity: e, category: 'evidence', change: 'New evidence observation.' });
      }
    }

    return changes;
  }

  /** First run — everything is NEW. */
  private static firstRun(current: DeepProspect | null): ChangeRecord[] {
    if (!current) return [];
    const snap = snapshotFromProspect(current);
    if (!snap) return [];
    const changes: ChangeRecord[] = [];
    for (const src of snap.sources) {
      changes.push({ kind: 'NEW', entity: src, category: 'source', change: 'Initial discovery.' });
    }
    for (const sig of snap.signals) {
      changes.push({ kind: 'NEW', entity: sig.signal_id, category: 'signal', change: `${sig.type}: ${sig.excerpt.slice(0, 80)}` });
    }
    for (const f of snap.findings) {
      changes.push({ kind: 'NEW', entity: f, category: 'finding', change: 'Initial finding.' });
    }
    for (const o of snap.owners) {
      changes.push({ kind: 'NEW', entity: o, category: 'owner', change: 'Initial owner identification.' });
    }
    for (const p of snap.people) {
      changes.push({ kind: 'NEW', entity: p, category: 'person', change: 'Initial person discovery.' });
    }
    return changes;
  }

  /**
   * Build a state snapshot from an IntelligenceCase (for non-deep research path).
   */
  static snapshotFromCase(caseRef: {
    company: string;
    evidence: Evidence[];
    finding_classification?: { finding_type: string };
    technical_owner?: { name: string };
  }): StoredState {
    return {
      company: caseRef.company,
      domain: '',
      sources: new Set(caseRef.evidence.map(e => e.public_url)),
      signals: [],
      findings: caseRef.finding_classification ? [caseRef.finding_classification.finding_type] : [],
      owners: caseRef.technical_owner ? [caseRef.technical_owner.name] : [],
      people: [],
      contacts: [],
      activities: [],
      evidence_ids: caseRef.evidence.map(e => e.id),
      retrieved_at: new Date().toISOString(),
    };
  }
}
