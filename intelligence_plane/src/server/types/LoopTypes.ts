/**
 * VARDHAN Autonomous Loop Types
 * Defines the state machine and decision structures for the adaptive research loop.
 */

export type ResearchState =
  | 'START'
  | 'RESOLVED'
  | 'MAPPED'
  | 'EVIDENCE_FOUND'
  | 'VERIFIED'
  | 'OWNER_FOUND'
  | 'OUTREACH_READY'
  | 'NO_GO'
  | 'RESEARCH_MORE';

export type VoIActionType =
  | 'IDENTITY_RESOLVE'
  | 'BROAD_SURFACE_MAPPING'
  | 'TARGETED_DISCOVERY'
  | 'LIVE_VERIFICATION'
  | 'OWNER_RESOLUTION'
  | 'CONTACT_DISCOVERY'
  | 'FINAL_DECISION'
  | 'STOP'
  | 'GITHUB_RESOLVE_ORG'
  | 'GITHUB_DISCOVER_REPOSITORIES'
  | 'GITHUB_OBSERVE_REPOSITORY'
  | 'GITHUB_COMPARE_TEMPORAL_STATE'
  | 'GITHUB_EXPAND_FROM_SIGNAL';

export interface VoIAction {
  action: VoIActionType;
  target?: string;
  rationale: string;
  expectedGain: 'CONFIDENCE_BOOST' | 'FINDING_VALIDATION' | 'OWNER_VERIFICATION' | 'IDENTITY_NORMALIZATION' | 'CORRELATION_CONFIDENCE' | 'TEMPORAL_INTEL';
}

export interface Signal {
  id: string;
  type: string; // e.g., 'INFRA_MIGRATION', 'LATENCY_SPIKE'
  strength: number; // 0 to 1
  provenance: string; // Evidence ID
  timestamp: Date;
}

export interface ResearchHistoryEntry {
  timestamp: Date;
  state: ResearchState;
  action: VoIAction;
  result: 'SUCCESS' | 'FAILURE' | 'NO_NEW_INFO';
  observation?: string;
}
