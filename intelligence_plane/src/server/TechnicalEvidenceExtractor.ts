/**
 * VARDHAN — TECHNICAL EVIDENCE EXTRACTOR
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces "Signal Regex" with a structured extraction layer.
 * Flow: Evidence -> TechnicalEvidenceExtractor -> TechnicalEvidence[] -> SignalCandidates
 * 
 * This layer separates the RAW SOURCE TEXT from the STRUCTURED TECHNICAL FACT.
 */

import { 
  Evidence, 
  SignalSourceType, 
  EvidenceProvenance, 
  SignalStrength 
} from './IntelligenceCase';
import { 
  TechnicalEvidence, 
  TechnicalFactType 
} from './TechnicalEvidence';
import { extractorRegistry } from './extractors/ExtractorRegistry';
import { 
  SignalCandidate, 
  DeepSignalExtractor 
} from './DeepSignalExtractor';

export class TechnicalEvidenceExtractor {
  /**
   * Process a piece of evidence into structured technical facts.
   */
  static extractFacts(evidence: Evidence): TechnicalEvidence[] {
    const facts: TechnicalEvidence[] = [];
    const rawContent = evidence.raw_observation || evidence.evidence_text || '';
    
    // 1. Use Source-Specific Extractors for initial structured observations
    const extractor = extractorRegistry.getExtractor(evidence.source_type);
    const observations = extractor ? extractor.extract(rawContent, evidence.public_url, {}) : [];
    
    for (const obs of observations) {
      facts.push(this.mapObservationToFact(obs, evidence));
    }

    // 2. Supplemental Generic Fact Extraction (Behavioral/Structural)
    // Here we would add logic to detect Architecture, Constraints, etc. 
    // that generic extractors might miss.
    
    return facts;
  }

  private static mapObservationToFact(obs: any, evidence: Evidence): TechnicalEvidence {
    // Map a generic observation type to a TechnicalFactType
    let factType: TechnicalFactType = 'OBSERVATION';
    
    const type = obs.type.toLowerCase();
    if (type.includes('incident') || type.includes('outage')) factType = 'INCIDENT';
    else if (type.includes('hiring') || type.includes('role')) factType = 'ARCHITECTURE'; // Hiring signals reflect architecture needs
    else if (type.includes('api') || type.includes('doc')) factType = 'ARCHITECTURE';
    
    return {
      id: `fact_${Math.random().toString(36).substr(2, 9)}`,
      fact_type: factType,
      fact_value: obs.type, 
      raw_snippet: obs.raw_text,
      confidence: obs.confidence || 0.5,
      timestamp: evidence.retrieved_at,
      source_url: evidence.public_url,
      metadata: obs.metadata || {}
    };
  }

  /**
   * Bridges the gap between Structured Facts and Signal Candidates.
   * This allows us to apply "Proof Contracts" to the facts before creating signals.
   */
  static generateCandidates(facts: TechnicalEvidence[], evidence: Evidence): SignalCandidate[] {
    // We delegate the actual mapping to the DeepSignalExtractor's logic 
    // but we feed it the purified technical facts instead of raw observations.
    
    const mockObservations = facts.map(f => ({
      type: f.fact_type,
      raw_text: f.raw_snippet,
      url: f.source_url,
      category: evidence.provenance?.classification
    }));

    return DeepSignalExtractor.extractCandidates(
      mockObservations, 
      [evidence], 
      { onCandidate: () => {} }
    );
  }
}
