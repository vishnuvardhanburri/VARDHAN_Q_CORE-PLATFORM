import { SignalType, SIGNAL_TAXONOMY } from '../SignalTaxonomy';
import { Evidence, IntelligenceCase } from '../IntelligenceCase';
import { CompanyResearchContext } from '../CompanyResearchContext';

export interface ExpansionQuery {
  query: string;
  rationale: string;
  category: 'INFRASTRUCTURE' | 'ARCHITECTURE' | 'INCIDENT' | 'DOCUMENTATION' | 'BOUNDARY';
}

export class SignalContextExpansionEngine {
  /**
   * Generates targeted research queries to expand the technical context of a supported signal.
   */
  generateExpansionQueries(
    organization: string, 
    domain: string, 
    signalType: SignalType, 
    existingEvidence: Evidence[]
  ): ExpansionQuery[] {
    const queries: ExpansionQuery[] = [];
    
    // Signal-specific expansion logic
    switch (signalType) {
      case 'PUBLIC_DATA_EXPOSURE':
        queries.push(
          { query: `"${organization}" "public asset" architecture`, rationale: 'Identify the specific boundary exposed', category: 'BOUNDARY' },
          { query: `"${organization}" "security advisory" remediation`, rationale: 'Find public remediation steps', category: 'DOCUMENTATION' },
          { query: `"${organization}" "exposed" system category`, rationale: 'Determine which system is implicated', category: 'INFRASTRUCTURE' }
        );
        break;

      case 'INFRASTRUCTURE_CHANGE':
        queries.push(
          { query: `"${organization}" "migration" architecture`, rationale: 'Identify the motivation for the change', category: 'ARCHITECTURE' },
          { query: `"${organization}" "new region" infrastructure`, rationale: 'Determine the scale of expansion', category: 'INFRASTRUCTURE' },
          { query: `"${organization}" "deprecated" system`, rationale: 'Identify what was replaced', category: 'ARCHITECTURE' }
        );
        break;

      case 'PUBLIC_OUTAGE':
        queries.push(
          { query: `"${organization}" "postmortem" engineering`, rationale: 'Extract root cause and technical components', category: 'INCIDENT' },
          { query: `"${organization}" "incident report" root cause`, rationale: 'Identify the failing architectural boundary', category: 'INCIDENT' },
          { query: `"${organization}" "status" component failure`, rationale: 'Map the outage to specific services', category: 'BOUNDARY' }
        );
        break;

      default:
        // Generic technical expansion for other signals
        queries.push(
          { query: `"${organization}" engineering architecture`, rationale: 'General architecture context', category: 'ARCHITECTURE' },
          { query: `"${organization}" infrastructure scaling`, rationale: 'Scale and complexity indicators', category: 'INFRASTRUCTURE' },
          { query: `"${organization}" technical documentation`, rationale: 'Explicit surface boundaries', category: 'DOCUMENTATION' }
        );
    }

    // Add domain-specific variants
    const domainQueries = queries.map(q => ({
      ...q,
      query: q.query.replace(`"${organization}"`, `site:${domain}`)
    }));

    return [...queries, ...domainQueries];
  }

  /**
   * Determines if the expanded context is now sufficient for entity extraction.
   */
  isContextSufficient(evidence: Evidence[]): boolean {
    // Context is sufficient if we have at least 3 distinct technical entities 
    // or a high-confidence documented architectural fact.
    const technicalTerms = ['database', 'gpu', 'cluster', 'orchestration', 'region', 'latency', 'api', 'queue'];
    let count = 0;
    
    evidence.forEach(e => {
      const text = (e.factualObservation || e.observed_behavior || '').toLowerCase();
      technicalTerms.forEach(term => {
        if (text.includes(term)) count++;
      });
    });

    return count >= 5;
  }
}
