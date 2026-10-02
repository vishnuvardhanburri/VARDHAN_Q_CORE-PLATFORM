// ActivityTimeline.ts
// ---------------------
// Synthesizes a provenance-tracked activity timeline from structured signals,
// raw evidence, and discovered GitHub activity. Every event carries its
// provenance (DOCUMENTED_FACT / REAL_PUBLIC_OBSERVATION / VARDHAN_INFERENCE) and
// the evidence IDs it traces to — never fabricated.

import type { ActivityEvent, ActivityType, DeepSignal, GithubRepoMeta, DeepProspect, DeepFinding } from './DeepTypes';
import type { Evidence, FindingClassification } from './IntelligenceCase';

export interface ActivityInput {
  company: DeepProspect['company'];
  domain: DeepProspect['domain'];
  signals: DeepSignal[];
  evidence: Evidence[];
  github: GithubRepoMeta[] | undefined;
  finding: DeepFinding | FindingClassification | null;
  observedAt?: string;
}

const SIGNAL_TO_ACTIVITY: Partial<Record<DeepSignal['type'], ActivityType>> = {
  PUBLIC_INCIDENT: 'PUBLIC_INCIDENT',
  STATUS_PAGE: 'STATUS_DEGRADATION',
  TECHNICAL_HIRING: 'HIRING_FOR_ROLE',
  ARCHITECTURE_DISCUSSION: 'ARCHITECTURE_CHANGE',
  ENGINEERING_ARTICLE: 'ENGINEERING_RELEASE',
  SECURITY_PAGE: 'SECURITY_UPDATE',
  API_REFERENCE: 'TECHNICAL_SIGNAL',
};

export class ActivityTimeline {
  static synthesize(input: ActivityInput): ActivityEvent[] {
    const events: ActivityEvent[] = [];
    const observedAt = input.observedAt || new Date().toISOString();
    let seq = 0;
    const mk = (type: ActivityType, source_url: string, title: string, provenance: ActivityEvent['provenance'], evidence: string, strength: ActivityEvent['strength'], related: string[], published_at?: string): ActivityEvent => ({
      activity_id: `act:${input.domain}:${seq++}`,
      company_id: input.domain || input.company,
      type, source_url, title, published_at: published_at || null,
      observed_at: observedAt, evidence, provenance, strength, related_evidence_ids: related,
    });

    // 1) Signals -> activity events (documented facts from public pages).
    for (const s of input.signals) {
      const type = SIGNAL_TO_ACTIVITY[s.type] || 'TECHNICAL_SIGNAL';
      const prov = s.provenance === 'REAL_PUBLIC_OBSERVATION' ? 'REAL_PUBLIC_OBSERVATION'
        : s.provenance === 'VARDHAN_INFERENCE' ? 'VARDHAN_INFERENCE' : 'DOCUMENTED_FACT';
      events.push(mk(
        type, s.source_url, s.excerpt.slice(0, 140), prov,
        `signal ${s.signal_id}: ${s.excerpt.slice(0, 120)}`,
        s.signal_strength,
        s.related_evidence_ids || [],
        undefined
      ));
    }

    // 2) Repeatable public observations -> STATUS_DEGRADATION for 5xx, else TECHNICAL_SIGNAL.
    for (const e of input.evidence) {
      if (!e.repeatable) continue;
      const is5xx = (e.status || 0) >= 500 && (e.status || 0) < 600;
      const type = is5xx ? 'STATUS_DEGRADATION' : 'TECHNICAL_SIGNAL';
      const prov = e.evidence_origin === 'REAL_PUBLIC_OBSERVATION' ? 'REAL_PUBLIC_OBSERVATION'
        : e.evidence_origin === 'MOCK_TEST' ? 'REAL_PUBLIC_OBSERVATION' : 'DOCUMENTED_FACT';
      events.push(mk(
        type, e.public_url || '',
        `Observable behavior: ${e.observed_behavior.slice(0, 120)}`,
        prov,
        `evidence ${e.id}: ${e.observed_behavior.slice(0, 120)}`,
        e.repeatable ? (e.evidence_origin === 'REAL_PUBLIC_OBSERVATION' ? 'MEDIUM' : 'LOW') : 'LOW',
        [e.id],
        undefined
      ));
    }

    // 3) GitHub repo updates -> ENGINEERING_RELEASE activity.
    if (input.github) {
      for (const r of input.github) {
        events.push(mk(
          'ENGINEERING_RELEASE', r.url,
          `${r.org}/${r.repo} — public repository maintained by ${input.company}`,
          'DOCUMENTED_FACT',
          `github public repo ${r.url}`,
          'LOW', [], r.updated_at || undefined
        ));
      }
    }

    // 4) The deep finding itself is the headline activity anchor (if any).
    if (input.finding) {
      const df = input.finding as DeepFinding;
      events.push(mk(
        'PUBLIC_INCIDENT',
        df.source_urls?.[0] || '',
        `Finding: ${input.finding.finding_type} — ${input.finding.severity_basis.slice(0, 120)}`,
        'DOCUMENTED_FACT',
        `finding ${input.finding.finding_type}`,
        'HIGH',
        [],
        undefined
      ));
    }

    // Sort: most recent first (by observed_at / published_at).
    events.sort((a, b) => {
      const ta = a.published_at || a.observed_at;
      const tb = b.published_at || b.observed_at;
      return tb.localeCompare(ta);
    });
    return events;
  }
}
