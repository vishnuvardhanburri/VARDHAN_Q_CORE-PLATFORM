/**
 * Live company research CLI (read-only, no secrets, no auto-outreach).
 * Usage: npx tsx scripts/live-company-research.ts --company "Name" --domain example.com [--max-sources N]
 * Exit 0 on success (even with 0 sources — honest empty); exit 2 on crash/usage error.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { HttpFetcher } from '../src/server/IntelligenceCase.ts';
import { KeylessSearchProvider } from '../src/server/providers/KeylessSearchProvider.ts';
import {
  CompanyResearchPipeline,
  type CompanyResearchResult,
  type VerifiedSource,
} from '../src/server/company/CompanyResearchPipeline.ts';

interface CliArgs {
  company: string;
  domain: string;
  maxSources: number;
}

function parseArgs(argv: string[]): CliArgs | null {
  let company: string | undefined;
  let domain: string | undefined;
  let maxSources = 12;
  for (let i = 0; i < argv.length; i++) {
    const arg: string = argv[i];
    if (arg === '--company' && i + 1 < argv.length) {
      company = argv[++i];
    } else if (arg === '--domain' && i + 1 < argv.length) {
      domain = argv[++i];
    } else if (arg === '--max-sources' && i + 1 < argv.length) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) maxSources = Math.floor(n);
    }
  }
  if (company === undefined || company.trim().length === 0) return null;
  if (domain === undefined || domain.trim().length === 0) return null;
  return { company: company.trim(), domain: domain.trim(), maxSources };
}

function printUsage(): void {
  console.error('Usage: npx tsx scripts/live-company-research.ts --company "Name" --domain example.com [--max-sources N]');
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'company';
}

function escapeMdCell(cell: string): string {
  return cell.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function excerptShort(excerpt: string, maxChars = 220): string {
  const flat = excerpt.replace(/\s+/g, ' ').trim();
  return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
}

function renderBrief(result: CompanyResearchResult): string {
  const lines: string[] = [];
  lines.push(`# ${result.company} — live company research`);
  lines.push('');
  lines.push(`- Domain: ${result.domain}`);
  lines.push(`- Run: ${result.runId} (${result.startedAt} → ${result.finishedAt})`);
  lines.push(`- Sources: ${result.stats.sourcesRetrieved} retrieved / ${result.stats.sourcesAttempted} attempted (duplicate rate ${(result.stats.duplicateRate * 100).toFixed(1)}%, claims-with-evidence ${result.stats.claimsWithEvidencePct.toFixed(1)}%)`);
  lines.push('');
  lines.push('## Top sources');
  lines.push('');
  const top: VerifiedSource[] = result.sources.slice(0, 5);
  if (top.length === 0) {
    lines.push('_No verified sources in this run — honest empty._');
  } else {
    lines.push('| # | URL | Publisher | Date | Excerpt |');
    lines.push('|---|-----|-----------|------|---------|');
    top.forEach((s: VerifiedSource, i: number) => {
      const date = s.publishedDate ?? s.retrievedAt;
      lines.push(`| ${i + 1} | ${escapeMdCell(s.canonicalUrl)} | ${escapeMdCell(s.publisher)} | ${escapeMdCell(date)} | ${escapeMdCell(excerptShort(s.excerpt))} |`);
    });
  }
  lines.push('');
  lines.push('## Signals');
  lines.push('');
  if (result.signals.length === 0) {
    lines.push('_No signals._');
  } else {
    for (const sig of result.signals.slice(0, 20)) {
      lines.push(`- [${sig.category}]${sig.verified ? '' : ' (unverified)'} ${sig.statement}`);
    }
  }
  lines.push('');
  lines.push('## Limitations');
  lines.push('');
  if (result.limitations.length === 0) {
    lines.push('_None recorded._');
  } else {
    for (const lim of result.limitations) lines.push(`- ${lim}`);
  }
  lines.push('');
  lines.push('## Stats');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(result.stats, null, 2));
  lines.push('```');
  lines.push('');
  return lines.join('\n');
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
    const result: CompanyResearchResult = await pipeline.run(args.company, args.domain, {
      maxSources: args.maxSources,
    });

    const outDir = path.resolve(process.cwd(), '.research', 'companies', slugify(args.domain || args.company));
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${result.runId}.json`), JSON.stringify(result, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'brief.md'), renderBrief(result), 'utf8');

    console.log(
      `company=${result.company} domain=${result.domain} run=${result.runId} ` +
        `sources=${result.stats.sourcesRetrieved}/${result.stats.sourcesAttempted} ` +
        `signals=${result.signals.length} limitations=${result.limitations.length}`,
    );
    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`live-company-research crashed: ${message}`);
    process.exit(2);
  }
}

void main();
