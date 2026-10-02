import assert from 'node:assert/strict';
import { OwnerPipeline } from '../src/server/OwnerPipeline';
import type { GrowjoCompany } from '../src/server/DeepTypes';
import type { OwnerCandidate } from '../src/server/IntelligenceCase';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
// tests/ownerPipeline.test.ts
// Tests for the Growjo-primary owner resolution topology (Sub-agent D refinement).
// Fully offline: OwnerPipeline.resolve is pure (GrowjoProvider.extractContacts +
// OwnerSelector + DeepOwnerResolver + subsystemFromFinding — no network).


let passed = 0;
let failed = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
};

function mkGrowjo(over: Partial<GrowjoCompany> & { company?: string; domain?: string | null; primary_person_name: string | null; primary_title: string | null }): GrowjoCompany {
  const company = over.company ?? 'Acme Corp';
  const domain = over.domain ?? 'acme.com';
  return {
    source: 'GROWJO',
    company,
    canonical_name: company.trim(),
    domain,
    website: domain ? `https://${domain}` : null,
    industry: over.industry ?? 'SaaS',
    employee_count: over.employee_count ?? 500,
    employee_growth_pct: null,
    funding: null, funding_currency: null,
    revenue: null, revenue_currency: null,
    valuation: null, valuation_currency: null,
    primary_email: null,
    primary_phone: null,
    linkedin_url: null,
    growjo_url: null,
    source_url: null,
    retrieved_at: '2026-09-25T00:00:00Z',
    column_mapping: {},
    raw: {},
    ...over,
  } as GrowjoCompany;
}

const baseInput = {
  company: 'Acme Corp',
  targetDomain: 'acme.com',
  technicalArea: 'api authentication configuration',
  classification: null,
  resolvedEvidence: [],
  growjoData: null as GrowjoCompany | null,
  publicCandidates: [] as OwnerCandidate[],
};

// ── 1. Growjo person with technical title + matching domain → HIGH owner ──────
{
  const growjo = mkGrowjo({ company: 'Acme Corp', domain: 'acme.com', primary_person_name: 'Jane Doe', primary_title: 'CTO' });
  const r = OwnerPipeline.resolve({ ...baseInput, growjoData: growjo });
  ok('1 selected', !!r.selected, 'expected selected owner');
  ok('1 name', r.selected?.name === 'Jane Doe', r.selected?.name);
  ok('1 HIGH', r.selected?.confidence === 'HIGH', String(r.selected?.confidence));
  ok('1 provenance GROWJO_SOURCE', r.provenance === 'GROWJO_SOURCE', String(r.provenance));
  ok('1 evidence tagged GROWJO_SOURCE', r.ownerEvidenceString.startsWith('Jane Doe is listed as CTO'), r.ownerEvidenceString);
  ok('1 finding_link set', !!r.selected?.finding_link, String(r.selected?.finding_link));
  ok('1 responsibility covers area', /api authentication configuration/.test(r.selected?.responsibility_match || ''), r.selected?.responsibility_match);
}

// ── 2. Growjo person with NON-technical title → not a candidate ───────────────
{
  const growjo = mkGrowjo({ company: 'Acme Corp', domain: 'acme.com', primary_person_name: 'Sam Marketer', primary_title: 'Marketing Manager' });
  const r = OwnerPipeline.resolve({ ...baseInput, growjoData: growjo });
  ok('2 no selected (non-technical title)', r.selected === null, String(r.selected));
  ok('2 no GROWJO_IDENTITY candidate', r.candidates.every(c => !c.evidence[0]?.startsWith('GROWJO_IDENTITY')), 'growjo candidate leaked');
}

// ── 3. Growjo person but COMPANY IDENTITY mismatch (domain + name both wrong) ─
{
  const growjo = mkGrowjo({ company: 'Other Corp', domain: 'mismatch.com', primary_person_name: 'Jane Doe', primary_title: 'CTO' });
  const r = OwnerPipeline.resolve({ ...baseInput, company: 'Acme Corp', targetDomain: 'acme.com', growjoData: growjo });
  ok('3 no selected (company identity mismatch)', r.selected === null, String(r.selected));
  ok('3 not invented', r.candidates.length === 0, 'candidates=' + r.candidates.length);
}

// ── 3b. Company name match (domain absent) still matches ─────────────────────
{
  const growjo = mkGrowjo({ company: 'Acme Corp', domain: null, primary_person_name: 'Jane Doe', primary_title: 'VP Engineering' });
  const r = OwnerPipeline.resolve({ ...baseInput, growjoData: growjo });
  ok('3b selected via company-name match', !!r.selected, String(r.selected));
  ok('3b provenance GROWJO_SOURCE', r.provenance === 'GROWJO_SOURCE', String(r.provenance));
}

