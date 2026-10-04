import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const requiredMarkers = [
  'Vardhan Technologies',
  'Intelligence',
  'Q Core',
  'Enterprise Access',
  'AER-KEP-Q',
  'Compliance',
  'Usage & Plans',
];

for (const marker of requiredMarkers) {
  if (!html.includes(marker)) {
    throw new Error(`premium shell missing required surface: ${marker}`);
  }
}

for (const marker of ['landing', 'app', 'modal', 'demoLogin', 'logout']) {
  if (!html.includes(`id="${marker}"`)) {
    throw new Error(`premium shell missing interaction anchor: ${marker}`);
  }
}

console.log(`premium shell contract: ${requiredMarkers.length} surfaces + 5 interaction anchors verified`);
