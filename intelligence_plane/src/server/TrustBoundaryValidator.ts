/**
 * VARDHAN — TRUST BOUNDARY VALIDATOR
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs 20 independent validation checks on a VerifiedFindingContract
 * BEFORE it is transmitted to Q-Core. This matches the Rust
 * `trust_boundary.rs` validator exactly (F-007: canonical 20-check set).
 *
 * Q-Core performs its own independent validation on receipt.
 * These are not redundant — they catch problems before a network call
 * and provide Intelligence-side accountability.
 *
 * INVARIANT: This validator never throws. All failures are collected
 * and returned. A single failure causes passed === false.
 *
 * INVARIANT: Checks are never softened to make a contract pass.
 */

import {
  VerifiedFindingContract,
  FINDING_CONTRACT_VERSION,
  computeEvidenceContentHash,
} from './VerifiedFindingContract';
import type { Evidence } from './IntelligenceCase';

export interface ValidationFailure {
  code: string;
  message: string;
}

export interface TrustBoundaryValidationResult {
  passed: boolean;
  failures: ValidationFailure[];
  checked_at: string;
}

export class TrustBoundaryValidator {
  validate(
    contract: VerifiedFindingContract,
    evidenceStore: Evidence[]
  ): TrustBoundaryValidationResult {
    const failures: ValidationFailure[] = [];
    const evidenceMap = new Map(evidenceStore.map(e => [e.id, e]));

    // ── Check 1: Schema version ───────────────────────────────────────────────
    if (contract.schema_version !== FINDING_CONTRACT_VERSION) {
      failures.push({
        code: 'SCHEMA_VERSION_MISMATCH',
        message: `Expected schema_version '${FINDING_CONTRACT_VERSION}', got '${contract.schema_version}'`,
      });
    }

    // ── Check 2: finding_id non-empty ─────────────────────────────────────────
    if (!contract.finding_id || contract.finding_id.trim().length === 0) {
      failures.push({
        code: 'MISSING_FINDING_ID',
        message: 'finding_id must be non-empty',
      });
    }

    // ── Check 3: organization_id non-empty ───────────────────────────────────
    if (
      !contract.organization?.organization_id ||
      contract.organization.organization_id.trim().length === 0
    ) {
      failures.push({
        code: 'MISSING_ORGANIZATION_ID',
        message: 'organization.organization_id must be non-empty',
      });
    }

    // ── Check 4: canonical_url is a valid URL ────────────────────────────────
    if (!contract.affected_resource?.canonical_url) {
      failures.push({
        code: 'MISSING_RESOURCE_URL',
        message: 'affected_resource.canonical_url must be non-empty',
      });
    } else {
      try {
        new URL(contract.affected_resource.canonical_url);
      } catch {
        failures.push({
          code: 'INVALID_RESOURCE_URL',
          message: `affected_resource.canonical_url is not a valid URL: '${contract.affected_resource.canonical_url}'`,
        });
      }
    }

    // ── Check 5: at least one evidence ref ───────────────────────────────────
    if (!contract.evidence_refs || contract.evidence_refs.length === 0) {
      failures.push({
        code: 'NO_EVIDENCE',
        message: 'evidence_refs must contain at least one entry',
      });
    }

    // ── Check 6: every evidence_ref resolves in the store ────────────────────
    for (const ref of contract.evidence_refs ?? []) {
      if (!evidenceMap.has(ref.evidence_id)) {
        failures.push({
          code: 'UNRESOLVABLE_EVIDENCE',
          message: `evidence_id '${ref.evidence_id}' not found in evidenceStore`,
        });
      }
    }

    // ── Check 7: no historical evidence ─────────────────────────────────────
    for (const ref of contract.evidence_refs ?? []) {
      if (ref.temporal_status === 'HISTORICAL') {
        failures.push({
          code: 'HISTORICAL_EVIDENCE',
          message: `evidence_id '${ref.evidence_id}' has temporal_status HISTORICAL — cannot support a current finding`,
        });
      }
    }

    // ── Check 8: no context artifacts ────────────────────────────────────────
    for (const ref of contract.evidence_refs ?? []) {
      if (ref.is_context_artifact === true) {
        failures.push({
          code: 'CONTEXT_ARTIFACT',
          message: `evidence_id '${ref.evidence_id}' is a context artifact — cannot satisfy a physical verification contract`,
        });
      }
    }

    // ── Check 9: content hashes must match ───────────────────────────────────
    for (const ref of contract.evidence_refs ?? []) {
      const stored = evidenceMap.get(ref.evidence_id);
      if (stored) {
        const recomputed = computeEvidenceContentHash(stored);
        if (ref.content_hash !== recomputed) {
          failures.push({
            code: 'EVIDENCE_HASH_MISMATCH',
            message: `evidence_id '${ref.evidence_id}' content hash mismatch — evidence may have been tampered with after hashing`,
          });
        }
      }
    }

    // ── Check 10: contradictory_evidence_ids must be explicit ────────────────
    if (!Array.isArray(contract.contradictory_evidence_ids)) {
      failures.push({
        code: 'MISSING_CONTRADICTION_FIELD',
        message: 'contradictory_evidence_ids must be explicitly set (use empty array if none)',
      });
    }

    // ── Check 11: differential_state ─────────────────────────────────────────
    const VALID_STATES = ['MISMATCH', 'CONFIRMED_MISMATCH'];
    if (!VALID_STATES.includes(contract.differential_state)) {
      failures.push({
        code: 'INVALID_DIFFERENTIAL_STATE',
        message: `differential_state must be one of [${VALID_STATES.join(', ')}], got '${contract.differential_state}'`,
      });
    }

    // ── Check 12: materiality not NONE or empty ──────────────────────────────
    const VALID_MATERIALITY = ['HIGH', 'MEDIUM', 'LOW'];
    if (!VALID_MATERIALITY.includes(contract.materiality)) {
      failures.push({
        code: 'INSUFFICIENT_MATERIALITY',
        message: `materiality must be one of [${VALID_MATERIALITY.join(', ')}], got '${contract.materiality}'`,
      });
    }

    // ── Check 13: provenance chain completeness ───────────────────────────────
    const pc = contract.provenance_chain;
    const pcMissing: string[] = [];
    if (!pc) {
      pcMissing.push('provenance_chain');
    } else {
      if (!pc.expectation_id) pcMissing.push('expectation_id');
      if (!pc.differential_id) pcMissing.push('differential_id');
      if (!pc.hypothesis_id) pcMissing.push('hypothesis_id');
    }
    if (pcMissing.length > 0) {
      failures.push({
        code: 'INCOMPLETE_PROVENANCE_CHAIN',
        message: `provenance_chain missing required fields: ${pcMissing.join(', ')}`,
      });
    }

    // ── Check 14: authorization context must be explicitly set ───────────────
    if (
      !contract.authorization_context ||
      typeof contract.authorization_context.requires_authorized_assessment !== 'boolean'
    ) {
      failures.push({
        code: 'MISSING_AUTHORIZATION_CONTEXT',
        message: 'authorization_context.requires_authorized_assessment must be explicitly set as a boolean',
      });
    }

    // ── Check 15: intelligence engine identity non-empty ─────────────────────
    // Mirrors Rust check 3: intel.engine_id and run_id must not be empty
    if (
      !contract.intelligence?.engine_id ||
      contract.intelligence.engine_id.trim().length === 0
    ) {
      failures.push({
        code: 'MISSING_ENGINE_ID',
        message: 'intelligence.engine_id must be non-empty',
      });
    }
    if (
      !contract.intelligence?.run_id ||
      contract.intelligence.run_id.trim().length === 0
    ) {
      failures.push({
        code: 'MISSING_ENGINE_RUN_ID',
        message: 'intelligence.run_id must be non-empty',
      });
    }

    // ── Check 16: canonical_domain non-empty ─────────────────────────────────
    // Mirrors Rust check 4: organization.canonical_domain must not be empty
    if (
      !contract.organization?.canonical_domain ||
      contract.organization.canonical_domain.trim().length === 0
    ) {
      failures.push({
        code: 'MISSING_CANONICAL_DOMAIN',
        message: 'organization.canonical_domain must be non-empty',
      });
    }

    // ── Check 17: resource entry_point_id non-empty ──────────────────────────
    // Mirrors Rust check 5: affected_resource.entry_point_id must not be empty
    if (
      !contract.affected_resource?.entry_point_id ||
      contract.affected_resource.entry_point_id.trim().length === 0
    ) {
      failures.push({
        code: 'MISSING_ENTRY_POINT_ID',
        message: 'affected_resource.entry_point_id must be non-empty',
      });
    }

    // ── Check 18: evidence_origin non-empty ──────────────────────────────────
    // Mirrors Rust check 9: evidence_origin must not be empty
    for (const ref of contract.evidence_refs ?? []) {
      if (!ref.evidence_origin || ref.evidence_origin.trim().length === 0) {
        failures.push({
          code: 'MISSING_EVIDENCE_ORIGIN',
          message: `evidence_id '${ref.evidence_id}' has empty evidence_origin`,
        });
      }
    }

    // ── Check 19: provenance_chain observation_ids non-empty ─────────────────
    // Mirrors Rust check 13: observation_ids must not be empty
    if (
      !contract.provenance_chain?.observation_ids ||
      contract.provenance_chain.observation_ids.length === 0
    ) {
      failures.push({
        code: 'MISSING_OBSERVATION_IDS',
        message: 'provenance_chain.observation_ids must contain at least one entry',
      });
    }

    // ── Check 20: provenance_chain verification_contract_id non-empty ──────────
    // Mirrors Rust check 15: verification_contract_id must not be empty
    if (
      !contract.provenance_chain?.verification_contract_id ||
      contract.provenance_chain.verification_contract_id.trim().length === 0
    ) {
      failures.push({
        code: 'MISSING_VERIFICATION_CONTRACT_ID',
        message: 'provenance_chain.verification_contract_id must be non-empty',
      });
    }

    // ── Check 21: decision_candidate must be SEAL_VERIFIED_FINDING ────────────
    // Mirrors Rust check 19: action_type must be in allowed_actions.
    // The canonical allowlist is externalized in F-003; here we verify
    // the TS-side contract before delegating to Q-Core authority evaluation.
    if (contract.decision_candidate !== 'SEAL_VERIFIED_FINDING') {
      failures.push({
        code: 'UNAUTHORIZED_ACTION',
        message: `decision_candidate '${contract.decision_candidate}' is not an authorized action type`,
      });
    }

    // ── Check 22: policy_reference must be canonical policy ID ────────────────
    // Mirrors Rust check 20: policy_reference must be in allowed_policies.
    // The canonical policy ID is externalized in F-003.
    if (contract.policy_reference !== 'VARDHAN_CORE_INTELLIGENCE_POLICY_V1') {
      failures.push({
        code: 'UNKNOWN_POLICY_REFERENCE',
        message: `policy_reference '${contract.policy_reference}' is not a registered policy`,
      });
    }

    return {
      passed: failures.length === 0,
      failures,
      checked_at: new Date().toISOString(),
    };
  }
}
