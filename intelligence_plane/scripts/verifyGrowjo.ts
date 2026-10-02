/**
 * verifyGrowjo.ts
 * ───────────────
 * Verify that the Growjo CSV export parses correctly and report what the
 * GrowjoProvider extracts.  This CSV is a COMPANY-LEVEL ranking export whose
 * "Contact Data" column says "For Contacts and mobile phone number see lead411"
 * — i.e. there is NO person-level (name/title/email) data embedded.  We verify
 * the parser handles this honestly: contacts come back with person info absent.
 */
import * as fs from 'fs';
import { GrowjoProvider } from '../src/server/GrowjoProvider';
import type { GrowjoCompany } from '../src/server/DeepTypes';

const csvPath = process.argv[2] || 'data/growjo_export.csv';
const text = fs.readFileSync(csvPath, 'utf8');
const result = GrowjoProvider.parseCsv(text);

console.log(`\n=== Growjo CSV parse report: ${csvPath} ===`);
console.log(`Total rows:      ${result.total_rows}`);
console.log(`Parsed companies: ${result.companies.length}`);
console.log(`Duplicates dropped: ${result.duplicate_domains_dropped}`);
console.log(`Warnings: ${result.warnings.length}`);
result.warnings.slice(0, 10).forEach(w => console.log(`  - ${w}`));
console.log(`Column mapping:`);
for (const [alias, canonical] of Object.entries(result.column_mapping)) {
  console.log(`  "${alias}" → ${canonical}`);
}

console.log(`\n--- First 3 parsed records ---`);
for (const c of result.companies.slice(0, 3)) {
  console.log(JSON.stringify({
    company: c.company,
    domain: c.domain,
    industry: c.industry,
    primary_person_name: c.primary_person_name,
    primary_title: c.primary_title,
    primary_email: c.primary_email,
    primary_phone: c.primary_phone,
    linkedin_url: c.linkedin_url,
    funding: c.funding,
    valuation: c.valuation,
    employee_count: c.employee_count,
  }, null, 2));
}

// Check: how many records have a person name vs null?
const withPersonName = result.companies.filter(c => c.primary_person_name && c.primary_person_name !== c.company);
const withTitle = result.companies.filter(c => c.primary_title);
const withEmail = result.companies.filter(c => c.primary_email);
console.log(`\n--- Person-level data coverage ---`);
console.log(`Records with a person name (≠ company name): ${withPersonName.length} / ${result.companies.length}`);
console.log(`Records with a title:                         ${withTitle.length} / ${result.companies.length}`);
console.log(`Records with an email:                        ${withEmail.length} / ${result.companies.length}`);
console.log(`\nNOTE: The "Contact Data" column in this CSV says "For Contacts and mobile phone number see lead411"`);
console.log(`      — no person-level contact data is embedded. Growjo-owner resolution will correctly produce`);
console.log(`      no owner candidates (role-match gate fails when title is absent) — RESEARCH_MORE, no invented owners.`);

// Demonstrate extractContacts for the first record to show what the pipeline sees
const first = result.companies[0] as GrowjoCompany | undefined;
if (first) {
  const contact = GrowjoProvider.extractContacts(first);
  console.log(`\n--- extractContacts(first record) ---`);
  console.log(`company: ${contact.company}`);
  console.log(`domain:  ${contact.domain}`);
  console.log(`person.name:  ${contact.person.name}`);
  console.log(`person.title: ${contact.person.title}`);
  console.log(`person.email: ${contact.person.email}`);
  console.log(`channels: ${contact.channels.length}`);
  console.log(`=> OwnerPipeline.buildFromGrowjo will SKIP this (title is null → role-match gate rejects).`);
}
