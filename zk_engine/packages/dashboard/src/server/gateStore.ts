/**
 * Gatekeeper report store — reads stored M8 gate reports from a data
 * directory. Read-only: the dashboard never runs the gate and never
 * modifies the trust model (docs/20 §3).
 */

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { GateReportDetail, GateReportSummary, GateOverview } from '../shared/types.js';

export interface GateReportStore {
  listFiles(): Promise<string[]>;
  readSummary(file: string): Promise<GateReportSummary | null>;
  readDetail(file: string): Promise<GateReportDetail | null>;
  overview(): Promise<GateOverview>;
}

const REPORT_NAME = /^[a-zA-Z0-9._-]+\.json$/;

export class FsGateReportStore implements GateReportStore {
  constructor(private readonly dir: string) {}

  async listFiles(): Promise<string[]> {
    try {
      const entries = await readdir(this.dir);
      return entries.filter((e) => REPORT_NAME.test(e)).sort((a, b) => (a > b ? -1 : 1));
    } catch {
      return [];
    }
  }

  async readDetail(file: string): Promise<GateReportDetail | null> {
    if (!REPORT_NAME.test(file)) return null;
    try {
      const target = resolve(this.dir, file);
      if (!target.startsWith(resolve(this.dir))) return null;
      const raw = JSON.parse(await readFile(target, 'utf8'));
      return this.toDetail(file, raw);
    } catch {
      return null;
    }
  }

  async readSummary(file: string): Promise<GateReportSummary | null> {
    if (!REPORT_NAME.test(file)) return null;
    try {
      const target = resolve(this.dir, file);
      if (!target.startsWith(resolve(this.dir))) return null;
      const raw = JSON.parse(await readFile(target, 'utf8'));
      return this.toSummary(file, raw);
    } catch {
      return null;
    }
  }

  async overview(): Promise<GateOverview> {
    const files = await this.listFiles();
    const summaries: GateReportSummary[] = [];
    for (const f of files) {
      const s = await this.readSummary(f);
      if (s) summaries.push(s);
    }
    const byCircuit: GateOverview['byCircuit'] = {};
    for (const s of summaries) {
      const key = s.circuitId ?? 'unknown';
      const cur = byCircuit[key] ?? { reports: 0, latestVerified: false, latestArtifactHash: null };
      cur.reports += 1;
      const idx = summaries.indexOf(s);
      const isNewestForCircuit =
        summaries.filter((t, i) => t.circuitId === key && i < idx).length === 0;
      if (isNewestForCircuit) {
        cur.latestVerified = s.verified;
        cur.latestArtifactHash = s.artifactHash;
      }
      byCircuit[key] = cur;
    }
    return { count: summaries.length, latest: summaries[0] ?? null, reports: summaries, byCircuit };
  }

  private toSummary(file: string, raw: unknown): GateReportSummary | null {
    const r = raw as Partial<GateReportSummary> & { reasons?: unknown; checks?: Array<{ name: string; ok: boolean }> };
    if (typeof r !== 'object' || r === null || typeof r.verified !== 'boolean') return null;
    const failedChecks = (r.checks ?? []).filter((c) => !c.ok).map((c) => c.name);
    return {
      file,
      verified: r.verified,
      circuitId: r.circuitId ?? null,
      vkHash: r.vkHash ?? null,
      artifactHash: r.artifactHash ?? null,
      publicInputHash: r.publicInputHash ?? null,
      keyId: r.keyId ?? null,
      reasonCount: Array.isArray(r.reasons) ? r.reasons.length : 0,
      failedChecks,
    };
  }

  private toDetail(file: string, raw: unknown): GateReportDetail | null {
    const s = this.toSummary(file, raw);
    const r = raw as GateReportDetail;
    if (!s) return null;
    return {
      ...s,
      checks: Array.isArray(r.checks) ? r.checks : [],
      reasons: Array.isArray(r.reasons) ? r.reasons : [],
      onChain: r.onChain ?? null,
    };
  }
}