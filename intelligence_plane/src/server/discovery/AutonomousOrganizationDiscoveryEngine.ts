import {
  OrganizationCandidate,
  DiscoveryRequest
} from './AutonomousOrganizationDiscoveryEngine.types';
import { OrganizationCandidateExtractor } from './OrganizationCandidateExtractor';
import { CompanyNormalizer } from './CompanyNormalizer';
import { VardhanSystemManager } from '../system/VardhanSystemManager';

export interface DiscoveryRequest {
  objective: string;
  industries?: string;
  geographies?: string;
  maxCandidates: number;
  researchBudget: any;
  researchMode: 'FREE_FIRST' | 'NORMAL' | 'PAID_AGGRESSIVE';
}

export interface OrganizationCandidate {
  organizationName: string;
  domain?: string;
  sourceUrl: string;
  sourceType: string;
  discoveryQuery: string;
  discoveryReason: string;
  provenance: string;
  signalState: 'UNKNOWN' | 'SUPPORTED' | 'REJECTED';
  supportedSignals?: string[];
}

export class AutonomousOrganizationDiscoveryEngine {
  private extractor = new OrganizationCandidateExtractor();
  private normalizer = new CompanyNormalizer();

  constructor(private manager: VardhanSystemManager) {}

  async discover(request: DiscoveryRequest): Promise<OrganizationCandidate[]> {
    console.log(`[AutoDiscovery] Starting Two-Stage Discovery: ${request.objective}`);

    // Stage A: Organization Discovery (High Recall)
    const rawCandidates = await this.discoverOrganizations(request);

    // Stage B: Footprint Confirmation & Signal Discovery (High Precision)
    const confirmedCandidates = await this.confirmAndQualify(rawCandidates);

    return confirmedCandidates;
  }

  private async discoverOrganizations(request: DiscoveryRequest): Promise<any[]> {
    const candidates: any[] = [];

    const discoveryQueries = [
      "top technology companies engineering blog",
      "cloud infrastructure platform documentation",
      "enterprise software developer portals",
      "SaaS infrastructure status pages",
      "technical architecture whitepapers 2025",
      "engineering scaling challenges blogs"
    ];

    for (const query of discoveryQueries) {
      console.log(`[Stage A] Executing Discovery Query: ${query}`);
      const results = await this.manager.search(query);

      const extracted = await this.extractor.extractCandidates(results);
      candidates.push(...extracted);
    }

    return candidates;
  }

  private async confirmAndQualify(candidates: any[]): Promise<OrganizationCandidate[]> {
    const qualified: OrganizationCandidate[] = [];

    for (const cand of candidates) {
      // 1. Normalization & Footprint Confirmation
      const normalizationResult = await this.normalizer.normalize(cand);
      if (!normalizationResult.confirmed) {
        console.log(`[Stage B] Footprint rejected for ${cand.organizationName}`);
        continue;
      }

      const normalizedCandidate = normalizationResult.candidate;

      // 2. Signal Discovery
      const signals = await this.discoverSignalsForOrg(normalizedCandidate);

      qualified.push({
        ...normalizedCandidate,
        signalState: signals.length > 0 ? 'SUPPORTED' : 'UNKNOWN',
        supportedSignals: signals
      });
    }

    return qualified;
  }

  private async discoverSignalsForOrg(org: any): Promise<string[]> {
    const orgName = org.organizationName;
    if (!orgName) return [];

    const signalQueries = [
      `${orgName} infrastructure architecture`,
      `${orgName} reliability incident`,
      `${orgName} scaling challenges`,
      `${orgName} engineering migration`
    ];

    const allSignals: string[] = [];
    for (const q of signalQueries) {
      const results = await this.manager.search(q);
      if (results && results.length > 0) {
        allSignals.push(`Signal from query: ${q}`);
      }
    }
    return allSignals;
  }
}
