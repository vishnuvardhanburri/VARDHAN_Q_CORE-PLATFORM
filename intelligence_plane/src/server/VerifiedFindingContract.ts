/**
 * VARDHAN — VERIFIED FINDING CONTRACT v1.0
 * ─────────────────────────────────────────────────────────────────────────────
 * The self-describing, versioned contract that must be populated by the
 * Intelligence Plane before any artifact crosses the Q-Core trust boundary.
 *
 * Q-Core independently validates this contract. A VERIFIED_FINDING label
 * on the Intelligence side is NOT sufficient. The contract must satisfy
 * Q-Core's own validation rules independently.
 *
 * Identity roles are explicitly separated:
 *   IntelligenceIdentity  — the engine that produced this finding
 *   OrganizationIdentity  — the customer org being assessed
 *   ResourceIdentity      — the specific affected technical resource
 *
 * These three identities must never be conflated.
 */

import { createHash } from 'crypto';
import type { Evidence } from './IntelligenceCase';

export const FINDING_CONTRACT_VERSION = '1.0';

// ── Separated Identity Roles ──────────────────────────────────────────────────

/** Identity of the Intelligence engine that produced this finding. */
export interface IntelligenceIdentity {
  /** Stable identifier for this intelligence engine instance. */
  engine_id: string;
  /** Semantic version of the Intelligence engine. */
  engine_version: string;
  /** Unique ID for this specific research run. */
  run_id: string;
}

/** Identity of the organisation being assessed. */
export interface OrganizationIdentity {
  /** Stable organisation identifier (not free text). */
  organization_id: string;
  /** Primary attributed domain. */
  canonical_domain: string;
}

/** Identity of the specific physical resource affected. */
export interface ResourceIdentity {
  /** Exact canonical URL of the affected resource. */
  canonical_url: string;
  /** Surface classification e.g. API_REST, WEBSITE_LOGIN. */
  surface_type: string;
  /** Stable entry-point identifier from the graph. */
  entry_point_id: string;
}

// ── Evidence Reference ────────────────────────────────────────────────────────

/**
 * A reference to a single evidence item with its content hash.
 * The hash allows Q-Core to detect tampering between submission and receipt.
 */
export interface EvidenceRef {
  evidence_id: string;
  public_url: string;
  temporal_status: 'CURRENT' | 'HISTORICAL';
  is_context_artifact: boolean;
  evidence_origin: string;
  /**
   * SHA-256 of the canonical evidence fingerprint:
   *   evidence_id | public_url | temporal_status | evidence_origin
   * Computed by computeEvidenceContentHash(). Never set manually.
   */
  content_hash: string;
}

// ── Provenance Chain ─────────────────────────────────────────────────────────

/**
 * The unbroken chain of artefact IDs from expectation to hypothesis.
 * Every link must be non-empty for the contract to be valid.
 */
export interface ProvenanceChain {
  /** The expectation that was violated. */
  expectation_id: string;
  /** Observation IDs that recorded the violation. */
  observation_ids: string[];
  /** The differential that triggered the hypothesis. */
  differential_id: string;
  /** The hypothesis that was subsequently verified. */
  hypothesis_id: string;
  /** The proof contract type used to verify the hypothesis. */
  verification_contract_id: string;
}

// ── Authorization Context ─────────────────────────────────────────────────────

/**
 * Explicit declaration of whether this finding requires authorized assessment
 * before any active verification or exploitation step.
 */
export interface AuthorizationContext {
  /** Must always be explicitly set — never inferred. */
  requires_authorized_assessment: boolean;
  /** Identity of the entity that granted authorization, if applicable. */
  authorized_by?: string;
  /** Scope of the granted authorization. */
  authorization_scope?: string;
}

// ── The Contract ─────────────────────────────────────────────────────────────

export interface VerifiedFindingContract {
  /** Must equal FINDING_CONTRACT_VERSION. */
  schema_version: string;
  /** Deterministic finding identifier. Must not be random. */
  finding_id: string;

  // Separated identities
  intelligence: IntelligenceIdentity;
  organization: OrganizationIdentity;
  affected_resource: ResourceIdentity;

  // Technical finding
  technical_area: string;
  technical_mechanism: string;
  expected_behavior: string;
  observed_behavior: string;
  /** Must be 'MISMATCH' or 'CONFIRMED_MISMATCH'. */
  differential_state: string;
  /** Must be HIGH, MEDIUM, or LOW. Never NONE or empty. */
  materiality: string;

  // Evidence
  evidence_refs: EvidenceRef[];

  // Unbroken provenance chain
  provenance_chain: ProvenanceChain;

  // Contradictions and uncertainty (must be explicit arrays, not omitted)
  contradictory_evidence_ids: string[];
  uncertainty: string[];
  benign_explanation: string;

  // Authorization
  authorization_context: AuthorizationContext;
  decision_candidate: string;
  policy_reference: string;


  // Temporal bounds
  created_at: string;
  evidence_earliest_retrieved_at: string;
  evidence_latest_retrieved_at: string;
}

// ── Canonical Hash ────────────────────────────────────────────────────────────

/**
 * Compute the stable content hash for one evidence item.
 * Same inputs always produce the same hash.
 * Used by TrustBoundaryValidator to detect tampering.
 */
export function computeEvidenceContentHash(e: Evidence): string {
  const canonical = [
    e.id,
    e.public_url,
    e.temporal_status ?? 'UNKNOWN',
    e.evidence_origin,
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}
