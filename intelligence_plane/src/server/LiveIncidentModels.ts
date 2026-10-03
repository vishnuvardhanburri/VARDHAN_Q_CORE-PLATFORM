/**
 * VARDHAN — LIVE INCIDENT MODELS
 * ─────────────────────────────────────────────────────────────────────────────
 * Structured models for tracking live technical events and their
 * correlation to target companies.
 */

import { Provenance } from './IntelligenceCase';

export type LiveEventType =
  | 'SERVICE_OUTAGE'
  | 'PERFORMANCE_DEGRADATION'
  | 'SECURITY_INCIDENT'
  | 'MAINTENANCE_WINDOW'
  | 'API_BREAKAGE'
  | 'REGIONAL_FAILURE';

export type BehavioralMarkerOperator = 'EQUALS' | 'GREATER_THAN' | 'CONTAINS';

export interface BehavioralMarker {
  type: 'STATUS_CODE' | 'LATENCY' | 'TEXT_MATCH';
  value: any;
  operator: BehavioralMarkerOperator;
}

export interface LiveTechnicalEvent {
  id: string;
  source: string;
  sourceUrl: string;
  eventType: LiveEventType;
  provider: string;        // e.g., 'Supabase', 'AWS', 'Cloudflare'
  component?: string;       // e.g., 'Postgres', 'Edge Functions', 'S3'
  symptom: string;          // e.g., 'Increased latency in us-east-1'
  signature?: BehavioralMarker[]; // High-precision behavioral signature
  affectedRegion?: string;
  startedAt?: string;       // ISO timestamp
  resolvedAt?: string;      // ISO timestamp
  observedAt: string;       // When VARDHAN detected it
  provenance: Provenance;
}

export type DependencyConfidence =
  | 'KNOWN_DEPENDENCY'     // Explicitly stated in docs/code
  | 'LIKELY_DEPENDENCY'    // Strong patterns/headers/SaaS signatures
  | 'POSSIBLE_DEPENDENCY'  // Generic mentions or common industry patterns
  | 'UNKNOWN';

export interface TargetExposure {
  targetCompany: string;
  dependency: string;       // The provider/component being tracked
  confidence: DependencyConfidence;
  exposureEvidence: string[]; // IDs or snippets of evidence proving the link
  provenance: Provenance[];
}

export type TemporalRelation =
  | 'CURRENT'     // Incident is ongoing and target is currently observed as affected
  | 'RECENT'     // Incident just happened, target was affected
  | 'HISTORICAL' // Incident happened in the past
  | 'RESOLVED'   // Incident is over, target recovered
  | 'UNKNOWN';

export type TemporalMatch = 'EXACT' | 'OVERLAPPING' | 'NEARBY' | 'MISMATCHED' | 'UNKNOWN';
export type RegionalMatch = 'EXACT' | 'RELATED' | 'UNKNOWN' | 'MISMATCHED';
export type ComponentMatch = 'EXACT' | 'RELATED' | 'UNKNOWN' | 'MISMATCHED';

export interface AffectedTargetCandidate {
  id: string;
  targetCompany: string;
  dependency: string;
  dependencyConfidence: DependencyConfidence;
  liveEvent: LiveTechnicalEvent;
  temporalRelation: TemporalRelation;
  exposureEvidence: string[];
  verificationTarget: string;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REFUTED' | 'INCONCLUSIVE';
  provenance: Provenance;
  expectation_id?: string;
  differential_id?: string;
  hypothesis_id?: string;
}

export interface VerificationReport {
  provider_event: string;
  target: string;
  target_id?: string;
  target_canonical_domain?: string;
  dependency: string;
  target_surface: string;
  signature: BehavioralMarker[];
  target_observation: any;
  control_observation?: any;
  temporal_match: TemporalMatch;
  regional_match: RegionalMatch;
  component_match: ComponentMatch;
  differential_result: string;
  final_status: 'VERIFIED' | 'REFUTED' | 'INCONCLUSIVE';
  reason: string;
  hypothesis_id?: string;
  expectation_id?: string;
}
// End of file
