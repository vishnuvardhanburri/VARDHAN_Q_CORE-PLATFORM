import type { IcpContext, IcpQualification, IcpDimension } from './IcpQualificationEngine.ts';
import type { CompanySurface, Evidence, FindingClassification } from './IntelligenceCase.ts';

export interface BankOpportunity {
  institutionName: string;
  jurisdiction: string;
  problem: string;
  source: {
    title: string;
    url: string;
    date: string;
  };
  evidenceExcerpt: string;
  isInstitutionSpecific: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  fitCapability: 'Vardhan Intelligence' | 'Q Core' | 'Quantum Trust Fabric';
  valueProposition: string;
  diagnosticScope: string;
  procurementRoute: string | 'unknown';
  failureReason: string;
  nextAction: string;
}

export interface BankOpportunityScore {
  evidenceStrength: number;
  urgency: number;
  productFit: number;
  accessPlausibility: number;
  totalScore: number;
}

export class BankOpportunityEngine {
  static async qualify(
    institution: string, 
    problem: string, 
    source: any, 
    evidence: string, 
    jurisdiction: string
  ): Promise<{ opportunity: BankOpportunity | null, score: BankOpportunityScore | null }> {
    
    // 1. Evidence Strength (0-3)
    let evidenceStrength = 0;
    if (source.url && source.title) evidenceStrength = 1;
    if (evidence.length > 100 && evidence.includes('quantum')) evidenceStrength = 2;
    if (evidence.includes('migration') || evidence.includes('cryptographic')) evidenceStrength = 3;

    // 2. Urgency (0-3)
    let urgency = 0;
    const urgentKeywords = ['deadline', 'regulatory', 'mandatory', 'risk', 'urgent', 'transition'];
    if (urgentKeywords.some(k => evidence.toLowerCase().includes(k))) urgency = 3;
    else if (evidence.toLowerCase().includes('planning')) urgency = 1;

    // 3. Product Fit (0-3)
    let productFit = 0;
    let capability = 'Vardhan Intelligence';
    let valueProp = 'General quantum risk discovery';

    if (evidence.toLowerCase().includes('verification') || evidence.toLowerCase().includes('trust')) {
      productFit = 3;
      capability = 'Quantum Trust Fabric';
      valueProp = 'Cryptographically verifiable migration passports for bank trust';
    } else if (evidence.toLowerCase().includes('inventory') || evidence.toLowerCase().includes('crypto-agility')) {
      productFit = 2;
      capability = 'Q Core';
      valueProp = 'Automated cryptographic inventory and migration orchestration';
    } else if (evidence.toLowerCase().includes('assessment') || evidence.toLowerCase().includes('gap')) {
      productFit = 1;
      capability = 'Vardhan Intelligence';
      valueProp = 'Deep surface discovery of quantum-exposed assets';
    }

    // 4. Access Plausibility (0-3)
    let access = 0;
    if (evidence.toLowerCase().includes('partnership') || evidence.toLowerCase().includes('tender')) access = 3;
    else if (evidence.toLowerCase().includes('api') || evidence.toLowerCase().includes('portal')) access = 2;
    else access = 1;

    const totalScore = evidenceStrength + urgency + productFit + access;

    // Threshold for qualification
    if (totalScore < 5) return { opportunity: null, score: null };

    const opportunity: BankOpportunity = {
      institutionName: institution,
      jurisdiction: jurisdiction,
      problem: problem,
      source: {
        title: source.title || 'Unknown Source',
        url: source.url || 'Unknown URL',
        date: source.date || 'Unknown Date',
      },
      evidenceExcerpt: evidence,
      isInstitutionSpecific: true,
      confidence: evidenceStrength >= 3 ? 'HIGH' : (evidenceStrength >= 2 ? 'MEDIUM' : 'LOW'),
      fitCapability: capability,
      valueProposition: valueProp,
      diagnosticScope: `A £15k diagnostic to map ${capability} fit against current ${problem} gap.`,
      procurementRoute: 'unknown',
      failureReason: 'High incumbent competition or internal sovereign capability',
      nextAction: 'Identify specific CISO or Quantum Program Lead via LinkedIn/Company Registry',
    };

    return {
      opportunity,
      score: {
        evidenceStrength,
        urgency,
        productFit,
        accessPlausibility: access,
        totalScore
      }
    };
  }
}
