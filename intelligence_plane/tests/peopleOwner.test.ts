import { DeepOwnerResolver } from '../src/server/DeepOwnerResolver';
import { OwnerSelector } from '../src/server/OwnerSelector';
import { ContactabilityFinder } from '../src/server/ContactabilityFinder';
import { PeopleExtractor } from '../src/server/PeopleExtractor';
import type { OwnerCandidate, DiscoveredPage } from '../src/server/IntelligenceCase';
import type { DeepContact, GrowjoCompany } from '../src/server/DeepTypes';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
/**
 * VARDHAN — People / Owner / Contact topology tests (Topology D).
 * Run with: npx tsx tests/peopleOwner.test.ts
 *
 * Covers:
 *   1. DeepOwnerResolver HIGH-only gate (Part E): rejects LOW/MEDIUM candidates.
 *   2. Owner evidence string format: exact `<name> is listed as <role> on <url> — "<excerpt>"`.
 *   3. ContactabilityFinder: Growjo + public channel normalization, never guesses emails.
 *   4. PeopleExtractor: real-person extraction vs contamination regression.
 */


// ── test harness ─────────────────────────────────────────────────────────────

let pass = 0; let fail = 0; const failures: string[] = [];
function assert(c: boolean, m: string): void { if (c) pass++; else { fail++; failures.push(m); console.log('[FAIL] ' + m); } }
function assertEq<T>(actual: T, expected: T, m: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; failures.push(m + ` (got: ${JSON.stringify(actual)})`); console.log('[FAIL] ' + m + ` got: ${JSON.stringify(actual)}`); }
}
function run(name: string, fn: () => void): void { console.log('\n--- ' + name + ' ---'); fn(); }

// ── fixtures ─────────────────────────────────────────────────────────────────

const HIGH_CANDIDATE: OwnerCandidate = {
  name: 'Jane Doe',
  role: 'Head of Engineering',
  company: 'acme.com',
  source_urls: ['https://acme.com/team'],
  evidence: ['Jane Doe is listed as Head of Engineering on the Acme team page.'],
  relationship_to_area: "Role 'Head of Engineering' covers engineering & technical leadership.",
  confidence: 'HIGH',
  explicit_evidence: true,
};

const HIGH_CANDIDATE_NO_EVIDENCE: OwnerCandidate = {
  ...HIGH_CANDIDATE,
  evidence: [],
};

const MED_CANDIDATE: OwnerCandidate = {
  name: 'Bob Smith',
  role: 'Staff Engineer',
  company: 'acme.com',
  source_urls: ['https://acme.com/blog'],
  evidence: ['Bob Smith, Staff Engineer, mentioned in an engineering blog post.'],
  relationship_to_area: "Role 'Staff Engineer' covers platform, infrastructure & reliability.",
  confidence: 'MEDIUM',
  explicit_evidence: false,
};

const LOW_CANDIDATE: OwnerCandidate = {
  name: 'Carol Jones',
  role: 'Engineer',
  company: 'acme.com',
  source_urls: ['https://acme.com/engineering'],
  evidence: ['Engineer role mentioned.'],
  relationship_to_area: 'Engineer covers platform engineering.',
  confidence: 'LOW',
  explicit_evidence: false,
};

function makeGrowjoCompany(overrides: Partial<GrowjoCompany> = {}): GrowjoCompany {
  return {
    source: 'GROWJO',
    company: 'Acme Corp',
    canonical_name: 'Acme Corp',
    domain: 'acme.com',
    website: 'https://acme.com',
    industry: 'Developer Infrastructure',
    employee_count: 250,
    employee_growth_pct: 12,
    funding: 12000000,
    funding_currency: 'USD',
    revenue: 50000000,
    revenue_currency: 'USD',
    valuation: 2000000000,
    valuation_currency: 'USD',
    primary_person_name: 'Jane Doe',
    primary_title: 'Head of Engineering',
    primary_email: 'Jane@ACME.com',
    primary_phone: '555-1234',
    linkedin_url: 'linkedin.com/in/janedoe',
    growjo_url: 'https://www.growjo.com/acme',
    source_url: 'https://www.growjo.com/acme',
    retrieved_at: '2024-01-01T00:00:00.000Z',
    column_mapping: { company: 'company', email: 'primary_email' },
    raw: { company: 'Acme Corp', email: 'Jane@ACME.com' },
    ...overrides,
  };
}

