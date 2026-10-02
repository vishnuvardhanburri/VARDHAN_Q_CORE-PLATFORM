/**
 * VARDHAN — EVIDENCE LEDGER (§12)
 * ─────────────────────────────────────────────────────────────────────────────
 * The single source of truth for every observation. Every conclusion in VARDHAN
 * must trace backward:
 *   EMAIL/OPPORTUNITY → FINDING → SIGNAL → EVIDENCE → SOURCE → URL → TIMESTAMP
 *
 * Evidence is persisted with full provenance, content hash, and traceability links.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomBytes, createHash } from 'crypto';
import type { Evidence } from './IntelligenceCase';

export type EvidenceType = 'FACT' | 'OBSERVATION' | 'DOCUMENTED_SOURCE' | 'INFERENCE';

export interface EvidenceRecord extends Evidence {
  evidence_type: EvidenceType;
  /** SHA-256 content hash for deduplication. */
  content_hash: string;
  /** The company this evidence belongs to. */
  company_id: string;
  /** The research run that observed this evidence. */
  run_id: string;
  /** 6-tag provenance: GROWJO_SOURCE, OFFICIAL_COMPANY_SOURCE, etc. */
  provenance_tag: string;
  /** Downstream entities that reference this evidence. */
  referenced_by: string[];
  /** Source relationship in the IdentityGraph. */
  source_relationship: 'OFFICIAL' | 'LINKED' | 'DISCOVERED' | 'LIKELY' | 'VERIFIED';
}

export interface TraceLink {
  from_id: string;
  to_id: string;
  relationship: string;
  evidence_ids: string[];
  confidence: number;
}

export interface CompanyEvidence {
  company_id: string;
  company_name: string;
  evidence: EvidenceRecord[];
  trace_links: TraceLink[];
  summary: {
    total_evidence: number;
    by_type: Record<string, number>;
    by_provenance: Record<string, number>;
    first_observed: string | null;
    last_observed: string | null;
  };
}

