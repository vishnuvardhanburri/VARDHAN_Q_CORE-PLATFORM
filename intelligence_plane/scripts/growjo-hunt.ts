// growjo-hunt.ts
// ─────────────────
// UNIFIED VARDHAN DEEP-RESEARCH HUNT ENTRY POINT
//
// Supports all input modes:
//   npx tsx scripts/growjo-hunt.ts data/growjo_export.csv --batch 3
//   npx tsx scripts/growjo-hunt.ts data/ft1000_2026.csv --batch 5 --start 200
//   npx tsx scripts/growjo-hunt.ts --domains "vercel.com,supabase.com,stripe.com"
//   npx tsx scripts/growjo-hunt.ts --companies "Vercel,Supabase,Stripe"
//   npx tsx scripts/growjo-hunt.ts --research https://vercel.com
//
// All data sources are OPTIONAL / pluggable. When no CSV is provided,
// company names/domains are used as direct seeds — the pipeline resolves
// them independently of any provider.
//
// Honest decisions only (NO_GO / RESEARCH_MORE / OUTREACH_READY). No invented owners.

import * as fs from 'fs';
import * as path from 'path';
import { CSVProvider } from '../src/server/providers/CSVProvider';
import { PublicDatasetProvider } from '../src/server/providers/PublicDatasetProvider';
import { ProviderRegistry } from '../src/server/providers/ProviderRegistry';
import { GrowjoProviderAdapter } from '../src/server/providers/GrowjoProviderAdapter';
import { EntityResolver } from '../src/server/providers/EntityResolver';
import { GrowjoProvider } from '../src/server/GrowjoProvider';
import type { CanonicalCompany, CanonicalPerson } from '../src/server/providers/Model';
import type { CompanyResolution, DeepBuilderResult } from '../src/server/DeepTypes';
import type { ProviderCompanyLike } from '../src/server/DeepTypes';
import { DeepProspectBuilder } from '../src/server/DeepProspectBuilder';
import { StatePersistence } from '../src/server/StatePersistence';
import { CompanyQueue } from '../src/server/CompanyQueue';
import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { VardhanDecisionEngine } from '../src/server/VardhanDecisionEngine';
import { EvidenceLedger } from '../src/server/EvidenceLedger';
import { VardhanModelGateway, OllamaProvider } from '../src/server/VardhanModelGateway';
import { detectSearchCapabilities, NullSearchProvider, PublicWebSearchProvider, type SearchProvider } from '../src/server/WebSearchProvider';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

function saveArtifact(p: string, data: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data, 'utf8');
}

/** Shared state persistence directory for resume/refresh/changes. */
const statePersistence = new StatePersistence(path.join(process.cwd(), 'artifacts', 'intelligence'));

