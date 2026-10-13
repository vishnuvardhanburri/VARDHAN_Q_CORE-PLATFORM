export type EntryPointClass = 
  | 'PUBLIC_API' 
  | 'PUBLIC_AUTH' 
  | 'PUBLIC_SSO' 
  | 'PUBLIC_ADMIN' 
  | 'PUBLIC_DEVELOPER' 
  | 'PUBLIC_STORAGE' 
  | 'PUBLIC_FILE' 
  | 'PUBLIC_SERVICE' 
  | 'PUBLIC_REMOTE_ACCESS' 
  | 'PUBLIC_STATUS' 
  | 'PUBLIC_APPLICATION' 
  | 'PUBLIC_CLOUD_RESOURCE' 
  | 'PUBLIC_STREAM';

export type TrustBoundary = 
  | 'AUTHENTICATION' 
  | 'AUTHORIZATION' 
  | 'TENANT_ISOLATION' 
  | 'ROLE_BOUNDARY' 
  | 'NETWORK_BOUNDARY' 
  | 'SERVICE_BOUNDARY' 
  | 'DATA_BOUNDARY' 
  | 'ADMINISTRATIVE_BOUNDARY' 
  | 'ENVIRONMENT_BOUNDARY';

export type CapabilityState = 
  | 'PUBLIC_REACHABILITY_ONLY' 
  | 'ENTRY_POINT_IDENTIFIED' 
  | 'EXPOSURE_INDICATED' 
  | 'CAPABILITY_INDICATED' 
  | 'CAPABILITY_UNVERIFIED' 
  | 'VERIFIED_CAPABILITY' 
  | 'AUTHORIZATION_REQUIRED' 
  | 'NOT_SUPPORTED';

export type AuthorizationState = 
  | 'NOT_REQUIRED' 
  | 'REQUIRED' 
  | 'AUTHORIZED' 
  | 'EXPIRED' 
  | 'OUT_OF_SCOPE';

export type AuthModel = 
  | 'AUTH_MODEL_KNOWN' 
  | 'AUTH_MODEL_UNKNOWN' 
  | 'AUTH_REQUIREMENT_UNCLEAR' 
  | 'AUTH_EXPECTED' 
  | 'AUTH_OBSERVED';

export type ConsistencyState = 
  | 'CONSISTENT' 
  | 'EXPECTED_PUBLIC' 
  | 'AUTH_MODEL_UNKNOWN' 
  | 'AUTH_BEHAVIOR_MISMATCH' 
  | 'DOCUMENTATION_BEHAVIOR_MISMATCH' 
  | 'HISTORICAL_ONLY' 
  | 'CONTRADICTED' 
  | 'INSUFFICIENT_EVIDENCE';

export interface BoundaryAssessment {
  surfaceId: string;
  boundaryType: TrustBoundary;
  authModel: AuthModel;
  consistencyState: ConsistencyState;
  exposureState: string;
  capabilityState: CapabilityState;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  unknowns: string[];
  provenance: string;
}
