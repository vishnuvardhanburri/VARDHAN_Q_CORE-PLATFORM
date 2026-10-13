/**
 * VARDHAN — INVESTIGATION PLANNER (§PLAN)
 * ─────────────────────────────────────────────────────────────────────────────
 * Decides: "What is the next most useful public observation?" for an entry point.
 *
 * The planner NEVER produces plans that require authentication, credential
 * attacks, brute force, or private-data access. All candidate targets are
 * public, unauthenticated, read-only HTTP operations.
 *
 * Priority ordering (highest first):
 *   1. Direct evidence — observe the entry point URL itself
 *   2. Public runtime evidence — inspect public JS for runtime API calls
 *   3. Documented operation — follow evidence-backed documented operations
 *   4. Re-check — re-observe an already-observed surface that needs validation
 *   5. Cross-source corroboration — compare behavior across independent sources
 *   6. Related public surface — follow public graph edges
 *
 * The planner operates strictly in PUBLIC_INTELLIGENCE mode.
 */

import type { EntryPoint, EntryPointGraph } from './EntryPointModel';
import type { ExpectedBehavior, BehavioralObservation, InvestigationPlan, DifferentialState } from './findings/ProblemFinding';
import type { Evidence } from './IntelligenceCase';

// ── Plan ID generation ────────────────────────────────────────────────────────

let planIdCounter = 0;
function makePlanId(entryPointId: string): string {
  return `plan_${entryPointId.slice(0, 8)}_${(planIdCounter++).toString(36)}`;
}

// ── Planning input/output ────────────────────────────────────────────────────

export interface PlanningInput {
  entryPoint: EntryPoint;
  allEntryPoints: EntryPoint[];
  graph: EntryPointGraph | null;
  expectations: ExpectedBehavior[];
  observations: BehavioralObservation[];
  evidence: Evidence[];
  differentialState: DifferentialState | null;
}

export interface PlanningResult {
  plan: InvestigationPlan | null;
  candidates: InvestigationPlan[];
  rationale: string[];
}

/** Helper to create a STOP plan. */
function createStopPlan(
  entryPoint: EntryPoint,
  reason: string,
  objective: string,
  authorizationRequired: boolean
): InvestigationPlan {
  return {
    plan_id: makePlanId(entryPoint.entry_point_id),
    entry_point_id: entryPoint.entry_point_id,
    reason,
    objective,
    action: 'STOP',
    candidate_targets: [],
    required_evidence: [],
    success_condition: 'N/A — no public observation planned.',
    stop_condition: 'Entry point is not publicly observable or requires authorization, or all expectations are satisfied.',
    authorization_required: authorizationRequired,
  };
}

/**
 * Investigation Planner — determines the next most useful public observation
 * for a given entry point.
 */
