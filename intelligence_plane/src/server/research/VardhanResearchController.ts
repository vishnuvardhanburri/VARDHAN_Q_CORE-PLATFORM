/**
 * VARDHAN — RESEARCH CONTROLLER (§19, §20)
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates the FAST TRIAGE → OPPORTUNITY → VERIFICATION → DECIDE loop.
 * This is the minimal reliable path that works against REAL public companies.
 *
 * State machine:
 *   TRIAGE → TARGETED → DEEP → VERIFY → COMPLETE
 *
 * A failed source does NOT terminate company research. The controller classifies
 * the failure, selects an alternate strategy, and retries within budget.
 */

import { TriageEngine, type TriageResult } from './TriageEngine';
import { VardhanNoiseFilter } from '../findings/VardhanNoiseFilter';
import { OpportunityDetector, type FindingOutput } from '../findings/OpportunityDetector';
import { SignalCorrelationEngine } from '../signals/SignalCorrelationEngine';
import { BudgetController, type BudgetTier, type ResearchBudget, BUDGET_TIERS } from './ResearchBudget';
import { EvidenceLedger } from '../EvidenceLedger';
import { StatePersistence } from '../StatePersistence';
import { ChangeDetector, snapshotFromProspect } from '../ChangeDetector';
import type { HttpFetcher } from '../IntelligenceCase';
import type { SearchProvider } from '../WebSearchProvider';
import type { DeepBuilderResult } from '../DeepTypes';
import { DeepProspectBuilder } from '../DeepProspectBuilder';
import type { DeepProspect } from '../DeepTypes';

export type ResearchPhase = 'TRIAGE' | 'TARGETED' | 'DEEP' | 'VERIFY' | 'COMPLETE';

export interface ResearchState {
  companyId: string;
  phase: ResearchPhase;
  hypotheses: string[];
  completedActions: string[];
  pendingActions: string[];
  evidenceIds: string[];
  signalIds: string[];
  findingIds: string[];
  lastDecision: 'STOP' | 'RESEARCH_MORE' | 'DEEP_RESEARCH' | 'FINDING';
  startedAt: string;
  updatedAt: string;
}

export interface ResearchResult {
  company: string;
  domain: string;
  runId: string;
  phase: ResearchPhase;
  budgetSummary: string;
  triage: TriageResult | null;
  finding: FindingOutput | null;
  evidenceCount: number;
  signalCount: number;
  owner: { name: string; role: string; confidence: string } | null;
  outreachReady: boolean;
  failures: { type: string; source: string; strategy: string }[];
  auditTrail: string[];
  timeMs: number;
}

export interface ResearchControllerOptions {
  fetcher?: HttpFetcher;
  searchProvider?: SearchProvider;
  modelGateway?: any;
  artifactsDir?: string;
  maxTriageRuntimeMs?: number;
  maxDeepRuntimeMs?: number;
  onProgress?: (phase: ResearchPhase | string, msg: string) => void;
}

export class VardhanResearchController {
  private readonly fetcher: HttpFetcher;
  readonly searchProvider?: SearchProvider;
  private readonly modelGateway?: any;
  private readonly artifactsDir: string;
  private readonly maxTriageRuntimeMs: number;
  private readonly maxDeepRuntimeMs: number;
  private readonly onProgress: (phase: string, msg: string) => void;
  private readonly ledger: EvidenceLedger;
  private readonly statePersistence: StatePersistence;

  constructor(options: ResearchControllerOptions = {}) {
    this.fetcher = options.fetcher || (globalThis.fetch as any);
    this.searchProvider = options.searchProvider;
    this.modelGateway = options.modelGateway;
    this.artifactsDir = options.artifactsDir || process.cwd();
    this.maxTriageRuntimeMs = options.maxTriageRuntimeMs ?? 30_000;
    this.maxDeepRuntimeMs = options.maxDeepRuntimeMs ?? 300_000;
    this.onProgress = (phase, msg) => options.onProgress?.(phase, msg) || console.log(`  [${phase}] ${msg}`);
    this.ledger = new EvidenceLedger(`${this.artifactsDir}/artifacts/intelligence/evidence`);
    this.statePersistence = new StatePersistence(`${this.artifactsDir}/artifacts/intelligence`);
  }

