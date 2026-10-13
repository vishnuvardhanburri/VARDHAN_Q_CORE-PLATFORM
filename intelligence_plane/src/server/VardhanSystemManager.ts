/**
 * VARDHAN SYSTEM MANAGER (§2, §14)
 * ─────────────────────────────────────────────────────────────────────────────
 * The central lifecycle owner for VARDHAN's autonomous intelligence system.
 * It decides WHAT to research, HOW MUCH to spend, WHICH sources to investigate
 * next, WHAT failed, WHAT needs retry, whether evidence is enough, whether a
 * finding should exist, whether owner discovery is worth it, and whether
 * outreach is justified.
 *
 * State machine:
 *   DISCOVER → RESOLVE → PLAN → RESEARCH → ASSESS → EXPAND → CORRELATE →
 *   DECIDE → FINDING → OWNER → CONTACT → QA → HUMAN_APPROVAL → SEND
 *
 * A failed source does NOT terminate company research. The manager classifies
 * the failure, selects an alternate strategy, and retries within budget.
 *
 * Failures recognized: SEARCH_UNAVAILABLE, TIMEOUT, HTTP_403, HTTP_429,
 * JS_REQUIRED, EMPTY_RESULT, SOURCE_DISAPPEARED, DNS_FAILURE, PARSER_FAILURE,
 * MODEL_FAILURE
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import type { IntelligenceRunContext } from './DeepTypes';
import type { QueuedCompany } from './DeepTypes';
import { CompanyQueue } from './CompanyQueue';
import { DomainResolver, type ResolveSeed } from './DomainResolver';
import { SourceDiscoveryOrchestrator } from './SourceDiscoveryOrchestrator';
import { LiveWebResearchProvider } from './LiveWebResearchProvider';
import type { LiveWebResearchResult } from './LiveWebResearchProvider';
import { DeepProspectBuilder } from './DeepProspectBuilder';
import type { DeepBuilderResult } from './DeepTypes';
import { QCoreSubmissionOrchestrator } from './QCoreSubmissionOrchestrator';
import { VardhanDecisionEngine, type Decision } from './VardhanDecisionEngine';
import { VardhanModelGateway, type ModelProvider } from './VardhanModelGateway';
import { EvidenceLedger } from './EvidenceLedger';
import { StatePersistence } from './StatePersistence';
import { DataSufficiencyChecker } from './DataSufficiencyChecker';
import { ResearchBudget, type ResearchStage } from './ResearchBudget';
import type { Evidence } from './IntelligenceCase';
import type { DiscoveredSource } from './SourceDiscoveryOrchestrator';
import { ChangeDetector, snapshotFromProspect } from './ChangeDetector';

export type SystemManagerState =
  | 'DISCOVER'
  | 'RESOLVE'
  | 'PLAN'
  | 'RESEARCH'
  | 'ASSESS'
  | 'EXPAND'
  | 'CORRELATE'
  | 'DECIDE'
  | 'FINDING'
  | 'OWNER'
  | 'CONTACT'
  | 'QA'
  | 'HUMAN_APPROVAL'
  | 'SEND'
  | 'DONE'
  | 'ERROR';

export type FailureType =
  | 'SEARCH_UNAVAILABLE'
  | 'TIMEOUT'
  | 'HTTP_403'
  | 'HTTP_429'
  | 'JS_REQUIRED'
  | 'EMPTY_RESULT'
  | 'SOURCE_DISAPPEARED'
  | 'DNS_FAILURE'
  | 'PARSER_FAILURE'
  | 'MODEL_FAILURE'
  | 'UNKNOWN';

export interface SystemManagerOptions {
  /** Injectable fetcher. */
  fetcher?: any;
  /** Artifact persistence. */
  saveArtifact?: (path: string, data: string) => void;
  /** Optional model gateway for assisted intelligence. */
  modelGateway?: VardhanModelGateway;
  /** Optional search provider for web research. */
  searchProvider?: any;
  /** Output sink for progress. */
  output?: { write: (s: string) => void };
  /** Artifacts directory. */
  artifactsDir?: string;
  /** Queue file path. */
  queuePath?: string;
  /** Research budget overrides. */
  maxDiscoveryPages?: number;
  discoveryDelayMs?: number;
  discoveryTimeoutMs?: number;
  /** Authoritative identity context from the intelligence execution layer.
   * If absent, the Q-Core production orchestration boundary will be skipped
   * (fail-closed). Identity must never be reconstructed at the boundary. */
  runContext?: IntelligenceRunContext;
}