/** Simple deterministic hash of content (SHA-256, hex digest). */
function hashContent(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/** Generate a unique evidence ID. */
function genId(): string {
  return 'ev_' + randomBytes(8).toString('hex');
}

export class EvidenceLedger {
  private readonly storeDir: string;

  constructor(storeDir: string) {
    this.storeDir = storeDir;
    try { fs.mkdirSync(storeDir, { recursive: true }); } catch { /* read-only FS */ }
  }

  /**
   * Record a new piece of evidence. Deduplicates by content hash — if the same
   * content was already recorded for this company, returns the existing record
   * and updates `last_observed`.
   */
  record(
    companyId: string,
    runId: string,
    evidence: Partial<Evidence> & { observed_behavior: string; public_url: string },
    evidenceType: EvidenceType,
    provenance: string = 'REAL_PUBLIC_OBSERVATION',
    sourceRelationship: EvidenceRecord['source_relationship'] = 'DISCOVERED',
  ): EvidenceRecord {
    const hash = hashContent(evidence.observed_behavior + evidence.public_url + provenance);
    const existing = this.findByHash(companyId, hash);
    const now = new Date().toISOString();
    const id = existing?.id || genId();

    const record: EvidenceRecord = {
      id,
      evidence_origin: evidence.evidence_origin || 'REAL_PUBLIC_OBSERVATION',
      provenance_tag: provenance,
      public_url: evidence.public_url,
      source_type: (evidence.source_type || 'UNKNOWN') as any,
      method: evidence.method || 'GET',
      status: evidence.status || 200,
      observed_behavior: evidence.observed_behavior,
      reproductions: evidence.reproductions || 1,
      repeatable: evidence.repeatable || false,
      tested_without_auth: evidence.tested_without_auth ?? true,
      not_tested: evidence.not_tested || [],
      retrieved_at: evidence.retrieved_at || now,
      evidence_text: evidence.evidence_text || '',
      latency_ms: evidence.latency_ms,
      latency_samples: evidence.latency_samples,
      baseline_latency_ms: evidence.baseline_latency_ms,
      evidence_type: evidenceType,
      content_hash: hash,
      company_id: companyId,
      run_id: runId,
      referenced_by: existing ? [...(existing.referenced_by || []), runId] : [runId],
      source_relationship: sourceRelationship,
    };

    this.saveRecord(record);
    return record;
  }

  /** Link two evidence items (e.g. a finding references an evidence ID). */
  link(fromId: string, toId: string, relationship: string, evidenceIds: string[], confidence: number = 1.0): TraceLink {
    const link: TraceLink = { from_id: fromId, to_id: toId, relationship, evidence_ids: evidenceIds, confidence };
    this.saveTrace(fromId, link);
    return link;
  }

  /** Get all evidence for a company with traceability summary. */
  getCompanyEvidence(companyId: string): CompanyEvidence {
    const records = this.loadAllRecords(companyId);
    const traceLinks = this.loadAllTraces(companyId);

    const byType: Record<string, number> = {};
    const byProvenance: Record<string, number> = {};
    let firstObserved: string | null = null;
    let lastObserved: string | null = null;

    for (const r of records) {
      byType[r.evidence_type] = (byType[r.evidence_type] || 0) + 1;
      byProvenance[r.evidence_origin] = (byProvenance[r.evidence_origin] || 0) + 1;
      if (!firstObserved || r.retrieved_at < firstObserved) firstObserved = r.retrieved_at;
      if (!lastObserved || r.retrieved_at > lastObserved) lastObserved = r.retrieved_at;
    }

    return {
      company_id: companyId,
      company_name: records[0]?.public_url || '',
      evidence: records,
      trace_links: traceLinks,
      summary: {
        total_evidence: records.length,
        by_type: byType,
        by_provenance: byProvenance,
        first_observed: firstObserved,
        last_observed: lastObserved,
      },
    };
  }

  /** Trace backward from any evidence/finding/finding to source. */
  traceBackward(id: string): TraceLink[] {
    return this.loadTracesFor(id);
  }

  /** Find evidence by content hash (deduplication). */
  private findByHash(companyId: string, hash: string): EvidenceRecord | null {
    const records = this.loadAllRecords(companyId);
    return records.find(r => r.content_hash === hash) || null;
  }

  private recordPath(companyId: string): string {
    return path.join(this.storeDir, `${companyId}.jsonl`);
  }

  private tracePath(companyId: string): string {
    return path.join(this.storeDir, `${companyId}.traces.json`);
  }

  private saveRecord(record: EvidenceRecord): void {
    try {
      const p = this.recordPath(record.company_id);
      let records: EvidenceRecord[] = [];
      if (fs.existsSync(p)) {
        const lines = fs.readFileSync(p, 'utf8').split('\n').filter(l => l.trim());
        records = lines.map(l => JSON.parse(l) as EvidenceRecord);
      }
      // Upsert by id: replace existing, append new
      const idx = records.findIndex(r => r.id === record.id);
      if (idx >= 0) records[idx] = record;
      else records.push(record);
      fs.writeFileSync(p, records.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    } catch { /* read-only FS */ }
  }

  private saveTrace(fromId: string, link: TraceLink): void {
    try {
      const p = path.join(this.storeDir, 'traces.jsonl');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.appendFileSync(p, JSON.stringify(link) + '\n', 'utf8');
    } catch { /* read-only FS */ }
  }

  private loadAllRecords(companyId: string): EvidenceRecord[] {
    try {
      const p = this.recordPath(companyId);
      if (!fs.existsSync(p)) return [];
      const lines = fs.readFileSync(p, 'utf8').split('\n').filter(l => l.trim());
      return lines.map(l => JSON.parse(l) as EvidenceRecord);
    } catch {
      return [];
    }
  }

  private loadAllTraces(companyId: string): TraceLink[] {
    try {
      const p = this.tracePath(companyId);
      if (!fs.existsSync(p)) return [];
      const data = JSON.parse(fs.readFileSync(p, 'utf8')) as TraceLink[];
      return data;
    } catch {
      return [];
    }
  }

  private loadTracesFor(id: string): TraceLink[] {
    try {
      const allTraces: TraceLink[] = [];
      for (const f of fs.readdirSync(this.storeDir)) {
        if (f.endsWith('.traces.json')) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(this.storeDir, f), 'utf8')) as TraceLink[];
            allTraces.push(...data.filter(l => l.from_id === id || l.to_id === id));
          } catch { /* skip */ }
        }
      }
      return allTraces;
    } catch {
      return [];
    }
  }
}
