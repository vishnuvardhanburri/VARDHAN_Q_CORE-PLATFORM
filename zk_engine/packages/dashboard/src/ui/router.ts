/**
 * Tiny hash router: `#/overview`, `#/circuits`, `#/circuits/:id`, etc.
 * Hash navigation never triggers a full page load (CSP-safe, no server
 * round-trips for routing).
 */

export type DashboardRoute =
  | { name: 'overview' }
  | { name: 'circuits' }
  | { name: 'circuit'; circuitId: string }
  | { name: 'proofs' }
  | { name: 'gatekeeper'; reportFile?: string }
  | { name: 'audit' }
  | { name: 'unknown'; path: string };

export function parseHash(hash: string): DashboardRoute {
  const path = hash.replace(/^#/, '').split('?')[0] ?? '/';
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'overview' };
  switch (parts[0]) {
    case 'overview':
      return { name: 'overview' };
    case 'circuits':
      if (parts.length >= 2) return { name: 'circuit', circuitId: parts[1] ?? '' };
      return { name: 'circuits' };
    case 'proofs':
      return { name: 'proofs' };
    case 'gatekeeper': {
      const reportFile = parts[1];
      return reportFile !== undefined ? { name: 'gatekeeper', reportFile } : { name: 'gatekeeper' };
    }
    case 'audit':
      return { name: 'audit' };
    default:
      return { name: 'unknown', path };
  }
}

export function navigate(hash: string): void {
  location.hash = hash;
}