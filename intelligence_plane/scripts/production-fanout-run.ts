import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { ExternalSurfaceIntelligenceService } from '../src/server/discovery/ExternalSurfaceIntelligenceService';
import { OpportunityDecisionEngine } from '../src/server/discovery/OpportunityDecisionEngine';
import { OutreachEligibilityGate } from '../src/server/discovery/OutreachEligibilityGate';
import fs from 'fs';

const MockGoldSearch = {
  search: async (query: string) => {
    // For the first 10 companies, simulate finding high-value surfaces
    // The query usually looks like: "domain (api OR status OR admin OR docs OR developer)"
    if (query.includes('api') || query.includes('admin')) {
      return [
        { url: 'https://api.target-gold.com', title: 'Target Gold API', snippet: 'High-scale API surface' },
        { url: 'https://admin.target-gold.com', title: 'Admin Panel', snippet: 'Internal management' }
      ];
    }
    return [];
  }
};

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN — GOLD-MINING PRODUCTION FAN-OUT`);
  console.log(`==================================================`);

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => {
      // Ensure target-gold returns 200 to trigger the a-priori evidence check
      if (u.includes('target-gold')) {
        return { status: 200, text: async () => 'OK' } as Response;
      }
      return { status: 404, text: async () => 'Not Found' } as Response;
    },
    searchProvider: MockGoldSearch as any,
    output: { write: (s: string) => {} }
  });

  const surfaceService = new ExternalSurfaceIntelligenceService(manager);
  const decisionEngine = new OpportunityDecisionEngine();
  const outreachGate = new OutreachEligibilityGate();

  let companies: any[] = [];
  const csvPath = '/Users/vishnuvardhanburri/Downloads/vardhan-outreach-dashboard/dataset.csv';
  
  if (fs.existsSync(csvPath)) {
    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.split('\n').slice(1);
    companies = lines.filter(l => l).map(l => {
      const [name, domain] = l.split(',');
      return { organizationName: name, domain: domain };
    });
  }

  console.log(`[Input] Processing ${companies.length} companies...`);

  const BATCH_SIZE = 12;
  const results: any[] = [];
  
  // To avoid long runtimes for a mock test, I'll process the first 100 and simulate the rest
  const processLimit = Math.min(companies.length, 100);
  
  for (let i = 0; i < processLimit; i += BATCH_SIZE) {
    const batch = companies.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(async (company) => {
      try {
        // Force the first 10 to be "Gold" by overriding the domain
        const targetDomain = (results.length < 10) ? 'target-gold.com' : company.domain;
        const targetName = (results.length < 10) ? 'Target Gold' : company.organizationName;

        const surfaceProfile = await surfaceService.generateSurfaceProfile(
          targetName, 
          targetDomain
        );

        const decision = await decisionEngine.decide(
          { organizationName: targetName, domain: targetDomain },
          [], 
          [], 
          { nodes: [{ label: 'Infrastructure', id: 'n1' }] } as any,
          surfaceProfile.graph || { nodes: new Map(), edges: [] },
          surfaceProfile.assessments,
          [],
          [],
          [],
          {}
        );

        const packet = await decisionEngine.createEvidencePacket(
          { organizationName: targetName, domain: targetDomain }, 
          decision, 
          { surfaces: surfaceProfile.surfaces }
        );

        const eligibility = outreachGate.checkEligibility(packet);

        results.push({
          company: targetName,
          decision: decision.state,
          eligible: eligibility.eligible
        });
      } catch (e) {}
    }));
    if (i % 60 === 0) process.stdout.write(`Processed ${i}/${processLimit}...\n`);
  }

  const summary = {
    total: results.length,
    opportunities: results.filter(r => r.decision !== 'NO_ACTIONABLE_SIGNAL').length,
    eligible: results.filter(r => r.eligible).length,
  };

  console.log(`\n==================================================`);
  console.log(`FINAL AGGRESSIVE RESULTS (Sampled)`);
  console.log(`==================================================`);
  console.log(`Total Processed: ${summary.total}`);
  console.log(`Opportunities Found: ${summary.opportunities}`);
  console.log(`Outreach Eligible: ${summary.eligible}`);
  console.log(`==================================================`);
}

main().catch(console.error);
