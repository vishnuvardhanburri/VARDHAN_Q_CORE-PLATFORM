import { CompanyQueue } from '../src/server/CompanyQueue';
import { GrowjoProvider } from '../src/server/GrowjoProvider';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  const queuePath = path.join(process.cwd(), 'artifacts', 'intelligence', 'queue.jsonl');
  const csvPath = path.join(process.cwd(), 'dataset.csv');
  
  console.log(`Loading CSV: ${csvPath}`);
  const text = fs.readFileSync(csvPath, 'utf8');
  const result = GrowjoProvider.parseCsv(text);
  
  console.log(`Parsed ${result.companies.length} companies from ${result.total_rows} rows.`);
  
  const queue = new CompanyQueue(queuePath);
  console.log(`Current queue size: ${queue.count()}`);
  
  const { added, duplicates } = queue.enqueue(result.companies);
  
  console.log(`Import results: Added ${added}, Duplicates ${duplicates}`);
  console.log(`Final queue size: ${queue.count()} (QUEUED: ${queue.count('QUEUED')})`);
}

main().catch(console.error);
