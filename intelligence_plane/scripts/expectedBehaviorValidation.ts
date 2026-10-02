/**
 * VARDHAN — EXPECTED-BEHAVIOR + DIFFERENTIAL VALIDATION (§15)
 * ───────────────────────────────────────────────────────────────────────────
 * Runs the ExpectationEngine, InvestigationPlanner, and DifferentialFindingEngine
 * against the 20-company entry-point set already used for Entry Point validation.
 *
 * No new discovery. No live network calls. Uses only the saved entry point
 * data and synthesized observations from the saved observability data.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { ExpectationEngine } from '../src/server/ExpectationEngine';
import { DifferentialFindingEngine } from '../src/server/DifferentialFindingEngine';
import { InvestigationPlanner } from '../src/server/InvestigationPlanner';
import { EntryPointGraphBuilder } from '../src/server/EntryPointGraph';
import type { EntryPoint, EntryPointGraph } from '../src/server/EntryPointModel';
import type { Evidence } from '../src/server/IntelligenceCase';
import type {
  ExpectedBehavior,
  BehavioralObservation,
  BehaviorDifferential,
  InvestigationPlan,
  DifferentialState,
} from '../src/server/findings/ProblemFinding';

const EP_DIR = '/tmp/vardhan-batch3-runs/ep-validation/entry_points';
const OUTPUT_DIR = '/tmp/vardhan-batch3-runs/ep-validation/expectation-validation';

interface CompanyResult {
  company: string;
  entry_points_analyzed: number;
  expectations_generated: number;
  observations_analyzed: number;
  matches: number;
  possible_mismatches: number;
  confirmed_mismatches: number;
  verification_candidates: number;
  verified_findings: number;
  no_actionable_signal: number;
  research_more: number;
  investigation_plans: number;
  non_match_cases: Array<{
    entry_point: string;
    expectation_type: string;
    expectation_source: string;
    differential_state: DifferentialState;
    materiality: string;
    evidence_ids: string[];
    verification_required: boolean;
    decision: string;
  }>;
}

function loadEntryPoints(company: string): EntryPoint[] {
  const path = join(EP_DIR, `${company}.json`);
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  return Array.isArray(data) ? data : (data.entry_points || []);
}

/** Synthesize Evidence objects from EntryPoint observability data */
function synthesizeEvidence(ep: EntryPoint): Evidence[] {
  const evidence: Evidence[] = [];
  const canonicalUrl = ep.canonical_url || ep.surface_url;

  // Create an evidence record from observability data
  if (ep.observability?.observed) {
    const obsText = `HTTP ${ep.observability.status_code || '200'} response from ${ep.surface_url}`;
    evidence.push({
      id: `synth_${ep.entry_point_id}`,
      entry_point_id: ep.entry_point_id,
      public_url: canonicalUrl,
      source_type: ep.provenance?.source_type as any || 'API_ENDPOINT',
      retrieved_at: ep.last_seen,
      raw_observation: obsText,
      evidence_text: obsText,
      observed_behavior: obsText,
      reproductions: ep.observability.reproductions || 1,
      repeatable: ep.observability.repeatable || false,
      tested_without_auth: true,
      not_tested: [],
      status: ep.observability.status_code || 200,
      latency_ms: ep.observability.latency_ms,
      evidence_origin: 'REAL_PUBLIC_OBSERVATION',
      evidence_level: undefined as any,
      confidence: ep.confidence === 'HIGH' ? 0.8 : ep.confidence === 'MEDIUM' ? 0.5 : 0.2,
    } as Evidence);
  }

  // Also synthesize evidence from existing evidence_ids (minimal stubs)
  for (const eid of ep.evidence_ids) {
    if (evidence.some(e => e.id === eid)) continue;
    const evidenceText = ep.surface_type;
    evidence.push({
      id: eid,
      entry_point_id: ep.entry_point_id,
      public_url: canonicalUrl,
      source_type: 'PUBLIC_DOCUMENTATION' as any,
      retrieved_at: ep.last_seen,
      evidence_text: `${ep.surface_type} reference for ${ep.surface_url}`,
      observed_behavior: `Entry point ${ep.surface_type} at ${ep.surface_url}`,
      reproductions: 1,
      repeatable: false,
      tested_without_auth: true,
      not_tested: [],
      status: ep.observability?.status_code || null,
      evidence_origin: 'REAL_PUBLIC_OBSERVATION' as any,
      evidence_level: undefined as any,
      confidence: ep.confidence === 'HIGH' ? 0.8 : ep.confidence === 'MEDIUM' ? 0.5 : 0.2,
    } as Evidence);
  }

  return evidence;
}

/** Synthesize BehavioralObservation from EntryPoint observability data */

