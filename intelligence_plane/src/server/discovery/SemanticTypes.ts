export type FunctionalRole = 
  | 'DOCUMENTATION' 
  | 'AUTHENTICATION' 
  | 'APPLICATION' 
  | 'API' 
  | 'ADMINISTRATION' 
  | 'STATUS' 
  | 'DEVELOPER' 
  | 'STORAGE' 
  | 'FILE' 
  | 'SERVICE' 
  | 'DEMO' 
  | 'LEGACY' 
  | 'UNKNOWN';

export type AuthExpectation = 
  | 'AUTH_EXPECTED' 
  | 'AUTH_NOT_EXPECTED' 
  | 'AUTH_UNKNOWN';

export type SurfaceRelationshipType = 
  | 'USES' 
  | 'PROTECTS' 
  | 'MANAGES' 
  | 'AUTHENTICATES' 
  | 'DOCUMENTS' 
  | 'REPLACES' 
  | 'DEPENDS_ON' 
  | 'EXPOSES_FUNCTION' 
  | 'RELATED_TO';

export interface SurfaceRelationship {
  sourceSurfaceId: string;
  targetSurfaceId: string;
  type: SurfaceRelationshipType;
  evidenceIds: string[];
  rationale: string;
}

export interface SurfaceSemanticAssessment {
  surfaceId: string;
  surfaceType: string;
  functionalRole: FunctionalRole;
  organizationAttribution: string;
  ownershipEvidence: string[];
  currentState: string;
  recency: string;
  expectedBehavior: string;
  authExpectation: AuthExpectation;
  boundaryType: string;
  evidenceIds: string[];
  confidence: number;
  unknowns: string[];
}

export interface ExposureAssessment {
  surfaceId: string;
  exposureType: string;
  capabilityState: string;
  evidenceIds: string[];
  rationale: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW' | 'NO_ACTION';
}

export interface ExternalExposurePath {
  entrySurface: string;
  trustBoundary: string;
  publicBehavior: string;
  relatedService: string;
  relatedData: string;
  evidenceIds: string[];
  capabilityState: string;
}

export type OpportunityDecisionState = 
  | 'VERIFIED_FINDING' 
  | 'ADVISORY_OPPORTUNITY' 
  | 'INVESTIGATION_OPPORTUNITY' 
  | 'MONITOR' 
  | 'RESEARCH_MORE' 
  | 'NO_ACTIONABLE_SIGNAL' 
  | 'REJECT';

export interface OpportunityDecision {
  state: OpportunityDecisionState;
  reason: string;
  supportingEvidenceIds: string[];
  missingEvidence?: string[];
  recommendedResearch?: string[];
  decisionTimeline: string;
  confidence: number;
  commercialRelevance: string;
}

export interface OpportunityEvidencePacket {
  organization: string;
  domain: string;
  industryContext: string;
  keySignals: string[];
  supportingEvidence: string[];
  surfaceSummary: string;
  technicalContext: string;
  changeTimeline: string;
  hypotheses: any[];
  verificationStatus: string;
  decision: OpportunityDecision;
  decisionReason: string;
  uncertainties: string[];
  recommendedNextAction: string;
  sourceUrls: string[];
  provenance: string;
}
