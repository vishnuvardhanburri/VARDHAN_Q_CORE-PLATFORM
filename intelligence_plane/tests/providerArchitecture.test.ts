import * as fs from 'fs';
import * as path from 'path';
import { CSVProvider } from '../src/server/providers/CSVProvider';
import { PublicDatasetProvider } from '../src/server/providers/PublicDatasetProvider';
import { ProviderRegistry } from '../src/server/providers/ProviderRegistry';
import { SourceRegistry } from '../src/server/providers/SourceRegistry';
import { EntityResolver } from '../src/server/providers/EntityResolver';
import { GrowjoProviderAdapter } from '../src/server/providers/GrowjoProviderAdapter';
import { GrowjoProvider } from '../src/server/GrowjoProvider';
import { OwnerPipeline } from '../src/server/OwnerPipeline';
import type { OwnerCandidate } from '../src/server/IntelligenceCase';
import type { GrowjoCompany, CompanyResolution } from '../src/server/DeepTypes';
import { CompanyDataProvider } from '../src/server/providers/ProviderInterface';
import type { ProviderCapabilities } from '../src/server/providers/ProviderInterface';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
// ── Provider Architecture & Provider-Agnostic Pipeline Tests ──
// Proves: the system works with Growjo, without Growjo (CSV/Dataset/Manual seed),
// provider waterfall works, provenance is preserved, no owners invented,
// provider failure does not kill the pipeline, deduplication is evidence-based.

let pass = 0, fail = 0; const failures: string[] = [];
const assert = (c: boolean, m: string) => { if (c) pass++; else { fail++; failures.push(m); console.log('[FAIL] ' + m); } };
function run(name: string, fn: () => void) { console.log('\n--- ' + name + ' ---'); fn(); }

// ── CSV Provider ──

run('CSV provider — parses generic CSV with flexible aliases', () => {
  const csv = [
    'company_name,url,industry,employees,employee_growth_pct,total_funding,email,person_title,linkedin_url,growjo_url',
    'Acme Corp,acme.com,Developer Infrastructure,250,12,12000000,jane@acme.com,Head of Engineering,https://linkedin.com/in/jane,https://www.acme.com/about',
  ].join('\n');
  const p = new CSVProvider({ sourceUrl: 'test.csv' });
  const r = p.parseCsv(csv);
  assert(r.companies.length === 1, 'one company parsed');
  const c = r.companies[0];
  assert(c.source === 'CSV', 'source = CSV');
  assert(c.company === 'Acme Corp', 'company name');
  assert(c.domain === 'acme.com', 'domain from url');
  assert(c.industry === 'Developer Infrastructure', 'industry');
  assert(c.employee_count === 250, 'employees');
  assert(c.employee_growth_pct === 12, 'growth');
  assert(c.funding === 12000000, 'funding');
  assert(c.primary_email === 'jane@acme.com', 'email');
  assert(c.primary_title === 'Head of Engineering', 'title');
  assert(c.linkedin_url === 'https://linkedin.com/in/jane', 'linkedin');
  assert(!!c.retrieved_at, 'retrieved_at present');
  assert(r.column_mapping.url === 'domain', 'url -> domain');
  assert(c.entity_sources.length === 1, 'entity source recorded');
  assert(c.entity_sources[0].source === 'CSV', 'entity source provenance');
});

run('CSV provider — BOM stripped, no BOM in header', () => {
  const csv = '\uFEFFcompany,domain\ndef,def.com';
  const r = new CSVProvider().parseCsv(csv);
  assert(r.companies.length === 1, 'parsed despite BOM');
  assert(r.companies[0].company === 'def', "BOM didn't corrupt first header");
  assert(!r.warnings.some(w => w.includes('\ufeff')), 'no BOM artifact in warnings');
});

run('CSV provider — deduplication by canonical domain', () => {
  const csv = [
    'company,domain',
    'Acme,acme.com',
    'Acme Corp,https://www.acme.com',
    'OtherCo,other.com',
  ].join('\n');
  const r = new CSVProvider().parseCsv(csv);
  assert(r.companies.length === 2, `deduped to 2 (got ${r.companies.length})`);
  assert(r.duplicate_domains_dropped === 1, 'one dup dropped');
});

run('CSV provider — never guesses email from name+domain', () => {
  const csv = [
    'company,domain,person_name,person_title',
    'Acme,acme.com,Jane Doe,CTO',
  ].join('\n');
  const r = new CSVProvider().parseCsv(csv);
  const c = r.companies[0];
  assert(c.primary_email === null, 'no email invented from name');
  assert(c.primary_phone === null, 'no phone invented');
  assert(c.primary_person_name === 'Jane Doe', 'person name from CSV');
  assert(c.primary_title === 'CTO', 'title from CSV');
});