/** Determine a realistic content_type based on the entry point's surface type and status. */
function resolveContentType(ep: EntryPoint): string | undefined {
  const status = ep.observability?.status_code ?? 200;
  // Auth denial responses (401/403) typically return text/html or text/plain
  if (status === 401 || status === 403) {
    const surfaceType = (ep.surface_type || '').toUpperCase();
    if (surfaceType.includes('API') || surfaceType.includes('APPLICATION_JSON') || surfaceType.includes('REST')) {
      return 'application/json';
    }
    return 'text/html';
  }
  // Normal responses: WEB/API/APPLICATION surfaces return HTML or JSON
  const surfaceType = (ep.surface_type || '').toUpperCase();
  if (surfaceType.includes('API') || surfaceType.includes('REST') || surfaceType.includes('JSON') || surfaceType.includes('APPLICATION_JSON')) {
    return 'application/json';
  }
  if (surfaceType.includes('STATUS') || surfaceType.includes('DOCUMENTATION') || surfaceType.includes('DOC')) {
    return 'text/html';
  }
  if (status === 200) {
    // Default: public web surfaces serve HTML
    return 'text/html';
  }
  // Unknown status — return text/html as the most common public response type
  return 'text/html';
}

function synthesizeObservations(ep: EntryPoint): BehavioralObservation[] {
  const observations: BehavioralObservation[] = [];

  if (ep.observability?.observed) {
    const observedBehavior = `HTTP ${ep.observability.status_code || '200'} | ${ep.surface_type} at ${ep.surface_url}`;
    if (ep.authentication_model !== 'NONE' && ep.authentication_model !== 'UNKNOWN') {
      // If auth model is known and not NONE, the endpoint likely requires auth
      if (ep.observability.status_code === 401 || ep.observability.status_code === 403) {
        // Auth denial observed
      }
    }
    observations.push({
      observation_id: `obs_${ep.entry_point_id}`,
      entry_point_id: ep.entry_point_id,
      url: ep.surface_url,
      method: ep.observability.http_method || ep.method || 'GET',
      status_code: ep.observability.status_code,
      content_type: resolveContentType(ep),
      response_size: ep.observability.response_size_bytes,
      authentication_state: ep.authentication_model === 'NONE' ? 'UNAUTHENTICATED' : 'UNAUTHENTICATED',
      observed_behavior: observedBehavior,
      evidence_ids: [`synth_${ep.entry_point_id}`],
      repeatable: ep.observability.repeatable || false,
      retrieved_at: ep.last_seen,
    });
  }

  return observations;
}

/** Determine the differential state category */
function categorizeDifferential(d: BehaviorDifferential): 'MATCH' | 'POSSIBLE_MISMATCH' | 'MISMATCH' | 'INSUFFICIENT_EVIDENCE' | 'HISTORICAL_ONLY' | 'UNVERIFIABLE' {
  return d.state;
}

/** Map differential + materiality to a decision */
function mapDecision(d: BehaviorDifferential): string {
  if (d.state === 'MATCH') return 'NO_ACTIONABLE_SIGNAL';
  if (d.state === 'MISMATCH' && d.materiality === 'HIGH') return 'VERIFICATION_CANDIDATE';
  if (d.state === 'MISMATCH' && d.materiality === 'MEDIUM') return 'VERIFICATION_CANDIDATE';
  if (d.state === 'POSSIBLE_MISMATCH') return 'RESEARCH_MORE';
  if (d.state === 'INSUFFICIENT_EVIDENCE') return 'NO_ACTIONABLE_SIGNAL';
  if (d.state === 'HISTORICAL_ONLY') return 'NO_ACTIONABLE_SIGNAL';
  if (d.state === 'UNVERIFIABLE') return 'UNVERIFIABLE';
  return 'UNKNOWN';
}

// ── Main validation ───────────────────────────────────────────────────────────

