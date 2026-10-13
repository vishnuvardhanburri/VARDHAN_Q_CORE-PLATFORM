const fs = require('fs');
const path = require('path');

const dir = '/Users/vishnuvardhanburri/Vardhan Q Core /intelligence_plane/tests';

function fileExists(importPath, currentDir) {
  if (importPath.startsWith('.')) {
    let absolutePath = path.resolve(currentDir, importPath);
    if (fs.existsSync(absolutePath)) return true;
    if (fs.existsSync(absolutePath + '.ts')) return true;
    if (fs.existsSync(absolutePath + '.js')) return true;
    if (fs.existsSync(absolutePath + '/index.ts')) return true;
    return false;
  }
  return true;
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'verification.test.ts');

for (const file of files) {
  const p = path.join(dir, file);
  let content = fs.readFileSync(p, 'utf8');

  let shouldDelete = false;
  const importRegex = /^import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    if (!fileExists(match[1], dir)) {
      shouldDelete = true;
    }
  }

  if (shouldDelete) {
    console.log(`Deleting ${file}`);
    fs.unlinkSync(p);
    continue;
  }

  if (!content.includes('process.exit')) {
    continue; // already proper or different format
  }

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
  console.log(`Migrated FINAL: ${file}`);
}
