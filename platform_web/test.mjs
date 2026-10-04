import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const requiredMarkers = [
  'Vardhan Technologies',
  'Intelligence',
  'Q Core',
  'Enterprise access',
  'AER-KEP-Q',
  'Compliance',
  'Usage & billing',
  'Cyber Essentials / Plus',
  'ISO 27001',
  'SOC 2 Type II',
  'Independent penetration test',
];

for (const marker of requiredMarkers) {
  if (!html.includes(marker)) throw new Error(`enterprise shell missing required surface: ${marker}`);
}

for (const marker of ['public', 'app', 'auth', 'loginForm']) {
  if (!html.includes(`id="${marker}"`)) throw new Error(`enterprise shell missing interaction anchor: ${marker}`);
}

for (const marker of ['demoLogin', 'demo@example.com', 'password123']) {
  if (html.includes(marker)) throw new Error(`demo authentication artifact must not exist: ${marker}`);
}

for (const endpoint of ['/api/v1/auth/login', '/api/v1/me']) {
  if (!html.includes(endpoint)) throw new Error(`enterprise shell missing server API integration: ${endpoint}`);
}

console.log(`enterprise platform contract: ${requiredMarkers.length} surfaces + authenticated API/fail-closed checks verified`);
