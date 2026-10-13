import { Evidence, Provenance } from '../IntelligenceCase';

export type SpecialistTaskType = 
  | 'COMPANY_UNDERSTANDING'
  | 'PRODUCT_UNDERSTANDING'
  | 'TECHNOLOGY_FOOTPRINT'
  | 'PUBLIC_TECHNICAL_SURFACES'
  | 'ENGINEERING_EVIDENCE'
  | 'RECENT_TECHNICAL_CHANGES'
  | 'INCIDENT_RELIABILITY'
  | 'INFRASTRUCTURE_ARCHITECTURE'
  | 'DEVELOPER_API'
  | 'COMMUNITY_TECHNICAL_DISCUSSION';

export interface SpecialistResult {
  taskType: SpecialistTaskType;
  evidence: Evidence[];
  gaps: string[];
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
}

export interface SpecialistInput {
  companyId: string;
  companyName: string;
  domain: string;
}
