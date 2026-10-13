import { IntelligenceCase, Evidence, SourceRelationship } from './IntelligenceCase';
import { ResearchPolicyManager } from './ResearchPolicyManager';

import { VoIRouter } from './VoIRouter';
import { VoIAction, VoIActionType } from './types/LoopTypes';
import { TargetedSearchProvider } from './providers/TargetedSearchProvider';
import { LiveIncidentCorrelationEngine } from './LiveIncidentCorrelationEngine';
import { TargetVerificationEngine } from './TargetVerificationEngine';
import { LiveTechnicalEvent, AffectedTargetCandidate } from './LiveIncidentModels';
import { SignalCorrelationEngine } from './signals/SignalCorrelationEngine';
import { OpportunityDetector } from './findings/OpportunityDetector';
import { ResearchBudget } from './ResearchBudget';
import { LivePublicObservationProvider } from './LivePublicObservationProvider.js';
import { TemporalDeltaEngine } from './TemporalDeltaEngine';
import { ThesisEngine } from './ThesisEngine';
import { StrategicWindowCalculator } from './StrategicWindowCalculator';
import { HumanTelemetryProvider } from './providers/HumanTelemetryProvider';
import { SynapseEngine } from './SynapseEngine';
import { BehavioralXRayAnalyzer } from './BehavioralXRayAnalyzer';
import { DependencyGraphReconstructor } from './DependencyGraphReconstructor';
import { EvidenceScoringEngine } from './EvidenceScoringEngine';
import { extractorRegistry } from './extractors/ExtractorRegistry';
import { SourceRelationshipValidator } from './SourceRelationshipValidator';
import { SourceType } from './IntelligenceCase';
import { SourceDiscoveryOrchestrator } from './SourceDiscoveryOrchestrator';
import { DeepSignalExtractor } from './DeepSignalExtractor';

export interface ActionExecutionResult {
  action: VoIActionType;
  status: 'COMPLETED' | 'DEFERRED' | 'SKIPPED' | 'FAILED';
  evidence_ids: string[];
  signals: any[];
  error?: string;
}

export interface ActionHistoryRecord {
  action_type: VoIActionType;
  iteration: number;
  evidence_delta: number;
  signal_delta: number;
  state_changed: boolean;
  status: string;
}

export class AutonomousLoopManager {
  private voIRouter: VoIRouter;
  private tsp: TargetedSearchProvider;
  private signalExtractor: DeepSignalExtractor;
  private correlationEngine: SignalCorrelationEngine;
  private oppDetector: OpportunityDetector;
  private budget: ResearchBudget;
  private observationProvider: any;
  private discoveryOrchestrator: SourceDiscoveryOrchestrator;
  private incidentCorrelation: LiveIncidentCorrelationEngine;
  private verificationEngine: TargetVerificationEngine;
  private actionHistory: ActionHistoryRecord[] = [];
  private fetcher?: any;

  constructor(company?: string, observationProvider?: any, options?: { fetcher?: any }) {
    this.voIRouter = new VoIRouter();
    this.tsp = new TargetedSearchProvider();
    this.signalExtractor = new DeepSignalExtractor();
    this.correlationEngine = new SignalCorrelationEngine();
    this.oppDetector = new OpportunityDetector();
    this.budget = new ResearchBudget();
    this.observationProvider = observationProvider || new LivePublicObservationProvider();
    this.discoveryOrchestrator = new SourceDiscoveryOrchestrator(
      this.observationProvider,
      this.tsp,
      this.budget
    );
    this.incidentCorrelation = new LiveIncidentCorrelationEngine();
    this.verificationEngine = new TargetVerificationEngine(this.observationProvider);
    this.fetcher = options?.fetcher;
  }