export class InvestigationPlanner {
  /**
   * Plan the next most useful public observation for an entry point.
   */
  plan(input: PlanningInput): PlanningResult {
    const { entryPoint, allEntryPoints, graph, expectations, observations, evidence, differentialState } = input;
    const rationale: string[] = [];
    const candidates: InvestigationPlan[] = [];

    // ── STOP: Entry point is not public-verification-eligible ──
    if (!entryPoint.verification_eligibility.eligible) {
      const stopPlan = createStopPlan(
        entryPoint,
        `Entry point is not verification-eligible: ${entryPoint.verification_eligibility.ineligibility_reasons.join(', ') || 'ineligible'}.`,
        'No public observation can be performed — entry point requires authorization or is a context artifact.',
        true,
      );
      candidates.push(stopPlan);
      rationale.push('STOP: Entry point is not verification-eligible for public observation.');
      return { plan: stopPlan, candidates, rationale };
    }

    // ── STOP: Differential is MATCH and no verification needed ──
    if (differentialState === 'MATCH' && expectations.every(e => !e.current)) {
      const stopPlan = createStopPlan(entryPoint,
        'All expectations are matched; no further observation needed.',
        'No further public observation is useful for this entry point.',
        false);
      candidates.push(stopPlan);
      rationale.push('STOP: All expectations matched, no further observation needed.');
      return { plan: stopPlan, candidates, rationale };
    }

    // ── STOP: Historical only — no current verification needed ──
    if (differentialState === 'HISTORICAL_ONLY') {
      const stopPlan = createStopPlan(entryPoint,
        'Differential is HISTORICAL_ONLY — historical evidence is not actionable.',
        'Historical evidence does not require current public verification.',
        false);
      candidates.push(stopPlan);
      rationale.push('STOP: Historical-only expectation, no current verification needed.');
      return { plan: stopPlan, candidates, rationale };
    }

    // ── Phase 2: Generate candidate plans in priority order ──
    const observedUrls = new Set(observations.map(o => o.url));

    // Priority 1: OBSERVE_PUBLIC_RESPONSE — surface URL not yet observed
    if (!observedUrls.has(entryPoint.surface_url) || !observedUrls.has(entryPoint.canonical_url)) {
      const plan: InvestigationPlan = {
        plan_id: makePlanId(entryPoint.entry_point_id),
        entry_point_id: entryPoint.entry_point_id,
        reason: 'No direct behavioral observation exists for this public surface.',
        objective: 'Observe the unauthenticated response to establish the baseline behavior of this entry point.',
        action: 'OBSERVE_PUBLIC_RESPONSE',
        candidate_targets: [entryPoint.surface_url],
        required_evidence: entryPoint.evidence_ids,
        success_condition: 'HTTP response received with status code, content-type, and visible content captured.',
        stop_condition: 'Response is consistently reproducible and no new behavioral information is gained.',
        authorization_required: false,
      };
      candidates.push(plan);
      rationale.push('Priority 1: Direct observation of the entry point URL (unobserved).');
    }

    // Priority 2: INSPECT_PUBLIC_JS — JS bundle evidence exists and not yet inspected
    const jsEvidence = evidence.filter(e =>
      e.source_type === 'JS_BUNDLE' || (e.source_type as string) === 'CLIENT_JS_BUNDLE'
    );
    const jsAlreadyInspected = observations.some(o =>
      o.observed_behavior.toLowerCase().includes('js bundle') ||
      o.observed_behavior.toLowerCase().includes('buildrequestheaders') ||
      o.observed_behavior.toLowerCase().includes('api call') ||
      o.observed_behavior.toLowerCase().includes('runtime')
    );
    if (jsEvidence.length > 0 && !jsAlreadyInspected &&
        (observations.length === 0 || differentialState !== 'MATCH')) {
      const jsUrls = [...new Set(jsEvidence.map(e => e.public_url).filter(u => u.length > 0))];
      const plan: InvestigationPlan = {
        plan_id: makePlanId(entryPoint.entry_point_id),
        entry_point_id: entryPoint.entry_point_id,
        reason: `Public client-side JS evidence exists (${jsEvidence.length} record(s)) but has not been inspected for runtime API call patterns.`,
        objective: 'Inspect public JavaScript to discover explicitly referenced API URLs, HTTP methods, and auth header requirements.',
        action: 'INSPECT_PUBLIC_JS',
        candidate_targets: jsUrls,
        required_evidence: jsEvidence.map(e => e.id),
        success_condition: 'JS bundle inspected; API URLs, HTTP methods, and auth header construction patterns extracted.',
        stop_condition: 'No additional JS bundles to inspect, or JS contains no API call patterns.',
        authorization_required: false,
      };
      candidates.push(plan);
      rationale.push('Priority 2: Inspect public JS bundle for runtime API call patterns.');
    }

    // Priority 3: FOLLOW_DOCUMENTED_OPERATION — documentation evidence exists and not followed
    const docEvidence = evidence.filter(e =>
      (e.source_type as string) === 'API_DOCUMENTATION' ||
      (e.source_type as string) === 'API_REFERENCE' ||
      e.source_type === 'PUBLIC_DOCUMENTATION' ||
      e.evidence_origin === 'DOCUMENTED_SOURCE'
    );
    const docAlreadyFollowed = observations.some(o =>
      o.observed_behavior.toLowerCase().includes('documented') &&
      o.observed_behavior.toLowerCase().includes('operation')
    );
    if (docEvidence.length > 0 && !docAlreadyFollowed) {
      const docUrls: string[] = [...new Set(docEvidence.map(e => e.public_url || e.source_url || '').filter(Boolean))];
      const plan: InvestigationPlan = {
        plan_id: makePlanId(entryPoint.entry_point_id),
        entry_point_id: entryPoint.entry_point_id,
        reason: `${docEvidence.length} documented-operation evidence record(s) exist but have not been cross-referenced with observed behavior.`,
        objective: 'Verify that the documented operation behaves as documented when accessed publicly.',
        action: 'FOLLOW_DOCUMENTED_OPERATION',
        candidate_targets: docUrls,
        required_evidence: docEvidence.map(e => e.id),
        success_condition: 'Documented operation behavior (status code, auth requirement) is confirmed or contradicted by public observation.',
        stop_condition: 'No additional documented operations to follow.',
        authorization_required: false,
      };
      candidates.push(plan);
      rationale.push('Priority 3: Follow documented operations to verify they match expectations.');
    }

    // Priority 4: RECHECK — surface already observed, differential is not MATCH
    if (observations.some(o => o.url === entryPoint.surface_url || o.url === entryPoint.canonical_url) &&
        differentialState !== 'MATCH' &&
        differentialState !== null) {
      const plan: InvestigationPlan = {
        plan_id: makePlanId(entryPoint.entry_point_id),
        entry_point_id: entryPoint.entry_point_id,
        reason: `Surface has been observed but differential state is ${differentialState} — re-observation may yield additional signal.`,
        objective: 'Re-check the entry point response to gather additional behavioral evidence for differential resolution.',
        action: 'RECHECK',
        candidate_targets: [entryPoint.surface_url],
        required_evidence: entryPoint.evidence_ids,
        success_condition: 'Consistent reproducible observation confirming or refining the differential state.',
        stop_condition: 'Observation confirms prior behavior with no new information.',
        authorization_required: false,
      };
      candidates.push(plan);
      rationale.push(`Priority 4: RECHECK surface (differential state: ${differentialState}).`);
    }

    // Priority 5: COMPARE_BEHAVIOR — POSSIBLE_MISMATCH with 2+ observations
    if (differentialState === 'POSSIBLE_MISMATCH' && observations.length >= 2) {
      const plan: InvestigationPlan = {
        plan_id: makePlanId(entryPoint.entry_point_id),
        entry_point_id: entryPoint.entry_point_id,
        reason: 'Differential is POSSIBLE_MISMATCH with multiple observations — needs cross-corroboration to resolve.',
        objective: 'Compare behavior across independent evidence sources to resolve the possible mismatch.',
        action: 'COMPARE_BEHAVIOR',
        candidate_targets: observations.map(o => o.url),
        required_evidence: [...new Set(observations.flatMap(o => o.evidence_ids))],
        success_condition: 'Behavior is confirmed consistent (or inconsistent) across independent observations.',
        stop_condition: 'No additional independent evidence sources to compare.',
        authorization_required: false,
      };
      candidates.push(plan);
      rationale.push('Priority 5: Cross-source corroboration to resolve POSSIBLE_MISMATCH.');
    }

    // Priority 6: FOLLOW_PUBLIC_RELATION — related public surfaces in graph
    const relatedEps: EntryPoint[] = [];
    if (graph) {
      for (const edge of graph.edges) {
        if (edge.source_entry_point_id === entryPoint.entry_point_id) {
          const target = allEntryPoints.find(ep => ep.entry_point_id === edge.target_entry_point_id || ep.entry_point_id === edge.to);
          if (target && target.verification_eligibility.eligible && !target.is_context_artifact) {
            relatedEps.push(target);
          }
        }
      }
    }
    if (relatedEps.length > 0) {
      const plan: InvestigationPlan = {
        plan_id: makePlanId(entryPoint.entry_point_id),
        entry_point_id: entryPoint.entry_point_id,
        reason: `${relatedEps.length} related public surface(s) found via graph edges — useful for cross-source corroboration.`,
        objective: 'Observe related public surfaces to corroborate or refine expectations for the primary entry point.',
        action: 'FOLLOW_PUBLIC_RELATION',
        candidate_targets: relatedEps.map(ep => ep.surface_url),
        required_evidence: entryPoint.evidence_ids,
        success_condition: 'At least one related surface is observed, confirming or contradicting expectations.',
        stop_condition: 'All related public surfaces have been observed.',
        authorization_required: false,
      };
      candidates.push(plan);
      rationale.push('Priority 6: Follow related public surfaces for cross-source corroboration.');
    }

    // ── Select the best candidate ──
    if (candidates.length > 0) {
      // Priority order: OBSERVE > INSPECT_JS > FOLLOW_DOC > COMPARE_BEHAVIOR > FOLLOW_RELATION > RECHECK
      const priority = ['OBSERVE_PUBLIC_RESPONSE', 'INSPECT_PUBLIC_JS', 'FOLLOW_DOCUMENTED_OPERATION', 'COMPARE_BEHAVIOR', 'FOLLOW_PUBLIC_RELATION', 'RECHECK'];
      let plan: InvestigationPlan | null = null;
      for (const p of priority) {
        const match = candidates.find(c => c.action === p);
        if (match) {
          plan = match;
          break;
        }
      }
      if (!plan) plan = candidates[0];
      rationale.push(`Selected plan action: ${plan!.action}`);
      return { plan: plan!, candidates, rationale };
    }

    // ── Fallback STOP ──
    const stopPlan = createStopPlan(entryPoint,
      'No actionable expectations or observations remaining.',
      'No further useful public observations can be made.',
      false);
    candidates.push(stopPlan);
    rationale.push('STOP: No remaining actionable observations.');
    return { plan: stopPlan, candidates, rationale };
  }

