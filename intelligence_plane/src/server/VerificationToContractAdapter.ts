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

    // Strict Fail-Closed on ALL mandatory authoritative data
    if (!report.finding_id) throw new Error("Missing authoritative finding identity (finding_id)");
    if (!report.organization_id) throw new Error("Missing authoritative organization identity (organization_id)");
    if (!report.target_canonical_domain) throw new Error("Missing resource identity (target_canonical_domain)");
    if (!report.target_surface) throw new Error("Missing resource identity (target_surface)");
    if (!report.entry_point_id) throw new Error("Missing authoritative entry point identity (entry_point_id)");
    if (!report.target_observation) throw new Error("Missing evidence (target_observation)");
    
    const e = report.target_observation;
    
    if (!e.id) throw new Error("Missing evidence hash source (evidence ID)");
    if (!e.public_url) throw new Error("Missing evidence public URL");
    if (!e.temporal_status) throw new Error("Missing evidence temporal status");
    if (!e.evidence_origin) throw new Error("Missing evidence origin");
    if (!e.source_type) throw new Error("Missing authoritative surface type");
    if (!e.timestamp) throw new Error("Missing timestamp on evidence object");

    if (!report.expectation_id) throw new Error("Missing provenance (expectation_id)");
    if (!report.hypothesis_id) throw new Error("Missing provenance (hypothesis_id)");
    if (!report.differential_id) throw new Error("Missing provenance (differential_id)");
    if (!report.verification_contract_id) throw new Error("Missing verification contract ID");
    
    if (!report.technical_area) throw new Error("Missing technical area");
    if (!report.technical_mechanism) throw new Error("Missing technical mechanism");
    if (!report.expected_behavior) throw new Error("Missing expected behavior");
    if (!report.materiality) throw new Error("Missing materiality");
    if (report.requires_authorized_assessment === undefined) throw new Error("Missing authorization context");
    if (!report.policy_reference) throw new Error("Missing policy reference");
    if (!report.decision_candidate) throw new Error("Missing decision candidate");
    if (!report.differential_result) throw new Error("Missing differential state");

    // Strictly enforce differential mapping
    const differentialStateMapping: Record<string, string> = {
      'CONTROL_HEALTHY': 'CONFIRMED_MISMATCH',
      'NO_CONTROL_PROBED': 'UNVERIFIED',
      'CONTROL_ALSO_AFFECTED': 'MATCH'
    };
    const mappedDifferential = differentialStateMapping[report.differential_result];
    if (mappedDifferential !== 'CONFIRMED_MISMATCH') {
       throw new Error(`Invalid differential state for verified finding: ${report.differential_result}`);
    }

    const intelligence: IntelligenceIdentity = {
      engine_id: engineId,
      engine_version: engineVersion,
      run_id: runId
    };

    const organization: OrganizationIdentity = {
      organization_id: report.organization_id,
      canonical_domain: report.target_canonical_domain
    };

    const affected_resource: ResourceIdentity = {
      canonical_url: report.target_surface,
      surface_type: e.source_type,
      entry_point_id: report.entry_point_id
    };

    // We treat upstream objects as IMMUTABLE. Do not mutate e.
    const evidenceRefs: EvidenceRef[] = [{
      evidence_id: e.id,
      public_url: e.public_url,
      temporal_status: e.temporal_status,
      is_context_artifact: false,
      evidence_origin: e.evidence_origin,
      content_hash: computeEvidenceContentHash(e)
    }];

    const provenance_chain: ProvenanceChain = {
      expectation_id: report.expectation_id,
      observation_ids: [e.id],
      differential_id: report.differential_id,
      hypothesis_id: report.hypothesis_id,
      verification_contract_id: report.verification_contract_id
    };

    const authorization_context: AuthorizationContext = {
      requires_authorized_assessment: report.requires_authorized_assessment
    };

    return {
      schema_version: "1.0",
      finding_id: report.finding_id,
      intelligence,
      organization,
      affected_resource,
      technical_area: report.technical_area,
      technical_mechanism: report.technical_mechanism,
      expected_behavior: report.expected_behavior,
      observed_behavior: JSON.stringify(e),
      differential_state: mappedDifferential,
      materiality: report.materiality,
      evidence_refs: evidenceRefs,
      provenance_chain,
      contradictory_evidence_ids: [],
      uncertainty: [],
      benign_explanation: "",
      authorization_context,
      decision_candidate: report.decision_candidate,
      policy_reference: report.policy_reference,
      created_at: e.timestamp, // No Date.now()
      evidence_earliest_retrieved_at: e.timestamp,
      evidence_latest_retrieved_at: e.timestamp
    };
  }
}