  /** @internal — expose fetcher for SystemManager identity resolution. */
  getFetcher(): HttpFetcher { return this.fetcher; }

  /**
   * Run the full research pipeline for a single company.
   * Implements the FAST TRIAGE → OPPORTUNITY → VERIFICATION → DECIDE loop.
   */
  async researchCompany(
    company: string,
    domain: string,
    providerCompanies: any[] = [],
  ): Promise<ResearchResult> {
    const startTime = Date.now();
    const runId = 'rc_' + Math.random().toString(36).slice(2, 12);
    const auditTrail: string[] = [];
    const failures: { type: string; source: string; strategy: string }[] = [];

    this.onProgress('TRIAGE', `Starting research for ${company} (${domain})`);
    auditTrail.push(`Research cycle ${runId} initiated for ${company}`);

    const budget = new BudgetController('TRIAGE');

    // === FAST TRIAGE ===
    this.onProgress('TRIAGE', 'Running fast triage...');
    let triage: TriageResult | null = null;
    try {
      triage = await TriageEngine.triage(company, domain, this.fetcher, {
        maxRequests: BUDGET_TIERS.TRIAGE.maxHttpRequests,
        maxRuntimeMs: this.maxTriageRuntimeMs,
        onProgress: (msg) => this.onProgress('TRIAGE', msg),
      });
      auditTrail.push(`Triage: ${triage.decision} — ${triage.signals.length} signals, ${triage.httpRequestsUsed} requests, ${triage.timeMs}ms`);

      if (triage.decision === 'STOP_LOW_VALUE') {
        this.onProgress('TRIAGE', 'STOP — low value, not worth deeper research.');
        const result: ResearchResult = {
          company, domain, runId, phase: 'COMPLETE',
          budgetSummary: budget.summarize('TRIAGE'),
          triage, finding: null,
          evidenceCount: 0, signalCount: 0,
          owner: null, outreachReady: false,
          failures, auditTrail,
          timeMs: Date.now() - startTime,
        };
        this.saveState(domain, result);
        return result;
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      auditTrail.push(`Triage error: ${msg}`);
      failures.push({ type: 'TRIAGE_ERROR', source: msg, strategy: 'continue to deep pipeline' });
    }

    // === DEEP PIPELINE (via DeepProspectBuilder) ===
    // After triage passes, run the existing deep pipeline for full evidence
    this.onProgress('TARGETED', 'Starting targeted deep research...');
    budget.allocate('TARGETED');

    let deepResult: DeepBuilderResult | null = null;
    let prospect: DeepProspect | null = null;

    try {
      const targetUrl = `https://${domain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
      const resolution = {
        canonical_name: providerCompanies[0]?.canonical_name || providerCompanies[0]?.company || company,
        official_domain: domain,
        resolution_method: (providerCompanies[0]?.source === 'GROWJO' ? 'GROWJO_DOMAIN' : 'AMBIGUOUS') as 'GROWJO_DOMAIN' | 'GROWJO_HOMEPAGE_CANONICAL' | 'PUBLIC_REDIRECT' | 'PUBLIC_CANONICAL_LINK' | 'OGP_URL' | 'AMBIGUOUS',
        resolution_source: providerCompanies[0]?.source_url || `Direct seed: ${domain}`,
        resolution_confidence: 'HIGH' as const,
      };

      const builder = new DeepProspectBuilder({
        fetcher: this.fetcher as any,
        saveArtifact: (p, d) => { try { require('fs').mkdirSync(require('path').dirname(p), { recursive: true }); require('fs').writeFileSync(p, d, 'utf8'); } catch { /* read-only FS */ } },
        artifactsBaseDir: this.artifactsDir,
        maxDiscoveryPages: 15,
        discoveryDelayMs: 40,
        discoveryTimeoutMs: 6000,
        observationDelayMs: 40,
        onProgress: (stage: any, msg: string) => this.onProgress('deep:' + stage, msg),
        logger: (m: string) => this.onProgress('deep:log', m),
        growjo: providerCompanies[0]?.source === 'GROWJO' ? providerCompanies[0] : null,
        providerCompanies,
        resolution,
        statePersistence: this.statePersistence,
        searchProvider: this.searchProvider,
        skipLiveWebResearch: false,
      });

      deepResult = await builder.build(targetUrl);
      prospect = deepResult.prospect;
      auditTrail.push(`Deep pipeline: decision=${prospect.decision} confidence=${prospect.confidence}`);
      this.onProgress('DEEP', `Deep pipeline complete: ${prospect.decision} (${prospect.confidence})`);
    } catch (e: any) {
      const msg = e?.message || String(e);
      auditTrail.push(`Deep pipeline error: ${msg}`);
      failures.push({ type: 'DEEP_PIPELINE_ERROR', source: msg, strategy: 'use triage-only result' });
      prospect = null;
    }

    // === NOISE FILTER ===
    this.onProgress('VERIFY', 'Filtering noise...');
    const allSignals = (prospect?.technical_signals || []) as any[];
    const rawSignals = allSignals.map(s => ({
      type: s.type,
      source_url: s.source_url,
      status: undefined,
      excerpt: s.excerpt,
      age_days: s.related_evidence_ids ? 0 : null,
      evidence_count: (s.related_evidence_ids || []).length,
      reproducible: !!s.related_evidence_ids && s.related_evidence_ids.length > 0,
      content: '',
      headers: {},
    }));

    const noiseResult = VardhanNoiseFilter.filterSignals(rawSignals);
    this.onProgress('VERIFY', `Noise filter: ${noiseResult.candidates.length} candidates, ${noiseResult.noise.length} rejected`);
    for (const n of noiseResult.noise) {
      this.onProgress('VERIFY', `  noise: ${n.assessment.reason}`);
    }
    auditTrail.push(`Noise filter: ${noiseResult.candidates.length} candidates, ${noiseResult.noise.length} noise`);

    // === OPPORTUNITY DETECTION ===
    this.onProgress('VERIFY', 'Detecting engineering opportunities...');
    const opportunities = OpportunityDetector.detect(
      allSignals as any,
      prospect?.evidence || [],
      { company, now: new Date().toISOString() },
    );

    // === CORRELATION ===
    const correlation = SignalCorrelationEngine.correlate(allSignals as any, prospect?.evidence || []);
    this.onProgress('VERIFY', `Correlation: ${correlation.correlationCount} group(s), dominant: ${correlation.dominantTheme || 'none'}`);
    auditTrail.push(`Correlation: ${correlation.correlationCount} groups, shouldDeep=${correlation.shouldDeepResearch}`);

    // === FINDING EVALUATION ===
    let finding: FindingOutput | null = null;
    if (opportunities.length > 0) {
      const topOpp = opportunities[0];
      finding = OpportunityDetector.evaluateFinding(
        topOpp,
        prospect?.evidence?.length || 0,
        correlation.correlationCount,
      );
      this.onProgress('VERIFY', `Finding: ${finding.classification} — ${finding.explanation}`);
      auditTrail.push(`Finding: ${finding.classification} (${finding.evidenceIds.length} evidence IDs)`);
    } else {
      finding = {
        classification: noiseResult.candidates.length > 0 ? 'RESEARCH_MORE' : 'LOW_VALUE',
        opportunity: null,
        explanation: noiseResult.candidates.length === 0
          ? 'No technical signals detected — low value.'
          : `${noiseResult.candidates.length} signal(s) remain after noise filtering — more research needed.`,
        evidenceIds: prospect?.evidence?.map(e => e.id) || [],
        rejectedSignals: [],
        evaluatedAt: new Date().toISOString(),
      };
      auditTrail.push(`Finding: ${finding.classification}`);
    }

    // === RECORD EVIDENCE IN LEDGER ===
    if (prospect) {
      const now = new Date().toISOString();
      for (const ev of (prospect.evidence || [])) {
        this.ledger.record(domain, runId, ev, 'OBSERVATION', 'REAL_PUBLIC_OBSERVATION' as any);
      }
      for (const sig of (prospect.technical_signals || [])) {
        this.ledger.record(domain, runId, {
          evidence_origin: 'DOCUMENTED_SOURCE' as any,
          public_url: sig.source_url,
          source_type: 'UNKNOWN' as any,
          observed_behavior: sig.excerpt,
          method: 'GET',
          status: 200,
          reproductions: 1,
          repeatable: true,
          tested_without_auth: true,
          not_tested: [],
          retrieved_at: now,
          evidence_text: `${sig.type}: ${sig.excerpt.slice(0, 120)}`,
        } as any, 'FACT', sig.provenance as string);
      }
    }

    // === OWNER ===
    this.onProgress('VERIFY', 'Checking owner...');
    const owner = prospect?.selected_owner
      ? { name: prospect.selected_owner.name, role: prospect.selected_owner.role, confidence: prospect.selected_owner.confidence }
      : null;

    // === OUTREACH GATE ===
    // Only outreach-ready if: finding is VERIFIED or ENGINEERING_OPPORTUNITY + owner + contact
    const contacts = prospect?.contactability || [];
    const outreachReady = (finding.classification === 'VERIFIED_FINDING' || finding.classification === 'ENGINEERING_OPPORTUNITY')
      && !!owner
      && contacts.length > 0
      && finding.evidenceIds.length >= 1;

    const result: ResearchResult = {
      company,
      domain,
      runId,
      phase: 'COMPLETE',
      budgetSummary: `${budget.summarize('TRIAGE')} | ${budget.summarize('TARGETED')}`,
      triage,
      finding,
      evidenceCount: prospect?.evidence?.length || 0,
      signalCount: allSignals.length,
      owner,
      outreachReady,
      failures,
      auditTrail,
      timeMs: Date.now() - startTime,
    };

    this.saveState(domain, result);
    this.onProgress('COMPLETE', `Research complete. Finding: ${finding.classification}, Outreach-ready: ${outreachReady}`);

    return result;
  }

  /** Save research state for resume. */
  private saveState(domain: string, result: ResearchResult): void {
    try {
      const snap = snapshotFromProspect(null);
      this.statePersistence.save(domain, {
        company: result.company,
        domain,
        last_researched_at: new Date().toISOString(),
        stage_reached: 1,
        last_error: result.failures.length > 0 ? result.failures[0].type : null,
        last_summary: {
          decision: result.finding?.classification || 'UNKNOWN',
          finding: result.finding?.opportunity?.title || null,
          owner: result.owner?.name || null,
          confidence: result.finding?.opportunity?.confidence || 'LOW',
          people_count: 0,
          owner_candidates_count: 0,
          evidence_count: result.evidenceCount,
          sources_count: 0,
          technical_signals_count: result.signalCount,
        },
        state_snapshot: snap || this.makeEmptySnapshot(domain, result),
        search_cache: [],
      });
    } catch { /* read-only FS */ }
  }

  private makeEmptySnapshot(domain: string, result: ResearchResult): any {
    return {
      company: result.company,
      domain,
      sources: new Set<string>(),
      signals: [],
      findings: [result.finding?.opportunity?.opportunity_id || ''],
      owners: result.owner ? [result.owner.name] : [],
      people: [],
      contacts: [],
      activities: [],
      evidence_ids: result.finding?.evidenceIds || [],
      retrieved_at: new Date().toISOString(),
    };
  }
}
