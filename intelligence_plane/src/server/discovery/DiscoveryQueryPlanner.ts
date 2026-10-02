import { SignalType, SIGNAL_TAXONOMY } from '../SignalTaxonomy';

export interface DiscoveryQuery {
  query: string;
  type: 'ORGANIZATION' | 'SIGNAL';
  signalType?: SignalType;
  rationale: string;
}

export class DiscoveryQueryPlanner {
  /**
   * Generates two classes of queries: 
   * Class A: Broad Organization/Footprint Discovery
   * Class B: Organization-Specific Signal Discovery
   */
  generateOrganizationQueries(request: any): DiscoveryQuery[] {
    const queries: DiscoveryQuery[] = [];
    
    const broadTerms = [
      'engineering blog', 'developer portal', 'infrastructure architecture', 
      'technical documentation', 'API reference', 'status page', 'incident report',
      'platform engineering', 'distributed systems', 'cloud architecture',
      'database migration', 'scaling strategy', 'observability stack'
    ];

    for (const term of broadTerms) {
      queries.push({
        query: `"${term}"`,
        type: 'ORGANIZATION',
        rationale: `Broad search for organizations publishing ${term} content.`
      });
    }

    return queries;
  }

  generateSignalQueries(organization: string, domain: string, request: any): DiscoveryQuery[] {
    const queries: DiscoveryQuery[] = [];
    
    for (const [type, def] of Object.entries(SIGNAL_TAXONOMY)) {
      const signalType = type as SignalType;
      const indicators = def.indicators.join(' OR ');
      
      // Search for the signal specifically tied to the organization
      queries.push({
        query: `"${organization}" OR "${domain}" ("${indicators}")`,
        type: 'SIGNAL',
        signalType: signalType,
        rationale: `Searching for ${signalType} signals specifically for ${organization}.`
      });
    }

    return queries;
  }
}