// ── HTML fixtures ────────────────────────────────────────────────────────────

const TEAM_HTML = `<html><body><section class="team">
<div class="member"><img src="/jane.jpg" alt="Jane Doe"><h3>Jane Doe</h3><p class="title">Head of Engineering</p></div>
<div class="member"><img src="/bob.jpg" alt="Bob Smith"><h3>Bob Smith</h3><p class="title">VP of Engineering</p></div>
<div class="member"><img src="/sarah.jpg" alt="Sarah Jones"><h3>Sarah Jones</h3><p class="title">Head of Marketing</p></div>
</section></body></html>`;

const CONTAMINATION_HTML = `<html><body><section class="team">
<div class="member"><img src="/jane.jpg" alt="Jane Doe"><h3>Jane Doe</h3><p class="title">Head of Engineering</p></div>
<div class="member"><img alt="Use Case"><h3>Use Case</h3><p class="title">CTO</p></div>
<div class="member"><img alt="Docs Dire"><h3>Docs Dire</h3><p class="title">Director of Engineering</p></div>
<div class="member"><img alt="Example Test"><h3>Example Test</h3><p class="title">Staff Engineer</p></div>
<div class="member"><img alt="Demo Page"><h3>Demo Page</h3><p class="title">Principal Engineer</p></div>
<div class="member"><img alt="Ve"><h3>Ve</h3><p class="title">CTO</p></div>
</section></body></html>`;

const ABOUT_HTML_COMMA = `<html><body><p>Jane Doe, CTO</p></body></html>`;

// ── 1. OWNER HIGH-ONLY GATE (Part E) ─────────────────────────────────────────

run('DeepOwnerResolver — HIGH candidate resolves to a DeepOwner', () => {
  const owner = DeepOwnerResolver.resolve([HIGH_CANDIDATE], 'api surface', null, []);
  assert(!!owner, 'HIGH candidate produces a DeepOwner');
  if (owner) {
    assert(owner.name === 'Jane Doe', 'owner name preserved');
    assert(owner.role === 'Head of Engineering', 'owner role preserved');
    assert(owner.confidence === 'HIGH', 'owner confidence is HIGH (not promoted from another level)');
    assert(owner.company === 'acme.com', 'owner company preserved');
    assert(owner.finding_link === 'platform engineering', 'finding_link defaults to subsystem for null classification');
  }
});

run('DeepOwnerResolver — LOW candidate rejected (null)', () => {
  const owner = DeepOwnerResolver.resolve([LOW_CANDIDATE], 'api surface', null, []);
  assert(owner === null, 'LOW candidate yields null (never promoted to HIGH)');
});

run('DeepOwnerResolver — MEDIUM candidate rejected (null)', () => {
  const owner = DeepOwnerResolver.resolve([MED_CANDIDATE], 'api surface', null, []);
  assert(owner === null, 'MEDIUM candidate yields null (never promoted to HIGH)');
});

run('DeepOwnerResolver — mix [LOW, HIGH] resolves HIGH, not LOW', () => {
  const owner = DeepOwnerResolver.resolve([LOW_CANDIDATE, HIGH_CANDIDATE], 'api surface', null, []);
  assert(!!owner, 'at least one candidate is HIGH -> owner resolved');
  assert(owner?.name === 'Jane Doe', 'HIGH candidate selected over LOW');
  assert(owner?.confidence === 'HIGH', 'resolved owner confidence is HIGH');
});

run('DeepOwnerResolver — mix [MEDIUM, LOW] (no HIGH) yields null', () => {
  const owner = DeepOwnerResolver.resolve([MED_CANDIDATE, LOW_CANDIDATE], 'api surface', null, []);
  assert(owner === null, 'no HIGH candidate => null (cannot promote MEDIUM/LOW)');
});

run('DeepOwnerResolver — empty candidates yields null', () => {
  const owner = DeepOwnerResolver.resolve([], 'api surface', null, []);
  assert(owner === null, 'no candidates => null');
});

