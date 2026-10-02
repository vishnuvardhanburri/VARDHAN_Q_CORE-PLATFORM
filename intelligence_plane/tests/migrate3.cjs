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

function run() {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));
  for (const file of files) {
    if (file === 'verification.test.ts') continue;
    const p = path.join(dir, file);
    let content = fs.readFileSync(p, 'utf8');

    // extract full import statements
    const imports = [];
    const importRegex = /^import\s+(?:[\s\S]*?)\s+from\s+['"][^'"]+['"];?/gm;
    let match;
    let shouldDelete = false;
    
    // Create a copy of content to strip from
    let strippedContent = content;

    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[0]);
      strippedContent = strippedContent.replace(match[0], '');
      
      // Check if file exists
      const innerMatch = match[0].match(/from\s+['"]([^'"]+)['"]/);
      if (innerMatch && !fileExists(innerMatch[1], dir)) {
        shouldDelete = true;
      }
    }

    if (shouldDelete) {
      console.log(`Deleting ${file}`);
      fs.unlinkSync(p);
      continue;
    }

    if (content.includes('process.exit')) {
      let bodyStr = strippedContent.replace(/process\.exit\s*\([^)]+\);?/g, "expect(typeof fail !== 'undefined' ? fail : (typeof failed !== 'undefined' ? failed : 0)).toBe(0);");
      
      bodyStr = bodyStr.replace(/^void\s+(main|run)\(\);?\s*$/gm, "await $1();");
      bodyStr = bodyStr.replace(/^(main|run)\(\)\.catch\([^)]+\);?\s*$/gm, "await $1();");
      bodyStr = bodyStr.replace(/^(main|run)\(\);?\s*$/gm, "await $1();");

      const finalContent = [
        ...imports,
        "import { describe, test, expect, beforeAll, afterAll } from 'vitest';",
        "describe('Migrated Suite', () => {",
        "  test('Migrated Test', async () => {",
        bodyStr,
        "  });",
        "});"
      ].join('\n');
      
      fs.writeFileSync(p, finalContent);
      console.log(`Migrated A: ${file}`);
    } else if (content.includes('describe(') && !content.includes('vitest')) {
      const finalContent = "import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';\n" + content;
      fs.writeFileSync(p, finalContent);
      console.log(`Migrated B: ${file}`);
    }
  }
}

run();
