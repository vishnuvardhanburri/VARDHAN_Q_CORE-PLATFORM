import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('audit_output.json', 'utf8'));

console.log(`TOTAL AUDITED PROSPECTS: ${data.length}\n`);

const p0 = data.filter((d: any) => d.priority === 'P0' && d.emailStatus === 'ELIGIBLE');
const p1 = data.filter((d: any) => d.priority === 'P1' && d.emailStatus === 'ELIGIBLE');
const p2 = data.filter((d: any) => d.priority === 'P2' || d.emailStatus === 'NEEDS_VERIFICATION');
const p3 = data.filter((d: any) => d.priority === 'P3');
const identityBlocked = data.filter((d: any) => d.blockReason.includes('IDENTITY_MISMATCH') || d.identityStatus.includes('MISMATCH'));
const sourceUnavailable = data.filter((d: any) => d.sourceUrl === 'NONE' || d.blockReason.includes('No real, publicly verifiable signal'));
const subjectBlocked = data.filter((d: any) => d.subject.includes('SUBJECT_BLOCKED'));

console.log(`1. VERIFIED P0: ${p0.length}`);
console.log(`2. VERIFIED P1: ${p1.length}`);
console.log(`3. P2 HUMAN REVIEW: ${p2.length}`);
console.log(`4. P3 BLOCKED: ${p3.length}`);
console.log(`5. IDENTITY BLOCKED: ${identityBlocked.length}`);
console.log(`6. SOURCE UNAVAILABLE: ${sourceUnavailable.length}`);
console.log(`7. SUBJECT BLOCKED: ${subjectBlocked.length}`);

console.log('\nFINAL ELIGIBLE PROSPECTS:');
const eligible = data.filter((d: any) => d.emailStatus === 'ELIGIBLE' && d.priority !== 'P3');
if (eligible.length === 0) {
  console.log('NONE (All unverified / mismatched prospects are safely blocked)');
} else {
  console.log(JSON.stringify(eligible, null, 2));
}
