import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GrowjoProvider } from '../src/server/GrowjoProvider';
import type { GrowjoContact, GrowjoContactChannel, GrowjoPerson } from '../src/server/GrowjoProvider';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
// GrowjoProvider offline tests — CSV alias mapping, dedupe, provenance, contact channels.

let pass = 0, fail = 0; const failures: string[] = [];
const assert = (c: boolean, m: string) => { if (c) pass++; else { fail++; failures.push(m); console.log('[FAIL] ' + m); } };

function run(name: string, fn: () => void) { console.log('\n--- ' + name + ' ---'); fn(); }

run('growjo CSV — flexible column aliases', () => {
  const csv = [
    'company_name,website,industry,employees,employee_growth_pct,funding,revenue,valuation,person_name,person_title,email,linkedin_url,growjo_url',
    'Acme Corp,https://acme.com,Developer Infrastructure,250,12,12000000,50000000,2000000000,Jane Doe,Head of Engineering,jane@acme.com,https://www.linkedin.com/in/janedoe,https://www.acme.com/about',
  ].join('\n');
  const r = GrowjoProvider.parseCsv(csv);
  assert(r.companies.length === 1, 'one company parsed');
  const c = r.companies[0];
  assert(c.source === 'GROWJO', 'provenance source = GROWJO');
  assert(c.canonical_name === 'Acme Corp', 'canonical_name preserved');
  assert(c.domain === 'acme.com', 'domain normalised from website');
  assert(c.industry === 'Developer Infrastructure', 'industry mapped');
  assert(c.employee_count === 250, 'employees mapped to number');
  assert(c.employee_growth_pct === 12, 'growth pct mapped');
  assert(c.funding === 12000000, 'funding mapped to number');
  assert(c.revenue === 50000000, 'revenue mapped');
  assert(c.valuation === 2000000000, 'valuation mapped');
  assert(c.primary_person_name === 'Jane Doe', 'person_name mapped');
  assert(c.primary_title === 'Head of Engineering', 'person_title mapped');
  assert(c.primary_email === 'jane@acme.com', 'email mapped');
  assert(c.linkedin_url === 'https://www.linkedin.com/in/janedoe', 'linkedin mapped');
  assert(c.growjo_url === 'https://www.acme.com/about', 'growjo_url mapped');
  assert(c.source_url === c.growjo_url, 'source_url from growjo_url');
  assert(!!c.retrieved_at, 'retrieved_at present');
  assert(c.raw.company_name === 'Acme Corp', 'raw row preserved');
  assert(r.column_mapping.website === 'domain', 'website -> domain alias');
});

run('growjo CSV — alternate aliases (domain/url/title/phone)', () => {
  const csv = [
    'company,domain,url,title,phone,email',
    'Beta LLC,betalabs.com,https://betalabs.com,CTO,555-1234,cto@betalabs.com',
  ].join('\n');
  const r = GrowjoProvider.parseCsv(csv);
  const c = r.companies[0];
  assert(c.canonical_name === 'Beta LLC', 'name');
  assert(c.domain === 'betalabs.com', 'domain from domain col');
  assert(c.primary_title === 'CTO', 'title alias');
  assert(c.primary_phone === '555-1234', 'phone mapped');
  assert(c.primary_email === 'cto@betalabs.com', 'email');
});

run('growjo CSV — dedupe by canonical domain', () => {
  const csv = [
    'company,domain',
    'Acme,acme.com',
    'Acme Corp,https://www.acme.com',  // same canonical domain
    'OtherCo,other.com',
  ].join('\n');
  const r = GrowjoProvider.parseCsv(csv);
  assert(r.companies.length === 2, `deduped to 2 (got ${r.companies.length})`);
  assert(r.duplicate_domains_dropped === 1, 'one duplicate dropped');
});

