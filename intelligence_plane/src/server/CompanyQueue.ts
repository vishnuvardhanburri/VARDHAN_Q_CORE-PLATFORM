// CompanyQueue.ts
// -----------------
// Persistent research queue for Growjo-imported companies. Stores state as a
// JSONL file (one JSON object per line) so interruption is survivable and
// per-company writes are crash-safe.

import * as fs from 'fs';
import * as path from 'path';
import type { QueuedCompany, QueueState, GrowjoCompany, CompanyResolution, DeepDecision, DeepConfidence } from './DeepTypes';

export class CompanyQueue {
  private file: string;
  private rows: QueuedCompany[] = [];

  constructor(filePath: string) {
    this.file = filePath;
    try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch { /* exists */ }
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.file)) { this.rows = []; return; }
    const raw = fs.readFileSync(this.file, 'utf8');
    this.rows = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { this.rows.push(JSON.parse(t)); } catch { /* skip corrupt line */ }
    }
  }

  private flush(): void {
    const data = this.rows.map(r => JSON.stringify(r)).join('\n') + (this.rows.length ? '\n' : '');
    fs.writeFileSync(this.file, data, 'utf8');
  }

  count(state?: QueueState): number {
    return state ? this.rows.filter(r => r.state === state).length : this.rows.length;
  }

  list(state?: QueueState): QueuedCompany[] {
    return state ? this.rows.filter(r => r.state === state) : [...this.rows];
  }

  private byId(id: string): QueuedCompany | undefined {
    return this.rows.find(r => r.id === id);
  }

  private save(row: QueuedCompany): void {
    const idx = this.rows.findIndex(r => r.id === row.id);
    if (idx >= 0) this.rows[idx] = row; else this.rows.push(row);
    this.flush();
  }

  static canonicalDomain(c: GrowjoCompany | { domain: string | null }): string | null {
    if (!c.domain) return null;
    return c.domain.replace(/^www\./, '').toLowerCase();
  }

  enqueue(companies: GrowjoCompany[]): { added: number; duplicates: number } {
    let added = 0, duplicates = 0;
    for (const c of companies) {
      const canon = CompanyQueue.canonicalDomain(c);
      const exists = canon ? this.rows.some(r => CompanyQueue.canonicalDomain(r.growjo || { domain: null }) === canon) : false;
      if (exists) { duplicates++; continue; }
      const id = `gq:${canon || c.canonical_name.toLowerCase().replace(/\s+/g, '_')}:${Date.now()}`;
      const row: QueuedCompany = {
        id,
        company: c.canonical_name,
        domain: c.domain,
        state: 'QUEUED',
        growjo: c,
        resolution: null,
        artifact_path: null,
        prospect: null,
        attempt: 0,
        last_error: null,
        enqueued_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.save(row);
      added++;
    }
    return { added, duplicates };
  }

  enqueueName(companyName: string, domain: string | null = null): QueuedCompany {
    const canon = domain ? companyName + '|' + CompanyQueue.canonicalDomain({ domain }) : companyName;
    const exists = this.rows.find(r => r.company === companyName && (r.domain || '') === (domain || ''));
    if (exists) return exists;
    const id = `gq:${canon.toLowerCase().replace(/\s+/g, '_')}:${Date.now()}`;
    const row: QueuedCompany = {
      id, company: companyName, domain, state: 'QUEUED', growjo: null, resolution: null,
      artifact_path: null, prospect: null, attempt: 0, last_error: null,
      enqueued_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    this.save(row);
    return row;
  }

  claimNext(workerId?: string): QueuedCompany | null {
    const idx = this.rows.findIndex(r => r.state === 'QUEUED');
    if (idx < 0) return null;
    const row = this.rows[idx];
    row.state = 'RESOLVING'; 
    row.updated_at = new Date().toISOString();
    if (workerId) {
      (row as any).worker_id = workerId;
      (row as any).claimed_at = new Date().toISOString();
    }
    this.save(row);
    return row;
  }

  markResolving(id: string, resolution: CompanyResolution): QueuedCompany | null {
    const row = this.byId(id);
    if (!row) return null;
    row.resolution = resolution;
    row.state = 'RESEARCHING';
    row.updated_at = new Date().toISOString();
    this.save(row);
    return row;
  }

  markResearched(
    id: string,
    decision: DeepDecision,
    confidence: DeepConfidence,
    finding: string | null,
    owner: string | null,
    artifact_path: string | null,
    nextState: 'OUTREACH_READY' | 'RESEARCH_MORE' | 'NO_GO' | 'CONTACT_READY',
    error?: string | null
  ): QueuedCompany | null {
    const row = this.byId(id);
    if (!row) return null;
    row.state = nextState;
    row.prospect = { decision, finding, owner, confidence };
    row.artifact_path = artifact_path;
    row.attempt += 1;
    row.last_error = error || null;
    row.updated_at = new Date().toISOString();
    this.save(row);
    return row;
  }

  approve(id: string): QueuedCompany | null {
    const row = this.byId(id);
    if (!row) return null;
    if (row.state === 'OUTREACH_READY' || row.state === 'CONTACT_READY') { row.state = 'APPROVED'; row.updated_at = new Date().toISOString(); this.save(row); }
    return row;
  }

  markSent(id: string): QueuedCompany | null {
    const row = this.byId(id);
    if (!row || row.state !== 'APPROVED') return null;
    row.state = 'SENT'; row.updated_at = new Date().toISOString();
    this.save(row);
    return row;
  }

  pending(): QueuedCompany[] {
    return this.rows.filter(r => !['NO_GO', 'APPROVED', 'SENT'].includes(r.state));
  }

  /** Recovery: Re-queue companies stuck in RESOLVING or RESEARCHING for too long. */
  recoverStaleClaims(timeoutMs: number = 3600000): number {
    let recovered = 0;
    const now = new Date().getTime();
    for (const row of this.rows) {
      if (row.state === 'RESOLVING' || row.state === 'RESEARCHING') {
        const updated = new Date(row.updated_at).getTime();
        if (now - updated > timeoutMs) {
          row.state = 'QUEUED';
          row.updated_at = new Date().toISOString();
          recovered++;
        }
      }
    }
    if (recovered > 0) this.flush();
    return recovered;
  }
}
