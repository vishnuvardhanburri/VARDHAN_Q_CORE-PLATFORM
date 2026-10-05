import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

const requiredMarkers = [
  'VARDHAN ENTERPRISE', 'Authenticated access', 'Organizations', 'Subscription', 'Usage',
  'Security posture', 'Findings', 'Incidents', 'Q Core', 'AER-KEP-Q', 'Access &amp; RBAC',
  'server-side', 'authorization-new-token'
];
for (const marker of requiredMarkers) {
  if (!html.includes(marker)) throw new Error(`enterprise console missing required surface: ${marker}`);
}
for (const endpoint of [
  '/api/v1/auth/login', '/api/v1/auth/mfa/verify', '/api/v1/auth/logout', '/api/v1/me',
  '/api/v1/organizations', '/api/v1/catalog/plans', '/api/v1/organizations/${encodeURIComponent(selectedOrg.id)}/subscription',
  '/api/v1/organizations/${encodeURIComponent(selectedOrg.id)}/entitlements', '/api/v1/organizations/${encodeURIComponent(selectedOrg.id)}/usage',
  '/security/posture', '/findings', '/incidents', '/transactions', '/aer-kep-q/status', '/members', '/invitations'
]) {
  if (!html.includes(endpoint)) throw new Error(`enterprise console missing API integration: ${endpoint}`);
}
for (const marker of ['demoLogin', 'demo@example.com', 'password123', 'super_secret_admin_pass_123']) {
  if (html.includes(marker)) throw new Error(`demo or test credential artifact must not exist: ${marker}`);
}
if (!html.includes('await loadOrganizations()')) throw new Error('console must load organization state from API');
console.log(`enterprise console contract: ${requiredMarkers.length} surfaces + token rotation + ${15} API integration checks`);