// ── 2. OWNER EVIDENCE STRING FORMAT ───────────────────────────────────────────

run('OwnerSelector — evidence string exact format: `<name> is listed as <role> on <url> — "<excerpt>"`', () => {
  const sel = OwnerSelector.select([HIGH_CANDIDATE], 'api surface');
  const url = HIGH_CANDIDATE.source_urls[0];
  const excerpt = HIGH_CANDIDATE.evidence[0];
  const expected = `${HIGH_CANDIDATE.name} is listed as ${HIGH_CANDIDATE.role} on ${url} — "${excerpt}"`;
  assert(sel.ownerEvidenceString === expected,
    `evidence string matches exact format (got: ${JSON.stringify(sel.ownerEvidenceString)})`);
  // structural checks
  assert(sel.ownerEvidenceString.startsWith('Jane Doe is listed as Head of Engineering on '), 'starts with name + "is listed as" + role + "on"');
  assert(sel.ownerEvidenceString.includes(' — "'), 'contains em-dash + opening quote');
  assert(sel.ownerEvidenceString.endsWith('"'), 'ends with closing quote');
});

run('DeepOwnerResolver.buildEvidenceString — exact format: `<name> is listed as <role> on <url> — "<excerpt>"`', () => {
  const url = HIGH_CANDIDATE.source_urls[0];
  const excerpt = HIGH_CANDIDATE.evidence[0];
  const expected = `${HIGH_CANDIDATE.name} is listed as ${HIGH_CANDIDATE.role} on ${url} — "${excerpt}"`;
  const actual = DeepOwnerResolver.buildEvidenceString(HIGH_CANDIDATE);
  assertEq(actual, expected, 'buildEvidenceString matches exact format with verbatim excerpt');
  // structural checks (em-dash is U+2014, single space padding around it)
  assert(actual.startsWith('Jane Doe is listed as Head of Engineering on '), 'starts with name + "is listed as" + role + "on"');
  assert(actual.includes(' — "'), 'contains em-dash + opening quote');
  assert(actual.endsWith('"'), 'ends with closing quote');
  assert(actual.split(' — "')[1] === excerpt + '"', 'excerpt is the verbatim candidate evidence');
  assert(!actual.startsWith(' '), 'no leading whitespace');
});

run('DeepOwnerResolver.buildEvidenceString — empty evidence still yields the exact shape', () => {
  const url = HIGH_CANDIDATE_NO_EVIDENCE.source_urls[0];
  const expected = `${HIGH_CANDIDATE_NO_EVIDENCE.name} is listed as ${HIGH_CANDIDATE_NO_EVIDENCE.role} on ${url} — ""`;
  const actual = DeepOwnerResolver.buildEvidenceString(HIGH_CANDIDATE_NO_EVIDENCE);
  assertEq(actual, expected, 'buildEvidenceString exact shape with empty excerpt (got: ' + JSON.stringify(actual) + ')');
  assert(actual.endsWith(' — ""'), 'ends with em-dash + empty quoted excerpt');
});

run('DeepOwnerResolver — owner_evidence uses verbatim candidate evidence when present', () => {
  const owner = DeepOwnerResolver.resolve([HIGH_CANDIDATE], 'api surface', null, []);
  assert(!!owner, 'HIGH candidate resolves');
  if (owner) {
    assertEq(owner.owner_evidence, HIGH_CANDIDATE.evidence, 'owner_evidence is verbatim candidate evidence');
  }
});

run('DeepOwnerResolver — falls back to buildEvidenceString when candidate evidence is empty', () => {
  const owner = DeepOwnerResolver.resolve([HIGH_CANDIDATE_NO_EVIDENCE], 'api surface', null, []);
  assert(!!owner, 'HIGH candidate with empty evidence still resolves');
  if (owner) {
    assert(owner.owner_evidence.length === 1, 'owner_evidence has one entry (fallback string)');
    const expected = DeepOwnerResolver.buildEvidenceString(HIGH_CANDIDATE_NO_EVIDENCE);
    assertEq(owner.owner_evidence[0], expected, 'owner_evidence falls back to DeepOwnerResolver.buildEvidenceString');
    // The fallback string still carries the core "<name> is listed as <role> on <url>" format.
    assert(owner.owner_evidence[0].startsWith('Jane Doe is listed as Head of Engineering on https://acme.com/team'),
      'core format present even without excerpt');
    assert(owner.owner_evidence[0].endsWith(' — ""'), 'exact format carries the em-dash + quoted (empty) excerpt');
  }
});