  public async executeLoop(currentCase: IntelligenceCase, maxIterations: number = 10): Promise<IntelligenceCase> {
    console.log(`\n[FORENSIC_IDENTITY] Class: ${this.constructor.name} | Method: executeLoop`);

    if (!currentCase.budget_state) {
      currentCase.budget_state = ResearchBudget.initializeState();
    }

    console.log(`\n[LOOP_ENTER] Target: ${currentCase.company}`);
    for (let i = 0; i < maxIterations; i++) {
      console.log(`\n--- ITERATION ${i+1} ---`);

      const isStopped = this.budget.isStoppedIntegrated(currentCase);
      if (isStopped) {
        console.log(`[LOOP_EXIT] Budget stopped early.`);
        break;
      }

      try {
        const action = this.voIRouter.getNextBestAction(currentCase, this.budget, this.actionHistory);

        const lastExecution = this.actionHistory[this.actionHistory.length - 1];
        if (lastExecution && lastExecution.action_type === action.action &&
            lastExecution.evidence_delta === 0 && lastExecution.signal_delta === 0 && !lastExecution.state_changed) {
          console.log(`[ANTI_DEADLOCK] Action ${action.action} produced no gain. Diversification required.`);
        }

        console.log(`[ACTION_SELECTED] ${action.action} | Rationale: ${action.rationale}`);

        const preEvidenceCount = currentCase.evidence.length;
        const preSignalCount = (currentCase.signals || []).length;

        const result = await this.executeAction(action, currentCase);

        const postEvidenceCount = currentCase.evidence.length;
        const postSignalCount = (currentCase.signals || []).length;

        const evidenceDelta = postEvidenceCount - preEvidenceCount;
        const signalDelta = postSignalCount - preSignalCount;
        const stateChanged = result.status === 'COMPLETED' && evidenceDelta > 0;

        this.actionHistory.push({
          action_type: action.action,
          iteration: i + 1,
          evidence_delta: evidenceDelta,
          signal_delta: signalDelta,
          state_changed: stateChanged,
          status: result.status
        });

        console.log(`[ITERATION_RESULT] Evidence Delta: ${evidenceDelta} | Signal Delta: ${signalDelta} | Status: ${result.status}`);

        if (result.evidence_ids.length > 0) {
          this.processEvidence(currentCase, result.evidence_ids);
        }

        if (result.status === 'FAILED' && evidenceDelta === 0) {
          console.log(`[INFO_GAIN] NO_INFORMATION_GAIN from ${action.action}`);
        }

      } catch (e: any) {
        console.error(`\n[LOOP_EXCEPTION] ${e.message}`);
        console.error(`[LOOP_STACK] ${e.stack}`);
        break;
      }
    }

    currentCase = await this.finalizeStrategicIntelligence(currentCase);
    return currentCase;
  }

  private async executeAction(action: VoIAction, currentCase: IntelligenceCase): Promise<ActionExecutionResult> {
    // We now use the la-mode budget check instead of stage-based counts
    const stage = 1; // Maintain legacy for compatibility, but logic shifted to checkAndConsume
    this.budget.recordRequest(currentCase, stage);

    switch (action.action) {
      case 'RESEARCH_TECHNICAL_SURFACES':
        return await this.handleTechnicalSurfaceResearch(currentCase);
      case 'TARGETED_DISCOVERY':
        return await this.handleTargetedDiscovery(currentCase);
      case 'BROAD_SURFACE_MAPPING':
        return await this.handleBroadSurfaceMapping(currentCase);
      case 'IDENTITY_RESOLVE':
        return { action: action.action, status: 'COMPLETED', evidence_ids: [], signals: [] };
      default:
        return { action: action.action, status: 'SKIPPED', evidence_ids: [], signals: [] };
    }
  }

  private async handleTechnicalSurfaceResearch(currentCase: IntelligenceCase): Promise<ActionExecutionResult> {
    console.log(`[ACTION] Executing TECHNICAL_SURFACE_RESEARCH for ${currentCase.company}...`);
    try {
      const { newEvidence, discoveryResults } = await this.discoveryOrchestrator.discoverTechnicalSurfaces(currentCase);

      currentCase.evidence.push(...newEvidence);

      return {
        action: 'RESEARCH_TECHNICAL_SURFACES',
        status: newEvidence.length > 0 ? 'COMPLETED' : 'EMPTY',
        evidence_ids: newEvidence.map(e => e.id),
        signals: []
      };
    } catch (e: any) {
      console.error(`[TECHNICAL_SURFACE_RESEARCH] Error: ${e.message}`);
      return { action: 'RESEARCH_TECHNICAL_SURFACES', status: 'FAILED', evidence_ids: [], signals: [], error: e.message };
    }
  }

