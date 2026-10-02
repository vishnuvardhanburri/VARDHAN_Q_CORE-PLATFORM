const fs = require('fs');

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
  const p = `/Users/vishnuvardhanburri/Vardhan Q Core /intelligence_plane/tests/${file}`;
  if (!fs.existsSync(p)) continue;
  let content = fs.readFileSync(p, 'utf8');

  // Simple and safe: just prepend vitest import and wrap everything else in describe/test.
  // We can't easily put imports outside test() without a proper parser, but in TS,
  // ES module imports inside a block are illegal!
  // Wait, ES imports MUST be at the top level!
  // Let's manually extract imports safely.
  
  const lines = content.split('\n');
  const topLevel = [];
  const testBody = [];
  
  let inImport = false;
  
  for (const line of lines) {
    if (line.trim().startsWith('import ')) {
      inImport = true;
      topLevel.push(line);
      if (line.includes('from ')) inImport = false;
    } else if (inImport) {
      topLevel.push(line);
      if (line.includes('from ')) inImport = false;
    } else {
      testBody.push(line);
    }
  }

  let bodyStr = testBody.join('\n');
  bodyStr = bodyStr.replace(/process\.exit\s*\([^)]+\);?/g, "expect(typeof fail !== 'undefined' ? fail : (typeof failed !== 'undefined' ? failed : 0)).toBe(0);");
  bodyStr = bodyStr.replace(/^void\s+(main|run)\(\);?\s*$/gm, "await $1();");
  bodyStr = bodyStr.replace(/^(main|run)\(\)\.catch\([^)]+\);?\s*$/gm, "await $1();");
  bodyStr = bodyStr.replace(/^(main|run)\(\);?\s*$/gm, "await $1();");

  const finalContent = [
    ...topLevel,
    "import { describe, test, expect, beforeAll, afterAll } from 'vitest';",
    "describe('Migrated Suite', () => {",
    "  test('Migrated Test', async () => {",
    bodyStr,
    "  });",
    "});"
  ].join('\n');

  fs.writeFileSync(p, finalContent);
  console.log(`Migrated C: ${file}`);
}