// ── 3. CONTACTABILITY FINDER ──────────────────────────────────────────────────

run('ContactabilityFinder — Growjo channels normalized (email/PHONE/LINKEDIN)', () => {
  const growjo = makeGrowjoCompany();
  const contacts = ContactabilityFinder.find([], new Map(), undefined, growjo);

  const email = contacts.find(c => c.type === 'PROFESSIONAL_EMAIL');
  const phone = contacts.find(c => c.type === 'PHONE');
  const linkedin = contacts.find(c => c.type === 'LINKEDIN');

  assert(!!email, 'PROFESSIONAL_EMAIL channel produced from Growjo');
  assert(!!phone, 'PHONE channel produced from Growjo');
  assert(!!linkedin, 'LINKEDIN channel produced from Growjo');

  // Email normalization: full address lowercased by GrowjoProvider
  assert(email?.value === 'jane@acme.com', 'Growjo email normalized: "Jane@ACME.com" -> "jane@acme.com"');
  assert(email?.confidence === 'HIGH', 'Growjo email confidence is HIGH');
  assert(email?.source_url === 'https://www.growjo.com/acme', 'Growjo email source_url is the Growjo lead URL');
  assert(!!(email?.note && email.note.includes('GROWJO_CSV:primary_email')), 'email note preserves Growjo provenance');

  // LinkedIn normalization: absolute URL, trailing slash stripped
  assert(linkedin?.value === 'https://linkedin.com/in/janedoe', 'Growjo LinkedIn URL canonicalised to absolute');
  assert(linkedin?.confidence === 'HIGH', 'Growjo LinkedIn confidence is HIGH');

  // Phone: value preserved (separators kept)
  assert(phone?.value === '555-1234', 'Growjo phone value preserved');
  assert(phone?.confidence === 'HIGH', 'Growjo phone confidence is HIGH');
});

run('ContactabilityFinder — no email guessing (LinkedIn-only page produces no PROFESSIONAL_EMAIL)', () => {
  const html = `<html><body><p>Contact <a href="https://www.linkedin.com/in/janedoe">Jane Doe on LinkedIn</a>.</p></body></html>`;
  const pages: DiscoveredPage[] = [{ url: 'https://acme.com/team', path: '/team', category: 'team_people' }];
  const contacts = ContactabilityFinder.find(pages, new Map([['https://acme.com/team', html]]));

  const emails = contacts.filter(c => c.type === 'PROFESSIONAL_EMAIL');
  assert(emails.length === 0, 'no PROFESSIONAL_EMAIL fabricated from a LinkedIn-only page');

  const profiles = contacts.filter(c => c.type === 'PUBLIC_PROFESSIONAL_CONTACT');
  assert(profiles.length === 1, 'exactly one PUBLIC_PROFESSIONAL_CONTACT captured from public link');
  assert(profiles[0].value.includes('linkedin.com/in/janedoe'), 'profile link is the real public URL');

  // No email-like values anywhere (no invented firstname@company.com)
  assert(!contacts.some(c => /@/.test(c.value)), 'no email-like value constructed from thin air');
});