  /**
   * Build a behavioral observation from an evidence record.
   * Used to synthesize observations for differential comparison when
   * direct observation tools are not available.
   */
  static observationFromEvidence(evidence: Evidence, entryPointId: string): BehavioralObservation | null {
    if (!evidence.tested_without_auth && evidence.tested_without_auth !== null) {
      return null;
    }

    const authState: BehavioralObservation['authentication_state'] =
      evidence.tested_without_auth ? 'UNAUTHENTICATED' : 'UNKNOWN';

    const behaviorParts: string[] = [];
    if (evidence.status !== null) behaviorParts.push(`HTTP ${evidence.status}`);
    if (evidence.observation_type) behaviorParts.push(evidence.observation_type);
    if (evidence.evidence_text) behaviorParts.push(evidence.evidence_text.slice(0, 200));
    const observedBehavior = behaviorParts.join(' | ') || 'No specific behavior recorded';

    return {
      observation_id: `obs_${evidence.id}`,
      entry_point_id: entryPointId,
      url: evidence.public_url,
      method: 'GET',
      status_code: evidence.status ?? undefined,
      content_type: undefined,
      response_size: evidence.raw_observation ? Buffer.byteLength(evidence.raw_observation, 'utf-8') : undefined,
      authentication_state: authState,
      observed_behavior: observedBehavior,
      evidence_ids: [evidence.id],
      repeatable: evidence.repeatable ?? false,
      retrieved_at: evidence.retrieved_at,
    };
  }
}