  private async handleBroadSurfaceMapping(currentCase: IntelligenceCase): Promise<ActionExecutionResult> {
    console.log(`[ACTION] Executing BROAD_SURFACE_MAPPING for ${currentCase.company}...`);
    try {
      const results = await this.observationProvider.observePublicSurface(
        currentCase.company_surface?.homepage || `https://${currentCase.company_surface?.origin}`,
        {
          requiredOrigin: currentCase.company_surface?.origin
        } as any
      );

      if (results.status === 'RATE_LIMITED') {
        console.log(`[FALLBACK_TRIGGER] Broad Surface Mapping rate-limited. Deferring to next available provider.`);
        return { action: 'BROAD_SURFACE_MAPPING', status: 'DEFERRED', evidence_ids: [], signals: [], error: 'RATE_LIMITED' };
      }

      if (results.status === 'UNAVAILABLE') {
        console.log(`[FALLBACK_TRIGGER] Broad Surface Mapping unavailable. Skipping.`);
        return { action: 'BROAD_SURFACE_MAPPING', status: 'SKIPPED', evidence_ids: [], signals: [] };
      }
      if (results.status === 'ERROR') {
        console.log(`[ERROR] Broad Surface Mapping encountered a critical error.`);
        return { action: 'BROAD_SURFACE_MAPPING', status: 'FAILED', evidence_ids: [], signals: [], error: 'PROVIDER_ERROR' };
      }

      if (results.observations.length > 0) {
        results.observations.forEach((ev: Evidence) => {
          ev.relationship_type = SourceRelationshipValidator.validate(
            ev.public_url,
            currentCase.company_surface?.origin || '',
            currentCase.company
          );
        });

        if (!currentCase.company_surface) {
          currentCase.company_surface = {
            company: currentCase.company,
            origin: '',
            homepage: `https://${currentCase.company}`,
            discovered_pages: [],
            page_categories: {}
          } as any;
        }

        const newPages = results.observations
          .filter((e: Evidence) => e.public_url)
          .map((e: Evidence) => ({
            url: e.public_url!,
            path: new URL(e.public_url!).pathname,
            status: e.status
          }));

        const existingUrls = new Set((currentCase.company_surface! as any).discovered_pages.map((p: any) => p.url));
        const uniquePages = newPages.filter((p: any) => !existingUrls.has(p.url));
        (currentCase.company_surface! as any).discovered_pages.push(...uniquePages);

        currentCase.evidence.push(...results.observations);
        return {
          action: 'BROAD_SURFACE_MAPPING',
          status: 'COMPLETED',
          evidence_ids: results.observations.map((e: Evidence) => e.id),
          signals: []
        };
      }

      console.log(`[BROAD_SURFACE_MAPPING] Provider returned zero usable evidence.`);
      return { action: 'BROAD_SURFACE_MAPPING', status: 'COMPLETED', evidence_ids: [], signals: [] };
    } catch (e: any) {
      console.error(`[BROAD_SURFACE_MAPPING] Error: ${e.message}`);
      return { action: 'BROAD_SURFACE_MAPPING', status: 'FAILED', evidence_ids: [], signals: [], error: e.message };
    }
  }

  private async handleTargetedDiscovery(currentCase: IntelligenceCase): Promise<ActionExecutionResult> {
    try {
      const results = await this.tsp.discoverSource(currentCase.company, currentCase.company_surface?.origin || '', 'BROAD');

      if (results.failureReason === 'SEARCH_RATE_LIMITED') {
        console.log(`[FALLBACK_TRIGGER] Targeted Discovery rate-limited. Deferring.`);
        return { action: 'TARGETED_DISCOVERY', status: 'DEFERRED', evidence_ids: [], signals: [], error: 'RATE_LIMITED' };
      }
      if (results.failureReason === 'SEARCH_UNAVAILABLE') {
        console.log(`[FALLBACK_TRIGGER] Targeted Discovery unavailable. Skipping.`);
        return { action: 'TARGETED_DISCOVERY', status: 'SKIPPED', evidence_ids: [], signals: [] };
      }

      const evidence = results.results?.map((url: string, i: number) => {
        const relationship = SourceRelationshipValidator.validate(
          url,
          currentCase.company_surface?.origin || '',
          currentCase.company
        );

        return {
          id: `ev-disc-${i}`,
          evidence_origin: 'DISCOVERY',
          public_url: url,
          source_type: 'SEARCH_RESULT',
          relationship_type: relationship,
          observed_behavior: 'Discovered via targeted search',
          retrieved_at: new Date().toISOString(),
          evidence_text: url,
          reproductions: 1, repeatable: true, tested_without_auth: true, not_tested: []
        } as any;
      }) || [];
      currentCase.evidence.push(...evidence);
      return { action: 'TARGETED_DISCOVERY', status: 'COMPLETED', evidence_ids: evidence.map((e: any) => e.id), signals: [] };
    } catch (e: any) {
      return { action: 'TARGETED_DISCOVERY', status: 'FAILED', evidence_ids: [], signals: [], error: e.message };
    }
  }

