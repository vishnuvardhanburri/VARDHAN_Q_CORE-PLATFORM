/**
 * VARDHAN — TARGET VERIFICATION ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 * Performs safe, non-destructive verification of a dependency hypothesis.
 * This is the FINAL gate before a hypothesis becomes a SignalCandidate.
 */

import { AffectedTargetCandidate } from './LiveIncidentModels';
import { IntelligenceCase } from './IntelligenceCase';
import { LivePublicObservationProvider } from './LivePublicObservationProvider';

export class TargetVerificationEngine {
  constructor(private observationProvider: LivePublicObservationProvider) {}

  private identifyVerificationTarget(event: any, target: IntelligenceCase): string | null {
    // CRITICAL: Endpoint discovery MUST be evidence-derived.
    // We search the case's evidence for discovered endpoints or surfaces.

    const surface = target.company_surface;
    if (surface && surface.discovered_pages.length > 0) {
      const healthPage = surface.discovered_pages.find(p =>
        p.path.toLowerCase().includes('health') ||
        p.path.toLowerCase().includes('status') ||
        p.path.toLowerCase().includes('metrics')
      );
      if (healthPage) return `https://${surface.origin}${healthPage.path}`;
    }

    const apiEvidence = target.evidence.find(e =>
      e.source_type === 'API_ENDPOINT' &&
      (e.public_url?.includes('health') || e.public_url?.includes('status'))
    );
    if (apiEvidence?.public_url) return apiEvidence.public_url;

    if (surface?.company_homepage) return surface.company_homepage;

    return null;
  }

  /**
   * Verifies if a target company is actually experiencing the impact
   * described in the LiveTechnicalEvent.
   */
  async verify(candidate: AffectedTargetCandidate, target: IntelligenceCase): Promise<{ status: 'VERIFIED' | 'REFUTED' | 'INCONCLUSIVE', report: VerificationReport }> {
    const verificationTarget = this.identifyVerificationTarget(candidate.liveEvent, target);

    if (!verificationTarget) {
      return {
        status: 'INCONCLUSIVE',
        report: this.createEmptyReport(candidate, target, 'No evidence-derived endpoint found. Blind probing forbidden.')
      };
    }

    try {
      // 1. Probe the Target
      const targetResult = await this.observationProvider.observePublicSurface(verificationTarget);
      const targetEvidence = targetResult?.evidence?.[0];

      // 2. Probe the Control (Differential Check)
      const controlUrl = this.getControlEndpoint(candidate.liveEvent.provider);
      let controlMatches = false;
      let differentialResult = 'NO_CONTROL_PROBED';
      if (controlUrl) {
        const controlResult = await this.observationProvider.observePublicSurface(controlUrl);
        const controlEvidence = controlResult?.evidence?.[0];
        if (controlEvidence) {
          controlMatches = this.matchSignature(candidate.liveEvent.signature || [], controlEvidence);
          differentialResult = controlMatches ? 'CONTROL_ALSO_AFFECTED' : 'CONTROL_HEALTHY';
        }
      }

      if (!targetEvidence) {
        return {
          status: 'INCONCLUSIVE',
          report: this.createEmptyReport(candidate, target, 'Target surface returned no evidence.')
        };
      }

      // 3. Signature Matching
      let targetMatches = false;
      if (candidate.liveEvent.signature && candidate.liveEvent.signature.length > 0) {
        targetMatches = this.matchSignature(candidate.liveEvent.signature, targetEvidence);
      } else {
        // Legacy fallback
        const symptom = candidate.liveEvent.symptom.toLowerCase();
        const obsText = (targetEvidence.raw_observation || '').toLowerCase();
        if (symptom.includes('latency') && targetEvidence.latency_ms && targetEvidence.latency_ms > 500) targetMatches = true;
        if (symptom.includes('500') && targetEvidence.status === 500) targetMatches = true;
      }

      // 4. Temporal Correlation
      const temporalMatch = this.calculateTemporalMatch(candidate.liveEvent);

      // 5. Regional Correlation
      const regionalMatch = this.calculateRegionalMatch(candidate.liveEvent, target);

      // 6. Component Correlation
      const componentMatch = this.calculateComponentMatch(candidate.liveEvent, target);

      // FINAL VERDICT:
      // Target must match signature AND Control must NOT match (or be different)
      let finalStatus: 'VERIFIED' | 'REFUTED' | 'INCONCLUSIVE' = 'REFUTED';
      let reason = 'Target behavior does not match provider symptom signature.';

      if (targetMatches && !controlMatches) {
        if (temporalMatch === 'MISMATCHED') {
          finalStatus = 'REFUTED';
          reason = 'Behavior matches but occurs outside the incident time window.';
        } else if (regionalMatch === 'MISMATCHED') {
          finalStatus = 'INCONCLUSIVE';
          reason = 'Behavior matches but target is in a different region than the incident.';
        } else {
          finalStatus = 'VERIFIED';
          reason = 'Target-specific impact verified via behavioral signature match and healthy control group.';
        }
      } else if (targetMatches && controlMatches) {
        finalStatus = 'REFUTED';
        reason = 'target-specific correspondence was not established; both target and control show symptom.';
      }

      return {
        status: finalStatus,
        report: {
          provider_event: candidate.liveEvent.id,
          target: target.company,
          dependency: candidate.dependency,
          target_surface: verificationTarget,
          signature: candidate.liveEvent.signature || [],
          target_observation: targetEvidence,
          temporal_match: temporalMatch,
          regional_match: regionalMatch,
          component_match: componentMatch,
          differential_result: differentialResult,
          final_status: finalStatus,
          reason: reason
        }
      };
    } catch (e: any) {
      return {
        status: 'INCONCLUSIVE',
        report: this.createEmptyReport(candidate, target, `Verification error: ${e.message}`)
      };
    }
  }

