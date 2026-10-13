import { IntelligenceCase } from './IntelligenceCase';
import { ResearchState, VoIAction, VoIActionType } from './types/LoopTypes';
import { GitHubProviderStatus } from './providers/GitHubProvider';
import { ResearchBudget } from './ResearchBudget';

export interface ActionHistoryRecord {
  action_type: VoIActionType;
  iteration: number;
  evidence_delta: number;
  signal_delta: number;
  state_changed: boolean;
  status: string;
}

export class VoIRouter {
  /**
   * Evaluates the IntelligenceCase and determines the highest-value next action.
   */
  public __getNextBestAction(currentCase: IntelligenceCase, budget: any, history: ActionHistoryRecord[] = []): VoIAction {
    console.log(`[VOI] Evaluating next action for ${currentCase.company}`);
    console.log(`[VOI] Origin: ${currentCase.company_surface?.origin}`);
    console.log(`[VOI] GH Org: ${currentCase.github_memory?.org_login}`);

    // ANTI-DEADLOCK: If the last action produced nothing, force diversification
    const lastAction = history[history.length - 1];
    const isRepeatingUselessAction = (action: VoIActionType) => {
      return lastAction &&
             lastAction.action_type === action &&
             lastAction.evidence_delta === 0 &&
             lastAction.signal_delta === 0 &&
             !lastAction.state_changed;
    };

    // 1. Fundamental Identity Resolution
    if (!currentCase.company_surface?.origin) {
      return {
        action: 'IDENTITY_RESOLVE',
        rationale: 'Company domain/origin is not yet resolved.',
        expectedGain: 'IDENTITY_NORMALIZATION',
      };
    }

    // 2. Minimum Discovery Obligation
    const hasSurfaceMap = currentCase.company_surface?.discovered_pages && currentCase.company_surface.discovered_pages.length > 0;
    const hasDiscoveredSources = currentCase.evidence.some(e => e.evidence_origin === 'DISCOVERY');

    if (!hasSurfaceMap && !hasDiscoveredSources && !isRepeatingUselessAction('BROAD_SURFACE_MAPPING')) {
      return {
        action: 'BROAD_SURFACE_MAPPING',
        rationale: 'No public surface map exists and no sources discovered; initial mapping required.',
        expectedGain: 'CONFIDENCE_BOOST',
      };
    }

    // 2b. Enforce transition from Broad to Specialized if map exists
    if (hasSurfaceMap && !hasDiscoveredSources) {
      if (!isRepeatingUselessAction('TARGETED_DISCOVERY')) {
        return {
          action: 'TARGETED_DISCOVERY',
          rationale: 'Broad surface map exists, but no specific technical sources identified; triggering targeted discovery.',
          expectedGain: 'FINDING_VALIDATION',
        };
      }
    }

    // 2b. Enforce transition from Broad to Specialized if map exists
    if (hasSurfaceMap && !hasDiscoveredSources) {
      // If we have a map but haven't actually discovered technical sources yet,
      // we should try Targeted Discovery instead of looping Broad Mapping.
      if (!isRepeatingUselessAction('TARGETED_DISCOVERY')) {
        return {
          action: 'TARGETED_DISCOVERY',
          rationale: 'Broad surface map exists, but no specific technical sources identified; triggering targeted discovery.',
          expectedGain: 'FINDING_VALIDATION',
        };
      }
    }

    // 2b. Enforce transition from Broad to Specialized if map exists
    if (hasSurfaceMap && !hasDiscoveredSources) {
      // If we have a map but haven't actually discovered technical sources yet,
      // we should try Targeted Discovery instead of looping Broad Mapping.
      if (!isRepeatingUselessAction('TARGETED_DISCOVERY')) {
        return {
          action: 'TARGETED_DISCOVERY',
          rationale: 'Broad surface map exists, but no specific technical sources identified; triggering targeted discovery.',
          expectedGain: 'FINDING_VALIDATION',
        };
      }
    }

    // 3. GITHUB SPECIALIZED ROUTING
    const githubDecision = this.evaluateGitHubVoI(currentCase, budget);
    if (githubDecision && !isRepeatingUselessAction(githubDecision.action)) {
      return githubDecision;
    }

    // 4. Targeted Discovery Gap
    if (!hasDiscoveredSources && !isRepeatingUselessAction('TARGETED_DISCOVERY')) {
      return {
        action: 'TARGETED_DISCOVERY',
        rationale: 'Initial surface known, but no targeted technical sources (GitHub, Blogs, Status) found yet.',
        expectedGain: 'FINDING_VALIDATION',
      };
    }

    // 5. Evidence Strength Gap
    if (currentCase.finding_classification &&
        (currentCase.finding_strength?.evidence_strength === 'LOW' ||
         currentCase.finding_strength?.evidence_strength === 'MEDIUM')) {

      const unobservedDiscovery = currentCase.evidence.filter(e => e.evidence_origin === 'DISCOVERY');
      if (unobservedDiscovery.length > 0 && !isRepeatingUselessAction('TARGETED_DISCOVERY')) {
        return {
          action: 'TARGETED_DISCOVERY',
          rationale: 'Technical sources discovered but not yet deeply observed; evidence strength is insufficient.',
          expectedGain: 'FINDING_VALIDATION',
        };
      }
    }

    // 6. Intelligence-Driven Gap
    if (currentCase.signals && currentCase.signals.length > 0 &&
        (!currentCase.correlated_groups || currentCase.correlated_groups.length === 0 ||
         currentCase.correlated_groups.every(g => g.strength < 0.6))) {
      if (!isRepeatingUselessAction('TARGETED_DISCOVERY')) {
        return {
          action: 'TARGETED_DISCOVERY',
          rationale: 'Technical sources discovered but not yet deeply observed; evidence strength is insufficient.',
          expectedGain: 'CORRELATION_CONFIDENCE',
        };
      }
    }

    // 7. Owner Gap
    if (currentCase.finding_classification &&
        (!currentCase.technical_owner || currentCase.technical_owner.owner_confidence === 'LOW')) {
      if (!isRepeatingUselessAction('OWNER_RESOLUTION')) {
        return {
          action: 'OWNER_RESOLUTION',
          rationale: 'Strong finding identified, but technical owner confidence is insufficient.',
          expectedGain: 'OWNER_VERIFICATION',
        };
      }
    }

    // 8. Verification Gap
    const unverifiedEvidence = currentCase.evidence.filter(e => e.evidence_origin === 'REAL_PUBLIC_OBSERVATION' && !e.repeatable);
    if (unverifiedEvidence.length > 0 && currentCase.finding_classification) {
      if (!isRepeatingUselessAction('LIVE_VERIFICATION')) {
        return {
          action: 'LIVE_VERIFICATION',
          rationale: 'Evidence found but not yet verified through live read-only probes.',
          expectedGain: 'FINDING_VALIDATION',
        };
      }
    }

    return {
      action: 'FINAL_DECISION',
      rationale: 'All high-value research gaps filled or exhausted. Ready for final classification.',
      expectedGain: 'CONFIDENCE_BOOST',
    };
  }

