import { CompanyQueue } from './src/server/CompanyQueue';
import * as path from 'path';

async function main() {
  const queuePath = path.join(process.cwd(), 'artifacts', 'intelligence', 'queue.jsonl');
  const queue = new CompanyQueue(queuePath);
  
  console.log(`QUEUE PATH:     ${queuePath}`);
  console.log(`TOTAL PERSISTED: ${queue.count()}`);
  console.log(`QUEUED:         ${queue.count('QUEUED')}`);
  console.log(`RESOLVING:      ${queue.count('RESOLVING')}`);
  console.log(`RESEARCHING:    ${queue.count('RESEARCHING')}`);
  console.log(`RESEARCH_MORE:   ${queue.count('RESEARCH_MORE')}`);
  console.log(`NO_GO:          ${queue.count('NO_GO')}`);
  console.log(`OUTREACH_READY: ${queue.count('OUTREACH_READY')}`);
}

main().catch(console.error);
