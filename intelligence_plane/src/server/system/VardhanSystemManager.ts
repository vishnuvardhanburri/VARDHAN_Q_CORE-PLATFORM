/**
 * VARDHAN — SYSTEM MANAGER (§2, §19)
 * ─────────────────────────────────────────────────────────────────────────────
 * The central lifecycle owner for VARDHAN's autonomous intelligence system.
 */

import type { QueuedCompany, GrowjoCompany } from '../DeepTypes';
import type { CanonicalCompany } from '../providers/Model';
import { CompanyQueue } from '../CompanyQueue';
import { DomainResolver, type ResolveSeed } from '../DomainResolver';
import { VardhanResearchController, type ResearchResult, type ResearchPhase } from '../research/VardhanResearchController';
import { BudgetController, type BudgetTier, BUDGET_TIERS } from '../research/ResearchBudget';
import { StatePersistence } from '../StatePersistence';
import type { HttpFetcher } from '../IntelligenceCase';
import type { SearchProvider } from '../WebSearchProvider';
import type { VardhanModelGateway } from '../VardhanModelGateway';
import { BroadIntelligenceOrchestrator } from '../BroadIntelligenceOrchestrator';
import { CompanyResearchContext } from '../CompanyResearchContext';
import { IntelligenceCase, Evidence } from '../IntelligenceCase';

export type SystemManagerState =
  | 'DISCOVER' | 'RESOLVE' | 'PLAN' | 'RESEARCH' | 'ASSESS' | 'EXPAND'
  | 'CORRELATE' | 'DECIDE' | 'FINDING' | 'OWNER' | 'CONTACT' | 'QA'
  | 'HUMAN_APPROVAL' | 'SEND' | 'DONE' | 'ERROR';

export type FailureType =
  | 'SEARCH_UNAVAILABLE' | 'TIMEOUT' | 'HTTP_403' | 'HTTP_429' | 'JS_REQUIRED'
  | 'EMPTY_RESULT' | 'SOURCE_DISAPPEARED' | 'DNS_FAILURE' | 'PARSER_FAILURE'
  | 'MODEL_FAILURE' | 'TRIAGE_ERROR' | 'UNKNOWN';

export interface CompanyReport {
  company: string;
  domain: string;
  runId: string;
  state: SystemManagerState;
  phase: ResearchPhase;
  triage: {
    decision: 'PASS_FOR_DEEP_RESEARCH' | 'STOP_LOW_VALUE';
    signals: string[];
    requests: number;
    timeMs: number;
  } | null;
  finding: {
    classification: string;
    title: string | null;
    confidence: string;
    explanation: string;
    evidenceIds: string[];
  } | null;
  evidenceCount: number;
  signalCount: number;
  sourcesCount: number;
  owner: { name: string; role: string; confidence: string } | null;
  outreachReady: boolean;
  failures: { type: FailureType; source: string; strategy: string }[];
  auditTrail: string[];
  timeMs: number;
  nextResearchAction: string;
}

export interface SystemManagerOptions {
  fetcher?: HttpFetcher;
  searchProvider?: SearchProvider;
  modelGateway?: VardhanModelGateway;
  artifactsDir?: string;
  queuePath?: string;
  output?: { write: (s: string) => void };
  maxTriageRuntimeMs?: number;
  maxDeepRuntimeMs?: number;
}

export class VardhanSystemManager {
  private readonly controller: VardhanResearchController;
  private readonly queue: CompanyQueue | null;
  private readonly statePersistence: StatePersistence;
  private readonly onProgress: (phase: string, msg: string) => void;
  private readonly artifactsDir: string;
  public readonly broadIntelOrchestrator: BroadIntelligenceOrchestrator;

