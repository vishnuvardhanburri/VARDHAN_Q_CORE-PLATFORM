import { CompanyQueue } from './CompanyQueue';
import { VardhanSystemManager } from './system/VardhanSystemManager';
import { VardhanModelGateway, OllamaProvider } from './VardhanModelGateway';
import { detectSearchCapabilities, PublicWebSearchProvider, NullSearchProvider } from './WebSearchProvider';
import * as path from 'path';

export interface FanoutOptions {
  batchSize?: number;
  concurrency?: number;
  artifactsDir?: string;
  isMock?: boolean;
}

export interface FanoutStats {
  total: number;
  completed: number;
  researching: number;
  queued: number;
  no_go: number;
  research_more: number;
  outreach_ready: number;
  errors: number;
  duplicateClaims: number;
}

export class FanoutResearchExecutor {
  private queue: CompanyQueue;
  private manager: VardhanSystemManager;
  private concurrency: number;
  private stats: FanoutStats = {
    total: 0, completed: 0, researching: 0, queued: 0,
    no_go: 0, research_more: 0, outreach_ready: 0, errors: 0, duplicateClaims: 0
  };

  constructor(options: FanoutOptions) {
    // FIX: Ensure we use the absolute production path unless explicitly in mock mode
    const artifactsDir = options.isMock 
      ? path.join(process.cwd(), 'artifacts', 'test_isolated') 
      : (options.artifactsDir || path.join(process.cwd(), 'artifacts', 'intelligence'));
    
    const queuePath = path.join(artifactsDir, 'queue.jsonl');
    this.queue = new CompanyQueue(queuePath);
    this.concurrency = options.concurrency ?? 12;

    const modelGateway = new VardhanModelGateway();
    modelGateway.addProvider(new OllamaProvider({}));

    const searchCaps = detectSearchCapabilities();
    const searchProvider = searchCaps.available 
      ? new PublicWebSearchProvider({ fetcher: async (u, i) => fetch(u, i) as any }) 
      : new NullSearchProvider();

    this.manager = new VardhanSystemManager({
      fetcher: async (u, i) => fetch(u, i) as any,
      searchProvider,
      modelGateway,
      artifactsDir,
      output: { write: (s: string) => {} },
    });
  }

  private async worker(id: string): Promise<void> {
    while (true) {
      const company = this.queue.claimNext(id);
      if (!company) break;

      console.log(`[worker-${id}] claimed ${company.company}`);
      this.stats.researching++;
      this.stats.queued--;

      try {
        const report = await this.manager.researchCompany(
          company.company, 
          company.domain || '', 
          company.growjo ? [company.growjo] : []
        );

        const finalDecision = report.outreachReady ? 'OUTREACH_READY' : 
                             (report.state === 'NO_GO' ? 'NO_GO' : 'RESEARCH_MORE');

        this.queue.markResearched(
          company.id,
          report.decision || 'RESEARCH_MORE', 
          report.confidence || 'MEDIUM',
          report.finding?.title || null,
          report.owner?.name || null,
          report.artifact_path || null,
          finalDecision as any,
          null
        );

        if (finalDecision === 'NO_GO') this.stats.no_go++;
        else if (finalDecision === 'RESEARCH_MORE') this.stats.research_more++;
        else if (finalDecision === 'OUTREACH_READY') this.stats.outreach_ready++;

        console.log(`[worker-${id}] ${company.company} → ${finalDecision}`);
      } catch (e: any) {
        console.error(`[worker-${id}] ${company.company} → ERROR: ${e.message}`);
        this.queue.markResearched(
          company.id,
          'ERROR', 'LOW', null, null, null, 
          'RESEARCH_MORE' as any, e.message
        );
        this.stats.errors++;
      } finally {
        this.stats.completed++;
        this.stats.researching--;
      }
    }
  }

  async execute(batchSize?: number): Promise<FanoutStats> {
    // Run stale recovery before starting
    const recovered = this.queue.recoverStaleClaims();
    if (recovered > 0) {
      console.log(`Recovered ${recovered} stale claims.`);
    }

    const allPending = this.queue.pending();
    const totalAvailable = allPending.length;
    
    // BATCH LOGIC:
    // If batchSize is undefined, process all pending.
    // If batchSize is provided, limit to that amount.
    const selectedBatch = batchSize === undefined ? totalAvailable : Math.min(batchSize, totalAvailable);
    
    this.stats.total = selectedBatch;
    this.stats.queued = selectedBatch;
    
    console.log(`\nFANOUT STARTING`);
    console.log(`Total: ${this.stats.total} | Concurrency: ${this.concurrency}`);
    
    const workers = [];
    for (let i = 0; i < this.concurrency; i++) {
      workers.push(this.worker(i.toString().padStart(2, '0')));
    }

    const reporter = setInterval(() => {
      process.stdout.write(`\rFANOUT: completed=${this.stats.completed}/${this.stats.total} | researching=${this.stats.researching} | queued=${this.stats.queued} | no_go=${this.stats.no_go} | ready=${this.stats.outreach_ready} | errors=${this.stats.errors}`);
    }, 1000);

    await Promise.all(workers);
    clearInterval(reporter);
    process.stdout.write('\n');
    
    return this.stats;
  }
}
