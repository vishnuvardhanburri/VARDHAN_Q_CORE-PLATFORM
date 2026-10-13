const fs = require('fs');
const path = require('path');

const files = [
  'adaptiveInvestigation.test.ts',
  'differentialFinding.test.ts',
  'entryPointAccuracy.test.ts',
  'entryPointIntelligence.test.ts',
  'ownerPipeline.test.ts',
  'vardhanOperator.test.ts',
  'owner_intelligence.test.ts',
  'regression_pseudo_signals.test.ts',
  'signalQuality.test.ts'
];

for (const file of files) {
  const p = path.join('/Users/vishnuvardhanburri/Vardhan Q Core /intelligence_plane/tests', file);
  if (!fs.existsSync(p)) continue;
  let content = fs.readFileSync(p, 'utf8');

  // remove duplicate vitest import
  content = content.replace("import { describe, test, expect, beforeAll, afterAll } from 'vitest';\nimport { describe, test, expect, beforeAll, afterAll } from 'vitest';", "import { describe, test, expect, beforeAll, afterAll } from 'vitest';");
  
  // remove duplicate describe
  content = content.replace("describe('Migrated Suite', () => {\n  test('Migrated Test', async () => {\ndescribe('Migrated Suite', () => {\n  test('Migrated Test', async () => {", "describe('Migrated Suite', () => {\n  test('Migrated Test', async () => {");
  
  // remove duplicate trailing tags
  content = content.replace("  });\n});\n  });\n});", "  });\n});");

  fs.writeFileSync(p, content);
  console.log(`Cleaned ${file}`);
}