  public getNextBestAction(currentCase: IntelligenceCase, budget: any, history: ActionHistoryRecord[] = []): VoIAction {
    return this.__getNextBestAction(currentCase, budget, history);
  }

  private evaluateGitHubVoI(currentCase: IntelligenceCase, budget: any): VoIAction | null {
    const ghMemory = currentCase.github_memory;

    if (!ghMemory?.org_login) {
      if (currentCase.company_surface?.origin) {
        return {
          action: 'GITHUB_RESOLVE_ORG',
          rationale: 'Company identity resolved; mapping to GitHub Organization to uncover engineering activity.',
          expectedGain: 'IDENTITY_NORMALIZATION',
        };
      }
    }

    if (ghMemory?.org_login && (!ghMemory.repositories || Object.keys(ghMemory.repositories).length === 0)) {
      return {
        action: 'GITHUB_DISCOVER_REPOSITORIES',
        target: ghMemory.org_login,
        rationale: 'GitHub Organization identified; discovering relevant technical repositories to find engineering signals.',
        expectedGain: 'FINDING_VALIDATION',
        };
    }

    const signals = currentCase.signals || [];
    const highValueSignals = signals.filter(s =>
      /infra|platform|scaling|migration|reliability/i.test(s.type) ||
      /infra|platform|scaling|migration|reliability/i.test(s.excerpt || '')
    );

    if (highValueSignals.length > 0) {
      const observedRepos = ghMemory?.repositories ? Object.keys(ghMemory.repositories) : [];

      if (observedRepos.length === 0) {
        return {
          action: 'GITHUB_DISCOVER_REPOSITORIES',
          target: ghMemory?.org_login,
          rationale: `High-value signal (${highValueSignals[0].type}) detected. Prioritizing GitHub repository discovery for corroboration.`,
          expectedGain: 'CORRELATION_CONFIDENCE',
        };
      }

      const targetRepo = this.selectRepoForSignal(observedRepos, highValueSignals[0]);
      if (targetRepo) {
        if (budget.isGitHubBudgetExhausted(currentCase)) {
          return null;
        }

        if (ghMemory?.repositories?.[targetRepo] &&
            !this.isTemporalComparisonNeeded(ghMemory.repositories[targetRepo])) {
          return null;
        }

        return {
          action: 'GITHUB_OBSERVE_REPOSITORY',
          target: targetRepo,
          rationale: `Signal [${highValueSignals[0].type}] suggests high information gain in repository ${targetRepo}.`,
          expectedGain: 'FINDING_VALIDATION',
        };
      }
    }

    if (ghMemory?.last_observation_at) {
      const lastObs = new Date(ghMemory.last_observation_at).getTime();
      const now = Date.now();
      const ageDays = (now - lastObs) / (1000 * 60 * 60 * 24);

      if (ageDays > 30) {
        return {
          action: 'GITHUB_COMPARE_TEMPORAL_STATE',
          rationale: 'Previous GitHub observation is stale (>30 days). Temporal comparison requested to detect activity acceleration.',
          expectedGain: 'TEMPORAL_INTEL',
        };
      }
    }

    return null;
  }

  private isTemporalComparisonNeeded(repoState: any): boolean {
    const ghMemory = repoState?._case?.github_memory;
    if (!ghMemory?.last_observation_at) return false;
    const lastObs = new Date(ghMemory.last_observation_at).getTime();
    const now = Date.now();
    const ageDays = (now - lastObs) / (1000 * 60 * 60 * 24);
    return ageDays > 30;
  }

  private selectRepoForSignal(repos: string[], signal: any): string | null {
    if (repos.length === 0) return null;
    const keywords = ['infra', 'platform', 'scaling', 'migration', 'reliability', 'core', 'api'];
    const signalText = (signal.type + ' ' + (signal.excerpt || '')).toLowerCase();

    for (const repo of repos) {
      const repoLower = repo.toLowerCase();
      if (keywords.some(k => repoLower.includes(k))) return repo;
      if (keywords.some(k => signalText.includes(k) && repoLower.includes(k))) return repo;
    }

    return repos[0];
  }
}