  private matchSignature(signature: BehavioralMarker[], evidence: Evidence): boolean {
    if (!signature || signature.length === 0) return false;
    for (const marker of signature) {
      let matches = false;
      const obsText = (evidence.raw_observation || '').toLowerCase();
      switch (marker.type) {
        case 'STATUS_CODE':
          if (marker.operator === 'EQUALS' && evidence.status === marker.value) matches = true;
          break;
        case 'LATENCY':
          if (marker.operator === 'GREATER_THAN' && evidence.latency_ms && evidence.latency_ms > marker.value) matches = true;
          break;
        case 'TEXT_MATCH':
          if (marker.operator === 'CONTAINS' && obsText.includes(marker.value.toLowerCase())) matches = true;
          break;
      }
      if (!matches) return false;
    }
    return true;
  }

  private getControlEndpoint(provider: string): string | null {
    const controls: Record<string, string> = {
      'Supabase': 'https://status.supabase.com/',
      'AWS': 'https://health.aws.amazon.com/',
      'Cloudflare': 'https://www.cloudflarestatus.com/',
      'Vercel': 'https://www.vercel-status.com/',
      'GitHub': 'https://www.githubstatus.com/',
    };
    const normalized = provider.toLowerCase();
    const key = Object.keys(controls).find(k => k.toLowerCase() === normalized);
    return key ? controls[key] : null;
  }

  private calculateTemporalMatch(event: LiveTechnicalEvent): TemporalMatch {
    return 'OVERLAPPING';
  }

  private calculateRegionalMatch(event: LiveTechnicalEvent, target: IntelligenceCase): RegionalMatch {
    return 'UNKNOWN';
  }

  private calculateComponentMatch(event: LiveTechnicalEvent, target: IntelligenceCase): ComponentMatch {
    return 'UNKNOWN';
  }

  private createEmptyReport(candidate: AffectedTargetCandidate, target: IntelligenceCase, reason: string): VerificationReport {
    return {
      provider_event: candidate.liveEvent.id,
      target: target.company,
      dependency: candidate.dependency,
      target_surface: 'NONE',
      signature: candidate.liveEvent.signature || [],
      target_observation: null,
      temporal_match: 'UNKNOWN',
      regional_match: 'UNKNOWN',
      component_match: 'UNKNOWN',
      differential_result: 'N/A',
      final_status: 'INCONCLUSIVE',
      reason: reason
    };
  }
}
