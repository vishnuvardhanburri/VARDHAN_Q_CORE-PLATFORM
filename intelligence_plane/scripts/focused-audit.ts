import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { CompanyResearchContext } from '../src/server/CompanyResearchContext';
import { IntelligenceCase } from '../src/server/IntelligenceCase';
import { TechnicalEntityExtractor } from '../src/server/TechnicalEntityExtractor';

async function main() {
  const targets = [
    { name: 'Mercor', domain: 'mercor.com' },
    { name: 'Together AI', domain: 'together.ai' },
  ];

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    output: { write: (s: string) => {} }
  });

  for (const target of targets) {
    console.log(`\n==================================================`);
    console.log(`COMPANY: ${target.name}`);
    console.log(`==================================================`);

    const context = new CompanyResearchContext(target.name, {
      maxSearchQueries: 50,
      maxPagesFetched: 100,
      maxGithubRequests: 30
    });

    const caseData: IntelligenceCase = {
      company: target.name,
      domain: target.domain,
      fit_status: 'UNKNOWN' as any,
      evidence: [],
      prospect_decision: 'RESEARCH_MORE',
      internalState: 'IDLE'
    } as any;

    try {
      const orchestrator = (manager as any).broadIntelOrchestrator;
      const resultCase = await orchestrator.orchestrate(caseData, context);

      console.log(`EVIDENCE COUNT: ${resultCase.evidence.length}`);
      
      const extractor = new TechnicalEntityExtractor();
      const entities = extractor.extractEntities(resultCase.evidence);
      const relationships = extractor.extractRelationships(entities, resultCase.evidence);
      
      console.log(`TECHNICAL ENTITIES: ${entities.length}`);
      console.log(`RELATIONSHIPS: ${relationships.length}`);
      console.log(`COMPLEXITY NODES: ${resultCase.complexityMap?.nodes.length || 0}`);

      if (resultCase.hypotheses && resultCase.hypotheses.length > 0) {
        resultCase.hypotheses.forEach(h => {
          console.log(`\nHYPOTHESIS: ${h.claim}`);
          console.log(`SUPPORTING EVIDENCE: ${h.evidenceIds.join(', ')}`);
          console.log(`VERIFICATION STATUS: ${h.status}`);
          
          // The orchestrator doesn't store the TargetCandidate object in the Hypothesis.
          // We rely on the logs emitted during orchestrate().
        });
      }

      console.log(`FINAL STATE: ${resultCase.internalState}`);
    } catch (e) {
      console.error(`FAILED audit for ${target.name}: ${e}`);
    }
  }
}

main().catch(console.error);