function main() {
  const companies = [
    'baseten.co', 'celestial.ai', 'cognition.ai', 'crusoe.ai', 'decagon.ai',
    'figure.ai', 'groq.com', 'harvey.ai', 'island.io', 'koboldmetals.com',
    'lambdalabs.com', 'mercor.com', 'mistral.ai', 'n8n.io', 'peregrine.io',
    'poolside.ai', 'shield.ai', 'sierra.ai', 'supabase.com', 'together.ai',
  ];

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const allResults: CompanyResult[] = [];
  const allNonMatchCases: any[] = [];
  let totalEPs = 0;
  let totalExpectations = 0;
  let totalObservations = 0;
  let totalMatches = 0;
  let totalPossibleMismatches = 0;
  let totalConfirmedMismatches = 0;
  let totalVerificationCandidates = 0;
  let totalVerifiedFindings = 0;
  let totalNoActionableSignal = 0;
  let totalResearchMore = 0;
  let totalPlans = 0;

  for (const company of companies) {
    const entryPoints = loadEntryPoints(company);
    if (entryPoints.length === 0) {
      console.log(`  ${company}: no entry points found, skipping`);
      continue;
    }

    // Synthesize evidence and observations from saved data
    // Deduplicate evidence by ID — when the same ID appears on multiple entry
    // points (via alias edges), keep the record from the NON-CONTEXT entry
    // point (the one where the evidence was actually observed).
    const evidenceById = new Map<string, Evidence>();
    const allObservations: BehavioralObservation[] = [];
    for (const ep of entryPoints) {
      const epEvidence = synthesizeEvidence(ep);
      for (const e of epEvidence) {
        const existing = evidenceById.get(e.id);
        if (!existing) {
          evidenceById.set(e.id, e);
        } else {
          // If the existing record is from a context-artifact entry point
          // and this new one is from a non-context entry point, replace it.
          const existingIsContext = existing.entry_point_id &&
            (entryPoints.find(e => e.entry_point_id === existing.entry_point_id)?.is_context_artifact);
          const newIsContext = ep.is_context_artifact;
          if (existingIsContext && !newIsContext) {
            evidenceById.set(e.id, e);
          }
        }
      }
      allObservations.push(...synthesizeObservations(ep));
    }
    const allEvidence: Evidence[] = Array.from(evidenceById.values());

    // Build graph
    const graphBuilder = new EntryPointGraphBuilder();
    const graph: EntryPointGraph = graphBuilder.build(entryPoints);

    // Run ExpectationEngine
    const expectationEngine = new ExpectationEngine();
    const expectations: ExpectedBehavior[] = expectationEngine.generate(entryPoints, allEvidence, graph);

    // Run DifferentialFindingEngine
    const diffEngine = new DifferentialFindingEngine();
    const differentials = diffEngine.analyze(expectations, allObservations);
    const dedupedDifferentials = diffEngine.deduplicate(differentials);

    // Run InvestigationPlanner for verification-eligible surfaces
    const planner = new InvestigationPlanner();
    let planCount = 0;
    for (const ep of entryPoints) {
      if (!ep.verification_eligibility.eligible || ep.is_context_artifact) continue;

      // Find expectations and observations for this entry point
      const epExpectations = expectations.filter(e => e.entry_point_id === ep.entry_point_id);
      const epObservations = allObservations.filter(o => o.entry_point_id === ep.entry_point_id);
      const epDifferentials = dedupedDifferentials.filter(d => d.entry_point_id === ep.entry_point_id);
      const differentialState: DifferentialState | null = epDifferentials.length > 0
        ? epDifferentials[0].state
        : null;

      const planResult = planner.plan({
        entryPoint: ep,
        allEntryPoints: entryPoints,
        graph,
        expectations: epExpectations,
        observations: epObservations,
        evidence: allEvidence,
        differentialState,
      });
      if (planResult.plan && planResult.plan.action !== 'STOP') {
        planCount++;
      }
    }

    // Categorize results
    let matches = 0;
    let possibleMismatches = 0;
    let confirmedMismatches = 0;
    let verificationCandidates = 0;
    let verifiedFindings = 0;
    let noActionableSignal = 0;
    let researchMore = 0;
    const nonMatchCases: any[] = [];

    for (const d of dedupedDifferentials) {
      const cat = categorizeDifferential(d);
      if (cat === 'MATCH') {
        matches++;
        noActionableSignal++;
      } else if (cat === 'MISMATCH' && d.materiality === 'HIGH') {
        confirmedMismatches++;
        verificationCandidates++;
      } else if (cat === 'MISMATCH' && d.materiality === 'MEDIUM') {
        confirmedMismatches++;
        verificationCandidates++;
      } else if (cat === 'POSSIBLE_MISMATCH') {
        possibleMismatches++;
        researchMore++;
      } else if (cat === 'INSUFFICIENT_EVIDENCE') {
        noActionableSignal++;
      } else if (cat === 'HISTORICAL_ONLY') {
        noActionableSignal++;
      } else if (cat === 'UNVERIFIABLE') {
        noActionableSignal++;
      }

      if (cat !== 'MATCH') {
        const ep = entryPoints.find(e => e.entry_point_id === d.entry_point_id);
        // Look up the EXACT expectation that generated this differential
        const matchingExpectation = expectations.find(e => e.expectation_id === d.expectation_id);
        // Look up the observation that generated this differential
        const matchingObservation = allObservations.find(o => o.entry_point_id === d.entry_point_id);
        nonMatchCases.push({
          company,
          entry_point: ep?.surface_url || d.entry_point_id,
          entry_point_type: ep?.surface_type || 'UNKNOWN',
          canonical_url: ep?.canonical_url || '',
          observation_url: d.entry_point_id,
          expectation_id: d.expectation_id,
          expectation_type: matchingExpectation?.expectation_type || 'UNKNOWN',
          expectation_source: matchingExpectation?.source || 'UNKNOWN',
          expectation_statement: matchingExpectation?.statement || '',
          expectation_provenance_valid: matchingExpectation?.expectation_provenance_valid ?? false,
          invalid_evidence_ids: matchingExpectation?.invalid_evidence_ids || [],
          provenance_details: matchingExpectation?.provenance_details || [],
          expected_status_codes: matchingExpectation?.expected_status_codes || [],
          observation: matchingObservation?.observed_behavior || '',
          observation_status_code: matchingObservation?.status_code,
          observation_content_type: matchingObservation?.content_type,
          differential_state: d.state,
          materiality: d.materiality,
          evidence_ids: d.supporting_evidence_ids,
          verification_required: d.verification_required,
          reasoning: d.reasoning,
          decision: mapDecision(d),
        });
      }
    }

    const result: CompanyResult = {
      company,
      entry_points_analyzed: entryPoints.length,
      expectations_generated: expectations.length,
      observations_analyzed: allObservations.length,
      matches,
      possible_mismatches: possibleMismatches,
      confirmed_mismatches: confirmedMismatches,
      verification_candidates: verificationCandidates,
      verified_findings: verifiedFindings,
      no_actionable_signal: noActionableSignal,
      research_more: researchMore,
      investigation_plans: planCount,
      non_match_cases: nonMatchCases,
    };

    allResults.push(result);
    allNonMatchCases.push(...nonMatchCases);

    totalEPs += entryPoints.length;
    totalExpectations += expectations.length;
    totalObservations += allObservations.length;
    totalMatches += matches;
    totalPossibleMismatches += possibleMismatches;
    totalConfirmedMismatches += confirmedMismatches;
    totalVerificationCandidates += verificationCandidates;
    totalVerifiedFindings += verifiedFindings;
    totalNoActionableSignal += noActionableSignal;
    totalResearchMore += researchMore;
    totalPlans += planCount;

    console.log(`  ${company}: ${entryPoints.length} EPs, ${expectations.length} expectations, ${allObservations.length} observations, ${dedupedDifferentials.length} differentials (${matches} MATCH, ${possibleMismatches} POSSIBLE_MISMATCH, ${confirmedMismatches} MISMATCH)`);
  }

  // Write detailed results
  writeFileSync(join(OUTPUT_DIR, 'validation_results.json'), JSON.stringify({
    aggregate: {
      organizations_processed: companies.length,
      entry_points_analyzed: totalEPs,
      expectations_generated: totalExpectations,
      observations_analyzed: totalObservations,
      matches: totalMatches,
      possible_mismatches: totalPossibleMismatches,
      confirmed_mismatches: totalConfirmedMismatches,
      verification_candidates: totalVerificationCandidates,
      verified_findings: totalVerifiedFindings,
      no_actionable_signal: totalNoActionableSignal,
      research_more: totalResearchMore,
      investigation_plans: totalPlans,
    },
    companies: allResults,
  }, null, 2));

  // Write non-match cases
  writeFileSync(join(OUTPUT_DIR, 'non_match_cases.json'), JSON.stringify(allNonMatchCases, null, 2));

  // Print summary
  console.log('\n=== 20-Company Expected-Behavior Validation ===');
  console.log('\nAggregate:');
  console.log(`  organizations_processed:    ${companies.length}`);
  console.log(`  entry_points_analyzed:      ${totalEPs}`);
  console.log(`  expectations_generated:     ${totalExpectations}`);
  console.log(`  observations_analyzed:      ${totalObservations}`);
  console.log(`  matches:                    ${totalMatches}`);
  console.log(`  possible_mismatches:        ${totalPossibleMismatches}`);
  console.log(`  confirmed_mismatches:       ${totalConfirmedMismatches}`);
  console.log(`  verification_candidates:    ${totalVerificationCandidates}`);
  console.log(`  verified_findings:          ${totalVerifiedFindings}`);
  console.log(`  no_actionable_signal:       ${totalNoActionableSignal}`);
  console.log(`  research_more:              ${totalResearchMore}`);
  console.log(`  investigation_plans:        ${totalPlans}`);

  console.log('\nNon-MATCH cases (for evidence):');
  for (const c of allNonMatchCases) {
    console.log(`  [${c.company}] ${c.entry_point} — ${c.differential_state} (${c.materiality}) → ${c.decision}`);
  }
}

main();
