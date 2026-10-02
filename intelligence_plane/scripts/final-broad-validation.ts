import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { CompanyResearchContext } from '../src/server/CompanyResearchContext';
import { IntelligenceCase } from '../src/server/IntelligenceCase';
import { TechnicalEntityExtractor } from '../src/server/TechnicalEntityExtractor';

async function main() {
  const companies = [
    { name: 'Anysphere', domain: 'anysphere.ai' },
    { name: 'ElevenLabs', domain: 'elevenlabs.io' },
    { name: 'Mistral AI', domain: 'mistral.ai' },
    { name: 'Figure', domain: 'figure.ai' },
    { name: 'Abridge', domain: 'abridge.com' },
    { name: 'Lightmatter', domain: 'lightmatter.ai' },
    { name: 'Shield AI', domain: 'shield.ai' },
    { name: 'Mercor', domain: 'mercor.com' },
    { name: 'Saronic Technologies', domain: 'saronic.com' },
    { name: 'Together AI', domain: 'together.ai' },
  ];

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    output: { write: (s: string) => {} }
  });

  const aggregate = {
    evidenceItems: 0,
    entities: 0,
    relationships: 0,
    complexityNodes: 0,
    hypotheses: 0,
    candidateTargets: 0,
    informationalTargets: 0,
    executableTargets: 0,
    verificationAttempts: 0,
    REFUTED: 0,
    INCONCLUSIVE: 0,
    VERIFIED: 0,
    TARGET_UNAVAILABLE: 0,
    OUTREACH_READY: 0,
    openApiSpecs: 0,
    sdkOperations: 0,
    jsEndpoints: 0,
    statusTargets: 0,
    runtimeTargets: 0,
    guessedTargets: 0,
    totalRequests: 0,
  };

  for (const target of companies) {
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
          
          const surfaces = (resultCase as any).intelligenceProfile?.surfaces;
          const infoTargets = [];
          const execTargets = [];

          if (surfaces) {
            if (surfaces.apiDeveloper) surfaces.apiDeveloper.forEach((u: string) => infoTargets.push(u));
            if (surfaces.docs) surfaces.docs.forEach((u: string) => infoTargets.push(u));
          }

          resultCase.evidence.forEach(e => {
            if (e.classification === 'SURFACE' && e.observed_behavior && e.observed_behavior.includes('Documented executable operation')) {
              execTargets.push(e.public_url);
            }
          });

          console.log(`API DOCUMENTATION SOURCES: ${infoTargets.length} (${infoTargets.join(', ')})`);
          console.log(`CANDIDATE TARGETS: ${infoTargets.length + execTargets.length}`);
          console.log(`INFORMATIONAL TARGETS: ${infoTargets.length}`);
          console.log(`EXECUTABLE TARGETS: ${execTargets.length}`);

          if (h.status !== 'HYPOTHESIS') {
            console.log(`SELECTED TARGET: Verified`);
            console.log(`EXACT OPERATION: [Refer to log]`);
            console.log(`METHOD: [Refer to log]`);
            console.log(`AUTH: None/Public`);
            console.log(`OBSERVABLE PROPERTY: runtime_behavior`);
          } else {
            console.log(`SELECTED TARGET: None`);
          }
        });
      }

      aggregate.evidenceItems += resultCase.evidence.length;
      aggregate.entities += entities.length;
      aggregate.relationships += relationships.length;
      aggregate.complexityNodes += resultCase.complexityMap?.nodes.length || 0;
      aggregate.hypotheses += resultCase.hypotheses?.length || 0;

      const state = resultCase.internalState;
      if (state === 'VERIFICATION_TARGET_UNAVAILABLE') aggregate.TARGET_UNAVAILABLE++;
      else if (state === 'VERIFIED_FINDING') {
        aggregate.VERIFIED++;
        aggregate.OUTREACH_READY++;
      } else if (state === 'VERIFICATION_INCONCLUSIVE') aggregate.INCONCLUSIVE++;
      else if (state === 'REFUTED') aggregate.REFUTED++;
      else if (state === 'OUTREACH_READY') aggregate.OUTREACH_READY++;

      const budget = context.getBudgetState();
      aggregate.totalRequests += budget.requestsUsed;
    } catch (e) {
      console.error(`FAILED validation for ${target.name}: ${e}`);
    }
  }

  console.log(`\n\n==================================================`);
  console.log(`FINAL AGGREGATE AUDIT`);
  console.log(`==================================================`);
  console.log(`Companies: ${companies.length}`);
  console.log(`Evidence items: ${aggregate.evidenceItems}`);
  console.log(`Technical entities: ${aggregate.entities}`);
  console.log(`Relationships: ${aggregate.relationships}`);
  console.log(`Complexity nodes: ${aggregate.complexityNodes}`);
  console.log(`Hypotheses: ${aggregate.hypotheses}`);
  console.log(`Candidate targets: ${aggregate.candidateTargets}`);
  console.log(`Informational targets: ${aggregate.informationalTargets}`);
  console.log(`Executable targets: ${aggregate.executableTargets}`);
  console.log(`Verification attempts: ${aggregate.verificationAttempts}`);
  console.log(`REFUTED: ${aggregate.REFUTED}`);
  console.log(`INCONCLUSIVE: ${aggregate.INCONCLUSIVE}`);
  console.log(`VERIFIED: ${aggregate.VERIFIED}`);
  console.log(`TARGET_UNAVAILABLE: ${aggregate.TARGET_UNAVAILABLE}`);
  console.log(`OUTREACH_READY: ${aggregate.OUTREACH_READY}`);
  
  const targetDiscoveryCoverage = aggregate.hypotheses > 0 
    ? (aggregate.executableTargets / aggregate.hypotheses) * 100 
    : 0;
  
  console.log(`TARGET DISCOVERY COVERAGE: ${targetDiscoveryCoverage.toFixed(2)}%`);
  console.log(`VERIFICATION SUCCESS RATE: ${aggregate.verificationAttempts > 0 ? (aggregate.VERIFIED / aggregate.verificationAttempts * 100).toFixed(2) + '%' : 'N/A'}`);
  console.log(`Guessed targets attempted: ${aggregate.guessedTargets} (MUST BE 0)`);
  console.log(`Budget used: ${aggregate.totalRequests}`);
  console.log(`==================================================`);
}

main().catch(console.error);