export interface CompanyResearchReport {
  company: string;
  domain: string;
  run_id: string;
  state: SystemManagerState;
  sources_discovered: number;
  evidence_count: number;
  signals_count: number;
  findings_count: number;
  owner: string | null;
  decision: Decision;
  decision_outcome: string;
  research_budget: Record<string, any>;
  failures: { type: FailureType; source: string; retry_strategy: string }[];
  audit_trail: string[];
  next_research_action: string;
}

export class VardhanSystemManager {
  private readonly fetcher: any;
  private readonly saveArtifact?: (path: string, data: string) => void;
  private readonly onProgress: (stage: string, message: string) => void;
  private readonly modelGateway?: VardhanModelGateway;
  private readonly searchProvider?: any;
  private readonly artifactsDir: string;
  private readonly queuePath: string;
  private readonly ledger: EvidenceLedger;
  private readonly statePersistence: StatePersistence;
  private readonly queue: CompanyQueue;
  private readonly maxDiscoveryPages: number;
  private readonly discoveryDelayMs: number;
  private readonly discoveryTimeoutMs: number;
  private readonly runContext?: IntelligenceRunContext;

  constructor(options: SystemManagerOptions = {}) {
    this.fetcher = options.fetcher;
    this.saveArtifact = options.saveArtifact;
    const output = options.output ?? { write: (s: string) => process.stdout.write(s) };
    this.onProgress = (stage: string, msg: string) => output.write(`  [${stage}] ${msg}`);
    this.modelGateway = options.modelGateway;
    this.searchProvider = options.searchProvider;
    this.artifactsDir = options.artifactsDir || process.cwd();
    this.queuePath = options.queuePath || path.join(this.artifactsDir, 'artifacts', 'intelligence', 'queue.jsonl');
    this.ledger = new EvidenceLedger(path.join(this.artifactsDir, 'artifacts', 'intelligence', 'evidence'));
    this.statePersistence = new StatePersistence(path.join(this.artifactsDir, 'artifacts', 'intelligence'));
    try { this.queue = new CompanyQueue(this.queuePath); } catch { this.queue = null as any; }
    this.maxDiscoveryPages = options.maxDiscoveryPages ?? 15;
    this.discoveryDelayMs = options.discoveryDelayMs ?? 50;
    this.discoveryTimeoutMs = options.discoveryTimeoutMs ?? 8000;
    this.runContext = options.runContext;
  }

