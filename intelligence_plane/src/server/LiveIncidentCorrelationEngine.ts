/**
 * VARDHAN — LIVE INCIDENT CORRELATION ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 * Correlates live technical events from the LiveSourceRegistry 
 * with target company exposures to generate hypotheses.
 */

import { 
  LiveTechnicalEvent, 
  TargetExposure, 
  AffectedTargetCandidate, 
  DependencyConfidence, 
  TemporalRelation 
} from './LiveIncidentModels';
import { 
  IntelligenceCase, 
  Evidence, 
  Provenance 
} from './IntelligenceCase';
import { LIVE_SOURCE_REGISTRY } from './LiveSourceRegistry';

export class LiveIncidentCorrelationEngine {
  /**
   * Core pipeline: Live Event -> Target Exposure -> Hypothesis
   */
  async correlate(
    event: LiveTechnicalEvent, 
    targets: IntelligenceCase[]
  ): Promise<AffectedTargetCandidate[]> {
    const candidates: AffectedTargetCandidate[] = [];

    for (const target of targets) {
      // 1. Check for Target Exposure
      const exposure = this.evaluateExposure(event, target);
      
      if (exposure.confidence === 'UNKNOWN') continue;

      // 2. Determine Temporal Relation
      const temporalRelation = this.calculateTemporalRelation(event);

      // 3. Identify Verification Target
      const verificationTarget = this.identifyVerificationTarget(event, target);

      // 4. Construct the Candidate
      candidates.push({
        id: `atc_${event.id}_${target.company.toLowerCase().replace(/\s+/g, '_')}`,
        targetCompany: target.company,
        dependency: event.provider,
        dependencyConfidence: exposure.confidence,
        liveEvent: event,
        temporalRelation: temporalRelation,
        exposureEvidence: exposure.exposureEvidence,
        verificationTarget: verificationTarget,
        verificationStatus: 'PENDING',
        provenance: {
          source_url: event.sourceUrl,
          canonical_url: event.sourceUrl,
          source_type: 'LIVE_INCIDENT_CORRELATION',
          discovery_mechanism: 'SEARCH',
          retrieval_timestamp: new Date().toISOString(),
          provider: 'LiveIncidentCorrelationEngine',
          attribution: `Correlated ${event.provider} event to ${target.company}`,
          classification: 'OBSERVATION'
        } as any
      });
    }

    return candidates;
  }

  private evaluateExposure(event: LiveTechnicalEvent, target: IntelligenceCase): TargetExposure {
    const provider = event.provider.toLowerCase();
    const evidence = target.evidence;

    // Strategy 1: Direct Evidence match (e.g., "Uses Supabase" in docs)
    const directMatch = evidence.find(e => 
      e.evidence_text.toLowerCase().includes(provider) || 
      (e.raw_observation && e.raw_observation.toLowerCase().includes(provider))
    );

    if (directMatch) {
      return {
        targetCompany: target.company,
        dependency: event.provider,
        confidence: 'KNOWN_DEPENDENCY',
        exposureEvidence: [directMatch.id],
        provenance: [directMatch.provenance]
      };
    }

    // Strategy 2: Behavioral signatures (e.g., headers, domains)
    // In a real implementation, this would check for specific provider headers in Evidence
    const behavioralMatch = evidence.some(e => 
      e.source_type === 'API_ENDPOINT' && e.raw_observation?.includes(provider)
    );

    if (behavioralMatch) {
      return {
        targetCompany: target.company,
        dependency: event.provider,
        confidence: 'LIKELY_DEPENDENCY',
        exposureEvidence: [], // In reality, would be the IDs of the headers
        provenance: []
      };
    }

    return {
      targetCompany: target.company,
      dependency: 'UNKNOWN',
      confidence: 'UNKNOWN',
      exposureEvidence: [],
      provenance: []
    };
  }

  private calculateTemporalRelation(event: LiveTechnicalEvent): TemporalRelation {
    const now = new Date();
    const started = event.startedAt ? new Date(event.startedAt) : null;
    const resolved = event.resolvedAt ? new Date(event.resolvedAt) : null;

    if (resolved && resolved < now) return 'RESOLVED';
    if (started && resolved === null) return 'CURRENT';
    if (started && resolved && resolved > now) return 'CURRENT';
    
    return 'UNKNOWN';
  }

  private identifyVerificationTarget(event: LiveTechnicalEvent, target: IntelligenceCase): string {
    // If it's a latency issue, we verify against the API endpoint
    // If it's a regional failure, we verify against the regional entry point
    const origin = target.company_surface?.origin || target.company;
    return `https://${origin}/api/health`; // Default hypothesis
  }
}
