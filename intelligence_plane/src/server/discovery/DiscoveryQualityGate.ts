import { OrganizationCandidate } from './AutonomousOrganizationDiscoveryEngine';

export class DiscoveryQualityGate {
  async evaluate(candidate: OrganizationCandidate): Promise<'CANDIDATE' | 'SUPPORTED' | 'REJECTED' | 'RESEARCH_MORE'> {
    if (!candidate.organizationName || candidate.organizationName.length < 2) return 'REJECTED';
    if (candidate.rawIndicators.length === 0) return 'REJECTED';
    if (!candidate.sourceUrl) return 'REJECTED';

    return 'CANDIDATE';
  }
}