run('ContactabilityFinder — role accounts classified as COMPANY_BUSINESS_EMAIL (not dropped)', () => {
  const html = `<html><body>
<a href="mailto:jane@acme.com">jane</a>
<a href="mailto:info@acme.com">info</a>
<a href="mailto:sales@acme.com">sales</a>
<a href="mailto:noreply@acme.com">noreply</a>
</body></html>`;
  const pages: DiscoveredPage[] = [{ url: 'https://acme.com/team', path: '/team', category: 'team_people' }];

  // Growjo email is also a role account — should be classified as COMPANY_BUSINESS_EMAIL too.
  const growjo = makeGrowjoCompany({ primary_email: 'team@acme.com' });
  const contacts = ContactabilityFinder.find(pages, new Map([['https://acme.com/team', html]]), undefined, growjo);

  const emails = contacts.filter(c => c.type === 'PROFESSIONAL_EMAIL');
  assert(emails.length === 1, 'only the non-role public email captured as PROFESSIONAL_EMAIL (expected 1, got ' + emails.length + ')');
  assert(emails[0].value === 'jane@acme.com', 'role accounts (info@, sales@, noreply@, team@) classified as COMPANY_BUSINESS_EMAIL, not dropped');

  const roleEmails = contacts.filter(c => c.type === 'COMPANY_BUSINESS_EMAIL');
  const roleValues = roleEmails.map(c => c.value).sort();
  assert(roleValues.includes('info@acme.com'), 'info@ classified as COMPANY_BUSINESS_EMAIL');
  assert(roleValues.includes('sales@acme.com'), 'sales@ classified as COMPANY_BUSINESS_EMAIL');
  assert(roleValues.includes('noreply@acme.com'), 'noreply@ classified as COMPANY_BUSINESS_EMAIL');
  assert(roleValues.includes('team@acme.com'), 'team@ (Growjo) classified as COMPANY_BUSINESS_EMAIL');
  assert(!ContactabilityFinder.hasOwnerVerifiedEmail(contacts), 'no OWNER_VERIFIED_EMAIL from role accounts');
});

run('ContactabilityFinder — public HTML: mailto + tel + profile + contact page captured', () => {
  const html = `<html><body>
<a href="mailto:jane@acme.com">jane@acme.com</a>
<a href="tel:+15551234567">+1 555-1234</a>
<a href="https://www.linkedin.com/in/janedoe">LinkedIn</a>
<a href="https://twitter.com/janedoe">Twitter</a>
<a href="/contact">Contact</a>
</body></html>`;
  const pages: DiscoveredPage[] = [{ url: 'https://acme.com/team', path: '/team', category: 'team_people' }];
  const contacts = ContactabilityFinder.find(pages, new Map([['https://acme.com/team', html]]));

  const email = contacts.find(c => c.type === 'PROFESSIONAL_EMAIL' && c.value === 'jane@acme.com');
  assert(!!email, 'mailto email captured');
  assert(email?.source_url === 'https://acme.com/team', 'email provenance recorded');

  const phone = contacts.find(c => c.type === 'PHONE');
  assert(!!phone, 'tel: phone captured as PHONE');
  assert(phone?.value === '+15551234567', 'phone value is the tel: contents');
  assert(phone?.source_url === 'https://acme.com/team', 'phone provenance recorded');

  const profile = contacts.find(c => c.type === 'PUBLIC_PROFESSIONAL_CONTACT');
  assert(!!profile, 'public profile link captured');
  assert(!!(profile?.value.includes('linkedin.com/in/janedoe')), 'LinkedIn profile link captured');

  const contactPage = contacts.find(c => c.type === 'CONTACT_PAGE');
  assert(!!contactPage, 'contact page link captured');

  const allEmails = contacts.filter(c => c.type === 'PROFESSIONAL_EMAIL');
  assert(allEmails.every(c => c.value === 'jane@acme.com'), 'no invented/gmail-style emails generated');
  assert(ContactabilityFinder.hasUsableChannel(contacts), 'usable channel exists');
});

run('ContactabilityFinder — hasUsableChannel recognizes PROFESSIONAL_EMAIL / PROFILE / PHONE / LINKEDIN', () => {
  const mk = (type: string): DeepContact => ({ type: type as DeepContact['type'], value: 'x', source_url: 'https://x.com', confidence: 'HIGH' });
  assert(ContactabilityFinder.hasUsableChannel([mk('PROFESSIONAL_EMAIL')]), 'PROFESSIONAL_EMAIL is usable');
  assert(ContactabilityFinder.hasUsableChannel([mk('PROFESSIONAL_PROFILE')]), 'PROFESSIONAL_PROFILE is usable');
  assert(ContactabilityFinder.hasUsableChannel([mk('PROFILE')]), 'PROFILE is usable');
  assert(ContactabilityFinder.hasUsableChannel([mk('PHONE')]), 'PHONE is usable');
  assert(ContactabilityFinder.hasUsableChannel([mk('LINKEDIN')]), 'LINKEDIN is usable');
  assert(!ContactabilityFinder.hasUsableChannel([mk('CONTACT_PAGE')]), 'CONTACT_PAGE-only is NOT a usable direct channel');
  assert(!ContactabilityFinder.hasUsableChannel([mk('PRESS_CONTACT')]), 'PRESS_CONTACT-only is NOT a usable direct channel');
});