  /**
   * Research a single company end-to-end through the full state machine.
   */
  async researchCompany(company: string, targetUrlOrDomain: string, providerCompanies: any[] = []): Promise<CompanyResearchReport> {
    const runId = 'run_' + randomBytes(8).toString('hex');
    const auditTrail: string[] = [];
    const failures: { type: FailureType; source: string; retry_strategy: string }[] = [];
    const budget = new ResearchBudget();
    let state: SystemManagerState = 'DISCOVER';

    this.onProgress('system', `Starting research cycle ${runId} for ${company}`);
    auditTrail.push(`Research cycle ${runId} initiated for ${company}`);

    // === DISCOVER ===
    state = 'DISCOVER';
    this.onProgress('system', `DISCOVER: ${company} ${targetUrlOrDomain}`);
    let domain: string;
    try {
      const seed: ResolveSeed = { domain: targetUrlOrDomain, website_url: targetUrlOrDomain.startsWith('http') ? targetUrlOrDomain : `https://${targetUrlOrDomain}`, company_name: company };
      const resolved = await DomainResolver.resolve(seed, this.fetcher || globalThis.fetch);
      domain = resolved.official_domain || targetUrlOrDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      auditTrail.push(`Domain resolved: ${domain} via ${resolved.resolution_method}`);
    } catch (e: any) {
      domain = targetUrlOrDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      auditTrail.push(`Domain resolution failed (${e?.message || String(e)}), using seed: ${domain}`);
    }

    // === RESOLVE ===
    state = 'RESOLVE';
    this.onProgress('system', `RESOLVE: entity resolution for ${domain}`);
    let canonicalCompany = company;
    let resolutionSource = 'seed';
    if (providerCompanies.length > 0) {
      const match = providerCompanies.find(c =>
        c.domain?.toLowerCase() === domain.toLowerCase() ||
        c.company?.toLowerCase().includes(company.toLowerCase())
      );
      if (match) {
        canonicalCompany = match.canonical_name || match.company;
        resolutionSource = match.source || 'provider';
        auditTrail.push(`Entity resolved from provider: ${canonicalCompany} (${resolutionSource})`);
      }
    }

    // === PLAN ===
    state = 'PLAN';
    this.onProgress('system', `PLAN: research plan for ${canonicalCompany}`);
    const plan = this.planResearch(canonicalCompany, domain, providerCompanies, budget);
    for (const step of plan) {
      this.onProgress('system', `  plan step: ${step}`);
      auditTrail.push(`Plan: ${step}`);
    }

    // === RESEARCH (source discovery + data sufficiency check) ===
    state = 'RESEARCH';
    this.onProgress('system', 'RESEARCH: source discovery');
    let sources: DiscoveredSource[] = [];
    let htmlByUrl = new Map<string, string>();
    let sourceEvidence: Evidence[] = [];
    try {
      const sourceResult = await SourceDiscoveryOrchestrator.discover({
        fetcher: this.fetcher,
        searchProvider: this.searchProvider,
        companyName: canonicalCompany,
        domain,
        seedUrls: [targetUrlOrDomain.startsWith('http') ? targetUrlOrDomain : `https://${targetUrlOrDomain}`],
        maxSources: this.maxDiscoveryPages,
        onProgress: (stage, msg) => this.onProgress('system', `  source-disc:${stage} — ${msg}`),
      });
      sources = sourceResult.sources;
      htmlByUrl = sourceResult.htmlByUrl;
      sourceEvidence = sourceResult.evidence;
      auditTrail.push(`Source discovery: ${sources.length} sources, ${sourceEvidence.length} evidence, ${sourceResult.errors.length} errors`);
      for (const err of sourceResult.errors) {
        auditTrail.push(`  source error: ${err}`);
        failures.push({ type: this.classifyError(err), source: err, retry_strategy: 'alternate source path' });
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      auditTrail.push(`Source discovery error: ${msg}`);
      failures.push({ type: 'UNKNOWN', source: msg, retry_strategy: 'retry with reduced scope' });
    }

    // === ASSESS (data sufficiency) ===
    state = 'ASSESS';
    this.onProgress('system', 'ASSESS: data sufficiency check');
    const providerCompany = providerCompanies[0];
    const surface = {
      company: canonicalCompany,
      origin: `https://${domain}`,
      homepage: `https://${domain}`,
      discovered_pages: sources.map(s => ({ url: s.url, path: new URL(s.url).pathname, category: s.kind.toLowerCase() as any, status: s.status })) as any,
      page_categories: {},
    };
    const sufficiency = DataSufficiencyChecker.check(providerCompany || null, surface as any);
    this.onProgress('system', `Sufficiency: sufficient=${sufficiency.sufficient} needs_live=${sufficiency.needs_live_research}`);
    auditTrail.push(`Sufficiency: ${sufficiency.needs_live_research ? 'LIVE RESEARCH TRIGGERED' : 'dataset sufficient'}`);

    // === RESEARCH (deep pipeline via DeepProspectBuilder) ===
    this.onProgress('system', 'RESEARCH: deep pipeline execution');
    let deepResult: DeepBuilderResult | null = null;
    let prospect: any = null;
    try {
      const resolution = {
        canonical_name: canonicalCompany,
        official_domain: domain,
        resolution_method: (providerCompany ? 'GROWJO_DOMAIN' : 'AMBIGUOUS') as 'GROWJO_DOMAIN' | 'GROWJO_HOMEPAGE_CANONICAL' | 'PUBLIC_REDIRECT' | 'PUBLIC_CANONICAL_LINK' | 'OGP_URL' | 'AMBIGUOUS',
        resolution_source: resolutionSource,
        resolution_confidence: 'HIGH' as const,
      };

      const builder = new DeepProspectBuilder({
        fetcher: this.fetcher,
        saveArtifact: this.saveArtifact,
        artifactsBaseDir: this.artifactsDir,
        maxDiscoveryPages: this.maxDiscoveryPages,
        discoveryDelayMs: this.discoveryDelayMs,
        discoveryTimeoutMs: this.discoveryTimeoutMs,
        onProgress: (stage: any, msg: string) => this.onProgress('deep', msg),
        logger: (m) => this.onProgress('deep', m),
        growjo: providerCompany?.source === 'GROWJO' ? providerCompany : null,
        providerCompanies,
        resolution,
        searchProvider: this.searchProvider,
        statePersistence: this.statePersistence,
        skipLiveWebResearch: false,
      });

      const targetUrl = `https://${domain}`;
      deepResult = await builder.build(targetUrl);
      prospect = deepResult.prospect;
      auditTrail.push(`Deep pipeline: decision=${prospect.decision} confidence=${prospect.confidence}`);
    } catch (e: any) {
      const msg = e?.message || String(e);
      auditTrail.push(`Deep pipeline error: ${msg}`);
      failures.push({ type: 'UNKNOWN', source: msg, retry_strategy: 'retry deep pipeline' });
    }

    // Record evidence in ledger
    if (prospect) {
      const runIdForEvidence = runId;
      for (const ev of (prospect.evidence || []) as Evidence[]) {
        this.ledger.record(domain, runIdForEvidence, ev, 'OBSERVATION');
      }
      for (const sig of (prospect.technical_signals || [])) {
        this.ledger.record(domain, runIdForEvidence, {
          evidence_origin: 'DOCUMENTED_FACT',
          public_url: sig.source_url,
          source_type: sig.type,
          observed_behavior: sig.excerpt,
          retrieved_at: new Date().toISOString(),
        } as any, 'FACT');
      }
    }

    // === EXPAND / CORRELATE / DECIDE ===
    state = 'CORRELATE';
    this.onProgress('system', 'CORRELATE: evidence correlation');
    const decision = VardhanDecisionEngine.decide({
      company: canonicalCompany,
      domain,
      signals: (prospect?.technical_signals || []) as any,
      evidence: (prospect?.evidence || []) as Evidence[],
      finding: prospect?.deep_finding || null,
      findings: prospect?.findings || null,
      signals_count: prospect?.technical_signals?.length || 0,
      evidence_count: prospect?.evidence?.length || 0,
      sources_count: prospect?.public_surface?.discovered_pages?.length || 0,
      owner: prospect?.selected_owner || null,
      contacts: (prospect?.contactability || []) as any,
      previous_state: null,
      modelGateway: this.modelGateway,
    });

    state = 'DECIDE';
    this.onProgress('system', `DECIDE: ${decision.outcome} (score ${decision.score}/${decision.max_score})`);
    auditTrail.push(`Decision: ${decision.outcome} score=${decision.score}/${decision.max_score}`);
    if (decision.warnings.length > 0) {
      for (const w of decision.warnings) this.onProgress('system', `  warning: ${w}`);
    }

    // === FINDING ===
    state = 'FINDING';
    if (decision.outcome === 'REJECT' || decision.outcome === 'LOW_VALUE') {
      this.onProgress('system', `Finding: ${decision.outcome} — no valuable finding.`);
      auditTrail.push(`Finding: REJECTED/LOW_VALUE — no outreach opportunity.`);
    } else {
      this.onProgress('system', `Finding: ${decision.outcome} — defensible finding.`);
      auditTrail.push(`Finding: ${decision.outcome} — evidence IDs: ${decision.evidence_ids.join(', ')}`);

      // ─── Q-CORE PRODUCTION ORCHESTRATION ────────────────────────────────────
      // Submit fully verified findings BEFORE any commercial/outreach scoring!
      // Identity context must be authoritative — never reconstructed at the boundary.
      // If no runContext was provided upstream, skip Q-Core (fail-closed).
      if (!this.runContext) {
        this.onProgress('qcore', 'Q-Core SEAL SKIPPED — no authoritative IntelligenceRunContext provided upstream.');
        auditTrail.push('Q-Core: skipped — no authoritative run context');
      } else if (prospect?.technical_findings && prospect.technical_findings.length > 0) {
        try {
          const orchestrator = new QCoreSubmissionOrchestrator();
          const results = await orchestrator.submitFindings(
            prospect.technical_findings,
            prospect.evidence,
            this.runContext,
            this.onProgress.bind(this)
          );

          const successful = results.filter(r => r.receipt).length;
          if (successful > 0) {
            auditTrail.push(`Q-Core SEAL SUCCESS: ${successful} finding(s)`);
          }
        } catch (err: any) {
          this.onProgress('system', `Q-Core Orchestration Error: ${err.message}`);
          auditTrail.push(`Q-Core Error: ${err.message}`);
        }
      }
    }

    // === OWNER ===
    state = 'OWNER';
    const owner = prospect?.selected_owner;
    if (owner) {
      this.onProgress('system', `Owner: ${owner.name} — ${owner.role} (${owner.confidence})`);
      auditTrail.push(`Owner: ${owner.name} (${owner.confidence})`);
    } else {
      this.onProgress('system', 'Owner: no evidence-backed technical owner discovered.');
      auditTrail.push('Owner: none identified');
    }

    // === CONTACT ===
    state = 'CONTACT';
    const contacts = prospect?.contactability || [];
    this.onProgress('system', `Contact: ${contacts.length} public professional channel(s) found.`);
    auditTrail.push(`Contacts: ${contacts.length} public channels`);

    // === QA ===
    state = 'QA';
    if (decision.outcome === 'REJECT' || decision.outcome === 'LOW_VALUE') {
      this.onProgress('system', 'QA: Finding rejected/weak — no outreach.');
    } else if (!owner || (owner.confidence !== 'HIGH')) {
      this.onProgress('system', 'QA: Finding defensible but no HIGH-confidence owner — awaiting more research.');
      auditTrail.push('QA: No HIGH-confidence owner — RESEARCH_MORE');
    } else if (contacts.length === 0) {
      this.onProgress('system', 'QA: Finding defensible with owner but no contact channel found — continuing research.');
      auditTrail.push('QA: No contactability — CONTACT not ready');
    } else {
      this.onProgress('system', 'QA: Finding defensible, owner identified, contact available.');
      auditTrail.push('QA: PASSED');
    }

    // === NEXT RESEARCH ACTION ===
    let nextAction = 'No further research needed.';
    if (decision.outcome === 'RESEARCH_MORE') {
      nextAction = 'Expand source discovery: search for additional public sources.';
    } else if (decision.outcome === 'LOW_VALUE') {
      nextAction = 'Monitor for changes — set up periodic freshness check.';
    } else if (decision.outcome === 'REJECT') {
      nextAction = 'Archive — no valuable technical signal detected.';
    } else if (!owner) {
      nextAction = 'Deepen person discovery: engineering pages, GitHub contributors, blog authors.';
    } else if (contacts.length === 0) {
      nextAction = 'Search for public contact channels on professional platforms.';
    }

    state = 'DONE';

    const report: CompanyResearchReport = {
      company: canonicalCompany,
      domain,
      run_id: runId,
      state,
      sources_discovered: sources.length,
      evidence_count: prospect?.evidence?.length || 0,
      signals_count: prospect?.technical_signals?.length || 0,
      findings_count: prospect?.findings ? 1 : 0,
      owner: owner?.name || null,
      decision,
      decision_outcome: decision.outcome,
      research_budget: {
        stage_reached: prospect?.research_state?.currentStage || 1,
        stopped_early: false,
      },
      failures,
      audit_trail: auditTrail,
      next_research_action: nextAction,
    };

    // Persist state for resume/refresh/changes
    try {
      const snap = snapshotFromProspect(prospect);
      if (snap) {
        this.statePersistence.save(domain, {
          company: canonicalCompany,
          domain,
          last_researched_at: new Date().toISOString(),
          stage_reached: prospect?.research_state?.currentStage || 1,
          last_error: failures.length > 0 ? failures[0].type : null,
          last_summary: {
            decision: prospect.decision,
            finding: prospect.deep_finding?.finding_type || prospect.findings?.finding_type || null,
            owner: owner?.name || null,
            confidence: prospect.confidence,
            people_count: prospect.people.length,
            owner_candidates_count: prospect.owner_candidates.length,
            evidence_count: prospect.evidence.length,
            sources_count: prospect.public_surface?.discovered_pages?.length || 0,
            technical_signals_count: prospect.technical_signals.length,
          },
          state_snapshot: snap,
          search_cache: [],
        });
      }
    } catch { /* read-only FS */ }

    return report;
  }

  /** Plan the research approach for a company. */
  private planResearch(company: string, domain: string, providers: any[], budget: ResearchBudget): string[] {
    const plan: string[] = [];

    // Score the company for budget allocation
    const hasProviderData = providers.length > 0;
    const isKnown = hasProviderData;
    const budgetTier = this.assessBudgetTier(company, domain, providers);

    plan.push(`budget_tier=${budgetTier} (LOW/INTERESTING/STRONG)`);
    plan.push(`sources_tier=${budgetTier === 'STRONG' ? 6 : budgetTier === 'INTERESTING' ? 4 : 2}`);
    plan.push(`max_search_queries=${budgetTier === 'STRONG' ? 12 : budgetTier === 'INTERESTING' ? 6 : 3}`);
    plan.push(`max_requests=${budgetTier === 'STRONG' ? 30 : budgetTier === 'INTERESTING' ? 15 : 8}`);

    if (!isKnown) {
      plan.push('no provider data → full public discovery + search');
    }
    if (hasProviderData) {
      plan.push('provider data present → dataset-first, live-web fallback if incomplete');
    }

    return plan;
  }

  /** Assess research budget tier based on company signals. */
  private assessBudgetTier(company: string, domain: string, providers: any[]): 'LOW' | 'INTERESTING' | 'STRONG' {
    // Simple heuristics for budget tiering
    if (providers.length > 0) {
      const p = providers[0];
      if (p.employee_count && p.employee_count > 1000) return 'STRONG';
      if (p.industry && (p.industry.includes('Tech') || p.industry.includes('SaaS') || p.industry.includes('Software'))) return 'INTERESTING';
    }
    // Default: medium interest (all companies get a baseline)
    return 'INTERESTING';
  }

  /** Classify an error message into a FailureType. */
  private classifyError(msg: string): FailureType {
    const m = msg.toLowerCase();
    if (m.includes('search_unavailable') || m.includes('nullsearch')) return 'SEARCH_UNAVAILABLE';
    if (m.includes('timeout') || m.includes('timed out')) return 'TIMEOUT';
    if (m.includes('403') || m.includes('forbidden')) return 'HTTP_403';
    if (m.includes('429') || m.includes('rate limit')) return 'HTTP_429';
    if (m.includes('captcha') || m.includes('js_required') || m.includes('javascript')) return 'JS_REQUIRED';
    if (m.includes('empty') || m.includes('no results')) return 'EMPTY_RESULT';
    if (m.includes('dns') || m.includes('resolve')) return 'DNS_FAILURE';
    if (m.includes('parse') || m.includes('json')) return 'PARSER_FAILURE';
    if (m.includes('model') || m.includes('ollama') || m.includes('vllm')) return 'MODEL_FAILURE';
    return 'UNKNOWN';
  }

  /** Get the system manager's current research queue. */
  getQueue(): QueuedCompany[] {
    try { return this.queue.list(); } catch { return []; }
  }

  /** Get summary of all companies in queue. */
  getQueueSummary(): { total: number; byState: Record<string, number> } {
    const all = this.getQueue();
    const byState: Record<string, number> = {};
    for (const c of all) {
      byState[c.state] = (byState[c.state] || 0) + 1;
    }
    return { total: all.length, byState };
  }
}
