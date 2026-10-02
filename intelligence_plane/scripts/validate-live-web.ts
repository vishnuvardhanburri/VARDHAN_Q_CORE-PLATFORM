/**
 * VARDHAN — REAL VALIDATION (§24)
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs the live-web fallback + freshness validation on 6 real scenarios.
 * Uses de-novo-solutions.com (confirmed reachable from sandbox).
 *
 * Usage: npx tsx scripts/validate-live-web.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { DeepProspectBuilder } from '../src/server/DeepProspectBuilder';
import { DataSufficiencyChecker } from '../src/server/DataSufficiencyChecker';
import { StatePersistence } from '../src/server/StatePersistence';
import { ChangeDetector } from '../src/server/ChangeDetector';
import { FreshnessEngine } from '../src/server/FreshnessEngine';
import { ResearchBudget } from '../src/server/ResearchBudget';
import { QueryGenerator } from '../src/server/QueryGenerator';
import { NullSearchProvider, PublicWebSearchProvider } from '../src/server/WebSearchProvider';
import { snapshotFromProspect } from '../src/server/ChangeDetector';
import type { GrowjoCompany, ProviderCompanyLike, CompanyResolution } from '../src/server/DeepTypes';

const stateDir = path.join(process.cwd(), 'artifacts', 'intelligence', 'validation');
const statePersistence = new StatePersistence(stateDir);

function saveArtifact(p: string, data: string): void {
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data, 'utf8'); } catch { /* no-op in read-only */ }
}

