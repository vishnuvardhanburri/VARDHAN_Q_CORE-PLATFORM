import { useFetch } from '../hooks.js';
import type { CircuitSummary } from '../../shared/types.js';
import type { DashboardRoute } from '../router.js';
import { booleanBadge } from './StatusBadge.js';

export function CircuitsPage({ onRoute }: { onRoute: (r: DashboardRoute) => void }) {
  const { data, error, loading, reload } = useFetch<{ circuits: CircuitSummary[] }>('/api/circuits');

  return (
    <div>
      <h1>Circuits</h1>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="ghost" onClick={reload}>
          refresh
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">loading…</p>}
      {data && (
        <div className="panel">
          <table data-testid="circuit-table">
            <thead>
              <tr>
                <th>circuitId</th>
                <th>version</th>
                <th>public inputs</th>
                <th>artifacts</th>
                <th>on-chain</th>
                <th>vkHash</th>
              </tr>
            </thead>
            <tbody>
              {data.circuits.map((c) => (
                <tr key={c.circuitId}>
                  <td>
                    <a href={`#/circuits/${c.circuitId}`} onClick={() => onRoute({ name: 'circuit', circuitId: c.circuitId })}>
                      {c.circuitId}
                    </a>
                  </td>
                  <td>{c.version}</td>
                  <td>{c.nPublic}</td>
                  <td>{booleanBadge(c.artifactsReady, 'ready', 'missing')}</td>
                  <td>
                    {c.registry
                      ? c.registry.active
                        ? 'active'
                        : 'inactive'
                      : 'unregistered'}
                  </td>
                  <td className="mono">{c.registry?.vkHash ? c.registry.vkHash.slice(0, 18) + '…' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}