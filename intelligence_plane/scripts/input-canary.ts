import { CSVParser } from '../src/server/discovery/CSVParser';
import { DomainValidator } from '../src/server/discovery/DomainValidator';
import fs from 'fs';

async function main() {
  console.log(`\n==================================================`);
  console.log(`INPUT CANARY`);
  console.log(`==================================================`);

  const csvPath = '/Users/vishnuvardhanburri/Downloads/vardhan-outreach-dashboard/dataset.csv';
  if (!fs.existsSync(csvPath)) {
    console.error("Dataset CSV not found.");
    return;
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const parsed = CSVParser.parse(content);

  console.log(`Total Rows Parsed: ${parsed.length}`);
  console.log(`\nFirst 20 Rows Inspection:`);
  
  parsed.slice(0, 20).forEach((row, i) => {
    const validation = DomainValidator.validate(row.domain);
    const normalized = validation.valid ? DomainValidator.normalize(row.domain) : 'N/A';
    console.log(`${i+1}. [${validation.valid ? 'VALID' : 'INVALID'}] Name: ${row.name} | Domain: ${row.domain} -> ${normalized} ${validation.reason ? '('+validation.reason+')' : ''}`);
  });

  const invalidCount = parsed.filter(r => !DomainValidator.validate(r.domain).valid).length;
  console.log(`\nTotal Invalid Domains: ${invalidCount}`);
  
  if (parsed.length === 0) {
    console.log(`\nFINAL DIAGNOSIS: CSV_PARSING_FAILURE`);
    process.exit(1);
  }
  
  console.log(`\nFINAL DIAGNOSIS: CSV_INPUT_VALIDATION_PASS`);
}

main().catch(console.error);
