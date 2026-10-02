import { OpportunityDetector, EngineeringOpportunity, OpportunityType } from './OpportunityDetector';
import { Evidence, DeepSignal } from '../IntelligenceCase';

export interface QualityOpportunity extends EngineeringOpportunity {
  opportunity_id: string;
  company_id: string;
  technical_area: string;
  title: string;
  description: string;
  signal_ids: string[];
  correlation_ids: string[];
  evidence_ids: string[];
  source_types: string[];
  source_count: number;
  independent_source_count: number;
  freshness: {
    published_at?: string;
    observed_at?: string;
    ageDays: number | null;
    score: number; // 0.0 to 1.0
  };
  confidence: {
    evidence_confidence: 'LOW' | 'MEDIUM' | 'HIGH';
    technical_confidence: 'LOW' | 'MEDIUM' | 'HIGH';
    opportunity_confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  };
  why_now: string[];
  unknowns: string[];
  verification_status: 'NOT_JUSTIFIED' | 'PENDING' | 'VERIFIED' | 'NOT_VERIFIED' | 'INCONCLUSIVE';
}

export class OpportunityQualityEngine {
  static refine(
    rawOpportunities: EngineeringOpportunity[],
    signals: DeepSignal[],
    evidence: Evidence[],
    companyId: string
  ): QualityOpportunity[] {
    const refined: QualityOpportunity[] = [];

    for (const raw of rawOpportunities) {
      console.log(`\n[QualityEngine] Refining opportunity: ${raw.title}`);
      
      const supportingSignals = signals.filter(s => raw.signalIds.includes(s.signal_id));
      const uniqueSources = new Set(supportingSignals.map(s => s.source_url)).size;
      
      console.log(`  - Signals matched: ${supportingSignals.length}`);
      console.log(`  - Unique sources: ${uniqueSources}`);

      const isPrimarySource = supportingSignals.some(s => 
        s.source_url.includes('status') || s.source_url.includes('blog') || s.source_url.includes('github.com')
      );

      if (uniqueSources < 2 && !(isPrimarySource && supportingSignals.length >= 2)) {
        console.log(`  ❌ Filtered: Insufficient source diversity (Unique: ${uniqueSources}, Primary: ${isPrimarySource})`);
        continue;
      }

      const freshestSignal = supportingSignals.sort((a, b) => {
        const da = a.published_at ? new Date(a.published_at).getTime() : 0;
        const db = b.published_at ? new Date(b.published_at).getTime() : 0;
        return db - da;
      })[0];

      let ageDays = null;
      let freshnessScore = 0.5;
      if (freshestSignal?.published_at) {
        const diff = Date.now() - new Date(freshestSignal.published_at).getTime();
        ageDays = Math.round(diff / (1000 * 60 * 60 * 24));
        if (ageDays < 30) freshnessScore = 1.0;
        else if (ageDays < 180) freshnessScore = 0.6;
        else freshnessScore = 0.2;
      }

      const whyNow = this.deriveWhyNow(supportingSignals, evidence);
      
      const evidenceConf = uniqueSources >= 3 ? 'HIGH' : uniqueSources >= 2 ? 'MEDIUM' : 'LOW';
      const techConf = raw.confidence === 'HIGH' ? 'HIGH' : raw.confidence === 'MEDIUM' ? 'MEDIUM' : 'LOW';
      
      let oppConf: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
      if (evidenceConf === 'HIGH' && techConf === 'HIGH') oppConf = 'HIGH';
      else if (evidenceConf === 'MEDIUM' || techConf === 'MEDIUM') oppConf = 'MEDIUM';

      refined.push({
        ...raw,
        opportunity_id: raw.opportunity_id,
        company_id: companyId,
        technical_area: raw.technicalArea,
        title: raw.title,
        description: raw.reasons.join(' '),
        signal_ids: raw.signalIds,
        correlation_ids: [],
        evidence_ids: raw.evidenceIds,
        source_types: supportingSignals.map(s => s.type),
        source_count: supportingSignals.length,
        independent_source_count: uniqueSources,
        freshness: {
          published_at: freshestSignal?.published_at,
          observed_at: new Date().toISOString(),
          ageDays,
          score: freshnessScore
        },
        confidence: {
          evidence_confidence: evidenceConf,
          technical_confidence: techConf,
          opportunity_confidence: oppConf
        },
        why_now: whyNow,
        unknowns: raw.unknowns,
        verification_status: 'NOT_JUSTIFIED'
      });
    }

    return refined;
  }

  private static deriveWhyNow(signals: DeepSignal[], evidence: Evidence[]): string[] {
    const reasons: string[] = [];
    const text = signals.map(s => s.excerpt).join(' ').toLowerCase();
    if (text.includes('migration') || text.includes('migrate')) reasons.push('Active architectural migration detected.');
    if (text.includes('hiring') || text.includes('expanding')) reasons.push('Relevant technical team expansion.');
    if (text.includes('incident') || text.includes('outage')) reasons.push('Recent reliability incidents suggesting pressure.');
    if (text.includes('release') || text.includes('launched')) reasons.push('Recent major technical release.');
    return reasons;
  }
}