  constructor(options: SystemManagerOptions = {}) {
    const output = options.output ?? { write: (s: string) => process.stdout.write(s) };
    this.onProgress = (phase, msg) => output.write(`  [${phase}] ${msg}`);
    this.artifactsDir = options.artifactsDir || process.cwd();
    this.controller = new VardhanResearchController({
      fetcher: options.fetcher,
      searchProvider: options.searchProvider,
      modelGateway: options.modelGateway,
      artifactsDir: this.artifactsDir,
      maxTriageRuntimeMs: options.maxTriageRuntimeMs,
      maxDeepRuntimeMs: options.maxDeepRuntimeMs,
      onProgress: (phase, msg) => this.onProgress(phase, msg),
    });
    const queuePath = options.queuePath || `${this.artifactsDir}/artifacts/intelligence/queue.jsonl`;
    this.statePersistence = new StatePersistence(`${this.artifactsDir}/artifacts/intelligence`);
    try { this.queue = new CompanyQueue(queuePath); } catch { this.queue = null; }
    
    this.broadIntelOrchestrator = new BroadIntelligenceOrchestrator(this);
  }

  async researchCompany(
    company: string,
    domain: string,
    providerCompanies: any[] = [],
  ): Promise<CompanyReport> {
    const start = Date.now();
    const auditTrail: string[] = [];
    const failures: { type: FailureType; source: string; strategy: string }[] = [];
    let state: SystemManagerState = 'DISCOVER';

    this.onProgress('system', `System Manager: starting research for ${company} (${domain})`);

    state = 'DISCOVER';
    this.onProgress('system', `DISCOVER: ${company} ${domain}`);
    auditTrail.push(`DISCOVER: ${company} ${domain}`);

    state = 'RESOLVE';
    let resolvedDomain = domain;
    try {
      const seed: ResolveSeed = {
        domain: domain,
        website_url: domain.startsWith('http') ? domain : `https://${domain}`,
        company_name: company,
      };
      const resolved = await DomainResolver.resolve(seed, this.controller.getFetcher());
      resolvedDomain = resolved.official_domain || domain;
      auditTrail.push(`RESOLVE: ${resolvedDomain} via ${resolved.resolution_method}`);
      this.onProgress('system', `RESOLVE: ${resolvedDomain} via ${resolved.resolution_method}`);
    } catch (e: any) {
      auditTrail.push(`RESOLVE: fallback to seed domain (${e?.message || String(e)})`);
      this.onProgress('system', `RESOLVE: fallback to seed (resolution failed)`);
    }

    state = 'PLAN';
    const budgetTier = this.assessBudgetTier(company, resolvedDomain, providerCompanies);
    this.onProgress('system', `PLAN: budget_tier=${budgetTier}`);
    auditTrail.push(`PLAN: budget_tier=${budgetTier}`);

    state = 'RESEARCH';
    this.onProgress('system', `RESEARCH: invoking BroadIntelligenceOrchestrator`);
    
    const context = new CompanyResearchContext(company, {
      maxSearchQueries: 50,
      maxPagesFetched: 100,
      maxGithubRequests: 30
    });

    const caseData: IntelligenceCase = {
      company,
      domain: resolvedDomain,
      fit_status: 'UNKNOWN' as any,
      evidence: [],
      prospect_decision: 'RESEARCH_MORE',
      internalState: 'IDLE'
    } as any;

    try {
      const resultCase = await this.broadIntelOrchestrator.orchestrate(caseData, context);
      auditTrail.push(`RESEARCH: internalState=${resultCase.internalState}, evidenceCount=${resultCase.evidence.length}`);
      this.onProgress('system', `RESEARCH: state=${resultCase.internalState}`);
      
      const isReady = resultCase.internalState === 'VERIFIED_FINDING' || resultCase.internalState === 'OUTREACH_READY';
      const decision = isReady ? 'OUTREACH_READY' : (resultCase.internalState === 'NO_ACTIONABLE_SIGNAL' ? 'NO_GO' : 'RESEARCH_MORE');

      const report: CompanyReport = {
        company,
        domain: resolvedDomain,
        runId: 'broad-intel-run',
        state: 'DONE',
        phase: 'COMPLETE',
        triage: {
          decision: 'PASS_FOR_DEEP_RESEARCH',
          signals: ['BROAD_INTELLIGENCE_PIPELINE'],
          requests: context.getBudgetState().requestsUsed,
          timeMs: Date.now() - start,
        },
        finding: resultCase.hypotheses?.[0] ? {
          classification: 'VERIFIED_HYPOTHESIS',
          title: resultCase.hypotheses[0].claim,
          confidence: 'HIGH',
          explanation: resultCase.hypotheses[0].rationale,
          evidenceIds: resultCase.hypotheses[0].evidenceIds,
        } : null,
        evidenceCount: resultCase.evidence.length,
        signalCount: resultCase.hypotheses?.length || 0,
        sourcesCount: context.getDiscoveredSources().length,
        owner: null,
        outreachReady: isReady,
        failures,
        auditTrail,
        timeMs: Date.now() - start,
        nextResearchAction: this.nextAction(decision, null, isReady),
      };
      return report;
    } catch (e: any) {
      const msg = e?.message || String(e);
      auditTrail.push(`RESEARCH ERROR: ${msg}`);
      this.onProgress('system', `RESEARCH ERROR: ${msg}`);
      failures.push({ type: 'TRIAGE_ERROR', source: msg, strategy: 'failed' });
      
      return {
        company, domain: resolvedDomain, runId: 'error', state: 'ERROR', phase: 'COMPLETE',
        triage: null, finding: null, evidenceCount: 0, signalCount: 0, sourcesCount: 0,
        owner: null, outreachReady: false, failures, auditTrail, timeMs: Date.now() - start,
        nextResearchAction: 'Research failed due to orchestrator error.',
      };
    }
  }