run('CSV provider — empty file handled', () => {
  const r = new CSVProvider().parseCsv('');
  assert(r.companies.length === 0, 'empty CSV -> 0 companies');
  assert(r.warnings.length > 0, 'empty CSV warns');
});

run('CSV provider — supports comma delimiter in DEFAULT_CSV_SCHEMA', () => {
  const csv = [
    'Name,website,Sector,Founded',
    'Zeta Labs,zeta.com,Biotech,2020',
  ].join('\n');
  const r = new CSVProvider().parseCsv(csv);
  assert(r.companies.length === 1, 'FT1000-style CSV parses');
  assert(r.companies[0].company === 'Zeta Labs', 'Name -> company');
  assert(r.companies[0].domain === 'zeta.com', 'website -> domain');
  assert(r.companies[0].industry === 'Biotech', 'Sector -> industry');
});

// ── PublicDataset Provider ──

run('PublicDataset provider — parses CityData semicolon CSV', () => {
  const csv = 'Company Name;Trade Name;CEO Name;Business Category Code 1 - Description;Yearly Revenue in U.S. Dollars;Employees Total;Founding Year\nSafran Aircraft Engines;SA;Jean-paul Alary;Aircraft;13199338856;13667;1965';
  const p = new PublicDatasetProvider({ datasetName: 'paris-test', sourceUrl: 'datasets/paris' });
  const r = p.parseCsv(csv, ';');
  assert(r.companies.length === 1, 'one company parsed');
  const c = r.companies[0];
  assert(c.source === 'PUBLIC_DATASET', 'source = PUBLIC_DATASET');
  assert(c.company === 'Safran Aircraft Engines', 'company name');
  assert(c.industry === 'Aircraft', 'SIC description mapped');
  assert(c.employee_count === 13667, 'employees parsed');
  assert(c.revenue === 13199338856, 'revenue parsed');
  assert(c.primary_person_name === 'Jean-paul Alary', 'CEO name as primary_person');
  assert(c.domain === null, 'no domain in CityData (honest)');
});

run('PublicDataset provider — CityData has no person contact fields', () => {
  const csv = 'Company Name;CEO Name;Business Category Code 1 - Description;Employees Total\nAcme Corp;Jane Doe;Software;50';
  const r = new PublicDatasetProvider({ datasetName: 'test', sourceUrl: 'test' }).parseCsv(csv, ';');
  const c = r.companies[0];
  assert(c.primary_email === null, 'no email in CityData');
  assert(c.primary_phone === null, 'no phone in CityData');
  assert(c.linkedin_url === null, 'no linkedin in CityData');
  assert(c.primary_person_name === 'Jane Doe', 'CEO name as person name');
});

// ── GrowjoProvider Adapter ──

run('GrowjoProvider adapter — wraps GrowjoProvider, preserves people', () => {
  const csv = [
    'company_name,domain,person_title,person_name,person_email,phone,linkedin_url,growjo_url,funding,revenue,valuation,industry,employees,employee_growth_pct',
    'Acme,acme.com,CTO,Jane Doe,jane@acme.com,555,https://linkedin.com/in/jane,https://www.acme.com/about,$12M,$1M,$200M,Developer Infra,250,12',
  ].join('\n');
  const adapter = new GrowjoProviderAdapter();
  const r = adapter.parseCsv(csv);
  assert(r.companies.length === 1, 'one company');
  const c = r.companies[0];
  assert(c.source === 'GROWJO', 'source = GROWJO');
  assert(c.primary_person_name === 'Jane Doe', 'person name');
  assert(c.primary_title === 'CTO', 'title');
  assert(c.people.length === 1, 'person built with name ≠ company');
  assert(c.people[0].title === 'CTO', 'person title');
  assert(c.contacts.length === 0, 'no contacts guessed (CSV has no verified contact API)');
});

run('GrowjoProvider adapter — no person name → no people (no invention)', () => {
  const csv = 'company_name,domain\nAcme,acme.com';
  const r = new GrowjoProviderAdapter().parseCsv(csv);
  const c = r.companies[0];
  assert(c.people.length === 0, 'no people when name absent');
  assert(c.primary_person_name === 'Acme', 'name falls back to company');
  assert(c.primary_title === null, 'title null');
});

// ── Provider Registry ──