run('ContactabilityFinder — Growjo + public sources merged, no duplicate emails', () => {
  // Growjo email Jane@ACME.com -> normalized to jane@acme.com; public mailto also jane@acme.com.
  const growjo = makeGrowjoCompany();
  const html = `<html><body><a href="mailto:jane@acme.com">jane</a></body></html>`;
  const pages: DiscoveredPage[] = [{ url: 'https://acme.com/team', path: '/team', category: 'team_people' }];
  const contacts = ContactabilityFinder.find(pages, new Map([['https://acme.com/team', html]]), undefined, growjo);
  const emails = contacts.filter(c => c.type === 'PROFESSIONAL_EMAIL');
  assert(emails.length === 1, 'Growjo + public email deduplicated to 1 (got ' + emails.length + ')');
  assert(emails[0].value === 'jane@acme.com', 'deduplicated email value correct');
});

run('ContactabilityFinder — backward-compatible 3-arg call (no Growjo data)', () => {
  const html = `<html><body><a href="mailto:jane@acme.com">jane</a></body></html>`;
  const pages: DiscoveredPage[] = [{ url: 'https://acme.com/team', path: '/team', category: 'team_people' }];
  // 3-arg form (no onProgress, no growjoData) — mirrors existing DeepProspectBuilder usage.
  const contacts = ContactabilityFinder.find(pages, new Map([['https://acme.com/team', html]]));
  const emails = contacts.filter(c => c.type === 'PROFESSIONAL_EMAIL');
  assert(emails.length === 1, 'public mailto still captured without Growjo data');
  assert(!contacts.some(c => c.type === 'PHONE' || c.type === 'LINKEDIN'), 'no Growjo-only types when no Growjo data supplied');
});

// ── 4. PEOPLE EXTRACTOR REGRESSION ───────────────────────────────────────────

run('PeopleExtractor — real person on team_people page → HIGH + explicit evidence', () => {
  const pages: DiscoveredPage[] = [{ url: 'https://acme.com/team', path: '/team', category: 'team_people' }];
  const html = new Map([['https://acme.com/team', TEAM_HTML]]);
  const cands = PeopleExtractor.extractFromPages(pages, html, { company: 'acme.com' });

  const jane = cands.find(c => c.name === 'Jane Doe');
  const bob = cands.find(c => c.name === 'Bob Smith');
  const sarah = cands.find(c => c.name === 'Sarah Jones');

  assert(!!jane, 'Jane Doe extracted from team page');
  assert(jane?.confidence === 'HIGH', 'Jane HIGH (explicit team listing on people-context page)');
  assert(jane?.explicit_evidence === true, 'Jane explicit_evidence is true');
  assert(jane?.role === 'Head of Engineering', 'Jane role correct');
  assert(jane?.source_urls?.[0] === 'https://acme.com/team', 'Jane source_url is team page');

  assert(!!bob, 'Bob Smith extracted');
  assert(bob?.role === 'VP Engineering', 'Bob role normalised to VP Engineering');
  assert(bob?.confidence === 'HIGH', 'Bob HIGH');

  // Non-candidate role must never be fabricated.
  assert(!sarah, 'Sarah Jones (Head of Marketing — non-candidate role) NOT extracted');
});