const boundedFetch: typeof fetch = (async (url: string, init: any) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try { return await fetch(url, { ...(init || {}), signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}) as any;

// ── Convert GrowjoCompany to CanonicalCompany (adds missing canonical fields) ──

function toCanonical(c: any): CanonicalCompany {
  return { ...c, people: c.people || [], contacts: c.contacts || [], entity_sources: c.entity_sources || [] };
}

// ── Arg parsing ──

interface HuntArgs {
  csv: string | null;
  batch: number;
  start: number;
  domains: string[];
  companies: string[];
  research: string | null;
}

function parseArgs(argv: string[]): HuntArgs {
  const raw = argv.slice(2);
  // First pass: identify and consume flag values so they don't leak as positional args
  const flagsWithValue = new Set(['--csv', '--batch', '--start', '--domains', '--companies', '--research']);
  const positionals: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (flagsWithValue.has(raw[i])) { i++; continue; } // skip flag + its value
    if (raw[i].startsWith('--')) { continue; }          // skip unknown flag
    positionals.push(raw[i]);                          // genuine positional
  }
  const csv = positionals[0] || null;
  const batchMatch = argv.join(' ').match(/--batch\s+(\d+)/);
  const startMatch = argv.join(' ').match(/--start\s+(\d+)/);
  const domainsMatch = argv.join(' ').match(/--domains\s+([\w.,\-:]+)/);
  const companiesMatch = argv.join(' ').match(/--companies\s+(["']?)([^"']+)\1/);
  const researchMatch = argv.join(' ').match(/--research\s+(https?:\/\/[\w.\-]+)/);
  return {
    csv,
    batch: batchMatch ? parseInt(batchMatch[1], 10) : 5,
    start: startMatch ? parseInt(startMatch[1], 10) : 0,
    domains: domainsMatch ? domainsMatch[1].split(',').map(d => d.trim()).filter(Boolean) : [],
    companies: companiesMatch ? companiesMatch[2].split(',').map(c => c.trim()).filter(Boolean) : [],
    research: researchMatch ? researchMatch[1] : null,
  };
}

// ── Resolution ──

function buildResolution(company: CanonicalCompany | null, domain: string, source: string): CompanyResolution {
  return {
    canonical_name: company?.canonical_name || domain,
    official_domain: domain,
    resolution_method: company && company.domain ? 'GROWJO_DOMAIN' : 'AMBIGUOUS',
    resolution_source: source,
    resolution_confidence: 'HIGH',
  };
}

// ── Single-company hunt ──

interface HuntResult {
  company: string; domain: string; sector: string;
  decision: string; confidence: string | null;
  finding: string; findingProvenance: string;
  owner: string | null; ownerConfidence: string | null; ownerProvenance: string | null;
  people: number; owner_candidates: number;
  growjo_person: boolean;
  provider_sources: string[];
  error: string | null;
  /** Full deep prospect (for show/why commands). */
  prospect?: any;
}

interface DeepRunOptions {
  maxDiscoveryPages?: number;
  discoveryDelayMs?: number;
  discoveryTimeoutMs?: number;
  observationDelayMs?: number;
  skipLiveWebResearch?: boolean;
}

async function runOne(
  company: CanonicalCompany | null,
  domain: string,
  targetUrl: string,
  providerCompanies: ProviderCompanyLike[],
  opts?: DeepRunOptions,
): Promise<HuntResult> {
  const growjoName = company?.canonical_name || domain;
  const sector = company?.industry || 'unknown';

  console.log(`\n${growjoName} (${targetUrl})`);
  if (company) {
    const hasPerson = !!(company.primary_person_name && company.primary_person_name !== company.company);
    console.log(`  [${company.source}] person=${company.primary_person_name || '(none)'}  title=${company.primary_title || '(none)'}  email=${company.primary_email || '(none)'}  hasPersonData=${hasPerson || !!company.primary_title || !!company.primary_email}`);
  }

  const resolution = buildResolution(company, domain, company?.source_url || `Direct seed: ${domain}`);

  const builder = new DeepProspectBuilder({
    fetcher: boundedFetch as any,
    saveArtifact,
    artifactsBaseDir: process.cwd(),
    maxDiscoveryPages: opts?.maxDiscoveryPages ?? 15,
    discoveryDelayMs: opts?.discoveryDelayMs ?? 40,
    discoveryTimeoutMs: opts?.discoveryTimeoutMs ?? 6000,
    observationDelayMs: opts?.observationDelayMs ?? 40,
    onProgress: (stage, msg) => console.log(`  [${stage}] ${msg}`),
    logger: (m) => console.log(`  [discovery] ${m}`),
    growjo: company && company.source === 'GROWJO' ? company as any : null,
    providerCompanies,
    resolution,
    statePersistence,
    searchProvider: detectSearchCapabilities().available
      ? new PublicWebSearchProvider({ fetcher: boundedFetch as any }) : new NullSearchProvider(),
    skipLiveWebResearch: opts?.skipLiveWebResearch ?? false,
  });

  const result: HuntResult = {
    company: growjoName, domain, sector,
    decision: '', confidence: null,
    finding: '', findingProvenance: '',
    owner: null, ownerConfidence: null, ownerProvenance: null,
    people: 0, owner_candidates: 0, growjo_person: false,
    provider_sources: company ? [company.source] : [],
    error: null,
  };

  try {
    const { prospect } = await withTimeout(builder.build(targetUrl), 90000);
    result.prospect = prospect;
    result.decision = prospect.decision;
    result.confidence = prospect.confidence;
    result.finding = prospect.deep_finding ? `${prospect.deep_finding.finding_type} / ${prospect.deep_finding.confidence}` : (prospect.findings ? prospect.findings.finding_type : 'NONE');
    result.findingProvenance = prospect.deep_finding ? prospect.deep_finding.provenance : '';
    result.owner = prospect.selected_owner ? prospect.selected_owner.name : '(none)';
    result.ownerConfidence = prospect.selected_owner ? prospect.selected_owner.confidence : null;
    result.ownerProvenance = prospect.selected_owner ? (prospect.selected_owner as any).deep_owner_provenance || '(none)' : null;
    result.people = prospect.people.length;
    result.owner_candidates = prospect.owner_candidates.length;
    result.growjo_person = !!company?.primary_person_name && company.primary_person_name !== company.company;
    console.log(`  ── RESULT: ${result.decision} (confidence ${result.confidence})`);
    console.log(`     finding:   ${result.finding}  [${result.findingProvenance}]`);
    console.log(`     owner:     ${result.owner} (${result.ownerConfidence}, provenance: ${result.ownerProvenance || 'none'})`);
    console.log(`     people:    ${result.people}  owner_candidates: ${result.owner_candidates}`);
  } catch (e: any) {
    result.error = e?.message || String(e);
    console.log(`  ── RESULT: ERROR: ${result.error}`);
  }

  return result;
}

// ── CSV loading — auto-detects format ──

function loadCsv(csvPath: string): { companies: CanonicalCompany[]; format: string; provider: string } {
  const text = fs.readFileSync(csvPath, 'utf8');

  // Try Growjo format (comma-delimited, matches GrowjoProvider aliases)
  const growjoResult = GrowjoProvider.parseCsv(text);
  if (growjoResult.companies.length > 0) {
    // Check if companies have real person data or are just company names
    const providerSource = growjoResult.column_mapping['name'] || growjoResult.column_mapping['company_name']
      ? 'GROWJO' : 'CSV';
    return { companies: growjoResult.companies.map(toCanonical), format: 'growjo-comma', provider: providerSource };
  }

  // Try generic CSV (comma-delimited)
  const csvProvider = new CSVProvider({ sourceUrl: csvPath });
  const csvResult = csvProvider.parseCsv(text);
  if (csvResult.companies.length > 0) {
    return { companies: csvResult.companies, format: 'generic-comma', provider: 'CSV' };
  }

  // Try semicolon-delimited (CityData / PublicDataset format)
  const publicProvider = new PublicDatasetProvider({
    datasetName: path.basename(csvPath),
    sourceUrl: csvPath,
  });
  const pubResult = publicProvider.parseCsv(text, ';');
  if (pubResult.companies.length > 0) {
    return { companies: pubResult.companies, format: 'citydata-semicolon', provider: 'PUBLIC_DATASET' };
  }

  throw new Error(`Could not parse CSV: ${csvPath}`);
}

// ── Show commands ──

async function showCompany(targetUrl: string, result: HuntResult, domain: string): Promise<void> {
  const p = result.prospect;
  if (!p) {
    console.log('  (no prospect data — research failed)');
    return;
  }
  console.log(`\n── COMPANY SURFACE ──`);
  console.log(`  company:         ${p.company}`);
  console.log(`  domain:          ${p.domain}`);
  console.log(`  industry:        ${p.industry}`);
  console.log(`  fit:             ${p.fit}`);
  console.log(`  public surface:  ${p.public_surface?.discovered_pages?.length || 0} page(s)`);
  for (const pg of (p.public_surface?.discovered_pages || [])) {
    console.log(`    ${pg.category || '??'}  ${pg.path || pg.url}`);
  }
  console.log(`\n── TECHNICAL SIGNALS ──`);
  for (const sig of (p.technical_signals || [])) {
    console.log(`  [${sig.signal_strength}] ${sig.type} — ${sig.relevance}  (${sig.source_url})`);
  }
  if (!p.technical_signals?.length) console.log('  (none)');
  console.log(`\n── FINDING ──`);
  console.log(`  ${p.deep_finding?.finding_type || p.findings?.finding_type || 'NONE'}  (${p.deep_finding?.confidence || p.findings?.impact_severity || '?'})`);
  if (p.deep_finding?.explanation) console.log(`  explanation: ${p.deep_finding.explanation.slice(0, 120)}`);
  console.log(`\n── DECISION ──`);
  console.log(`  ${p.decision} (confidence ${p.confidence})`);
}

async function showPeople(targetUrl: string, result: HuntResult, domain: string): Promise<void> {
  const p = result.prospect;
  if (!p) {
    console.log('  (no prospect data — research failed)');
    return;
  }
  console.log(`\n── PEOPLE DISCOVERED ──`);
  for (const person of (p.people || [])) {
    console.log(`  ${person.name} — ${person.role} (${person.confidence})`);
    console.log(`    sources: ${person.source_urls.join(', ')}`);
    console.log(`    evidence: ${(person.evidence || []).slice(0, 2).join(' | ')}`);
  }
  if (!p.people?.length) console.log('  (no people discovered — not invented)');
  console.log(`\n── OWNER CANDIDATES ──`);
  for (const c of (p.owner_candidates || [])) {
    console.log(`  ${c.name} — ${c.role} (${c.confidence})  explicit=${c.explicit_evidence}`);
  }
  if (!p.owner_candidates?.length) console.log('  (none)');
  console.log(`\n── SELECTED OWNER ──`);
  if (p.selected_owner) {
    console.log(`  ${p.selected_owner.name} — ${p.selected_owner.role} (${p.selected_owner.confidence})`);
    console.log(`  provenance: ${(p.selected_owner as any).deep_owner_provenance || '(none)'}`);
    console.log(`  finding link: ${p.selected_owner.finding_link}`);
    console.log(`  responsibility: ${p.selected_owner.responsibility_match}`);
    console.log(`  evidence:`);
    for (const e of (p.selected_owner.owner_evidence || [])) {
      console.log(`    — ${e.slice(0, 120)}`);
    }
  } else {
    console.log('  (none — HIGH-only gate: no verified person reached HIGH ownership confidence)');
  }
  console.log(`\n── CONTACTABILITY ──`);
  for (const c of (p.contactability || [])) {
    console.log(`  [${c.type}] ${(c.email || c.url || c.phone || '').slice(0, 60)}  confidence=${c.confidence}`);
  }
  if (!p.contactability?.length) console.log('  (no professional contact channels found)');
}

async function showOwnerReasoning(targetUrl: string, result: HuntResult, domain: string): Promise<void> {
  const p = result.prospect;
  if (!p) {
    console.log('  (no prospect data — research failed)');
    return;
  }
  console.log(`\n── OWNER RESOLUTION REASONING ──`);
  console.log(`  company: ${p.company}`);
  console.log(`  finding: ${p.deep_finding?.finding_type || p.findings?.finding_type || 'NONE'}`);
  console.log(`  technical area: ${p.deep_finding?.technical_area || 'n/a'}`);

  console.log(`\n  Candidate pool (${p.owner_candidates?.length || 0} candidates):`);
  for (const c of (p.owner_candidates || [])) {
    console.log(`    ${c.name} — ${c.role}  (${c.confidence})  explicit=${c.explicit_evidence}`);
    console.log(`      relationship: ${c.relationship_to_area}`);
    console.log(`      evidence: ${(c.evidence || []).slice(0, 1).join(' | ').slice(0, 100)}`);
  }

  if (p.selected_owner) {
    console.log(`\n  ✓ Selected: ${p.selected_owner.name} (${p.selected_owner.confidence})`);
    console.log(`    provenance: ${(p.selected_owner as any).deep_owner_provenance || '(none)'}`);
    console.log(`    HIGH-only gate: passed (candidate confidence = HIGH)`);
  } else {
    console.log(`\n  ✗ No owner selected — HIGH-only gate not met.`);
    console.log(`    (identity confidence ≠ ownership confidence — a person can be`);
    console.log(`     clearly listed (HIGH identity) but not a verified technical owner)`);
    console.log(`    (Strong ICP + good research + no HIGH owner → RESEARCH_MORE, not NO_GO)`);
  }

  console.log(`\n  Evidence lineage:`);
  if (p.evidence && p.evidence.length > 0) {
    for (const e of p.evidence.slice(0, 10)) {
      console.log(`    [${e.source_type || '?'}] ${e.public_url || e.id}  provenance=${e.evidence_origin}`);
    }
  } else {
    console.log('    (no evidence collected)');
  }

  console.log(`\n  Decision: ${p.decision} (confidence ${p.confidence})`);
  if (p.decision === 'RESEARCH_MORE' && !p.selected_owner) {
    console.log(`  → Strong technical surface but no verified HIGH-confidence owner.`);
    console.log(`  → Next step: deepen person discovery (engineering pages, GitHub contributors, blog authors).`);
  }
}

async function showFindingReasoning(targetUrl: string, result: HuntResult, domain: string): Promise<void> {
  const p = result.prospect;
  if (!p) {
    console.log('  (no prospect data — research failed)');
    return;
  }

  console.log(`\n── FINDING REASONING — ${p.company} ${domain} ──`);
  const finding = p.deep_finding;
  if (!finding) {
    console.log('  No deep finding.');
    console.log(`  Decision: ${p.decision} (confidence ${p.confidence})`);
    return;
  }

  console.log(`  Finding type:      ${finding.finding_type}`);
  console.log(`  Confidence:        ${finding.confidence}`);
  console.log(`  Provenance:        ${finding.provenance}`);
  console.log(`  Technical area:    ${finding.technical_area}`);
  if (finding.explanation) console.log(`  Explanation:       ${finding.explanation}`);

  // Decision-engine dimension analysis
  const ctx = {
    company: p.company, domain,
    signals: p.technical_signals || [],
    evidence: p.evidence || [],
    finding,
    findings: p.findings,
    signals_count: p.technical_signals?.length || 0,
    evidence_count: p.evidence?.length || 0,
    sources_count: p.public_surface?.discovered_pages?.length || 0,
    owner: p.selected_owner || null,
    contacts: p.contactability || [],
    previous_state: null,
  };
  const decision = VardhanDecisionEngine.decide(ctx as any);
  console.log(`  Decision engine:   ${decision.outcome} (score ${decision.score}/${decision.max_score})`);
  console.log(`  Reason:            ${decision.reason}`);
  if (decision.warnings.length > 0) {
    console.log(`  Warnings:`);
    for (const w of decision.warnings) console.log(`    ⚠ ${w}`);
  }
  console.log(`  Dimension scores:`);
  for (const d of decision.dimensions) {
    console.log(`    ${d.name.padEnd(24)} ${d.score}  — ${d.explanation}`);
  }
}

async function showFindings(targetUrl: string, result: HuntResult, domain: string): Promise<void> {
  const p = result.prospect;
  if (!p) { console.log('  (no prospect data)'); return; }
  console.log(`\n── FINDINGS — ${p.company} ${domain} ──`);
  const deep = p.deep_finding;
  const shallow = p.findings;
  if (deep) {
    console.log(`  Deep finding: ${deep.finding_type} (${deep.confidence})`);
    console.log(`    provenance: ${deep.provenance}`);
    console.log(`    technical_area: ${deep.technical_area || 'n/a'}`);
    if (deep.explanation) console.log(`    explanation: ${deep.explanation.slice(0, 200)}`);
    if (deep.evidence_ids?.length) console.log(`    evidence_ids: ${deep.evidence_ids.join(', ')}`);
  }
  if (shallow) {
    console.log(`  Shallow finding: ${shallow.finding_type} (${shallow.impact_severity})`);
  }
  if (!deep && !shallow) console.log('  (no findings)');

  // Decision rationale
  const decision = result.prospect ? VardhanDecisionEngine.decide({
    company: p.company, domain,
    signals: p.technical_signals || [],
    evidence: p.evidence || [],
    finding: deep,
    findings: shallow,
    signals_count: p.technical_signals?.length || 0,
    evidence_count: p.evidence?.length || 0,
    sources_count: p.public_surface?.discovered_pages?.length || 0,
    owner: p.selected_owner || null,
    contacts: p.contactability || [],
    previous_state: null,
  } as any) : null;
  if (decision) {
    console.log(`  Decision: ${decision.outcome} (score ${decision.score}/${decision.max_score})`);
    console.log(`  Rationale: ${decision.reason}`);
  }
}

async function showEvidence(targetUrl: string, result: HuntResult, domain: string): Promise<void> {
  const p = result.prospect;
  if (!p) { console.log('  (no prospect data)'); return; }
  console.log(`\n── EVIDENCE LEDGER — ${p.company} ${domain} ──`);

  // Use the EvidenceLedger for traceability
  const ledger = new EvidenceLedger(path.join(process.cwd(), 'artifacts', 'intelligence', 'evidence'));
  const companyEvidence = ledger.getCompanyEvidence(domain);
  if (companyEvidence.evidence.length > 0) {
    console.log(`  Ledger evidence: ${companyEvidence.evidence.length} record(s)`);
    for (const e of companyEvidence.evidence.slice(0, 20)) {
      console.log(`    [${e.evidence_type}/${e.evidence_origin}] ${e.observed_behavior.slice(0, 80)}…`);
      console.log(`      url: ${e.public_url}`);
      console.log(`      method: ${e.method} status: ${e.status} retrieved: ${e.retrieved_at}`);
    }
    console.log(`  Summary: ${JSON.stringify(companyEvidence.summary, null, 2)}`);
  } else {
    console.log('  (no ledger evidence — showing prospect evidence)');
    for (const e of (p.evidence || []).slice(0, 20)) {
      console.log(`    [${e.source_type || '?'}] ${e.public_url || e.id}`);
      console.log(`      ${e.observed_behavior || e.evidence_text || ''}`);
    }
  }

  // Backward trace for any findings
  if (p.deep_finding?.evidence_ids?.length) {
    console.log(`\n  Trace: finding → evidence → source`);
    for (const id of p.deep_finding.evidence_ids) {
      const links = ledger.traceBackward(id);
      for (const link of links) {
        console.log(`    ${link.from_id} → ${link.to_id} (${link.relationship}) via evidence [${link.evidence_ids.join(', ')}]`);
      }
    }
  }
}

async function showSources(targetUrl: string, result: HuntResult, domain: string): Promise<void> {
  const p = result.prospect;
  if (!p) { console.log('  (no prospect data)'); return; }
  console.log(`\n── DISCOVERED SOURCES — ${p.company} ${domain} ──`);
  const pages = p.public_surface?.discovered_pages || [];
  for (const pg of pages) {
    const tier = categorizeTierFromUrl(pg.url);
    const rel = relateFromUrl(pg.url);
    console.log(`  Tier ${tier} [${rel}] ${pg.category || '??'}  ${pg.path || pg.url}  (HTTP ${pg.status ?? '?'})`);
  }
  if (pages.length === 0) console.log('  (no sources discovered)');

  // Show identity graph relationships
  if (p.public_surface) {
    console.log(`\n  Identity graph:`);
    const pagesAny = pages as any[];
    const categories = new Set(pagesAny.map((pg: any) => pg.category));
    for (const cat of categories) {
      const catPages = pagesAny.filter((pg: any) => pg.category === cat);
      console.log(`    ${cat} (${catPages.length}): ${catPages.map((pg: any) => pg.path).slice(0, 5).join(', ')}`);
    }
  }
}

function categorizeTierFromUrl(url: string): 1 | 2 | 3 | 4 | 5 | 6 {
  if (url.includes('/docs') || url.includes('/api') || url.includes('/status') || url.includes('/security')) return 2;
  if (url.includes('/blog') || url.includes('/careers') || url.includes('/engineering')) return 3;
  return 1;
}
function relateFromUrl(url: string): string {
  const u = typeof url === 'string' ? url : '';
  if (u.includes('github.com')) return 'LINKED';
  if (u.includes('/docs') || u.includes('/api') || u.includes('/status') || u.includes('/security') || u.includes('/blog') || u.includes('/careers')) return 'LINKED';
  return 'OFFICIAL';
}

async function main(): Promise<void> {
  const { csv, batch, start, domains, companies: companyNames, research } = parseArgs(process.argv);

  // Initialize provider registry (providers are optional/pluggable)
  const registry = new ProviderRegistry();
  const entityResolver = new EntityResolver();

  // ── Mode 1: --research <URL> ──
  if (research) {
    console.log(`VARDHAN HUNT — direct research: ${research}`);
    console.log(`Providers: (none — direct seed, no Growjo required)`);
    const result = await runOne(null, new URL(research).hostname, research, []);
    printSummary([result]);
    return;
  }

  // ── Mode 2: --domains ──
  if (domains.length > 0) {
    console.log(`VARDHAN HUNT — ${domains.length} domain seed(s): ${domains.join(', ')}`);
    console.log(`Providers: (none — direct domain seeds, no Growjo required)`);
    const results: HuntResult[] = [];
    let i = 0;
    for (const d of domains) {
      i++;
      try {
        const providerCompanies: CanonicalCompany[] = csv ? loadCsv(csv).companies : [];
        const company = providerCompanies.find(c => (c.domain || '').toLowerCase() === d.toLowerCase()) || null;
        const target = d.startsWith('http') ? d : `https://${d}`;
        results.push(await runOne(company, d, target, company ? [company] : []));
      } catch (e: any) {
        console.log(`\n[${i}/${domains.length}] ${d} — FAILED: ${e?.message || String(e)}`);
        results.push({ company: d, domain: d, sector: 'unknown', decision: 'ERROR', confidence: null, finding: '', findingProvenance: '', owner: null, ownerConfidence: null, ownerProvenance: null, people: 0, owner_candidates: 0, growjo_person: false, provider_sources: [], error: e?.message || String(e) });
      }
    }
    printSummary(results);
    return;
  }

  // ── Mode 3: --companies ──
  if (companyNames.length > 0) {
    console.log(`VARDHAN HUNT — ${companyNames.length} company name seed(s): ${companyNames.join(', ')}`);
    console.log(`Providers: (none — direct name seeds, no Growjo required)`);
    const results: HuntResult[] = [];
    let i = 0;
    for (const name of companyNames) {
      i++;
      try {
        const providerCompanies: CanonicalCompany[] = csv ? loadCsv(csv).companies : [];
        const company = providerCompanies.find(c => c.company.toLowerCase().includes(name.toLowerCase())) || null;
        const domain = company?.domain || name.toLowerCase().replace(/\s+/g, '') + '.com';
        const target = `https://${domain.replace(/^https?:\/\//, '')}`;
        results.push(await runOne(company, domain, target, company ? [company] : []));
      } catch (e: any) {
        console.log(`\n[${i}/${companyNames.length}] ${name} — FAILED: ${e?.message || String(e)}`);
        results.push({ company: name, domain: '', sector: 'unknown', decision: 'ERROR', confidence: null, finding: '', findingProvenance: '', owner: null, ownerConfidence: null, ownerProvenance: null, people: 0, owner_candidates: 0, growjo_person: false, provider_sources: [], error: e?.message || String(e) });
      }
    }
    printSummary(results);
    return;
  }

  // ── Mode 4: CSV file (batch) ──
  if (csv) {
    const { companies, format, provider } = loadCsv(csv);
    console.log(`VARDHAN HUNT — ${companies.length} companies from ${csv}`);
    console.log(`Format: ${format} | Provider source: ${provider}`);

    const slice = companies.slice(start, start + batch);
    const results: HuntResult[] = [];
    let i = start;
    for (const c of slice) {
      i++;
      try {
        const targetUrl = c.domain ? (c.domain.startsWith('http') ? c.domain : `https://${c.domain}`) : `https://${c.canonical_name.replace(/\s+/g, '').toLowerCase()}.com`;
        const providerCompanies = [c] as ProviderCompanyLike[];
        results.push(await runOne(c, c.domain || '', targetUrl, providerCompanies));
      } catch (e: any) {
        console.log(`\n[${i}/${companies.length}] ${c.canonical_name} — FAILED: ${e?.message || String(e)}`);
        results.push({ company: c.canonical_name, domain: c.domain || '', sector: c.industry || 'unknown', decision: 'ERROR', confidence: null, finding: '', findingProvenance: '', owner: null, ownerConfidence: null, ownerProvenance: null, people: 0, owner_candidates: 0, growjo_person: false, provider_sources: [c.source], error: e?.message || String(e) });
      }
    }
    printSummary(results);
    return;
  }

  // ── Mode --show (REPL-style display subcommands) ──
  // Usage: npx tsx scripts/growjo-hunt.ts show company <domain>
  //        npx tsx scripts/growjo-hunt.ts show people <domain>
  //        npx tsx scripts/growjo-hunt.ts why owner <domain>
  const subcommand = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (subcommand === 'show' || subcommand === 'why') {
    const subArgs = process.argv.slice(2).filter(a => !a.startsWith('--'));
    const mode = subArgs[0]; // 'show' or 'why'
    const aspect = subArgs[1];  // 'company' | 'people' | 'owner'
    const targetDomain = subArgs[2];
    if (!aspect || !targetDomain) {
      console.error(`Usage: npx tsx scripts/growjo-hunt.ts ${mode} ${aspect || '<aspect>'} <domain>`);
    console.error(`  show company <domain>    — full company surface + signals + findings`);
    console.error(`  show people <domain>     — discovered people + owner candidates`);
    console.error(`  show findings <domain>   — all findings with evidence linkage`);
    console.error(`  show evidence <domain>   — full evidence ledger backward trace`);
    console.error(`  show sources <domain>    — discovered sources + relationship graph`);
    console.error(`  why owner <domain>       — owner resolution reasoning`);
    console.error(`  why finding <domain>     — finding explanation + evidence dimensions`);
    process.exit(1);
  }

    const target = `https://${targetDomain.replace(/^https?:\/\//, '')}`;
    const result = await runOne(null, targetDomain, target, []);

    if (aspect === 'company') {
      await showCompany(target, result, targetDomain);
    } else if (aspect === 'people') {
      await showPeople(target, result, targetDomain);
    } else if (aspect === 'findings') {
      await showFindings(target, result, targetDomain);
    } else if (aspect === 'evidence') {
      await showEvidence(target, result, targetDomain);
    } else if (aspect === 'sources') {
      await showSources(target, result, targetDomain);
    } else if (aspect === 'owner' || (mode === 'why' && aspect === 'owner')) {
      await showOwnerReasoning(target, result, targetDomain);
    } else if (mode === 'why' && aspect === 'finding') {
      await showFindingReasoning(target, result, targetDomain);
    } else {
      console.error(`Unknown aspect: ${aspect}`);
      process.exit(1);
    }
    return;
  }

  // ── Mode: refresh <domain> — re-research a single company with fresh state ──
  if (subcommand === 'refresh') {
    const domain = process.argv.slice(2).filter(a => !a.startsWith('--'))[1];
    if (!domain) {
      console.error('Usage: npx tsx scripts/growjo-hunt.ts refresh <domain>');
      process.exit(1);
    }
    console.log(`VARDHAN REFRESH — re-researching ${domain}`);
    console.log(`Providers: (dataset-first; live-web fallback when incomplete/stale)`);
    const target = `https://${domain.replace(/^https?:\/\//, '')}`;
    const csvCompanies = csv ? loadCsv(csv).companies : [];
    const company = csvCompanies.find(c => (c.domain || '').toLowerCase() === domain.toLowerCase()) || null;
    const result = await runOne(company, domain, target, company ? [company] : []);
    if (result.prospect) {
      showChanges(result.prospect, domain);
    } else {
      console.log('  (no prospect data — refresh failed)');
    }
    return;
  }

  // ── Mode: refresh all — re-research all companies with stored state ──
  if (subcommand === 'refresh-all' || (subcommand === 'refresh' && process.argv.slice(2).includes('--all'))) {
    const allDomains = parseRefreshAll(process.argv, csv);
    console.log(`VARDHAN REFRESH-ALL — re-researching ${allDomains.length} company/companies`);
    const results: HuntResult[] = [];
    let i = 0;
    for (const d of allDomains) {
      i++;
      try {
        const csvCompanies = csv ? loadCsv(csv).companies : [];
        const company = csvCompanies.find(c => (c.domain || '').toLowerCase() === d.toLowerCase()) || null;
        const target = d.startsWith('http') ? d : `https://${d}`;
        console.log(`\n[${i}/${allDomains.length}] Refreshing ${d}...`);
        results.push(await runOne(company, d, target, company ? [company] : []));
      } catch (e: any) {
        console.log(`\n[${i}/${allDomains.length}] ${d} — FAILED: ${e?.message || String(e)}`);
        results.push({ company: d, domain: d, sector: 'unknown', decision: 'ERROR', confidence: null, finding: '', findingProvenance: '', owner: null, ownerConfidence: null, ownerProvenance: null, people: 0, owner_candidates: 0, growjo_person: false, provider_sources: [], error: e?.message || String(e) });
      }
    }
    printSummary(results);
    return;
  }

  // ── Mode: changes <domain> — show diff vs. previously stored state ──
  if (subcommand === 'changes') {
    const domain = process.argv.slice(2).filter(a => !a.startsWith('--'))[1];
    if (!domain) {
      console.error('Usage: npx tsx scripts/growjo-hunt.ts changes <domain>');
      process.exit(1);
    }
    console.log(`VARDHAN CHANGES — diff for ${domain}`);
    const target = `https://${domain.replace(/^https?:\/\//, '')}`;
    const csvCompanies = csv ? loadCsv(csv).companies : [];
    const company = csvCompanies.find(c => (c.domain || '').toLowerCase() === domain.toLowerCase()) || null;
    const result = await runOne(company, domain, target, company ? [company] : []);
    if (result.prospect) {
      showChanges(result.prospect, domain);
    } else {
      console.log('  (no prospect data — cannot diff)');
    }
    return;
  }

  // ── Mode: hunt <domain> — autonomous system-managed research ──
  if (subcommand === 'hunt') {
    const domain = process.argv.slice(2).filter(a => !a.startsWith('--'))[1];
    if (!domain) {
      console.error('Usage: npx tsx scripts/growjo-hunt.ts hunt <domain> [--deep]');
      console.error('  Autonomous full-stack research via VardhanSystemManager.');
      console.error('  --deep  enable max-depth research (all tiers, full budget).');
      process.exit(1);
    }
    const deepMode = process.argv.includes('--deep');
    console.log(`VARDHAN HUNT (system-managed) — researching ${domain}${deepMode ? ' [DEEP MODE]' : ''}`);
    const target = `https://${domain.replace(/^https?:\/\//, '')}`;
    const csvCompanies = csv ? loadCsv(csv).companies : [];
    const company = csvCompanies.find(c => (c.domain || '').toLowerCase() === domain.toLowerCase()) || null;
    const providerCompanies = company ? [company] : [];

    const modelGateway = new VardhanModelGateway();
    if (process.env.VARDHAN_OLLAMA_URL || process.env.VARDHAN_OLLAMA_MODEL) {
      const ollama = new OllamaProvider({});
      modelGateway.addProvider(ollama);
    }

    const searchCaps = detectSearchCapabilities();
    const searchProvider: SearchProvider = searchCaps.available
      ? new PublicWebSearchProvider({ fetcher: boundedFetch as any })
      : new NullSearchProvider();

    const mgr = new VardhanSystemManager({
      fetcher: boundedFetch as any,
      searchProvider,
      modelGateway,
      artifactsDir: process.cwd(),
      output: { write: (s: string) => console.log(s) },
    });

    const report = await mgr.researchCompany(company?.canonical_name || domain, domain, providerCompanies);

    console.log(`\n── HUNT REPORT — ${report.company} (${report.domain}) ──`);
    console.log(`  run id:                ${report.runId}`);
    console.log(`  state:                 ${report.state}`);
    console.log(`  phase:                 ${report.phase}`);
    if (report.triage) {
      console.log(`  triage:                ${report.triage.decision} — ${report.triage.signals.length} signals, ${report.triage.requests} requests, ${report.triage.timeMs}ms`);
    }
    if (report.finding) {
      console.log(`  finding:               ${report.finding.classification}`);
      console.log(`    title:    ${report.finding.title || 'n/a'}`);
      console.log(`    conf:     ${report.finding.confidence}`);
      console.log(`    evidence: ${report.finding.evidenceIds.length} ID(s)`);
      console.log(`    expl:     ${report.finding.explanation.slice(0, 120)}`);
    }
    console.log(`  evidence count:        ${report.evidenceCount}`);
    console.log(`  signals count:         ${report.signalCount}`);
    console.log(`  owner:                 ${report.owner ? `${report.owner.name} (${report.owner.role}, ${report.owner.confidence})` : '(none)'}`);
    console.log(`  outreach ready:        ${report.outreachReady}`);
    console.log(`  failures:              ${report.failures.length}`);
    for (const f of report.failures) console.log(`    ${f.type}: ${f.source} → ${f.strategy}`);
    console.log(`  next research action:  ${report.nextResearchAction}`);
    console.log(`  time:                  ${report.timeMs}ms`);
    console.log(`  audit trail (${report.auditTrail.length} steps):`);
    for (const step of report.auditTrail) console.log(`    • ${step}`);
    return;
  }

  // ── Mode: research <domain> — show current phase and budget ──
  if (subcommand === 'research') {
    const domain = process.argv.slice(2).filter(a => !a.startsWith('--'))[1];
    if (!domain) {
      console.error('Usage: npx tsx scripts/growjo-hunt.ts research <domain> [--deep]');
      console.error('  Shows current phase and budget. --deep forces full-depth research.');
      process.exit(1);
    }
    const deepMode = process.argv.includes('--deep');
    console.log(`VARDHAN RESEARCH — ${domain}${deepMode ? ' [DEEP MODE]' : ''}`);

    const searchCaps = detectSearchCapabilities();
    const searchProvider: SearchProvider = searchCaps.available
      ? new PublicWebSearchProvider({ fetcher: boundedFetch as any })
      : new NullSearchProvider();
    const modelGateway = new VardhanModelGateway();
    const ollama = new OllamaProvider({});
    modelGateway.addProvider(ollama);

    const mgr = new VardhanSystemManager({
      fetcher: boundedFetch as any,
      searchProvider,
      modelGateway,
      artifactsDir: process.cwd(),
      output: { write: (s: string) => console.log(s) },
    });

    const csvCompanies = csv ? loadCsv(csv).companies : [];
    const company = csvCompanies.find(c => (c.domain || '').toLowerCase() === domain.toLowerCase()) || null;
    const report = await mgr.researchCompany(company?.canonical_name || domain, domain, company ? [company] : []);

    console.log(`\n── RESEARCH — ${report.company} (${report.domain}) ──`);
    console.log(`  phase:                 ${report.phase}`);
    console.log(`  time:                  ${report.timeMs}ms`);
    if (report.triage) {
      console.log(`  triage:                ${report.triage.decision}`);
      console.log(`    signals: ${report.triage.signals.slice(0, 5).join('; ')}`);
      console.log(`    http requests: ${report.triage.requests}`);
      console.log(`    time: ${report.triage.timeMs}ms`);
    }
    if (report.finding) {
      console.log(`  finding:               ${report.finding.classification}`);
      if (report.finding.title) console.log(`    title:  ${report.finding.title}`);
      console.log(`    evidence: ${report.finding.evidenceIds.length}`);
      console.log(`    explanation: ${report.finding.explanation.slice(0, 200)}`);
    } else {
      console.log(`  finding:               (none)`);
    }
    console.log(`  signal count:          ${report.signalCount}`);
    console.log(`  evidence count:        ${report.evidenceCount}`);
    console.log(`  owner:                 ${report.owner ? report.owner.name : '(none)'}`);
    console.log(`  outreach ready:        ${report.outreachReady}`);
    console.log(`  next action:           ${report.nextResearchAction}`);
    return;
  }

  // ── Mode: show research <domain> — detailed research state ──
  if (subcommand === 'show' && process.argv.slice(2).filter(a => !a.startsWith('--'))[1] === 'research') {
    const domain = process.argv.slice(2).filter(a => !a.startsWith('--'))[2];
    if (!domain) {
      console.error('Usage: npx tsx scripts/growjo-hunt.ts show research <domain>');
      process.exit(1);
    }
    const stateDir = path.join(process.cwd(), 'artifacts', 'intelligence');
    const prospectFile = path.join(stateDir, 'deep', `${domain}.prospect.json`);

    console.log(`\n── RESEARCH STATE — ${domain} ──`);
    if (fs.existsSync(prospectFile)) {
      const prospect = JSON.parse(fs.readFileSync(prospectFile, 'utf8'));
      console.log(`  sources:     ${prospect.public_surface?.discovered_pages?.length || 0}`);
      console.log(`  evidence:    ${prospect.evidence?.length || 0}`);
      console.log(`  signals:     ${prospect.technical_signals?.length || 0}`);
      console.log(`  people:      ${prospect.people?.length || 0}`);
      console.log(`  owners:      ${prospect.owner_candidates?.length || 0}`);
      console.log(`  finding:     ${prospect.deep_finding?.finding_type || prospect.findings?.finding_type || 'NONE'}`);
      console.log(`  decision:    ${prospect.decision} (${prospect.confidence})`);
      console.log(`  data sufficiency: sufficient=${prospect.data_sufficiency?.sufficient || false}`);
      console.log(`  live web researched: ${prospect.live_web_researched || false}`);
      console.log(`  live web evidence: ${prospect.live_web_evidence?.length || 0}`);
      console.log(`  search queries: ${prospect.search_queries?.length || 0}`);
      if (prospect.search_queries) {
        for (const q of prospect.search_queries) console.log(`    ${q.cached ? '[cached]' : '[new]'} "${q.query}" → ${q.results} results`);
      }
    } else {
      console.log('  (no stored research state — run "hunt" or "refresh" first)');
    }
    return;
  }

  // ── Mode: deep <domain> — force maximum-depth deep research ──
  if (subcommand === 'deep') {
    const domain = process.argv.slice(2).filter(a => !a.startsWith('--'))[1];
    if (!domain) {
      console.error('Usage: npx tsx scripts/growjo-hunt.ts deep <domain>');
      console.error('  Force maximum-depth deep research (full budget, all stages).');
      process.exit(1);
    }
    console.log(`VARDHAN DEEP — maximum-depth research for ${domain}`);
    const target = `https://${domain.replace(/^https?:\/\//, '')}`;
    const csvCompanies = csv ? loadCsv(csv).companies : [];
    const company = csvCompanies.find(c => (c.domain || '').toLowerCase() === domain.toLowerCase()) || null;
    const providerCompanies = company ? [company] : [];
    const result = await runOne(
      company, domain, target, providerCompanies,
      { maxDiscoveryPages: 35, discoveryDelayMs: 25, skipLiveWebResearch: false },
    );
    printSummary([result]);
    return;
  }

  // ── Mode: status — show system manager state ──
  if (subcommand === 'status') {
    const modelGateway = new VardhanModelGateway();
    const ollama = new OllamaProvider({});
    modelGateway.addProvider(ollama);
    await modelGateway.checkHealth();
    const searchCaps = detectSearchCapabilities();
    const statePersistence = new StatePersistence(path.join(process.cwd(), 'artifacts', 'intelligence'));
    const queuePath = path.join(process.cwd(), 'artifacts', 'intelligence', 'queue.jsonl');
    let queue: any[] = [];
    try { queue = new CompanyQueue(queuePath).list(); } catch { /* no queue yet */ }
    const allDomains = await statePersistence.listAll();

    console.log('\n── VARDHAN SYSTEM STATUS ──');
    console.log(`  Ollama:                 ${ollama.available ? 'AVAILABLE' : 'not reachable'}`);
    console.log(`  Search (public):        ${searchCaps ? 'available (DuckDuckGo)' : 'unavailable (NullSearchProvider)'}`);
    console.log(`  Model gateway:          ${modelGateway.hasAvailableModel ? 'has available model' : 'no model (deterministic only)'}`);
    console.log(`  Companies in queue:     ${queue.length}`);
    const byState = queue.reduce((acc: Record<string, number>, r: any) => { acc[r.state] = (acc[r.state] || 0) + 1; return acc; }, {});
    const breakdown = Object.entries(byState).map(([s, n]) => `${s}=${n}`).join(', ');
    console.log(`  Queue breakdown:        ${breakdown || '0'}`);
    console.log(`  Companies with state:   ${allDomains.length}`);
    for (const d of allDomains.slice(0, 15)) {
      console.log(`    ${d.domain} — ${d.last_researched_at} — ${d.last_summary?.decision || '?'} / ${d.last_summary?.finding || '?'}`);
    }
    if (allDomains.length > 15) console.log(`    ... and ${allDomains.length - 15} more`);
    return;
  }

  // ── Mode: pipeline <domain> — show stage-by-stage progress ──
  if (subcommand === 'pipeline') {
    const domain = process.argv.slice(2).filter(a => !a.startsWith('--'))[1];
    if (!domain) {
      console.error('Usage: npx tsx scripts/growjo-hunt.ts pipeline <domain>');
      console.error('  Shows the stage-by-stage pipeline progress for a company.');
      process.exit(1);
    }
    const stateDir = path.join(process.cwd(), 'artifacts', 'intelligence');
    const prospectFile = path.join(stateDir, 'deep', `${domain}.prospect.json`);
    if (!fs.existsSync(prospectFile)) {
      console.log(`No stored prospect for ${domain} — run 'hunt' or 'refresh' first.`);
      process.exit(0);
    }
    const prospect = JSON.parse(fs.readFileSync(prospectFile, 'utf8'));

    console.log(`\n── PIPELINE PROGRESS — ${prospect.company} (${domain}) ──`);
    const stages = [
      { name: 'company', label: '1. Company' },
      { name: 'surface', label: '2. Surface Discovery' },
      { name: 'completeness', label: '3. Data Completeness' },
      { name: 'search', label: '4. Live-Web Research' },
      { name: 'engineering', label: '5. Engineering Signals' },
      { name: 'github', label: '6. GitHub Activity' },
      { name: 'activity', label: '7. Activity Timeline' },
      { name: 'signals', label: '8. Signal Engine' },
      { name: 'findings', label: '9. Finding Engine' },
      { name: 'verification', label: '10. Safe Verification' },
      { name: 'people', label: '11. Person Discovery' },
      { name: 'owners', label: '12. Owner Selection' },
      { name: 'contacts', label: '13. Contactability' },
      { name: 'email', label: '14. Email Generation' },
      { name: 'decision', label: '15. Final Decision' },
    ];

    const auditTrail = prospect.audit_trail || [];
    for (const s of stages) {
      const found = auditTrail.find((a: string) => a.toLowerCase().includes(s.name));
      const status = found ? '✓' : '○';
      console.log(`  ${status} ${s.label}`);
    }
    console.log(`\n  Final decision: ${prospect.decision} (confidence ${prospect.confidence})`);
    console.log(`  Finding: ${prospect.deep_finding?.finding_type || prospect.findings?.finding_type || 'NONE'}`);
    console.log(`  Owner: ${prospect.selected_owner?.name || '(none)'}`);
    return;
  }

  // ── Mode: draft email <domain> — generate evidence-backed email draft ──
  if (subcommand === 'draft' && process.argv.slice(2).filter(a => !a.startsWith('--'))[1] === 'email') {
    const domain = process.argv.slice(2).filter(a => !a.startsWith('--'))[2];
    if (!domain) {
      console.error('Usage: npx tsx scripts/growjo-hunt.ts draft email <domain>');
      process.exit(1);
    }
    console.log(`VARDHAN DRAFT EMAIL — ${domain}`);
    const csvCompanies = csv ? loadCsv(csv).companies : [];
    const company = csvCompanies.find(c => (c.domain || '').toLowerCase() === domain.toLowerCase()) || null;
    const target = `https://${domain.replace(/^https?:\/\//, '')}`;

    // Use the SystemManager to get a full report
    const searchCaps = detectSearchCapabilities();
    const searchProvider: SearchProvider = searchCaps.available
      ? new PublicWebSearchProvider({ fetcher: boundedFetch as any })
      : new NullSearchProvider();
    const modelGateway = new VardhanModelGateway();
    const ollama = new OllamaProvider({});
    modelGateway.addProvider(ollama);

    const mgr = new VardhanSystemManager({
      fetcher: boundedFetch as any,
      searchProvider,
      modelGateway,
      artifactsDir: process.cwd(),
      output: { write: (s: string) => console.log(s) },
    });

    const report = await mgr.researchCompany(company?.canonical_name || domain, domain, company ? [company] : []);

    if (!report.outreachReady || !report.finding) {
      console.log(`\n  Outreach NOT ready for ${domain}.`);
      console.log(`  reason: ${report.nextResearchAction}`);
      console.log(`  finding: ${report.finding?.classification || 'none'}`);
      console.log(`  owner: ${report.owner ? report.owner.name : '(none)'}`);
      return;
    }

    console.log(`\n── DRAFT EMAIL — ${domain} ──`);
    console.log(`  (based on: ${report.finding.title || report.finding.classification})`);
    console.log(`  evidence IDs: ${report.finding.evidenceIds.join(', ')}`);
    console.log('');
    console.log(`  ─────────────────────────────────────────────────────────`);
    console.log(`  Subject: Engineering observation at ${company?.canonical_name || domain}`);
    console.log('');
    console.log(`  Hi ${report.owner?.name || ''},`);
    console.log('');
    if (report.finding) {
      console.log(`  I noticed ${report.finding.explanation.slice(0, 200)}`);
      console.log('  This appears to be a genuine technical opportunity for your');
      console.log('  engineering team. I have specific, evidence-backed suggestions');
      console.log('  that could help reduce risk or improve outcomes.');
    }
    console.log('');
    console.log(`  All observations are backed by public evidence (${report.finding.evidenceIds.length} source(s)).`);
    console.log('');
    console.log(`  Best,`);
    console.log(`  VARDHAN Outreach`);
    console.log(`  ─────────────────────────────────────────────────────────`);
    console.log('');
    console.log(`  ⚠  This email requires HUMAN APPROVAL before sending.`);
    console.log(`  Review evidence traceability at: artifacts/intelligence/evidence/`);
    return;
  }

  // ── Mode: resume <domain> — resume interrupted research ──
  // Also supports: resume --batch N  (resume multiple pending companies)
  if (subcommand === 'resume') {
    const domain = process.argv.slice(2).filter(a => !a.startsWith('--'))[1];
    const batchMatch = process.argv.join(' ').match(/--batch\s+(\d+)/);
    const batchSize = batchMatch ? parseInt(batchMatch[1], 10) : 1;

    if (!domain && process.argv.includes('--batch')) {
      // Resume all pending companies from the queue
      const queuePath = path.join(process.cwd(), 'artifacts', 'intelligence', 'queue.jsonl');
      let queue: any[] = [];
      try { queue = new CompanyQueue(queuePath).pending(); } catch { /* no queue */ }
      const toResume = queue.slice(0, batchSize);
      console.log(`VARDHAN RESUME (batch ${batchSize}) — resuming ${toResume.length} company/companies`);
      const results: HuntResult[] = [];
      let i = 0;
      for (const q of toResume) {
        i++;
        try {
          const target = q.domain.startsWith('http') ? q.domain : `https://${q.domain}`;
          console.log(`\n[${i}/${toResume.length}] Resuming ${q.company} (${q.domain})...`);
          const csvCompanies = csv ? loadCsv(csv).companies : [];
          const company = csvCompanies.find(c => (c.domain || '').toLowerCase() === q.domain.toLowerCase()) || null;
          results.push(await runOne(company, q.domain, target, company ? [company] : []));
        } catch (e: any) {
          console.log(`\n[${i}/${toResume.length}] ${q.company} — FAILED: ${e?.message || String(e)}`);
          results.push({ company: q.company, domain: q.domain, sector: 'unknown', decision: 'ERROR', confidence: null, finding: '', findingProvenance: '', owner: null, ownerConfidence: null, ownerProvenance: null, people: 0, owner_candidates: 0, growjo_person: false, provider_sources: [], error: e?.message || String(e) });
        }
      }
      printSummary(results);
      return;
    }

    if (!domain) {
      console.error('Usage: npx tsx scripts/growjo-hunt.ts resume <domain>');
      console.error('       npx tsx scripts/growjo-hunt.ts resume --batch N  (resume from queue)');
      process.exit(1);
    }
    console.log(`VARDHAN RESUME — continuing research for ${domain}`);
    const target = `https://${domain.replace(/^https?:\/\//, '')}`;
    const csvCompanies = csv ? loadCsv(csv).companies : [];
    const company = csvCompanies.find(c => (c.domain || '').toLowerCase() === domain.toLowerCase()) || null;
    const result = await runOne(company, domain, target, company ? [company] : []);
    if (result.prospect) {
      console.log(`\n── RESUME SUMMARY ──`);
      console.log(`  decision:    ${result.prospect.decision} (confidence ${result.prospect.confidence})`);
      console.log(`  finding:     ${result.prospect.deep_finding?.finding_type || result.prospect.findings?.finding_type || 'NONE'}`);
      console.log(`  owner:       ${result.prospect.selected_owner?.name || '(none)'}`);
      console.log(`  people:      ${result.prospect.people.length}`);
      console.log(`  evidence:    ${result.prospect.evidence.length}`);
      console.log(`  sources:     ${result.prospect.public_surface?.discovered_pages?.length || 0}`);
      if ((result.prospect as any).changes && (result.prospect as any).changes.length > 0) {
        console.log(`  changes vs prior: ${(result.prospect as any).changes.length}`);
        for (const ch of (result.prospect as any).changes) {
          console.log(`    [${ch.kind}] ${ch.category}: ${ch.change}`);
        }
      } else {
        console.log(`  changes vs prior: (none — first run)`);
      }
    }
    return;
  }

  console.error('Usage: npx tsx scripts/growjo-hunt.ts <csv> [options]');
  console.error('       npx tsx scripts/growjo-hunt.ts --domains "vercel.com,supabase.com"');
  console.error('       npx tsx scripts/growjo-hunt.ts --companies "Vercel,Supabase"');
  console.error('       npx tsx scripts/growjo-hunt.ts --research https://vercel.com');
  console.error('       npx tsx scripts/growjo-hunt.ts hunt <domain> [--deep]');
  console.error('       npx tsx scripts/growjo-hunt.ts research <domain> [--deep]');
  console.error('       npx tsx scripts/growjo-hunt.ts deep <domain>');
  console.error('       npx tsx scripts/growjo-hunt.ts refresh <domain>');
  console.error('       npx tsx scripts/growjo-hunt.ts refresh --all [--csv <csv>]');
  console.error('       npx tsx scripts/growjo-hunt.ts resume <domain>');
  console.error('       npx tsx scripts/growjo-hunt.ts changes <domain>');
  console.error('       npx tsx scripts/growjo-hunt.ts status');
  console.error('       npx tsx scripts/growjo-hunt.ts pipeline <domain>');
  console.error('       npx tsx scripts/growjo-hunt.ts show company|people|findings|evidence|sources|research <domain>');
  console.error('       npx tsx scripts/growjo-hunt.ts why owner|finding <domain>');
  console.error('       npx tsx scripts/growjo-hunt.ts draft email <domain>');
  console.error('Options: --batch N  --start K  --csv <csv>');
  process.exit(1);
}

// ── Changes display ──

function showChanges(prospect: any, domain: string): void {
  console.log(`\n── CHANGE DETECTION — ${prospect.company} (${domain}) ──`);
  const changes = prospect.changes || [];
  if (changes.length === 0) {
    console.log('  (no changes detected — first run or all UNCHANGED)');
  } else {
    const byKind = changes.reduce((acc: Record<string, number>, c: any) => { acc[c.kind] = (acc[c.kind] || 0) + 1; return acc; }, {});
    console.log(`  ${changes.length} change(s): ${Object.entries(byKind).map(([k, v]) => `${k}×${v}`).join('  ')}`);
    console.log('');
    for (const c of changes) {
      const marker: Record<string, string> = { NEW: '✚', CHANGED: '~', UNCHANGED: '=', REMOVED: '✖', UNKNOWN: '?' };
      console.log(`  ${marker[c.kind] || '?'} [${c.category}] ${c.entity.slice(0, 50)}`);
      console.log(`      ${c.change}`);
    }
  }

  console.log(`\n── LIVE-WEB RESEARCH ──`);
  console.log(`  researched:   ${prospect.live_web_researched || false}`);
  console.log(`  evidence:     ${prospect.live_web_evidence?.length || 0}`);
  console.log(`  search queries: ${prospect.search_queries?.length || 0}`);
  if (prospect.search_queries && prospect.search_queries.length > 0) {
    for (const q of prospect.search_queries) {
      console.log(`    ${q.cached ? '[cached]' : '[new]'} "${q.query}" → ${q.results} result(s)`);
    }
  }

  console.log(`\n── DATA COMPLETENESS ──`);
  const ds = prospect.data_sufficiency;
  if (ds) {
    console.log(`  sufficient:           ${ds.sufficient}`);
    console.log(`  needs_live_research:  ${ds.needs_live_research}`);
    if (ds.missing.length > 0) console.log(`  missing:              ${ds.missing.join(', ')}`);
    if (ds.stale.length > 0) console.log(`  stale:                ${ds.stale.join(', ')}`);
    for (const r of ds.reasons) console.log(`  reason: ${r}`);
  } else {
    console.log('  (no sufficiency data)');
  }
}

// ── Parse domains for refresh --all ──

function parseRefreshAll(argv: string[], csv: string | null): string[] {
  const domainsFlag = argv.join(' ').match(/--domains\s+([\w.,\-:]+)/);
  if (domainsFlag) {
    return domainsFlag[1].split(',').map(d => d.trim()).filter(Boolean);
  }
  if (csv) {
    return loadCsv(csv).companies.map(c => c.domain || c.canonical_name).filter(Boolean);
  }
  return [];
}

// ── Summary ──

function printSummary(results: HuntResult[]): void {
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('                    HUNT SUMMARY');
  console.log('══════════════════════════════════════════════════════════════════');
  for (const r of results) {
    console.log(
      `${r.company.slice(0, 22).padEnd(24)} | ${(r.domain || '—').slice(0, 16).padEnd(18)} | ${r.decision.padEnd(14)} | ${(r.owner || '—').slice(0, 16).padEnd(18)} | ${(r.ownerProvenance || '—').slice(0, 16).padEnd(18)} | prov=${r.provider_sources.join(',')}`
    );
  }
  console.log('═'.repeat(120));
  const byDecision = results.reduce((acc, r) => { acc[r.decision] = (acc[r.decision] || 0) + 1; return acc; }, {} as Record<string, number>);
  console.log(`Decision breakdown: ${Object.entries(byDecision).map(([d, n]) => `${d}×${n}`).join('  ')}`);
  const ownersFound = results.filter(r => r.owner !== '(none)' && r.owner !== null);
  console.log(`Owners found: ${ownersFound.length} / ${results.length}  (no persons in CSV → no owners invented)`);
  console.log('\n═══ DONE ═══');
}

void main();
