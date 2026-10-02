/**
 * VARDHAN — OWNER SEARCH PLANNER
 * ─────────────────────────────────────────────────────────────────────────────
 * Decomposes an ENGINEERING_OPPORTUNITY into a structured search plan for
 * targeted person discovery. It transforms a technical finding into a set
 * of search personas, subsystems, and keywords.
 */

import type { FindingClassification, Evidence } from './IntelligenceCase';
import type { OwnerSearchPlan } from './DeepTypes';

export class OwnerSearchPlanner {
  static plan(
    opportunityId: string,
    classification: FindingClassification | null,
    evidence: Evidence[]
  ): OwnerSearchPlan {
    const findingType = classification?.finding_type || 'UNKNOWN';
    
    const targetSubsystem = this.deriveSubsystem(findingType, evidence);
    const rolePersonas = this.inferRolePersonas(findingType, targetSubsystem);
    const technicalKeywords = this.deriveKeywords(findingType, evidence);
    const seniorityTarget = this.inferSeniority(findingType);

    return {
      opportunity_id: opportunityId,
      target_subsystem: targetSubsystem,
      role_personas: rolePersonas,
      technical_keywords: technicalKeywords,
      seniority_target: seniorityTarget,
    };
  }

  private static deriveSubsystem(type: string, evidence: Evidence[]): string {
    if (type === 'OBSERVED_AVAILABILITY_ISSUE' || type === 'REPEATED_ERRORS' || type === 'OBSERVED_LATENCY') {
      return 'availability & performance';
    }
    if (type.startsWith('DOCUMENTED_INCIDENT')) {
      return 'reliability & observability';
    }
    if (type === 'POSSIBLE_PUBLIC_EXPOSURE' || type === 'POSSIBLE_SENSITIVE_METADATA_EXPOSURE' || type === 'POSSIBLE_INFORMATION_DISCLOSURE') {
      return 'public API surface';
    }
    if (evidence.some(e => (e.sensitive_fields || []).some(f => /security|token|credential|key/i.test(f)))) {
      return 'security & auth';
    }
    if (type.startsWith('DOCUMENTED_SCALING_CONSTRAINT') || type === 'DOCUMENTED_ENGINEERING_FAILURE') {
      return 'platform engineering';
    }
    return 'platform engineering';
  }

  private static inferRolePersonas(type: string, subsystem: string): string[] {
    const personas: string[] = [];
    personas.push('CTO', 'VP Engineering', 'Head of Engineering');

    if (subsystem.includes('platform') || subsystem.includes('infrastructure')) {
      personas.push('Head of Platform', 'Head of Infrastructure', 'Director of Platform', 'Director of Infrastructure');
    }
    if (subsystem.includes('security')) {
      personas.push('Head of Security', 'CISO', 'Director of Security');
    }
    if (subsystem.includes('availability') || subsystem.includes('reliability')) {
      personas.push('Head of SRE', 'SRE Lead', 'Director of Reliability');
    }
    
    personas.push('Staff Engineer', 'Principal Engineer', 'Technical Lead');
    return Array.from(new Set(personas));
  }

  private static deriveKeywords(type: string, evidence: Evidence[]): string[] {
    const keywords: string[] = [];
    const allText = evidence.map(e => (e.observed_behavior || '')).join(' ').toLowerCase();
    const technicalTerms = [
      'kubernetes', 'k8s', 'terraform', 'aws', 'gcp', 'azure', 'docker', 'containers',
      'redis', 'postgres', 'mysql', 'cassandra', 'mongodb', 'elasticsearch', 'kafka',
      'sharding', 'partitioning', 'distributed systems', 'microservices', 'grpc', 'rest api',
      'latency', 'throughput', 'availability', 'outage', 'downtime', 'scaling', 'migration',
      'soc 2', 'iso 27001', 'pci dss', 'encryption', 'authn', 'authz', 'oauth'
    ];

    for (const term of technicalTerms) {
      if (allText.includes(term)) keywords.push(term);
    }

    if (type === 'OBSERVED_LATENCY') keywords.push('performance', 'latency', 'optimization');
    if (type === 'POSSIBLE_SENSITIVE_METADATA_EXPOSURE') keywords.push('metadata', 'api exposure', 'security');

    return Array.from(new Set(keywords));
  }

  private static inferSeniority(type: string): 'LEADERSHIP' | 'STAFF' | 'INDIVIDUAL_CONTRIBUTOR' {
    if (type.startsWith('DOCUMENTED_SCALING_CONSTRAINT') || type === 'DOCUMENTED_ENGINEERING_FAILURE') {
      return 'LEADERSHIP';
    }
    if (type === 'OBSERVED_LATENCY' || type === 'REPEATED_ERRORS') {
      return 'STAFF';
    }
    return 'INDIVIDUAL_CONTRIBUTOR';
  }
}