class TestProvider extends CompanyDataProvider {
  name = 'test';
  readonly costClass = 'FREE';
  enabled = true;
  capabilities: ProviderCapabilities = { searchCompanies: true, resolveCompany: true, findPeople: true, findContacts: true, enrichCompany: true, enrichPerson: true, verifyContact: false };
  private data: any[];
  constructor(data: any[] = []) { super(); this.data = data; }
  async searchCompanies(q: string) { return this.data.filter(c => c.company.toLowerCase().includes(q.toLowerCase())); }
  async resolveCompany(n: string) { return this.data.find(c => c.company.toLowerCase() === n.toLowerCase()) || null; }
  async findPeople(c: any) { return c.people || []; }
  async findContacts(p: any) { return p.contacts || []; }
}

run('ProviderRegistry — waterfall returns first match', async () => {
  const reg = new ProviderRegistry();
  const providerA = new TestProvider([{ company: 'Acme', domain: 'acme.com', people: [], contacts: [], source: 'A', source_url: '', retrieved_at: '' }]);
  const providerB = new TestProvider([{ company: 'Acme', domain: 'acme.com', people: [], contacts: [], source: 'B', source_url: '', retrieved_at: '' }]);
  reg.add({ key: 'A', provider: providerA as any, priority: 1 });
  reg.add({ key: 'B', provider: providerB as any, priority: 2 });
  const result = await reg.lookupCompany('acme.com');
  assert(result.companies.length >= 1, 'at least one provider found the company');
  assert(result.tried_providers.length > 0, 'providers were tried');
});

run('ProviderRegistry — provider failure does not kill pipeline', async () => {
  const reg = new ProviderRegistry();
  const badProvider = new TestProvider([]);
  // Make it throw
  badProvider.resolveCompany = async () => { throw new Error('API down'); };
  const goodProvider = new TestProvider([{ company: 'Acme', domain: 'acme.com', people: [], contacts: [], source: 'good', source_url: '', retrieved_at: '' }]);
  reg.add({ key: 'bad', provider: badProvider as any, priority: 1 });
  reg.add({ key: 'good', provider: goodProvider as any, priority: 2 });
  const result = await reg.lookupCompany('acme.com');
  // The bad provider threw, but the good one should still be tried
  assert(result.tried_providers.some(t => t.includes('bad')), 'bad provider was tried');
  assert(result.companies.length >= 1, 'good provider still found the company despite bad provider');
});

run('ProviderRegistry — hasContactProvider reflects capabilities', () => {
  const reg = new ProviderRegistry();
  const noContact = new TestProvider([]);
  noContact.capabilities.verifyContact = false;
  reg.add({ key: 'no-contact', provider: noContact as any, priority: 1 });
  assert(reg.hasContactProvider === false, 'no contact provider → false');

  const withContact = new TestProvider([]);
  (withContact as any).capabilities.verifyContact = true;
  reg.add({ key: 'with-contact', provider: withContact as any, priority: 2 });
  assert(reg.hasContactProvider === true, 'contact provider present → true');
});

// ── Source Registry ──

run('SourceRegistry — default sources include GitHub + LinkedIn', () => {
  const reg = SourceRegistry.createDefault();
  assert(reg.get('github.com') !== undefined, 'github.com registered');
  assert(reg.isAllowed('https://github.com/acme/repo'), 'github.com allowed');
  assert(reg.isAllowed('https://api.github.com/repos/acme'), 'api.github.com allowed');
  assert(!reg.isAllowed('https://unknown-baddomain.xyz/secret'), 'unknown domain not allowed');
  const github = reg.get('github.com')!;
  assert(github.category === 'GITHUB', 'github category');
  assert(github.priority === 100, 'github priority high');
});

run('SourceRegistry — block a source', () => {
  const reg = SourceRegistry.createDefault();
  reg.register({ domain: 'blocked.com', category: 'COMPANY', priority: 50, authority_metadata: {}, allowed: false, blocked: true, last_checked: null, notes: 'blocked for testing' });
  assert(!reg.isAllowed('https://blocked.com/'), 'blocked source denied');
  const github = reg.get('github.com')!;
  assert(github.allowed === true, 'github still allowed');
});

// ── Entity Resolver ──

run('EntityResolver — resolves domain directly', async () => {
  const resolver = new EntityResolver();
  const result = await resolver.resolve('acme.com');
  assert(result !== null, 'resolved non-null');
  assert(result!.official_domain === 'acme.com', 'domain preserved');
  assert(result!.matched === true, 'matched');
  assert(result!.confidence === 'HIGH', 'HIGH confidence for known domain');
});

