import { CompanyQueue } from './src/server/CompanyQueue';
import * as path from 'path';

async function setup() {
  const queuePath = path.join(process.cwd(), 'artifacts', 'intelligence', 'queue.jsonl');
  const queue = new CompanyQueue(queuePath);
  
  const mockCompanies = [];
  for (let i = 0; i < 25; i++) {
    mockCompanies.push({
      canonical_name: `TestCorp ${i}`,
      domain: `testcorp${i}.com`,
      industry: 'Technology',
      source: 'MOCK',
    });
  }
  
  queue.enqueue(mockCompanies as any);
  console.log(`Enqueued ${mockCompanies.length} mock companies.`);
}

setup().catch(console.error);
