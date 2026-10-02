export type SurfaceType = 
  | 'PUBLIC_WEB' 
  | 'PUBLIC_API' 
  | 'PUBLIC_AUTHENTICATION' 
  | 'PUBLIC_STATUS' 
  | 'PUBLIC_DOCUMENTATION' 
  | 'PUBLIC_DEVELOPER' 
  | 'PUBLIC_STORAGE_REFERENCE' 
  | 'PUBLIC_STATIC_ASSET' 
  | 'PUBLIC_SERVICE' 
  | 'PUBLIC_CLOUD_REFERENCE' 
  | 'PUBLIC_FILE' 
  | 'PUBLIC_STREAM' 
  | 'PUBLIC_DEMO'
  | 'PUBLIC_LEGACY_SURFACE';

export type ExposureType = 
  | 'PUBLIC_API' 
  | 'PUBLIC_AUTH_SURFACE' 
  | 'PUBLIC_ADMIN_SURFACE' 
  | 'PUBLIC_STORAGE_SURFACE' 
  | 'PUBLIC_DEVELOPER_SURFACE' 
  | 'PUBLIC_SERVICE_SURFACE' 
  | 'PUBLIC_CLOUD_HOST' 
  | 'PUBLIC_SUBDOMAIN' 
  | 'PUBLIC_FILE' 
  | 'PUBLIC_CONFIGURATION_SIGNAL' 
  | 'PUBLIC_DATA_EXPOSURE' 
  | 'PUBLIC_SECURITY_DISCLOSURE' 
  | 'PUBLIC_INCIDENT' 
  | 'PUBLIC_MISCONFIGURATION_SIGNAL';

export type DiscoveryState = 
  | 'SURFACE_DISCOVERED' 
  | 'IDENTITY_CONFIRMED' 
  | 'PUBLICLY_REACHABLE' 
  | 'DOCUMENTED' 
  | 'OBSERVATION_AVAILABLE' 
  | 'BOUNDARY_IDENTIFIED' 
  | 'AUTHORIZATION_REQUIRED' 
  | 'NO_SAFE_OBSERVATION' 
  | 'REJECTED';

export type ExpectationSource = 
  | 'EXPLICIT_DOCUMENTATION' 
  | 'EXPLICIT_SECURITY_STATEMENT' 
  | 'PUBLIC_ARCHITECTURE_EVIDENCE' 
  | 'PUBLIC_BEHAVIOR' 
  | 'MULTI_SOURCE_INFERENCE' 
  | 'UNKNOWN';

export interface Alias {
  alias: string;
  type: 'CANONICAL' | 'BRAND' | 'SUBSIDIARY' | 'PRODUCT' | 'INFRA' | 'DEV_PORTAL';
  provenance: string;
  sourceUrl: string;
}

export interface ExternalSurface {
  id: string;
  url: string;
  type: SurfaceType;
  exposure: ExposureType;
  provenance: string;
  sourceUrl: string;
  isVerified: boolean;
  discoveryState: DiscoveryState;
  expectationSource: ExpectationSource;
}
