import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const queuePath = path.join(process.cwd(), 'artifacts', 'intelligence', 'queue.jsonl');
  const lines = fs.readFileSync(queuePath, 'utf8').split('\n').filter(l => l.trim());
  
  const realCompanies = lines
    .map(l => JSON.parse(l))
    .filter(c => !c.company.toLowerCase().includes('testcorp'))
    .slice(0, 10);

  console.log('\n=== SELECTED COMPANIES FOR VALIDATION ===');
  realCompanies.forEach(c => console.log(`${c.company} (${c.domain})`));
  console.log('==========================================\n');

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    output: { write: (s: string) => process.stdout.write(s) }
  });

  const reports = [];
  for (const company of realCompanies) {
    console.log(`\n--- Starting Broad Investigation for ${company.company} ---`);
    try {
      const report = await manager.researchCompany(
        company.company, 
        company.domain, 
        company.growjo ? [company.growjo] : []
      );
      reports.push(report);
    } catch (e) {
      console.error(`Failed ${company.company}:`, e);
    }
  }

  console.log('\n\n==================================================');
  console.log('        VALIDATION AGGREGATE RESULTS');
  console.log('==================================================');
  
  let totalEvidence = 0;
  let totalOutreachReady = 0;
  
  reports.forEach(r => {
    totalEvidence += r.evidenceCount;
    if (r.outreachReady) totalOutreachReady++;
  });

  console.log(`Companies Processed: ${reports.length}`);
  console.log(`Total Evidence Items: ${totalEvidence}`);
  console.log(`Outreach Ready: ${totalOutreachReady}`);
  console.log('==================================================\n');
}

main().catch(console.error);
