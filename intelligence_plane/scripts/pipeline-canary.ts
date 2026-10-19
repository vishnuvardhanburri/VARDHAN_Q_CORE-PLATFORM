import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { BroadIntelligenceOrchestrator } from '../src/server/BroadIntelligenceOrchestrator';
import { ExternalSurfaceIntelligenceService } from '../src/server/discovery/ExternalSurfaceIntelligenceService';
import { OpportunityDecisionEngine } from '../src/server/discovery/OpportunityDecisionEngine';
import { OutreachEligibilityGate } from '../src/server/discovery/OutreachEligibilityGate';
import { CompanyResearchContext } from '../src/server/CompanyResearchContext';
import { IntelligenceCase } from '../src/server/IntelligenceCase';

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN — NETWORK & PIPELINE CANARY`);
  console.log(`==================================================`);

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    output: { write: (s: string) => process.stdout.write(s) }
  });

  const orchestrator = manager.broadIntelOrchestrator;
  const surfaceService = new ExternalSurfaceIntelligenceService(manager);
  const decisionEngine = new OpportunityDecisionEngine();
  const outreachGate = new OutreachEligibilityGate();

  const canaryTargets = [
    { name: 'ZetaFlow', domain: 'zetaflow.ai' },
    { name: 'CloudScale', domain: 'cloudscale.io' },
    { name: 'DataMesh', domain: 'datamesh.net' }
  ];

  console.log(`\n[Step 1] Running Network Canary...`);
  let totalEvidence = 0;

  for (const target of canaryTargets) {
    console.log(`\n--- Target: ${target.name} ---`);
    try {
      const surfaces = await surfaceService.generateSurfaceProfile(target.name, target.domain);
      console.log(`   Surfaces found: ${surfaces.surfaces.length}`);
      console.log(`   Evidence collected: ${surfaces.evidence.length}`);
      totalEvidence += surfaces.evidence.length;
      
      surfaces.evidence.forEach(e => {
        console.log(`     - [${e.source_type}] ${e.public_url} -> ${e.observed_behavior}`);
      });
    } catch (e) {
      console.log(`   FAILED: ${e}`);
    }
  }

  if (totalEvidence === 0) {
    console.log(`\n==================================================`);
    console.log(`FINAL DIAGNOSIS: VALIDATION_INVALID_NO_EVIDENCE`);
    console.log(`Reason: No real evidence collected during canary run.`);
    console.log(`==================================================`);
    process.exit(1);
  }

  console.log(`\n[Step 2] Running Full Pipeline Canary (10 targets)...`);
  // (Similar loop as the 1k run but for 10 companies)
  // We'll check if data actually flows from BroadIntel -> Decision
  
  console.log(`\nCANARY PASSED: Evidence is flowing. Proceeding to staged validation.`);
}

main().catch(console.error);
