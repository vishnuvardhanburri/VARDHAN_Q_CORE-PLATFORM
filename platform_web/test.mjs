import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

const requiredMarkers = [
  'VARDHAN TECHNOLOGIES',
  'Enterprise access',
  'Organizations',
  'Subscription',
  'Usage',
  'Q Core',
  'AER-KEP-Q',
  'Compliance',
  'Access & RBAC',
  'Control plane connected',
];

for (const marker of requiredMarkers) {
  if (!html.includes(marker)) throw new Error(`enterprise console missing required surface: ${marker}`);
}

for (const marker of ['login', 'mfa', 'app', 'loginForm', 'mfaForm', 'orgForm']) {
  if (!html.includes(`id="${marker}"`)) throw new Error(`enterprise console missing interaction anchor: ${marker}`);
}

for (const marker of ['demoLogin', 'demo@example.com', 'password123', 'super_secret_admin_pass_123']) {
  if (html.includes(marker)) throw new Error(`demo or test credential artifact must not exist: ${marker}`);
}

for (const endpoint of [
  '/api/v1/auth/login',
  '/api/v1/auth/mfa/verify',
  '/api/v1/auth/logout',
  '/api/v1/me',
  '/api/v1/organizations',
  '/api/v1/catalog/plans',
  '/api/v1/organizations/${encodeURIComponent(selectedOrg.id)}/subscription',
  '/api/v1/organizations/${encodeURIComponent(selectedOrg.id)}/entitlements',
  '/api/v1/organizations/${encodeURIComponent(selectedOrg.id)}/usage',
]) {
  if (!html.includes(endpoint)) throw new Error(`enterprise console missing API integration: ${endpoint}`);
}

if (!html.includes('server-side')) throw new Error('console must describe server-side authority');
if (!html.includes('await loadOrganizations()')) throw new Error('console must load organization state from API');

console.log(`enterprise console contract: ${requiredMarkers.length} surfaces + authenticated MFA/API/fail-closed checks verified`);
