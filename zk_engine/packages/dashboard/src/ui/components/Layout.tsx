import type { ReactNode } from 'react';
import { fetchJson } from '../api.js';
import type { DashboardRoute } from '../router.js';
import type { SessionInfo } from '../App.js';
import { OverviewPage } from './OverviewPage.js';
import { CircuitsPage } from './CircuitsPage.js';
import { CircuitPage } from './CircuitPage.js';
import { ProofsPage } from './ProofsPage.js';
import { GatekeeperPage } from './GatekeeperPage.js';
import { AuditPage } from './AuditPage.js';

const NAV: Array<[label: string, hash: string, name: string]> = [
  ['Overview', '#/overview', 'overview'],
  ['Circuits', '#/circuits', 'circuits'],
  ['Proofs', '#/proofs', 'proofs'],
  ['Gatekeeper', '#/gatekeeper', 'gatekeeper'],
  ['Audit', '#/audit', 'audit'],
];

export function Layout({
  session,
  route,
  onRoute,
  onLogout,
}: {
  session: SessionInfo;
  route: DashboardRoute;
  onRoute: (r: DashboardRoute) => void;
  onLogout: () => void;
}) {
  async function logout() {
    try {
      await fetchJson('/api/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      onLogout();
    }
  }

  let page: ReactNode;
  switch (route.name) {
    case 'circuits':
      page = <CircuitsPage onRoute={onRoute} />;
      break;
    case 'circuit':
      page = <CircuitPage circuitId={route.circuitId} />;
      break;
    case 'proofs':
      page = <ProofsPage />;
      break;
    case 'gatekeeper': {
      const reportFile = route.reportFile;
      page = reportFile !== undefined ? (
        <GatekeeperPage reportFile={reportFile} onRoute={onRoute} />
      ) : (
        <GatekeeperPage onRoute={onRoute} />
      );
      break;
    }
    case 'audit':
      page = <AuditPage />;
      break;
    case 'unknown':
      page = <div className="panel error">unknown route: {route.path}</div>;
      break;
    default:
      page = <OverviewPage onRoute={onRoute} />;
  }

  const active = route.name === 'circuit' ? 'circuits' : route.name;

  return (
    <div>
      <header className="topbar">
        <span className="brand">zkpe dashboard</span>
        <nav>
          {NAV.map(([label, hash, name]) => (
            <a key={name} href={hash} className={active === name ? 'active' : ''}>
              {label}
            </a>
          ))}
        </nav>
        <span className="who">
          session expires {new Date(session.expiresMs).toLocaleString()}
          <button className="ghost" onClick={logout}>
            logout
          </button>
        </span>
      </header>
      <main className="page" data-testid="page">{page}</main>
    </div>
  );
}