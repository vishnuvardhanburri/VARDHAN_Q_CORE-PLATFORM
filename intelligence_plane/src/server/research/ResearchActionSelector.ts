/**
 * VARDHAN — RESEARCH ACTION SELECTOR (§5)
 * ─────────────────────────────────────────────────────────────────────────────
 * For every candidate research action, calculate:
 *   expectedInformationGain × technicalRelevance × freshness × evidencePotential
 *   ──────────────────────────────────────────────────────────────────────────
 *   researchCost
 *
 * Choose the highest-priority next action. Do NOT crawl hundreds of URLs.
 */

import type { Hypothesis } from './HypothesisEngine';
import type { ResearchState } from './VardhanResearchController';

export type ActionType =
  | 'inspect_github'
  | 'inspect_docs'
  | 'inspect_status'
  | 'inspect_security'
  | 'inspect_changelog'
  | 'inspect_engineering_blog'
  | 'search_technical_change'
  | 'search_engineering_hiring'
  | 'verify_endpoint'
  | 'render_js_page'
  | 'inspect_linked_source'
  | 'look_for_incident'
  | 'inspect_job_postings'
  | 'no_action';

export interface ResearchAction {
  id: string;
  type: ActionType;
  /** Human-readable description. */
  description: string;
  /** The hypothesis this action investigates. */
  hypothesisId: string | null;
  /** URL or search query to investigate (if applicable). */
  target: string | null;
  /** Scores (0–1). */
  expectedInformationGain: number;
  technicalRelevance: number;
  freshness: number;
  evidencePotential: number;
  /** Cost estimate (0–1, where 1 = most expensive). */
  researchCost: number;
  /** Priority = product / cost. */
  priority: number;
  /** Evidence type this action would produce. */
  expectedEvidenceType: string;
}

export class ResearchActionSelector {
  /**
   * Rank candidate research actions by information-gain-per-cost.
   * Returns actions sorted by priority (highest first).
   */
  static rank(hypotheses: Hypothesis[], state: ResearchState | null): ResearchAction[] {
    const actions: ResearchAction[] = [];
    const completed = new Set(state?.completedActions || []);

    for (const h of hypotheses) {
      for (const nextAction of h.nextActions) {
        const action = this.translate(h, nextAction, completed);
        if (action) actions.push(action);
      }
    }

    // Sort by priority descending
    return actions.sort((a, b) => b.priority - a.priority);
  }

  private static translate(h: Hypothesis, nextAction: string, completed: Set<string>): ResearchAction | null {
    const key = `${h.id}:${nextAction}`;
    if (completed.has(key)) return null;

    let type: ActionType;
    let description: string;
    let target: string | null;
    let infoGain: number;
    let cost: number;
    let evidenceType: string;

    const lower = nextAction.toLowerCase();
    if (lower.includes('verify live')) {
      type = 'verify_endpoint';
      description = `Verify ${h.statement.slice(0, 80)} against live public sources`;
      target = h.supportingEvidenceIds.length > 0 ? h.supportingEvidenceIds[0] : null;
      infoGain = 0.8; cost = 0.4; evidenceType = 'OBSERVATION';
    } else if (lower.includes('corroborating') || lower.includes('engineering content')) {
      type = 'search_technical_change';
      description = `Search for corroborating evidence of: ${h.statement.slice(0, 80)}`;
      target = h.type;
      infoGain = h.estimatedInfoGain * 0.7; cost = 0.3; evidenceType = 'DOCUMENTED_FACT';
    } else if (lower.includes('github')) {
      type = 'inspect_github';
      description = `Inspect GitHub activity for hypothesis: ${h.type}`;
      target = null;
      infoGain = 0.6; cost = 0.2; evidenceType = 'OBSERVATION';
    } else if (lower.includes('hiring') || lower.includes('technical hiring')) {
      type = 'inspect_job_postings';
      description = `Check for technical hiring signals related to: ${h.type}`;
      target = h.type;
      infoGain = 0.5; cost = 0.3; evidenceType = 'DOCUMENTED_FACT';
    } else {
      type = 'search_technical_change';
      description = nextAction;
      target = h.type;
      infoGain = 0.4; cost = 0.2; evidenceType = 'OBSERVATION';
    }

    // Priority = (infoGain * relevance * freshness * evidencePotential) / cost
    const technicalRelevance = h.type === 'SCALING_PRESSURE' || h.type === 'ARCHITECTURE_CHANGE' || h.type === 'PLATFORM_MIGRATION' ? 0.9 : 0.7;
    const freshness = h.supportingEvidenceIds.length > 0 ? 0.8 : 0.5; // assume recent if we have evidence
    const evidencePotential = Math.min(1.0, h.supportingEvidenceIds.length * 0.25);

    const priority = (infoGain * technicalRelevance * freshness * evidencePotential) / Math.max(cost, 0.1);

    return {
      id: 'act_' + Math.random().toString(36).slice(2, 10),
      type,
      description,
      hypothesisId: h.id,
      target,
      expectedInformationGain: infoGain,
      technicalRelevance,
      freshness,
      evidencePotential,
      researchCost: cost,
      priority,
      expectedEvidenceType: evidenceType,
    };
  }

  private static defaultAction(type: ActionType, description: string, hypothesisId: string): ResearchAction {
    const infoGain = 0.3;
    const cost = 0.1;
    const technicalRelevance = 0.5;
    const freshness = 0.7;
    const evidencePotential = 0.3;
    return {
      id: 'act_' + Math.random().toString(36).slice(2, 10),
      type,
      description,
      hypothesisId: hypothesisId === 'No hypothesis' ? null : hypothesisId,
      target: null,
      expectedInformationGain: infoGain,
      technicalRelevance,
      freshness,
      evidencePotential,
      researchCost: cost,
      priority: (infoGain * technicalRelevance * freshness * evidencePotential) / Math.max(cost, 0.1),
      expectedEvidenceType: 'OBSERVATION',
    };
  }
}
