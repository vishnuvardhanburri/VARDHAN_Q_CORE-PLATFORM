import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { AutonomousOrganizationDiscoveryEngine } from '../src/server/discovery/AutonomousOrganizationDiscoveryEngine';

const MockSearchProvider = {
  search: async (query: string) => {
    console.log(`[MockSearch] Query: ${query}`);
    
    // Mocking Stage A: Organization Discovery
    if (query.includes('top technology companies') || query.includes('engineering blog')) {
      return [
        { url: 'https://engineering.zetaflow.ai/blog', title: 'ZetaFlow Blog', snippet: 'ZetaFlow Engineering' },
        { url: 'https://docs.cloudscale.io', title: 'CloudScale Docs', snippet: 'CloudScale Documentation' },
        { url: 'https://status.datamesh.net', title: 'DataMesh Status', snippet: 'DataMesh Status Page' },
        { url: 'https://about.quantumcompute.com', title: 'QuantumCompute', snippet: 'About QuantumCompute' }
      ];
    }
    
    // Mocking Stage B: Signal Discovery
    if (query.includes('ZetaFlow') || query.includes('zetaflow.ai')) {
      return [{ url: 'https://zetaflow.ai/incidents', title: 'Incidents', snippet: 'Latency spikes in GPU cluster' }];
    }
    if (query.includes('CloudScale') || query.includes('cloudscale.io')) {
      return [{ url: 'https://cloudscale.io/blog', title: 'Blog', snippet: 'Migrating to new regional data plane' }];
    }
    
    return [];
  }
};

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN — RECALL VALIDATION (ZERO-INPUT)`);
  console.log(`==================================================`);

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    searchProvider: MockSearchProvider as any,
    output: { write: (s: string) => process.stdout.write(s) }
  });

  const discoveryEngine = new AutonomousOrganizationDiscoveryEngine(manager);

  const request = {
    objective: "Test recall",
    maxCandidates: 50,
    researchBudget: {},
    researchMode: 'FREE_FIRST'
  } as any;

  const results = await discoveryEngine.discover(request);

  console.log(`\n--------------------------------------------------`);
  console.log(`Discovery Results:`);
  console.log(`Total Candidates Found: ${results.length}`);
  
  results.forEach((r, i) => {
    console.log(`${i+1}. ${r.organizationName} | Domain: ${r.domain} | Signal: ${r.signalState}`);
  });
  console.log(`--------------------------------------------------`);

  if (results.length > 0) {
    console.log(`\nFINAL DIAGNOSIS: SUCCESS_RECALL_ESTABLISHED`);
  } else {
    console.log(`\nFINAL DIAGNOSIS: DISCOVERY_RECALL_LIMITATION`);
  }
}

main().catch(console.error);
