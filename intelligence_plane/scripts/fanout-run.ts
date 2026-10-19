import { FanoutResearchExecutor } from '../src/server/FanoutResearchExecutor';
import { CompanyQueue } from '../src/server/CompanyQueue';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  const args = process.argv.slice(2);
  const batchMatch = args.join(' ').match(/--batch\s+(\d+)/);
  const concMatch = args.join(' ').match(/--concurrency\s+(\d+)/);
  const isMock = args.includes('--mock');
  
  const batchSize = batchMatch ? parseInt(batchMatch[1], 10) : undefined;
  const concurrency = concMatch ? parseInt(concMatch[1], 10) : 12;

  // 1. Queue Diagnostics (Before Execution)
  const queuePath = path.join(process.cwd(), 'artifacts', 'intelligence', 'queue.jsonl');
  if (!fs.existsSync(queuePath)) {
    console.error(`FATAL: Production queue not found at ${queuePath}`);
    process.exit(1);
  }

  const queue = new CompanyQueue(queuePath);
  const total = queue.count();
  const queued = queue.count('QUEUED');
  const resolving = queue.count('RESOLVING');
  const researching = queue.count('RESEARCHING');
  const researchMore = queue.count('RESEARCH_MORE');
  const noGo = queue.count('NO_GO');
  const ready = queue.count('OUTREACH_READY');

  console.log(`\n=== VARDHAN FANOUT STARTUP DIAGNOSTICS ===`);
  console.log(`QUEUE PATH:     ${queuePath}`);
  console.log(`TOTAL PERSISTED: ${total}`);
  console.log(`QUEUED:         ${queued}`);
  console.log(`RESOLVING:      ${resolving}`);
  console.log(`RESEARCHING:    ${researching}`);
  console.log(`RESEARCH_MORE:   ${researchMore}`);
  console.log(`NO_GO:          ${noGo}`);
  console.log(`OUTREACH_READY: ${ready}`);
  console.log(`──────────────────────────────────────────`);
  console.log(`BATCH REQUESTED: ${batchSize || 'All'}`);
  console.log(`CONCURRENCY:     ${concurrency}`);
  console.log(`──────────────────────────────────────────\n`);

  // Safety Assertion: No implicit 25-company cap
  if (batchSize && batchSize > 25 && queued > 25) {
    console.log(`Confirmed: Processing batch of ${batchSize} from ${queued} available records.`);
  } else if (batchSize && batchSize > 25 && queued <= 25) {
    console.log(`Notice: Requested batch ${batchSize} exceeds available QUEUED records (${queued}). Processing all available.`);
  }

  const executor = new FanoutResearchExecutor({
    concurrency,
    batchSize,
    isMock,
  });

  const start = Date.now();
  const stats = await executor.execute(batchSize);
  const duration = (Date.now() - start) / 1000;

  console.log(`\n\n══════════════════════════════════════════════════════════════════`);
  console.log(`                    FANOUT FINAL REPORT`);
  console.log(`══════════════════════════════════════════════════════════════════`);
  console.log(`Total companies:    ${stats.total}`);
  console.log(`Workers:            ${concurrency}`);
  console.log(`Completed:          ${stats.completed}`);
  console.log(`NO_GO:              ${stats.no_go}`);
  console.log(`RESEARCH_MORE:      ${stats.research_more}`);
  console.log(`OUTREACH_READY:     ${stats.outreach_ready}`);
  console.log(`Errors:             ${stats.errors}`);
  console.log(`Remaining QUEUED:   ${stats.queued}`);
  console.log(`Duplicate claims:   ${stats.duplicateClaims}`);
  console.log(`Runtime:            ${duration.toFixed(2)}s`);
  console.log(`══════════════════════════════════════════════════════════════════`);
}

main().catch(console.error);
