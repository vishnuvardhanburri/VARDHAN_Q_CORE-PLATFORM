import { CompanyResearchContext } from '../CompanyResearchContext';
import { Evidence, Provenance, EvidenceClassification } from '../IntelligenceCase';
import { SpecialistResult, SpecialistInput, SpecialistTaskType } from './SpecialistTypes';

export abstract class BaseSpecialist {
  abstract readonly taskType: SpecialistTaskType;

  async execute(input: SpecialistInput, context: CompanyResearchContext): Promise<SpecialistResult> {
    try {
      const evidence = await this.collectEvidence(input, context);
      return {
        taskType: this.taskType,
        evidence,
        gaps: this.identifyGaps(evidence),
        status: evidence.length > 0 ? 'SUCCESS' : 'PARTIAL'
      };
    } catch (e) {
      console.error(`[Specialist ${this.taskType}] Execution failed:`, e);
      return {
        taskType: this.taskType,
        evidence: [],
        gaps: [`Error during execution: ${String(e)}`],
        status: 'FAILED'
      };
    }
  }

  protected abstract collectEvidence(input: SpecialistInput, context: CompanyResearchContext): Promise<Evidence[]>;

  protected identifyGaps(evidence: Evidence[]): string[] {
    return evidence.length === 0 ? [`No evidence found for ${this.taskType}`] : [];
  }

  protected createEvidence(
    url: string,
    observation: string,
    classification: EvidenceClassification,
    sourceType: any,
    attribution: string,
    uncertainty: string = 'LOW'
  ): Evidence {
    return {
      id: `ev_${Math.random().toString(36).substr(2, 9)}`,
      public_url: url,
      source_url: url,
      source_type: sourceType,
      classification,
      provenance: {
        source_url: url,
        canonical_url: url,
        source_type: sourceType,
        discovery_mechanism: 'SEARCH',
        retrieval_timestamp: new Date().toISOString(),
        provider: 'VARDHAN_SPECIALIST',
        attribution: attribution,
        classification: classification,
      },
      evidence_origin: 'REAL_PUBLIC_OBSERVATION',
      retrieved_at: new Date().toISOString(),
      factualObservation: observation,
      observed_behavior: observation,
      evidence_text: observation,
      uncertainty,
      observed_at: new Date().toISOString(),
    } as any;
  }
}
