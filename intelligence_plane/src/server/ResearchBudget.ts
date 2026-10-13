import { IntelligenceCase, ResearchBudgetState } from './IntelligenceCase';

/** Safely access budget_state, returning a default if missing. */
function bs(cs?: IntelligenceCase): ResearchBudgetState {
  return cs?.budget_state || {
    requestsUsed: 0,
    queriesUsed: 0,
    githubObservations: 0,
    stoppedEarly: false,
    pagesFetched: 0,
    technicalSurfaces: 0
  };
}

export type BudgetMetric = 'REQUEST' | 'QUERY' | 'PAGE' | 'SURFACE';

/** Research stages used by LiveWebResearchProvider staging logic. */
export type ResearchStage = 1 | 2 | 3 | 4 | 5 | 6;

export interface StageConfig {
  stage: ResearchStage;
  name: string;
  maxRequests: number;
  maxQueries: number;
  maxGitHubObservations: number;
  description: string;
}

export interface AbsoluteCompanyBudget {
  maxSearchQueries: number;      // e.g., 15
  maxPagesFetched: number;       // e.g., 50
  maxRequestsPerProvider: number; // e.g., 10
  maxTotalRequests: number;      // e.g., 100
  maxTechnicalSurfaces: number;   // e.g., 5
}

export const DEFAULT_COMPANY_BUDGET: AbsoluteCompanyBudget = {
  maxSearchQueries: 15,
  maxPagesFetched: 50,
  maxRequestsPerProvider: 10,
  maxTotalRequests: 100,
  maxTechnicalSurfaces: 5
};

export interface BudgetSummary {
  requests_used: number;
  requests_remaining: number;
  queries_used: number;
  queries_remaining: number;
  pages_fetched: number;
  pages_remaining: number;
  stopped_early: boolean;
  stop_reason?: string;
  stageName?: string;
}

export interface StopReason {
  stop: boolean;
  reason: string;
  stage: number;
}

export class ResearchBudget {
  // ── Instance-level state (for standalone use without caseState) ──────
  private _isStopped: boolean = false;
  private _stopReason: string = '';
  private _requestsUsed: number = 0;
  private _queriesUsed: number = 0;
  private _pagesFetched: number = 0;
  private _technicalSurfaces: number = 0;
  private _providerCounts: Record<string, number> = {};

  /** Initialize a default budget state for a case. */
  static initializeState(): ResearchBudgetState {
    return {
      requestsUsed: 0,
      queriesUsed: 0,
      githubObservations: 0,
      stoppedEarly: false,
      pagesFetched: 0,
      technicalSurfaces: 0
    };
  }

  /** Check if a research stage should be skipped due to early stopping. */
  static shouldStopEarly(reason: string): StopReason {
    const lowerReason = reason.toLowerCase();
    if (lowerReason.includes('irrelevant') || lowerReason.includes('no_go')) {
      return { stop: true, reason: 'Irrelevant company — stopping early.', stage: 1 };
    }
    if (lowerReason.includes('weak icp') || lowerReason.includes('poor')) {
      return { stop: true, reason: 'Weak ICP — stopping early.', stage: 2 };
    }
    if (lowerReason.includes('no meaningful technical surface') || lowerReason.includes('no technical surface')) {
      return { stop: true, reason: 'No meaningful technical surface — stopping early.', stage: 2 };
    }
    if (lowerReason.includes('repeatedly insufficient')) {
      return { stop: true, reason: 'Repeatedly insufficient evidence — stopping early.', stage: 3 };
    }
    return { stop: false, reason: '', stage: 1 };
  }

  /** Whether research is still active (not stopped early). */
  get isStopped(): boolean {
    return this._isStopped;
  }

  /** Current research stage number (for LiveWebResearchProvider staging). */
  private _currentStage: ResearchStage = 1;

  /** Check if a research stage should be attempted (not stopped early, not past max stage). */
  shouldAttemptStage(stage: ResearchStage, caseState?: IntelligenceCase): boolean {
    if (!caseState) {
      if (this._isStopped) return false;
      if (stage === 1) return true;
      return stage <= (this._currentStage as number) + 1;
    }
    const state = bs(caseState);
    if (state.stoppedEarly) return false;
    if (stage === 1) return true;
    const cfg = this.getStageConfig(stage);
    if (!cfg) return false;
    if (state.requestsUsed >= DEFAULT_COMPANY_BUDGET.maxTotalRequests) return false;
    return true;
  }