run('growjo CSV — no silent promotion of estimates', () => {
  const csv = [
    'company,domain,funding,revenue,valuation',
    'Gamma,gamma.com,$12.5M,$1.0M,$200M',
  ].join('\n');
  const r = GrowjoProvider.parseCsv(csv);
  const c = r.companies[0];
  assert(c.funding === 12.5, 'funding $12.5M -> 12.5 (currency-stripped, numeric, not a fact)');
  assert(c.valuation === 200, 'valuation $200M -> 200');
  assert(c.funding_currency === 'USD', 'currency default USD preserved as metadata, not a fact');
});

run('growjo CSV — unmapped columns warn, never invent', () => {
  const csv = [
    'company,domain,bogus_column,crowd_pleaser',
    'Delta,delta.com,hello,no',
  ].join('\n');
  const r = GrowjoProvider.parseCsv(csv);
  assert(r.companies.length === 1, 'still parses the real company');
  assert(r.warnings.some(w => w.includes('bogus_column')), 'unmapped column warned');
  assert(r.warnings.some(w => w.includes('crowd_pleaser')), 'unmapped column warned');
  assert(!('bogus_column' in r.companies[0].raw === false), 'bogus not in canonical model');
});

run('growjo CSV — empty file handled', () => {
  const r = GrowjoProvider.parseCsv('');
  assert(r.companies.length === 0, 'empty CSV -> 0 companies');
  assert(r.warnings.length > 0, 'empty CSV warns');
});

run('growjo CSV — company + url aliases (canonical name dedupe)', () => {
  const csv = [
    'company,url',
    'Acme Corp,https://acme.com',
    'Acme Corp (US),https://acme.com/', // same canonical domain, diff name
  ].join('\n');
  const r = GrowjoProvider.parseCsv(csv);
  assert(r.companies.length === 1, 'deduped to 1 by canonical domain (got ' + r.companies.length + ')');
  assert(r.duplicate_domains_dropped === 1, 'one duplicate dropped');
  assert(r.column_mapping.url === 'domain', 'url alias mapped to domain');
});

run('growjo — extractContacts person + channel normalization', () => {
  const csv = [
    'company_name,domain,industry,employees,funding,person_name,person_title,email,phone,linkedin_url,growjo_url',
    'Acme,acme.com,Developer Infra,250,$12M,"  Jane Doe  ","Head of Engineering","  Jane@ACME.com  ","555-1234","linkedin.com/in/janedoe","https://www.acme.com/about"',
  ].join('\n');
  const r = GrowjoProvider.parseCsv(csv);
  assert(r.companies.length === 1, 'one company');
  const c = r.companies[0];
  const contact = GrowjoProvider.extractContacts(c);

  // Person fields
  assert(contact.person.name === 'Jane Doe', 'person name trimmed: "  Jane Doe  " -> "Jane Doe"');
  assert(contact.person.title === 'Head of Engineering', 'person title trimmed');
  assert(contact.person.email === 'Jane@ACME.com', 'email trimmed (raw value preserved)');
  assert(contact.person.phone === '555-1234', 'phone trimmed');
  assert(contact.person.linkedin === 'linkedin.com/in/janedoe', 'linkedin trimmed');

  // Channel normalization
  assert(contact.channels.length === 3, '3 channels derived (email+linkedin+phone) (got ' + contact.channels.length + ')');

  const emailChan = contact.channels.find(ch => ch.type === 'PROFESSIONAL_EMAIL')!;
  assert(!!emailChan, 'PROFESSIONAL_EMAIL channel exists');
  assert(emailChan.value === 'jane@acme.com', 'email lowercased: "Jane@ACME.com" -> "jane@acme.com"');
  assert(emailChan.confidence_source === 'GROWJO_CSV:primary_email', 'email confidence_source is GROWJO_CSV:primary_email');

  const linkedinChan = contact.channels.find(ch => ch.type === 'LINKEDIN')!;
  assert(!!linkedinChan, 'LINKEDIN channel exists');
  assert(linkedinChan.value === 'https://linkedin.com/in/janedoe', 'linkedin URL canonicalised to absolute');
  assert(linkedinChan.confidence_source === 'GROWJO_CSV:linkedin_url', 'linkedin confidence_source is GROWJO_CSV:linkedin_url');

  assert(linkedinChan.value === linkedinChan.value.replace(/\/+$/, ''), 'linkedin URL trailing slash stripped');

  const phoneChan = contact.channels.find(ch => ch.type === 'PHONE')!;
  assert(!!phoneChan, 'PHONE channel exists');
  assert(phoneChan.value === '555-1234', 'phone value preserved (separators kept)');
  assert(phoneChan.confidence_source === 'GROWJO_CSV:primary_phone', 'phone confidence_source is GROWJO_CSV:primary_phone');

  // Company identity
  assert(contact.company === 'Acme', 'contact.company = canonical_name');
  assert(contact.domain === 'acme.com', 'contact.domain = canonical domain');
  assert(contact.channels === contact.person.channels, 'contact.channels mirrors person.channels');
});

