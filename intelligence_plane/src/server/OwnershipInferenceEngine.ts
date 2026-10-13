/**
 * VARDHAN — OWNERSHIP INFERENCE ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 * The "Brain" of the Owner Intelligence Engine.
 */

import type { 
  OwnerSearchPlan, 
  PersonEvidence, 
  EvidenceLedger, 
  DeepOwner, 
  OwnerConfidence 
} from './DeepTypes';

export class OwnershipInferenceEngine {
  private static readonly WEIGHTS = {
    IDENTITY: 1.0,
    ROLE: 0.8,
    TECHNICAL_RELEVANCE: 1.2,
    OWNERSHIP: 1.5,
    EMPLOYMENT: 1.0,
    CONTACTABILITY: 0.5
  };

  static scoreCandidate(
    candidate: any, 
    ledger: EvidenceLedger, 
    plan: OwnerSearchPlan
  ): { score: number; dimensions: Record<string, number> } {
    const dimensions: Record<string, number> = {
      IDENTITY: this.scoreIdentity(candidate, ledger),
      ROLE: this.scoreRole(candidate, plan),
      TECHNICAL_RELEVANCE: this.scoreTechnicalRelevance(candidate, ledger, plan),
      OWNERSHIP: this.scoreOwnership(candidate, ledger),
      EMPLOYMENT: this.scoreEmployment(candidate, ledger),
      CONTACTABILITY: this.scoreContactability(candidate)
    };

    if (dimensions.EMPLOYMENT < 0.4) {
      return { score: 0, dimensions }; 
    }

    if (dimensions.TECHNICAL_RELEVANCE === 0) {
      return { score: Math.min(30, dimensions.ROLE * 10), dimensions };
    }

    let weightedSum = 0;
    for (const [dim, score] of Object.entries(dimensions)) {
      const weight = (this.WEIGHTS as any)[dim] || 1.0;
      weightedSum += score * weight;
    }

    const maxPossible = Object.values(this.WEIGHTS).reduce((a, b) => a + b, 0);
    const normalizedScore = (weightedSum / maxPossible) * 100;

    return {
      score: Math.min(100, normalizedScore),
      dimensions
    };
  }

  private static scoreIdentity(candidate: any, ledger: EvidenceLedger): number {
    const sources = new Set(ledger.claims
      .filter(c => c.claim.includes(candidate.name))
      .map(c => c.source_type));
    if (sources.size >= 3) return 1.0;
    if (sources.size === 2) return 0.7;
    if (sources.size === 1) return 0.4;
    return 0;
  }

  private static scoreRole(candidate: any, plan: OwnerSearchPlan): number {
    const role = (candidate.role || '').toLowerCase();
    if (plan.role_personas.some(p => role === p.toLowerCase())) return 1.0;
    if (plan.role_personas.some(p => role.includes(p.toLowerCase()))) return 0.6;
    return 0.2;
  }

  private static scoreTechnicalRelevance(candidate: any, ledger: EvidenceLedger, plan: OwnerSearchPlan): number {
    const relevantClaims = ledger.claims.filter(c => 
      c.claim.includes(candidate.name) && 
      plan.technical_keywords.some(kw => c.claim.toLowerCase().includes(kw.toLowerCase()))
    );
    if (relevantClaims.length >= 2) return 1.0;
    if (relevantClaims.length === 1) return 0.5;
    return 0;
  }

  private static scoreOwnership(candidate: any, ledger: EvidenceLedger): number {
    const ownershipClaims = ledger.claims.filter(c => 
      c.claim.includes(candidate.name) && 
      /owner|lead|maintainer|architect/i.test(c.claim)
    );
    if (ownershipClaims.length > 0) return 1.0;
    return 0;
  }

  private static scoreEmployment(candidate: any, ledger: EvidenceLedger): number {
    const employmentClaims = ledger.claims.filter(c => 
      c.claim.includes(candidate.name) && 
      ['OFFICIAL_COMPANY_SOURCE', 'TECHNICAL_SURFACE', 'OSS_GITHUB'].includes(c.source_type)
    );

    if (employmentClaims.length === 0) return 0;

    const sortedClaims = employmentClaims.sort((a, b) => 
      new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime()
    );
    
    const latest = sortedClaims[0];
    const obsDate = new Date(latest.observed_at);
    const now = new Date();
    const diffDays = (now.getTime() - obsDate.getTime()) / (1000 * 60 * 60 * 24);
    
    if (diffDays < 180) return 1.0;
    if (diffDays < 365) return 0.6;
    return 0.2;
  }

  private static scoreContactability(candidate: any): number {
    if (candidate.email || candidate.linkedin_url) return 1.0;
    return 0;
  }

  static resolveConfidence(score: number, contactable: boolean): OwnerConfidence {
    if (score > 85 && contactable) return 'OWNER_VERIFIED_CONTACTABLE';
    if (score > 85) return 'OWNER_HIGH_CONFIDENCE';
    if (score > 60) return 'OWNER_VERIFIED';
    if (score > 30) return 'POSSIBLE_OWNER';
    return 'NO_OWNER_FOUND';
  }
}
