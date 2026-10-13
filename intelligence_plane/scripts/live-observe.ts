import { IntelligenceEngine } from '../src/server/IntelligenceEngine';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const targetUrl = process.argv[2] || 'https://example.com';
  const ownerName = process.argv[3] || 'Unknown';
  const ownerRole = process.argv[4] || 'CTO';
  const ownerEvidence = process.argv[5] || '';
  
  console.log(`==================================================`);
  console.log(`VARDHAN LIVE OBSERVATION: ${targetUrl}`);
  console.log(`==================================================`);

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    console.error(`Invalid URL provided: ${targetUrl}`);
    process.exit(1);
  }

  const companyDomain = parsedUrl.hostname.replace('www.', '');

  console.log(`[+] Initializing live discovery provider for ${companyDomain}...`);
  console.log(`[+] Target Owner: ${ownerName} (${ownerRole})`);
  console.log(`[+] Executing intelligence pipeline in PRODUCTION mode...\n`);

  const result = await IntelligenceEngine.run(
    companyDomain,
    targetUrl,
    ownerName,
    ownerRole,
    ownerEvidence,
    [], 
    "PRODUCTION"
  );

  console.log(`==================================================`);
  console.log(`OBSERVATION RESULTS`);
  console.log(`==================================================`);
  
  console.log(`Target:`);
  console.log(`${companyDomain}`);
  console.log();
  console.log(`HTTP observations:`);
  console.log(`${result.evidence.length}`);
  console.log();
  console.log(`Discovery errors:`);
  console.log(`${result.discovery_errors}`);
  console.log();
  
  console.log(`Finding:`);
  console.log(`${result.finding_classification?.finding_type || 'NONE'} (Severity: ${result.finding_classification?.impact_severity})`);
  console.log();
  
  console.log(`Evidence strength:`);
  console.log(`${result.finding_strength?.evidence_strength || 'LOW'}`);
  console.log();

  console.log(`Owner:`);
  console.log(`${result.technical_owner?.name} (${result.technical_owner?.role})`);
  console.log();
  
  console.log(`Owner confidence:`);
  console.log(`${result.technical_owner?.owner_confidence || 'LOW'}`);
  console.log();
  
  console.log(`Decision:`);
  console.log(`${result.prospect_decision}`);
  console.log();
  
  if (result.contradictions.length > 0) {
    console.log(`Contradictions:`);
    console.log(`- ${result.contradictions.join('\n- ')}\n`);
  }
  
  if (result.evidence.length > 0) {
    console.log(`Evidence Origins Received: ${Array.from(new Set(result.evidence.map(e => e.evidence_origin))).join(', ')}`);
    const sample = result.evidence[0];
    console.log(`\nSample Observation:`);
    console.log(`  URL:       ${sample.public_url}`);
    console.log(`  Status:    ${sample.status}`);
    console.log(`  Latency:   ${sample.latency_ms}ms`);
    console.log(`  Fields:    ${sample.observed_fields?.length || 0} fields extracted`);
    console.log(`  Behavior:  ${sample.observed_behavior}`);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactPath = path.join(process.cwd(), 'artifacts', 'intelligence', `${ts}-${companyDomain}.json`);
  fs.writeFileSync(artifactPath, JSON.stringify(result, null, 2));
  console.log(`\n[+] Evidence artifact saved to: ${artifactPath}`);
  console.log(`[+] Human approval required. No email sent automatically.`);
}

main().catch(console.error);
