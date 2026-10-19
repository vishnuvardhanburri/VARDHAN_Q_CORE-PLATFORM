/**
 * Live opportunity sweep CLI (read-only, no secrets, no auto-send).
 * End-to-end `research → qualify → draft` for a bank/company list producing
 * the ranked brief JSON consumed by the Rust API (part A).
 *
 * DDG THROTTLE LESSON: the keyless search provider is polite per-query
 * (~1.2s), but back-to-back companies still trip DuckDuckGo HTTP 429/202
 * rate limits. This CLI therefore sleeps 90s BETWEEN companies
 * (INTER_COMPANY_POLITENESS_MS). Do not remove or shorten without
 * re-validating against live DDG.
 *
 * Usage:
 *   npx tsx scripts/live-opportunity-sweep.ts --company "HSBC" --domain hsbc.com [--company ... --domain ...] [--max-sources N] [--out PATH]
 *   npx tsx scripts/live-opportunity-sweep.ts --targets hsbc,jpmorgan,lgt,swift [--max-sources N] [--out PATH]
 * Exit 0 on success (even with 0 sources — honest empty); exit 2 on usage error or crash.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { HttpFetcher } from '../src/server/IntelligenceCase.ts';
import { KeylessSearchProvider } from '../src/server/providers/KeylessSearchProvider.ts';
import {
  CompanyResearchPipeline,
  type CompanyResearchResult,
} from '../src/server/company/CompanyResearchPipeline.ts';
import {
  briefForCompany,
  dropBrief,
  rankBriefs,
  toRankedBrief,
  type RankedBrief,
  type SweepBrief,
  type SweepTarget,
} from '../src/server/commercial/SweepBriefing.ts';

/** Preset bank map for --targets (name → domain). */
const PRESET_TARGETS: Record<string, SweepTarget> = {
  hsbc: { company: 'HSBC', domain: 'hsbc.com' },
  jpmorgan: { company: 'JPMorgan', domain: 'jpmorgan.com' },
  lgt: { company: 'LGT', domain: 'lgt.com' },
  swift: { company: 'Swift', domain: 'swift.com' },
};

/** Inter-company politeness delay (see header comment). */
const INTER_COMPANY_POLITENESS_MS = 90_000;

interface SweepCliArgs {
  targets: SweepTarget[];
  maxSources: number;
  out: string;
}

function printUsage(): void {
  console.error(
    'Usage: npx tsx scripts/live-opportunity-sweep.ts (--company "Name" --domain d.com [...] | --targets hsbc,jpmorgan,lgt,swift) [--max-sources N] [--out PATH]',
  );
}

function parseArgs(argv: string[]): SweepCliArgs | null {
  const companies: string[] = [];
  const domains: string[] = [];
  let targetsRaw: string | undefined;
  let maxSources = 8;
  let out = path.join('.research', 'briefs', 'ranked.json');
  for (let i = 0; i < argv.length; i++) {
    const arg: string = argv[i];
    if (arg === '--company' && i + 1 < argv.length) {
      companies.push(argv[++i]);
    } else if (arg === '--domain' && i + 1 < argv.length) {
      domains.push(argv[++i]);
    } else if (arg === '--targets' && i + 1 < argv.length) {
      targetsRaw = argv[++i];
    } else if (arg === '--max-sources' && i + 1 < argv.length) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) maxSources = Math.floor(n);
    } else if (arg === '--out' && i + 1 < argv.length) {
      out = argv[++i];
    } else {
      return null;
    }
  }
  let targets: SweepTarget[] = [];
  if (targetsRaw !== undefined) {
    if (companies.length > 0 || domains.length > 0) return null;
    const keys: string[] = targetsRaw
      .split(',')
      .map((k: string) => k.trim().toLowerCase())
      .filter((k: string) => k.length > 0);
    if (keys.length === 0) return null;
    for (const key of keys) {
      const preset: SweepTarget | undefined = PRESET_TARGETS[key];
      if (preset === undefined) return null;
      targets.push({ company: preset.company, domain: preset.domain });
    }
  } else {
    if (companies.length === 0 || companies.length !== domains.length) return null;
    targets = companies.map((company: string, idx: number) => ({
      company: company.trim(),
      domain: domains[idx].trim(),
    }));
    if (targets.some((t: SweepTarget) => t.company.length === 0 || t.domain.length === 0)) return null;
  }
  return { targets, maxSources, out };
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'company';
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function oneLine(brief: SweepBrief): string {
  const draft: string =
    brief.draft !== null ? 'yes' : `no:${brief.draftBlockedReason ?? 'blocked'}`;
  return `${brief.company} verdict=${brief.verdict} score=${brief.score} sources=${brief.stats.sourcesRetrieved} draft=${draft}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    printUsage();
    process.exit(2);
  }
  try {
    const realFetcher: HttpFetcher = async (url, init) => fetch(url, init);
    const searchProvider = new KeylessSearchProvider({ fetcher: realFetcher });
    const pipeline = new CompanyResearchPipeline(searchProvider, realFetcher);
    const briefs: SweepBrief[] = [];
    for (let i = 0; i < args.targets.length; i++) {
      const target: SweepTarget = args.targets[i];
      if (i > 0) await sleep(INTER_COMPANY_POLITENESS_MS);
      try {
        const result: CompanyResearchResult = await pipeline.run(target.company, target.domain, {
          maxSources: args.maxSources,
        });
        briefs.push(briefForCompany(result, target.company, target.domain));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        briefs.push(
          dropBrief(target.company, target.domain, `Per-company sweep failed (isolated, others unaffected): ${message}`),
        );
      }
      const latest: SweepBrief = briefs[briefs.length - 1];
      console.log(oneLine(latest));
    }

    const ranked: SweepBrief[] = rankBriefs(briefs);
    const outPath: string = path.resolve(process.cwd(), args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    // Contract shape: full brief fields PLUS snake_case API keys
    // (signal_url/why_now/buyer_role, null never undefined) for the Rust
    // BriefSummary consumer (no #[serde(default)] — missing keys = BRIEFS_INVALID).
    const rankedContract: RankedBrief[] = ranked.map(toRankedBrief);
    fs.writeFileSync(outPath, JSON.stringify(rankedContract, null, 2), 'utf8');
    for (const brief of ranked) {
      const slug: string = slugify(brief.domain || brief.company);
      const perCompany: string = path.resolve(process.cwd(), '.research', 'briefs', `${slug}.json`);
      fs.mkdirSync(path.dirname(perCompany), { recursive: true });
      fs.writeFileSync(perCompany, JSON.stringify(brief, null, 2), 'utf8');
    }
    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`live-opportunity-sweep crashed: ${message}`);
    process.exit(2);
  }
}

void main();