  async gatherEvidenceForTask(task: any, caseData: IntelligenceCase, context: CompanyResearchContext): Promise<Evidence[]> {
    return [];
  }

  async verifyHypothesis(hypothesis: any, context: CompanyResearchContext): Promise<{verified: boolean, status: any}> {
    return { verified: false, status: 'INCONCLUSIVE' };
  }

  private assessBudgetTier(company: string, domain: string, providers: any[]): BudgetTier {
    if (providers.length > 0) {
      const p = providers[0];
      if (p.employee_count && p.employee_count > 1000) return 'DEEP';
      if (p.industry && /Tech|SaaS|Software/i.test(p.industry)) return 'TARGETED';
    }
    return 'TRIAGE';
  }

  private nextAction(outcome: string, owner: any, outreachReady: boolean): string {
    if (outcome === 'LOW_VALUE' || outcome === 'NO_GO') return 'No further research — low value.';
    if (outcome === 'RESEARCH_MORE') return 'Deepen targeted research on remaining hypotheses.';
    if (!owner) return 'Continue person discovery — no technical owner identified.';
    if (!outreachReady) return 'More evidence or contact channels needed before outreach.';
    if (outreachReady) return 'Finding is outreach-ready — awaiting human approval.';
    return 'Assess next information-gain opportunity.';
  }

  getQueue(): QueuedCompany[] {
    try { return this.queue ? this.queue.list() : []; } catch { return []; }
  }

  getQueueSummary(): { total: number; byState: Record<string, number> } {
    const all = this.getQueue();
    const byState: Record<string, number> = {};
    for (const c of all) {
      byState[c.state] = (byState[c.state] || 0) + 1;
    }
    return { total: all.length, byState };
  }

  async search(query: string): Promise<any[]> {
    if (!this.controller.searchProvider) {
      console.warn("[SystemManager] No search provider configured. Returning empty results.");
      return [];
    }
    try {
      const results = await this.controller.searchProvider.search(query);
      return results ? (results.results || []) : [];
    } catch (e: any) {
      console.error(`[SystemManager] Search failed for query "${query}": ${e.message}`);
      return [];
    }
  }
}
