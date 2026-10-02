export type EntityType = 
  | 'COMPUTE' | 'WORKLOAD' | 'CONTROL' | 'DATA' 
  | 'NETWORK' | 'PLATFORM' | 'ARCHITECTURE' | 'SECURITY' 
  | 'TECHNICAL_CHANGE' | 'IDENTITY';

export interface TechnicalEntity {
  entityId: string;
  entityType: EntityType;
  canonicalLabel: string;
  contextSnippet: string;
  evidenceIds: string[];
  sourceUrls: string[];
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  subjectAttribution: string;
}

export interface TechnicalRelationship {
  relationshipId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: 'SUPPORTS' | 'EXECUTED_BY' | 'CONTROLLED_BY' | 'DEPENDS_ON' | 'MIGRATED_TO' | 'EXPANDS';
  evidenceIds: string[];
  rationale: string;
}
