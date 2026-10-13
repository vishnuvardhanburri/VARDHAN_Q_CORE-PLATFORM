import { CompanyQueue } from './src/server/CompanyQueue';
import * as path from 'path';

async function main() {
  const queuePath = path.join(process.cwd(), 'artifacts', 'intelligence', 'queue.jsonl');
  const queue = new CompanyQueue(queuePath);
  
  console.log(`Recovering stale claims in ${queuePath}...`);
  const recovered = queue.recoverStaleClaims(0); // recover all for this setup
  console.log(`Recovered ${recovered} records.`);
  
  console.log(`New Queue State:`);
  console.log(`QUEUED:         ${queue.count('QUEUED')}`);
  console.log(`RESOLVING:      ${queue.count('RESOLVING')}`);
  console.log(`RESEARCHING:    ${queue.count('RESEARCHING')}`);
}

main().catch(console.error);
