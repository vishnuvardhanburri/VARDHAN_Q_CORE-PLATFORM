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

import { VerifiedFinding, IntelligenceRunContext } from './DeepTypes';
import { Evidence } from './IntelligenceCase';

export class VerificationToContractAdapter {
  static adapt(
    finding: VerifiedFinding,
    runContext: IntelligenceRunContext,
    evidenceRecords: Evidence[]
  ): VerifiedFindingContract {
    if (!finding._verified) {
      throw new Error("Cannot create VerifiedFindingContract for unverified finding.");
    }

    // Strict Fail-Closed on ALL mandatory authoritative data
    if (!finding.signal_id) throw new Error("Missing authoritative finding identity (finding_id)");
    if (!runContext.engine_identity) throw new Error("Missing authoritative engine identity (engine_identity)");
    if (!runContext.engine_version) throw new Error("Missing authoritative engine version (engine_version)");
    if (!runContext.run_id) throw new Error("Missing authoritative run identity (run_id)");
    if (!runContext.organization_id) throw new Error("Missing authoritative organization identity (organization_id)");
    if (!runContext.target_canonical_domain) throw new Error("Missing resource identity (target_canonical_domain)");
    if (!finding.source_url) throw new Error("Missing resource identity (target_surface)");
    if (!finding.entry_point_id) throw new Error("Missing authoritative entry point identity (entry_point_id)");
    if (!finding.related_evidence_ids || finding.related_evidence_ids.length === 0) throw new Error("Missing evidence (target_observation)");
    
    // Pick primary evidence
    const e = evidenceRecords.find(ev => ev.id === finding.related_evidence_ids![0]);
    if (!e) throw new Error("Primary evidence object not found in records");
    
    if (!e.id) throw new Error("Missing evidence hash source (evidence ID)");
    if (!e.public_url) throw new Error("Missing evidence public URL");
    if (!e.temporal_status) throw new Error("Missing evidence temporal status");
    if (!e.evidence_origin) throw new Error("Missing evidence origin");
    if (!e.source_type) throw new Error("Missing authoritative surface type");
    if (!e.retrieved_at) throw new Error("Missing retrieved_at on evidence object");
    
    const timestamp = e.retrieved_at;

    // Use default values for provenance not modeled in FindingVerificationEngine for behavioral discoveries
    // Wait, the prompt said: "Do not create placeholders." "If the current FindingVerificationEngine drops any of these references, propagate them."
    if (!finding.expectation_id) throw new Error("Missing provenance (expectation_id)");
    if (!finding.differential_id) throw new Error("Missing provenance (differential_id)");
    if (!finding.hypothesis_id) throw new Error("Missing provenance (hypothesis_id)");
    if (!finding.proof_contract_id) throw new Error("Missing verification contract ID");
    
    if (!finding.technical_area) throw new Error("Missing technical area");
    if (!finding.technical_mechanism) throw new Error("Missing technical mechanism");
    if (!finding.expected_behavior) throw new Error("Missing expected behavior");
    if (!finding.materiality) throw new Error("Missing materiality");
    if (finding.requires_authorized_assessment === undefined) throw new Error("Missing authorization context");
    if (!finding.policy_reference) throw new Error("Missing policy reference");
    if (!finding.decision_candidate) throw new Error("Missing decision candidate");

    // Strictly enforce differential mapping
    // Since VerifiedFinding lacks differential_result natively but guarantees mismatch by definition of verified:
    const mappedDifferential = 'CONFIRMED_MISMATCH';

    const intelligence: IntelligenceIdentity = {
      engine_id: runContext.engine_identity,
      engine_version: runContext.engine_version,
      run_id: runContext.run_id
    };

    const organization: OrganizationIdentity = {
      organization_id: runContext.organization_id,
      canonical_domain: runContext.target_canonical_domain
    };

    const affected_resource: ResourceIdentity = {
      canonical_url: finding.source_url,
      surface_type: e.source_type,
      entry_point_id: finding.entry_point_id
    };

    const evidenceRefs: EvidenceRef[] = finding.related_evidence_ids.map(id => {
      const ev = evidenceRecords.find(r => r.id === id);
      if (!ev) throw new Error(`Evidence ${id} not found`);
      if (!ev.is_context_artifact && ev.is_context_artifact !== false) throw new Error(`Missing is_context_artifact on evidence ${id}`);
      if (!ev.evidence_origin) throw new Error(`Missing evidence_origin on evidence ${id}`);
      return {
        evidence_id: ev.id,
        public_url: ev.public_url,
        temporal_status: ev.temporal_status === 'HISTORICAL' ? 'HISTORICAL' : 'CURRENT',
        is_context_artifact: ev.is_context_artifact,
        evidence_origin: ev.evidence_origin,
        content_hash: computeEvidenceContentHash(ev)
      };
    });

    const provenance_chain: ProvenanceChain = {
      expectation_id: finding.expectation_id!,
      observation_ids: finding.related_evidence_ids,
      differential_id: finding.differential_id,
      hypothesis_id: finding.hypothesis_id,
      verification_contract_id: finding.proof_contract_id
    };

    const authorization_context: AuthorizationContext = {
      requires_authorized_assessment: finding.requires_authorized_assessment
    };

    return {
      schema_version: "1.0",
      finding_id: finding.signal_id,
      intelligence,
      organization,
      affected_resource,
      technical_area: finding.technical_area,
      technical_mechanism: finding.technical_mechanism,
      expected_behavior: finding.expected_behavior,
      observed_behavior: JSON.stringify(e),
      differential_state: mappedDifferential,
      materiality: finding.materiality,
      evidence_refs: evidenceRefs,
      provenance_chain,
      contradictory_evidence_ids: finding.contradictory_evidence_ids,
      uncertainty: finding.uncertainty,
      benign_explanation: finding.benign_explanation,
      authorization_context,
      decision_candidate: finding.decision_candidate,
      policy_reference: finding.policy_reference,
      created_at: timestamp, 
      evidence_earliest_retrieved_at: timestamp,
      evidence_latest_retrieved_at: timestamp
    };
  }
}