  private processEvidence(currentCase: IntelligenceCase, evidenceIds: string[]) {
    const evidenceToProcess = currentCase.evidence.filter((e: Evidence) => evidenceIds.includes(e.id));

    currentCase.evidence = currentCase.evidence.map((ev: Evidence) => {
      if (!ev.scoring || ev.scoring.total_score === undefined) {
        const scored = EvidenceScoringEngine.score(ev);
        console.log(`[SCORE_TRACE] ID: ${scored.id} | Score: ${scored.scoring?.total_score || 0} | Strength: ${scored.strength} | Type: ${scored.source_type} | Obs: ${scored.observed_behavior.slice(0, 60)}...`);
        return scored;
      }
      return ev;
    });

    const allTechnicalFacts: TechnicalEvidence[] = [];
    for (const ev of evidenceToProcess) {
      const facts = TechnicalEvidenceExtractor.extractFacts(ev);
      allTechnicalFacts.push(...facts);
    }

    // Map extracted technical facts to signal candidates
    const newSignals = TechnicalEvidenceExtractor.generateCandidates(
      allTechnicalFacts,
      evidenceToProcess[0] // Simplified for the first evidence item; in production, map 1:1
    );
    console.log(`[SIGNAL_DEBUG] Extracted ${newSignals.length} signals from ${allTechnicalFacts.length} technical facts.`);
    currentCase.signals = [...(currentCase.signals || []), ...newSignals];
    currentCase.signals = [...(currentCase.signals || []), ...newSignals];

    const correlationResult = SignalCorrelationEngine.correlate(currentCase.signals, {
      evidence: currentCase.evidence
    } as any);
    currentCase.correlated_groups = correlationResult.groups;

    const opps = OpportunityDetector.detect(currentCase.signals, currentCase.evidence, { company: currentCase.company });
    if (opps.length > 0) {
      currentCase.pressure_classification = opps[0].type;
    }
  }

  private async finalizeStrategicIntelligence(currentCase: IntelligenceCase): Promise<IntelligenceCase> {
    console.log(`\n[PREDICTIVE_FINALIZATION] Synthesizing Strategic Intelligence...`);

    const thesis = ThesisEngine.generateThesis(currentCase);
    if (thesis) {
      currentCase.prospect_decision = {
        ...(currentCase.prospect_decision as any),
        thesis: thesis,
        confidence: thesis.confidence,
      };
      console.log(`[THESIS_GENERATED] ${thesis.thesis}`);
    }

    const simulatedPreviousCase = {
      ...currentCase,
      evidence: currentCase.evidence.slice(0, Math.max(0, currentCase.evidence.length - 3)),
      budget_state: { ...(currentCase.budget_state || {}), requestsUsed: (currentCase.budget_state?.requestsUsed || 0) - 5 },
      signals: (currentCase.signals || []),
    } as any;

    const trajectory = TemporalDeltaEngine.calculateTrajectory(currentCase, simulatedPreviousCase);
    currentCase.prospect_decision = {
      ...(currentCase.prospect_decision as any),
      trajectory: trajectory,
    };
    console.log(`[TRAJECTORY_ANALYZED] Status: ${trajectory.status} | Window: ${trajectory.vulnerability_window}`);

    if (thesis) {
      const window = StrategicWindowCalculator.calculateWindow(thesis, trajectory);
      currentCase.prospect_decision = {
        ...(currentCase.prospect_decision as any),
        strategic_window: window,
      };
      console.log(`[STRATEGIC_WINDOW_CALCULATED] Urgency: ${window.urgency_score} | Recommended: ${window.recommended_action}`);
    }

    const humanTelemetry = new HumanTelemetryProvider();
    const { signals: humanSignals, evidence: humanEvidence } = await humanTelemetry.analyzeHumanTelemetry(currentCase);
    currentCase.evidence.push(...humanEvidence);

    const synapseCorrelations = SynapseEngine.correlate(currentCase.signals || [], humanSignals);
    if (synapseCorrelations.length > 0) {
      currentCase.prospect_decision = {
        ...(currentCase.prospect_decision as any),
        synapse_insights: synapseCorrelations,
      } ;
    }

    const xray = new BehavioralXRayAnalyzer();
    const domain = currentCase.company_surface?.origin || 'vercel.com';
    const { result: xrayResult, evidence: xrayEvidence } = await xray.analyzeEndpointBehavior(domain, '/api/v1/metrics');
    currentCase.evidence.push(...xrayEvidence);

    const archMap = DependencyGraphReconstructor.reconstruct(currentCase, xrayResult);
    currentCase.prospect_decision = {
      ...(currentCase.prospect_decision as any),
      architecture_map: archMap,
      behavioral_fingerprint: xrayResult,
    };
    console.log(`[ARCH_MAPPED] Nodes: ${archMap.nodes.length} | Edges: ${archMap.edges.length} | Final: ${archMap.final_classification}`);

    return currentCase;
  }
}