const boundedFetch: typeof fetch = (async (url: string, init: any) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try { return await fetch(url, { ...(init || {}), signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}) as any;

interface Scenario {
  name: string;
  domain: string;
  description: string;
  providerData: any;
  searchProvider: any;
  skipLiveWeb?: boolean;
}

const scenarios: Scenario[] = [
  {
    name: 'Scenario 1: Dataset complete (sufficient)',
    domain: 'de-novo-solutions.com',
    description: 'Complete dataset record → no live-web research needed',
    providerData: {
      source: 'CSV', company: 'De Novo Solutions', canonical_name: 'De Novo Solutions',
      domain: 'de-novo-solutions.com', website: 'https://de-novo-solutions.com',
      industry: 'Technology', employee_count: 200, primary_person_name: 'John Smith',
      primary_title: 'Head of Engineering', primary_email: 'john@de-novo-solutions.com',
      linkedin_url: 'https://linkedin.com/company/denovosolutions', growjo_url: null,
      source_url: 'https://de-novo-solutions.com', retrieved_at: new Date().toISOString(),
      column_mapping: {}, raw: {},
    },
    searchProvider: new NullSearchProvider(),
    skipLiveWeb: false,
  },
  {
    name: 'Scenario 2: Dataset incomplete (missing people/contact) → live-web fallback',
    domain: 'de-novo-solutions.com',
    description: 'Incomplete dataset → triggers live-web research',
    providerData: {
      source: 'CSV', company: 'De Novo Solutions', canonical_name: 'De Novo Solutions',
      domain: 'de-novo-solutions.com', website: 'https://de-novo-solutions.com',
      industry: 'Technology', employee_count: 200, primary_person_name: null,
      primary_title: null, primary_email: null, linkedin_url: null, growjo_url: null,
      source_url: 'https://de-novo-solutions.com', retrieved_at: new Date().toISOString(),
      column_mapping: {}, raw: {},
    },
    searchProvider: new NullSearchProvider(),
    skipLiveWeb: false,
  },
  {
    name: 'Scenario 3: Dataset stale (365 days) → live-web refresh',
    domain: 'de-novo-solutions.com',
    description: 'Stale dataset → triggers live-web research for freshness',
    providerData: {
      source: 'CSV', company: 'De Novo Solutions', canonical_name: 'De Novo Solutions',
      domain: 'de-novo-solutions.com', website: 'https://de-novo-solutions.com',
      industry: 'Technology', employee_count: 200, primary_person_name: 'John Smith',
      primary_title: 'Head of Engineering', primary_email: 'john@de-novo-solutions.com',
      linkedin_url: 'https://linkedin.com/company/denovosolutions', growjo_url: null,
      source_url: 'https://de-novo-solutions.com', retrieved_at: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
      column_mapping: {}, raw: {},
    },
    searchProvider: new NullSearchProvider(),
    skipLiveWeb: false,
  },
  {
    name: 'Scenario 4: No dataset (domain-only seed) → full live-web discovery',
    domain: 'de-novo-solutions.com',
    description: 'No provider data → full live-web research from domain seed',
    providerData: null,
    searchProvider: new NullSearchProvider(),
    skipLiveWeb: false,
  },
  {
    name: 'Scenario 5: Search unavailable → SEARCH_UNAVAILABLE, continues with public sources',
    domain: 'de-novo-solutions.com',
    description: 'No search provider → SEARCH_UNAVAILABLE recorded, continues',
    providerData: null,
    searchProvider: new NullSearchProvider(),
    skipLiveWeb: false,
  },
  {
    name: 'Scenario 6: Search available (DuckDuckGo) → live research via search',
    domain: 'de-novo-solutions.com',
    description: 'DuckDuckGo search → evidence + sources from public search',
    providerData: null,
    searchProvider: new PublicWebSearchProvider({ fetcher: boundedFetch as any }),
    skipLiveWeb: false,
  },
];

async function runScenario(sc: Scenario, index: number): Promise<void> {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`SCENARIO ${index}: ${sc.name}`);
  console.log(`Domain: ${sc.domain} | ${sc.description}`);
  console.log(`${'='.repeat(70)}`);

  const resolution: CompanyResolution = {
    canonical_name: sc.providerData?.canonical_name || sc.domain,
    official_domain: sc.domain,
    resolution_method: sc.providerData ? 'GROWJO_DOMAIN' : 'AMBIGUOUS',
    resolution_source: sc.providerData?.source_url || `Direct seed: ${sc.domain}`,
    resolution_confidence: 'HIGH',
  };

  const target = `https://${sc.domain}`;
  const providerCompanies: ProviderCompanyLike[] = sc.providerData ? [sc.providerData] : [];

  const builder = new DeepProspectBuilder({
    fetcher: boundedFetch as any,
    saveArtifact,
    artifactsBaseDir: process.cwd(),
    maxDiscoveryPages: 15,
    discoveryDelayMs: 50,
    discoveryTimeoutMs: 8000,
    observationDelayMs: 50,
    onProgress: (stage, msg) => console.log(`  [${stage}] ${msg}`),
    logger: (m) => console.log(`  [discovery] ${m}`),
    growjo: (sc.providerData?.source === 'GROWJO' ? sc.providerData : null) as any,
    providerCompanies,
    resolution,
    searchProvider: sc.searchProvider,
    statePersistence,
    skipLiveWebResearch: sc.skipLiveWeb ?? false,
  });

  try {
    const { prospect, case_ref } = await builder.build(target);
    console.log(`\n  ── RESULT ──`);
    console.log(`  decision:           ${prospect.decision}`);
    console.log(`  confidence:         ${prospect.confidence}`);
    console.log(`  finding:            ${prospect.deep_finding?.finding_type || prospect.findings?.finding_type || 'NONE'}`);
    console.log(`  owner:              ${prospect.selected_owner?.name || '(none)'}`);
    console.log(`  people:             ${prospect.people.length}`);
    console.log(`  sources:            ${prospect.public_surface?.discovered_pages?.length || 0}`);
    console.log(`  evidence:           ${prospect.evidence.length}`);
    console.log(`  tech signals:       ${prospect.technical_signals.length}`);
    console.log(`  live_web_researched: ${prospect.live_web_researched}`);
    console.log(`  search_queries:     ${prospect.search_queries?.length || 0}`);
    console.log(`  live_web_evidence:  ${prospect.live_web_evidence?.length || 0}`);
    const ds = prospect.data_sufficiency;
    if (ds) {
      console.log(`  data_sufficiency:   sufficient=${ds.sufficient} needs_live=${ds.needs_live_research}`);
      console.log(`  missing:            ${ds.missing.join(', ') || '(none)'}`);
      console.log(`  stale:              ${ds.stale.join(', ') || '(none)'}`);
    }
    const changes = prospect.changes || [];
    console.log(`  changes:            ${changes.length}`);
  } catch (e: any) {
    console.log(`\n  ── ERROR: ${e?.message || String(e)} ──`);
  }
}

async function main(): Promise<void> {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`VARDHAN — REAL VALIDATION (§24): 6 Scenarios`);
  console.log(`${'='.repeat(70)}`);

  for (let i = 0; i < scenarios.length; i++) {
    await runScenario(scenarios[i], i + 1);
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`VALIDATION COMPLETE — 6 scenarios run.`);
  console.log(`${'='.repeat(70)}`);
}

void main();
