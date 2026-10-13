import fs from 'fs';
let code = fs.readFileSync('src/server/IntelligenceEngine.ts', 'utf8');
code = code.replace(
  /const explicitMatch = resolvedEvidence\.find\(e =>[\s\S]*?\);/,
  `const explicitMatch = resolvedEvidence.find(e => 
      e.owner_source_link && 
      e.owner_source_link.includes(crmName) &&
      (e.owner_source_link.includes('author explicitly matches') || e.owner_source_link.includes('repository owner') || e.owner_source_link.includes('source explicitly names'))
    );`
);
fs.writeFileSync('src/server/IntelligenceEngine.ts', code);