run('EntityResolver — dedupes by canonical domain', () => {
  const resolver = new EntityResolver();
  const companies = [
    { domain: 'acme.com', canonical_name: 'Acme Corp', company: 'Acme Corp', source: 'CSV' },
    { domain: 'https://www.acme.com', canonical_name: 'Acme Corp', company: 'Acme Corp', source: 'Growjo' },
    { domain: 'other.com', canonical_name: 'OtherCo', company: 'OtherCo', source: 'CSV' },
  ];
  const deduped = resolver.dedupe(companies as any);
  assert(deduped.length === 2, `deduped to 2 (got ${deduped.length})`);
});

run('EntityResolver — does not merge by name similarity alone', () => {
  const resolver = new EntityResolver();
  const companies = [
    { domain: 'acme.com', canonical_name: 'Acme Corp', company: 'Acme Corp', source: 'CSV' },
    { domain: 'acme-labs.com', canonical_name: 'Acme Labs', company: 'Acme Labs', source: 'CSV' }, // different domain
  ];
  const deduped = resolver.dedupe(companies as any);
  assert(deduped.length === 2, 'different domains → not merged');
});

// ── OwnerPipeline with providerCompanies (provider-agnostic) ──

run('OwnerPipeline — accepts providerCompanies (non-Growjo), no Growjo required', () => {
  // A CSV company with a CTO and matching domain
  const providerCompany = {
    source: 'CSV',
    company: 'Acme Corp',
    canonical_name: 'Acme Corp',
    domain: 'acme.com',
    website: 'https://acme.com',
    primary_person_name: 'Jane Doe',
    primary_title: 'CTO',
    primary_email: null,
    primary_phone: null,
    linkedin_url: null,
    growjo_url: null,
    source_url: 'test.csv',
    retrieved_at: new Date().toISOString(),
    industry: null,
    employee_count: null,
    employee_growth_pct: null,
    funding: null,
    funding_currency: null,
    revenue: null,
    revenue_currency: null,
    valuation: null,
    valuation_currency: null,
  };

  const result = OwnerPipeline.resolve({
    company: 'Acme Corp',
    targetDomain: 'acme.com',
    technicalArea: 'platform engineering',
    classification: null,
    resolvedEvidence: [],
    growjoData: null,  // <-- NO Growjo data!
    providerCompanies: [providerCompany as any],
    publicCandidates: [],
  });

  assert(result.candidates.length === 1, 'one candidate from provider');
  assert(result.candidates[0].name === 'Jane Doe', 'candidate name');
  assert(result.candidates[0].evidence[0].startsWith('OFFICIAL_COMPANY_SOURCE'), 'provenance = OFFICIAL_COMPANY_SOURCE');
  assert(result.selectedCandidate !== null, 'HIGH candidate selected');
  assert(result.provenance === 'OFFICIAL_COMPANY_SOURCE', 'provenance set correctly');
});

run('OwnerPipeline — no provider data + no public people → null owner', () => {
  const result = OwnerPipeline.resolve({
    company: 'Acme Corp',
    targetDomain: 'acme.com',
    technicalArea: 'platform engineering',
    classification: null,
    resolvedEvidence: [],
    growjoData: null,
    providerCompanies: null,
    publicCandidates: [],
  });
  assert(result.candidates.length === 0, 'no candidates');
  assert(result.selectedCandidate === null, 'no selected owner');
  assert(result.selected === null, 'no deep owner');
  assert(result.provenance === 'VARDHAN_INFERENCE', 'default provenance');
});

run('OwnerPipeline — provider with no title → candidate rejected (no invention)', () => {
  const providerCompany = {
    source: 'CSV',
    company: 'Acme Corp',
    canonical_name: 'Acme Corp',
    domain: 'acme.com',
    website: 'https://acme.com',
    primary_person_name: 'Jane Doe',
    primary_title: null,  // <-- no title
    primary_email: null,
    primary_phone: null,
    linkedin_url: null,
    growjo_url: null,
    source_url: 'test.csv',
    retrieved_at: new Date().toISOString(),
    industry: null,
    employee_count: null,
    employee_growth_pct: null,
    funding: null,
    funding_currency: null,
    revenue: null,
    revenue_currency: null,
    valuation: null,
    valuation_currency: null,
  };
  const result = OwnerPipeline.resolve({
    company: 'Acme Corp',
    targetDomain: 'acme.com',
    technicalArea: 'platform engineering',
    classification: null,
    resolvedEvidence: [],
    growjoData: null,
    providerCompanies: [providerCompany as any],
    publicCandidates: [],
  });
  assert(result.candidates.length === 0, 'no candidate without title');
  assert(result.selectedCandidate === null, 'no owner — rejected, not invented');
});

