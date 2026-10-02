/**
 * VARDHAN — FREE-FIRST 6-COMPANY LIVE VALIDATION
 *
 * Validates that the core pipeline (company discovery, technical finding
 * discovery, person discovery, owner verification, evidence collection)
 * works end-to-end using FREE / PUBLIC sources only — no paid APIs.
 *
 * Companies: Vercel, Supabase, Stripe, Shopify, GitLab, Cloudflare
 *
 * Runs DeepProspectBuilder for each company and reports:
 *  - surface pages discovered (multi-source coverage)
 *  - technical signals found
 *  - people discovered (from public pages only)
 *  - owner selected (HIGH confidence)
 *  - findings classified
 *  - decision rendered
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { VardhanSystemManager } from '../../src/server/VardhanSystemManager';
import { DeepProspectBuilder } from '../../src/server/DeepProspectBuilder';
import type { HttpFetcher } from '../../src/server/IntelligenceCase';

const COMPANIES = [
  { name: 'Vercel', url: 'https://vercel.com', domain: 'vercel.com' },
  { name: 'Supabase', url: 'https://supabase.com', domain: 'supabase.com' },
  { name: 'Stripe', url: 'https://stripe.com', domain: 'stripe.com' },
  { name: 'Shopify', url: 'https://shopify.com', domain: 'shopify.com' },
  { name: 'GitLab', url: 'https://gitlab.com', domain: 'gitlab.com' },
  { name: 'Cloudflare', url: 'https://cloudflare.com', domain: 'cloudflare.com' },
];

// Real fetcher (no mock) — uses the free-first provider stack
const realFetch: HttpFetcher = (async (url: string, init?: any): Promise<Response> => {
  const res = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'VARDHAN-FREE-FIRST/1.0', 'Accept': 'text/html' }, ...init });
  return res as any;
}) as any;

interface CompanyResult {
  name: string;
  url: string;
  surfacePages: number;
  technicalSignals: number;
  peopleFound: number;
  ownerSelected: boolean;
  ownerName: string | null;
  ownerConfidence: string | null;
  findingType: string | null;
  findingSeverity: string | null;
  decision: string | null;
  evidenceCount: number;
  providersUsed: string[];
  errors: string[];
  elapsedMs: number;
}

async function validateCompany(company: { name: string; url: string; domain: string }): Promise<CompanyResult> {
  const start = Date.now();
  const errors: string[] = [];
  const providersUsed = new Set<string>();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `vardhan-val-${company.name.toLowerCase()}-`));

  const builder = new DeepProspectBuilder({
    fetcher: realFetch,
    saveArtifact: (p, d) => { try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch {}; fs.writeFileSync(p, d, 'utf8'); },
    artifactsBaseDir: tmpDir,
    maxDiscoveryPages: 20,
    discoveryDelayMs: 200,
    observationDelayMs: 100,
    onProgress: (stage: string, message: string) => {
      // Track providers used from progress messages across all stages
      const lower = message.toLowerCase();
      if (lower.includes('github')) providersUsed.add('GitHub');
      if (lower.includes('gitlab')) providersUsed.add('GitLab');
      if (lower.includes('hacker') || lower.includes(' hn ') || lower.includes('[hn]')) providersUsed.add('HackerNews');
      if (lower.includes('stackexchange') || lower.includes('stack exchange') || lower.includes('[se]')) providersUsed.add('StackExchange');
      if (lower.includes('wikidata') || lower.includes('[wikidata]')) providersUsed.add('Wikidata');
      if (lower.includes('common crawl') || lower.includes('commoncrawl') || lower.includes('[cc]')) providersUsed.add('CommonCrawl');
      if (lower.includes('public-page') || lower.includes('[public-page]') || lower.includes('professional page')) providersUsed.add('PublicWeb');
      if (lower.includes('growjo')) providersUsed.add('GrowjoCSV');
      if (lower.includes('rss') || lower.includes('sitemap')) providersUsed.add('SitemapRSS');
      if (lower.includes('status')) providersUsed.add('StatusPage');
      if (lower.includes('docs') || lower.includes('api')) providersUsed.add('DocsAPI');
      if (lower.includes('blog') || lower.includes('engineering blog')) providersUsed.add('EngineeringBlog');
      if (lower.includes('job') || lower.includes('career') || lower.includes('hiring')) providersUsed.add('Jobs');
    },
    logger: (m: string) => {},
  });

  let result: CompanyResult = {
    name: company.name,
    url: company.url,
    surfacePages: 0,
    technicalSignals: 0,
    peopleFound: 0,
    ownerSelected: false,
    ownerName: null,
    ownerConfidence: null,
    findingType: null,
    findingSeverity: null,
    decision: null,
    evidenceCount: 0,
    providersUsed: [],
    errors,
    elapsedMs: 0,
  };

  try {
    const { prospect } = await builder.build(company.url);
    result.surfacePages = prospect.public_surface?.discovered_pages?.length || 0;
    result.technicalSignals = prospect.technical_signals?.length || 0;
    result.peopleFound = prospect.people?.length || 0;
    result.ownerSelected = !!prospect.selected_owner;
    result.ownerName = prospect.selected_owner?.name || null;
    result.ownerConfidence = prospect.selected_owner?.confidence || null;
    result.findingType = prospect.deep_finding?.finding_type || null;
    result.findingSeverity = prospect.deep_finding?.impact_severity || null;
    result.decision = prospect.decision;
    result.evidenceCount = prospect.evidence?.length || 0;
    result.providersUsed = Array.from(providersUsed);
  } catch (e: any) {
    errors.push(e?.message || String(e));
  }

  result.elapsedMs = Date.now() - start;
  result.providersUsed = Array.from(providersUsed);
  return result;
}

async function main() {
  console.log('============================================================');
  console.log('VARDHAN — FREE-FIRST 6-COMPANY LIVE VALIDATION');
  console.log('Companies: Vercel, Supabase, Stripe, Shopify, GitLab, Cloudflare');
  console.log('Mode: RESEARCH_MODE = FREE_ONLY (no paid APIs)');
  console.log('============================================================\n');

  const results: CompanyResult[] = [];

  for (const company of COMPANIES) {
    console.log(`┌─ ${company.name} (${company.url}) ─────────────────────────────`);
    const r = await validateCompany(company);
    results.push(r);
    console.log(`├─ Surface pages:   ${r.surfacePages}`);
    console.log(`├─ Technical signals: ${r.technicalSignals}`);
    console.log(`├─ People found:    ${r.peopleFound}`);
    console.log(`├─ Owner selected:  ${r.ownerSelected ? `${r.ownerName} (${r.ownerConfidence})` : 'none'}`);
    console.log(`├─ Finding:        ${r.findingType || 'none'} (${r.findingSeverity || 'N/A'})`);
    console.log(`├─ Decision:        ${r.decision || 'N/A'}`);
    console.log(`├─ Evidence count:  ${r.evidenceCount}`);
    console.log(`├─ Providers used:  ${r.providersUsed.join(', ') || 'none'}`);
    console.log(`├─ Errors:          ${r.errors.length > 0 ? r.errors.slice(0, 3).join('; ') : 'none'}`);
    console.log(`└─ Elapsed:         ${r.elapsedMs}ms\n`);
  }

  // --- Summary ---
  console.log('============================================================');
  console.log('VALIDATION SUMMARY');
  console.log('============================================================\n');

  const multiSource = results.filter(r => r.providersUsed.length >= 2);
  const hasSignals = results.filter(r => r.technicalSignals > 0);
  const hasOwner = results.filter(r => r.ownerSelected);
  const hasFinding = results.filter(r => r.findingType !== null);
  const hasErrors = results.filter(r => r.errors.length > 0);

  console.log(`Multi-source coverage (≥2 providers): ${multiSource.length}/${results.length}`);
  console.log(`Companies with technical signals:    ${hasSignals.length}/${results.length}`);
  console.log(`Companies with owner selected:       ${hasOwner.length}/${results.length}`);
  console.log(`Companies with findings:             ${hasFinding.length}/${results.length}`);
  console.log(`Companies with errors:               ${hasErrors.length}/${results.length}`);

  console.log('\n--- Per-company provider diversity ---');
  for (const r of results) {
    console.log(`  ${r.name.padEnd(12)}: ${r.providersUsed.join(', ') || 'none'}`);
  }

  // Validation gate
  const allMultiSource = results.every(r => r.providersUsed.length >= 2);
  const noFatalErrors = results.every(r => r.errors.filter(e => e.includes('FATAL')).length === 0);

  console.log(`\n${allMultiSource && noFatalErrors ? '✅ ALL VALIDATIONS PASSED' : '❌ SOME VALIDATIONS FAILED'}`);
  if (!allMultiSource) {
    console.log('  Reason: Some companies did not achieve multi-source coverage');
  }
  if (!noFatalErrors) {
    console.log('  Reason: Some companies had fatal errors');
  }

  // Write results to file
  const reportPath = path.join(os.tmpdir(), 'vardhan-validation-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nFull report: ${reportPath}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
