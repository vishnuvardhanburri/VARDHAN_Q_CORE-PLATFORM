/**
 * VARDHAN — TRUST BOUNDARY VALIDATOR
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs 14 independent validation checks on a VerifiedFindingContract
 * BEFORE it is transmitted to Q-Core.
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

    return {
      passed: failures.length === 0,
      failures,
      checked_at: new Date().toISOString(),
    };
  }
}