  /** Stage configurations for research pipeline. */
  public static readonly STAGES: StageConfig[] = [
    { stage: 1, name: 'dataset-qualification', maxRequests: 0, maxQueries: 0, maxGitHubObservations: 0, description: 'Cheap dataset qualification.' },
    { stage: 2, name: 'public-source-discovery', maxRequests: 8, maxQueries: 3, maxGitHubObservations: 2, description: 'Cheap public source discovery (homepage, sitemap, links).' },
    { stage: 3, name: 'live-technical-research', maxRequests: 12, maxQueries: 8, maxGitHubObservations: 5, description: 'Live technical research via search + direct observation.' },
    { stage: 4, name: 'signal-correlation', maxRequests: 6, maxQueries: 5, maxGitHubObservations: 3, description: 'Deeper signal correlation and evidence gathering.' },
    { stage: 5, name: 'safe-verification', maxRequests: 5, maxQueries: 3, maxGitHubObservations: 2, description: 'Safe read-only verification of technical signals.' },
    { stage: 6, name: 'owner-contact-refresh', maxRequests: 4, maxQueries: 3, maxGitHubObservations: 1, description: 'Owner and contact refresh via public sources.' },
  ];

  /** Get the configuration for a research stage. */
  getStageConfig(stage: ResearchStage): StageConfig | undefined {
    return ResearchBudget.STAGES.find(s => s.stage === stage);
  }

  /** Advance to the next research stage. */
  advanceStage(): void {
    this._currentStage = Math.min(6, (this._currentStage as number) + 1) as ResearchStage;
  }

  /** Get the current stage number. */
  getCurrentStageNum(): ResearchStage {
    return this._currentStage;
  }

  /**
   * Case-integrated stop check.
   */
  isStoppedIntegrated(caseState?: IntelligenceCase): boolean {
    if (caseState) return bs(caseState).stoppedEarly;
    return this._isStopped;
  }

  /**
   * Multi-dimensional budget check and consumption.
   * returns true if action is allowed, false if budget exhausted.
   */
  checkAndConsume(metric: BudgetMetric, provider: string = 'generic', caseState?: IntelligenceCase): boolean {
    const budget = DEFAULT_COMPANY_BUDGET;
    const state = bs(caseState);

    switch (metric) {
      case 'QUERY':
        if (state.queriesUsed >= budget.maxSearchQueries) return false;
        if (caseState) state.queriesUsed++; else this._queriesUsed++;
        break;
      case 'PAGE':
        if ((state.pagesFetched || 0) >= budget.maxPagesFetched) return false;
        if (caseState) state.pagesFetched = (state.pagesFetched || 0) + 1; else this._pagesFetched++;
        break;
      case 'REQUEST':
        if (state.requestsUsed >= budget.maxTotalRequests) return false;

        const pCount = caseState
          ? ((caseState.research_state as any)?.providerCounts || {})[provider] || 0
          : (this._providerCounts[provider] || 0);

        if (pCount >= budget.maxRequestsPerProvider) return false;

        if (caseState) {
          state.requestsUsed++;
          if (typeof caseState === 'object' && caseState !== null) {
            caseState.research_state = caseState.research_state || {};
            caseState.research_state.providerCounts = (caseState.research_state as any).providerCounts || {};
            (caseState.research_state as any).providerCounts[provider] = pCount + 1;
          }
        } else {
          this._requestsUsed++;
          this._providerCounts[provider] = pCount + 1;
        }
        break;
      case 'SURFACE':
        if ((state.technicalSurfaces || 0) >= budget.maxTechnicalSurfaces) return false;
        if (caseState) state.technicalSurfaces = (state.technicalSurfaces || 0) + 1; else this._technicalSurfaces++;
        break;
    }
    return true;
  }

  /** Legacy wrapper for recordRequest to maintain compatibility. */
  recordRequest(stage: number = 1, caseState?: IntelligenceCase): boolean {
    return this.checkAndConsume('REQUEST', 'generic', caseState);
  }

  /** Legacy wrapper for recordQuery. */
  recordQuery(stage: number = 1, caseState?: IntelligenceCase): boolean {
    return this.checkAndConsume('QUERY', 'generic', caseState);
  }

  /** Mark research as stopped early. */
  stopEarly(caseStateOrReason?: IntelligenceCase | string, reason: string = ''): void {
    if (typeof caseStateOrReason === 'string') {
      this._isStopped = true;
      this._stopReason = caseStateOrReason;
    } else if (caseStateOrReason) {
      bs(caseStateOrReason).stoppedEarly = true;
      bs(caseStateOrReason).stopReason = reason;
    } else {
      this._isStopped = true;
      this._stopReason = reason;
    }
  }

  /** Get a summary of the budget usage. */
  getSummary(stage: ResearchStage = 2): BudgetSummary {
    const cfg = this.getStageConfig(stage) ?? this.getStageConfig(2)!;
    const state = bs();
    const budget = DEFAULT_COMPANY_BUDGET;
    return {
      requests_used: state.requestsUsed,
      requests_remaining: Math.max(0, budget.maxTotalRequests - state.requestsUsed),
      queries_used: state.queriesUsed,
      queries_remaining: Math.max(0, budget.maxSearchQueries - state.queriesUsed),
      pages_fetched: state.pagesFetched || 0,
      pages_remaining: Math.max(0, budget.maxPagesFetched - (state.pagesFetched || 0)),
      stopped_early: state.stoppedEarly,
      stop_reason: state.stopReason,
      stageName: cfg.name,
    };
  }
}