run('OwnerPipeline — Growjo + providerCompanies both processed', () => {
  // Growjo person (CTO at acme.com)
  const growjoCsv = [
    'company_name,domain,person_name,person_title,growjo_url',
    'Acme Corp,acme.com,Jane Doe,CTO,https://growjo.com/acme',
  ].join('\n');
  const growjoResult = GrowjoProvider.parseCsv(growjoCsv);
  const growjoCompany = growjoResult.companies[0];

  // Provider company (CSV, different person but same company)
  const providerCompany = {
    source: 'CSV',
    company: 'Acme Corp',
    canonical_name: 'Acme Corp',
    domain: 'acme.com',
    website: 'https://acme.com',
    primary_person_name: 'Jane Doe',
    primary_title: 'CTO',
    primary_email: null,
    primary_phone: null,
    linkedin_url: null,
    growjo_url: null,
    source_url: 'manual.csv',
    retrieved_at: new Date().toISOString(),
    industry: null, employee_count: null, employee_growth_pct: null,
    funding: null, funding_currency: null, revenue: null, revenue_currency: null,
    valuation: null, valuation_currency: null,
  };

  const result = OwnerPipeline.resolve({
    company: 'Acme Corp',
    targetDomain: 'acme.com',
    technicalArea: 'platform engineering',
    classification: null,
    resolvedEvidence: [],
    growjoData: growjoCompany,
    providerCompanies: [providerCompany as any],
    publicCandidates: [],
  });

  // Both providers found the same person — should be deduped to 1
  assert(result.candidates.length === 1, 'deduped to 1 (same person)');
  assert(result.candidates[0].evidence.some(e => e.startsWith('GROWJO_IDENTITY')), 'has Growjo identity evidence');
  assert(result.selectedCandidate !== null, 'HIGH candidate selected');
  assert(result.provenance === 'GROWJO_SOURCE', 'growjo takes priority for provenance');
});

// ── Integration: Provider-agnostic pipeline ──

run('Provider-agnostic: system works without Growjo (CSV seed only)', () => {
  // Simulate: CSV provider finds company, no Growjo record exists
  const csv = [
    'company_name,domain,person_name,person_title,person_email',
    'Beta LLC,beta.com,Bob Smith,VP Platform,bob@beta.com',
  ].join('\n');
  const csvProvider = new CSVProvider({ sourceUrl: 'seed.csv' });
  const r = csvProvider.parseCsv(csv);
  const company = r.companies[0];

  // OwnerPipeline should still work with just providerCompanies, no Growjo
  const op = OwnerPipeline.resolve({
    company: 'Beta LLC',
    targetDomain: 'beta.com',
    technicalArea: 'platform engineering',
    classification: null,
    resolvedEvidence: [],
    growjoData: null,  // <-- no Growjo
    providerCompanies: [company as any],
    publicCandidates: [],
  });
  assert(op.candidates.length === 1, 'CSV person is an owner candidate');
  assert(op.selectedCandidate !== null, 'HIGH owner resolved from CSV only');
  assert(op.provenance === 'OFFICIAL_COMPANY_SOURCE', 'CSV provenance = OFFICIAL_COMPANY_SOURCE');
});

run('Contact engine: never guesses email from name+domain', () => {
  const csv = [
    'company_name,domain,person_name,person_title',
    'Gamma,gamma.com,Carol,Direcotr of Engineering',  // typo on purpose, also no email
  ].join('\n');
  const r = new CSVProvider().parseCsv(csv);
  const c = r.companies[0];
  assert(c.primary_email === null, 'email NOT guessed from name+domain');
  assert(c.primary_person_name === 'Carol', 'person name present');
  assert(c.primary_title === 'Direcotr of Engineering', 'title present');
  // The role is a technical role but with a typo — should still match "Director"
  // Actually "Direcotr" won't match — verifying honest rejection
  const op = OwnerPipeline.resolve({
    company: 'Gamma',
    targetDomain: 'gamma.com',
    technicalArea: 'platform engineering',
    classification: null,
    resolvedEvidence: [],
    growjoData: null,
    providerCompanies: [c as any],
    publicCandidates: [],
  });
  assert(op.candidates.length === 0, 'typo in title → role match fails → no candidate (honest)');
});

// ── Summary ──
console.log('\n==================================================');
console.log(`Provider architecture tests: ${pass} passed, ${fail} failed.`);
if (fail === 0) console.log('ALL TESTS PASSED.');
else { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
expect(typeof fail !== 'undefined' ? fail : (typeof failed !== 'undefined' ? failed : 0)).toBe(0);

  });
});