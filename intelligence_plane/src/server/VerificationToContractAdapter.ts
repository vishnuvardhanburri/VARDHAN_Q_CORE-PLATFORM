import type { 
  VerifiedFindingContract, 
  EvidenceRef, 
  ProvenanceChain, 
  AuthorizationContext, 
  IntelligenceIdentity, 
  OrganizationIdentity, 
  ResourceIdentity 
} from './VerifiedFindingContract';
import { computeEvidenceContentHash } from './VerifiedFindingContract';
import { createHash } from 'crypto';

export class VerificationToContractAdapter {
  static adapt(
    reportPayload: any, 
    engineId: string, 
    engineVersion: string, 
    runId: string
  ): VerifiedFindingContract {
    if (reportPayload.status !== 'VERIFIED') {
      throw new Error("Cannot create VerifiedFindingContract for unverified finding.");
    }

    const { report } = reportPayload;

    if (!report.target_id) throw new Error("Missing authoritative finding/target ID (target_id)");
    if (!report.target_canonical_domain) throw new Error("Missing resource identity (target_canonical_domain)");
    if (!report.target_observation) throw new Error("Missing evidence (target_observation)");
    if (!report.expectation_id) throw new Error("Missing provenance (expectation_id)");

    const intelligence: IntelligenceIdentity = {
      engine_id: engineId,
      engine_version: engineVersion,
      run_id: runId
    };

    const organization: OrganizationIdentity = {
      organization_id: report.target_id,
      canonical_domain: report.target_canonical_domain
    };

    // Deterministic resource entry point ID based on canonical URL
    const canonicalUrl = report.target_surface || report.target_canonical_domain;
    const entryPointId = `ep_${createHash('sha256').update(canonicalUrl).digest('hex').substring(0, 12)}`;

    const affected_resource: ResourceIdentity = {
      canonical_url: canonicalUrl,
      surface_type: report.target_observation.source_type || "API_ENDPOINT",
      entry_point_id: entryPointId
    };

    const e = report.target_observation;
    
    // Validate evidence has id
    if (!e.id) throw new Error("Missing evidence hash source (evidence ID)");
    
    // Ensure the observation has the fields required by computeEvidenceContentHash
    // If it lacks temporal_status or evidence_origin, we set them on the object 
    // so computeEvidenceContentHash hashes the exact values we put in the contract.
    e.temporal_status = e.temporal_status || 'CURRENT';
    e.evidence_origin = e.evidence_origin || 'TargetVerificationEngine';

    const evidenceRefs: EvidenceRef[] = [{
      evidence_id: e.id,
      public_url: e.public_url || canonicalUrl,
      temporal_status: e.temporal_status,
      is_context_artifact: false,
      evidence_origin: e.evidence_origin,
      content_hash: computeEvidenceContentHash(e)
    }];

    const provenance_chain: ProvenanceChain = {
      expectation_id: report.expectation_id,
      observation_ids: [e.id],
      differential_id: report.differential_id || report.expectation_id, // fallback to expectation if not explicit
      hypothesis_id: report.hypothesis_id || report.expectation_id,
      verification_contract_id: "LIVE_TECHNICAL_EVENT_VERIFICATION"
    };

    const authorization_context: AuthorizationContext = {
      requires_authorized_assessment: false // For public live events, no authorization is required
    };

    // Deterministic Finding ID based on target + provider event
    const findingIdSeed = `${organization.organization_id}-${report.provider_event}`;
    const findingId = `find_${createHash('sha256').update(findingIdSeed).digest('hex').substring(0, 16)}`;

    return {
      schema_version: "1.0",
      finding_id: findingId,
      intelligence,
      organization,
      affected_resource,
      technical_area: "RELIABILITY",
      technical_mechanism: "BEHAVIORAL_MATCH",
      expected_behavior: "Target surface should match control group baseline",
      observed_behavior: JSON.stringify(e),
      differential_state: report.differential_result === 'CONTROL_HEALTHY' ? "CONFIRMED_MISMATCH" : "UNKNOWN",
      materiality: "HIGH", // Live availability drops are high materiality
      evidence_refs: evidenceRefs,
      provenance_chain,
      contradictory_evidence_ids: [],
      uncertainty: [],
      benign_explanation: "",
      authorization_context,
      decision_candidate: "SEAL_VERIFIED_FINDING", // Defined by architecture for this pathway
      policy_reference: "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
      created_at: e.timestamp || new Date().toISOString(), // Use evidence timestamp for determinism if available
      evidence_earliest_retrieved_at: e.timestamp || new Date().toISOString(),
      evidence_latest_retrieved_at: e.timestamp || new Date().toISOString()
    };
  }
}