run('PeopleExtractor — real-person vs contamination regression: real people extracted, UI labels / template text rejected', () => {
  // Two pages processed together: a clean team page (real people) and a
  // contaminated page whose cards render UI labels / template fragments as
  // "names" ("Use Case", "Docs Dire", "Ve", "Demo Page", "Example Test").
  //
  // PeopleExtractor is conservative by design: Strategy 1 (line scan) can grab
  // a contamination token first, which (read-only) short-circuits Strategy 2
  // (card extraction) on THAT page. extractFromPages processes each discovered
  // page independently, so the REAL person is still recovered from the clean
  // page while the contamination on the other page is rejected by the
  // NON_NAME_TOKENS / isValidPersonName / personContext pipeline.
  const pages: DiscoveredPage[] = [
    { url: 'https://acme.com/team', path: '/team', category: 'team_people' },
    { url: 'https://acme.com/team-contaminated', path: '/team-contaminated', category: 'team_people' },
  ];
  const html = new Map<string, string>([
    ['https://acme.com/team', TEAM_HTML],
    ['https://acme.com/team-contaminated', CONTAMINATION_HTML],
  ]);
  const cands = PeopleExtractor.extractFromPages(pages, html, { company: 'acme.com' });

  const names = cands.map(c => c.name);
  const roles = cands.map(c => c.role);

  // Real person still extracted (from the clean page, via card strategy).
  assert(!!cands.find(c => c.name === 'Jane Doe'), 'Jane Doe (real person) extracted from the clean page');
  assert(!!cands.find(c => c.name === 'Bob Smith'), 'Bob Smith (real person) extracted from the clean page');

  // Contamination names must NOT appear anywhere in the results.
  assert(!names.some(n => /use case/i.test(n)), `no "Use Case" name (got ${JSON.stringify(names)})`);
  assert(!names.some(n => /docs/i.test(n) || /dire/i.test(n)), `no "Docs"/"Dire" name (got ${JSON.stringify(names)})`);
  assert(!names.some(n => /example/i.test(n) || /demo/i.test(n) || /\btest\b/i.test(n)), `no "Example/Demo/Test" names (got ${JSON.stringify(names)})`);
  assert(!names.some(n => /^ve$/i.test(n) || /\bve$/i.test(n)), `no single-token "Ve" name (got ${JSON.stringify(names)})`);

  // Truncated / fabricated role fragments must NOT appear.
  assert(!roles.some(r => r === 'Dire'), `no truncated role "Dire" (got ${JSON.stringify(roles)})`);

  // Every extracted candidate must be HIGH (people-context page).
  assert(cands.every(c => c.confidence === 'HIGH'), 'all extracted candidates are HIGH');
});

run('PeopleExtractor — about page yields HIGH for real person', () => {
  const pages: DiscoveredPage[] = [{ url: 'https://acme.com/about', path: '/about', category: 'about' }];
  const html = new Map([['https://acme.com/about', ABOUT_HTML_COMMA]]);
  const cands = PeopleExtractor.extractFromPages(pages, html, { company: 'acme.com' });

  const jane = cands.find(c => c.name === 'Jane Doe');
  assert(!!jane, 'Jane Doe extracted from about page');
  assert(jane?.confidence === 'HIGH', 'Jane HIGH on about page (people-context)');
  assert(jane?.role === 'CTO', 'Jane role is CTO');
  assert(jane?.explicit_evidence === true, 'Jane explicit_evidence true on about page');
});

run('PeopleExtractor — non-people page (engineering) yields no HIGH candidates', () => {
  const ENG_HTML = `<html><body><article><h1>Engineering Blog</h1><p>Jane Doe leads the team.</p></article></body></html>`;
  const pages: DiscoveredPage[] = [{ url: 'https://acme.com/engineering', path: '/engineering', category: 'engineering' }];
  const html = new Map([['https://acme.com/engineering', ENG_HTML]]);
  const cands = PeopleExtractor.extractFromPages(pages, html, { company: 'acme.com' });
  // Even if a name is grabbed, without a candidate role + co-occurrence it must not be HIGH.
  assert(cands.every(c => c.confidence !== 'HIGH'), 'engineering page (not a people-context page) yields no HIGH candidates');
});

// ── final ────────────────────────────────────────────────────────────────────

console.log('\n==================================================');
console.log(`peopleOwner tests: ${pass} passed, ${fail} failed.`);
if (fail === 0) console.log('ALL TESTS PASSED.');
else { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
expect(fail).toBe(0);

  });
});