// ── 4. No Growjo data → public candidate is selectable (OFFICIAL_COMPANY_SOURCE) ─
{
  const publicOwner: OwnerCandidate = {
    name: 'Public Person', role: 'Head of Engineering', company: 'Acme Corp',
    source_urls: ['https://acme.com/team'], evidence: ['Public Person is listed as Head of Engineering on https://acme.com/team — "lead the eng team"'],
    relationship_to_area: 'Role covers api authentication configuration.', confidence: 'HIGH', explicit_evidence: true,
  };
  const r = OwnerPipeline.resolve({ ...baseInput, publicCandidates: [publicOwner] });
  ok('4 selected (public)', !!r.selected, String(r.selected));
  ok('4 provenance OFFICIAL_COMPANY_SOURCE', r.provenance === 'OFFICIAL_COMPANY_SOURCE', String(r.provenance));
}

// ── 5. Public corroboration: same-name public listing strengthens Growjo owner ─
{
  const growjo = mkGrowjo({ company: 'Acme Corp', domain: 'acme.com', primary_person_name: 'Jane Doe', primary_title: 'CTO' });
  const publicOwner: OwnerCandidate = {
    name: 'Jane Doe', role: 'CTO', company: 'Acme Corp',
    source_urls: ['https://acme.com/team'], evidence: ['Jane Doe is listed as CTO on https://acme.com/team — "CTO bio"'],
    relationship_to_area: 'Role covers api authentication configuration.', confidence: 'HIGH', explicit_evidence: true,
  };
  const r = OwnerPipeline.resolve({ ...baseInput, growjoData: growjo, publicCandidates: [publicOwner] });
  ok('5 selected', !!r.selected, String(r.selected));
  ok('5 provenance GROWJO_SOURCE (primary, corroborated)', r.provenance === 'GROWJO_SOURCE', String(r.provenance));
  ok('5 corroboration appended to evidence', !!r.selected && r.selected.owner_evidence.some(e => e.includes('https://acme.com/team')), JSON.stringify(r.selected?.owner_evidence));
}

// ── 6. Do not invent: no person name in Growjo record ─────────────────────────
{
  const growjo = mkGrowjo({ company: 'Acme Corp', domain: 'acme.com', primary_person_name: null, primary_title: 'CTO' });
  const r = OwnerPipeline.resolve({ ...baseInput, growjoData: growjo });
  ok('6 no owner (no name)', r.selected === null, String(r.selected));
}

// ── 7. HIGH-only gate: a MEDIUM public candidate is NEVER promoted ───────────
{
  const mediumOwner: OwnerCandidate = {
    name: 'Maybe Person', role: 'Engineering Manager', company: 'Acme Corp',
    source_urls: ['https://acme.com/team'], evidence: ['Maybe Person is listed as ... — "bio"'],
    relationship_to_area: 'Role covers api authentication configuration.', confidence: 'MEDIUM', explicit_evidence: false,
  };
  const r = OwnerPipeline.resolve({ ...baseInput, publicCandidates: [mediumOwner] });
  ok('7 no selected (MEDIUM not promoted to HIGH)', r.selected === null, String(r.selected));
  ok('7 provenance VARDHAN_INFERENCE fallback', r.provenance === 'VARDHAN_INFERENCE', String(r.provenance));
}

// ── 8. Growjo owner selected but public candidates present and DIFFERENT names ─
// Both remain as distinct candidates (no false corroboration).
{
  const growjo = mkGrowjo({ company: 'Acme Corp', domain: 'acme.com', primary_person_name: 'Jane Doe', primary_title: 'CTO' });
  const other: OwnerCandidate = {
    name: 'Bob Smith', role: 'VP Engineering', company: 'Acme Corp',
    source_urls: ['https://acme.com/team'], evidence: ['Bob Smith is listed as VP Engineering on https://acme.com/team — "bio"'],
    relationship_to_area: 'Role covers api authentication configuration.', confidence: 'HIGH', explicit_evidence: true,
  };
  const r = OwnerPipeline.resolve({ ...baseInput, growjoData: growjo, publicCandidates: [other] });
  ok('8 two distinct candidates', r.candidates.length === 2, 'candidates=' + r.candidates.length);
  ok('8 selected is the Growjo person (Jane Doe)', r.selected?.name === 'Jane Doe', r.selected?.name);
}

console.log(`\n==================================================
OwnerPipeline tests: ${passed} passed, ${failed} failed.
${failed === 0 ? 'ALL TESTS PASSED.' : 'TESTS FAILED.'}
==================================================`);
if (failed > 0) process.exitCode = 1;

  });
});