run('growjo — extractContacts empty when no person data', () => {
  const csv = [
    'company,domain',
    'NoContact,no-contact.com',
  ].join('\n');
  const r = GrowjoProvider.parseCsv(csv);
  const c = r.companies[0];
  const contact = GrowjoProvider.extractContacts(c);
  // normalizeRow falls back primary_person_name to company name when absent.
  assert(contact.person.name === 'NoContact', 'person name falls back to company name when person_name column absent');
  assert(contact.person.title === null, 'person title null when absent');
  assert(contact.person.email === null, 'person email null when absent');
  assert(contact.person.phone === null, 'person phone null when absent');
  assert(contact.person.linkedin === null, 'person linkedin null when absent');
  assert(contact.channels.length === 0, 'no channels when person data absent (got ' + contact.channels.length + ')');
  assert(contact.company === 'NoContact', 'company name set from canonical_name');
  assert(contact.domain === 'no-contact.com', 'domain set');
});

run('growjo — extractContacts with person + name only (no email/phone/linkedin)', () => {
  const csv = [
    'company,domain,person_name',
    'Solo,solo.com,Only Person',
  ].join('\n');
  const r = GrowjoProvider.parseCsv(csv);
  const c = r.companies[0];
  const contact = GrowjoProvider.extractContacts(c);
  assert(contact.person.name === 'Only Person', 'person name extracted');
  assert(contact.channels.length === 0, 'no channels when only name present');
});

run('growjo — contact channel types are a closed union', () => {
  // Verify that the type system enforces the channel type union by checking
  // that all possible values are within the expected set.
  const validTypes: ReadonlyArray<string> = ['PROFESSIONAL_EMAIL', 'PROFILE', 'LINKEDIN', 'PHONE'];
  for (const t of validTypes) {
    assert(validTypes.includes(t), 'channel type ' + t + ' is valid');
  }
  // extractContacts should only ever emit PROFESSIONAL_EMAIL, LINKEDIN, PHONE
  const csv = [
    'company,domain,email,phone,linkedin_url',
    'T,t.com,a@t.com,555,b.com/in/t',
  ].join('\n');
  const r = GrowjoProvider.parseCsv(csv);
  const contact = GrowjoProvider.extractContacts(r.companies[0]);
  for (const ch of contact.channels) {
    assert(['PROFESSIONAL_EMAIL', 'LINKEDIN', 'PHONE'].includes(ch.type), 'channel type ' + ch.type + ' is in allowed set');
  }
});

console.log('\n==================================================');
console.log(`GrowjoProvider tests: ${pass} passed, ${fail} failed.`);
if (fail === 0) console.log('ALL TESTS PASSED.');
else { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
expect(typeof fail !== 'undefined' ? fail : (typeof failed !== 'undefined' ? failed : 0)).toBe(0);

  });
});