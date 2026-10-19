import { useFetch } from '../hooks.js';
import type { CircuitSummary, GateOverview, RegistryInfo } from '../../shared/types.js';
import type { DashboardRoute } from '../router.js';

export function OverviewPage({ onRoute }: { onRoute: (r: DashboardRoute) => void }) {
  const registry = useFetch<RegistryInfo>('/api/registry');
  const circuits = useFetch<{ circuits: CircuitSummary[] }>('/api/circuits');
  const gate = useFetch<GateOverview>('/api/gatekeeper');

  return (
    <div>
      <h1>Overview</h1>
      <div className="grid">
        <div className="stat">
          <div className="label">Registry</div>
          {registry.loading ? (
            <div className="muted">loading…</div>
          ) : registry.error ? (
            <div className="muted">{registry.error}</div>
) : (
            <div className="value" data-testid="registry-status">
              {registry.data?.paused ? 'paused' : 'active'}
            </div>
          )}
        </div>
        <div className="stat">
          <div className="label">Circuits</div>
          {circuits.loading ? (
            <div className="muted">loading…</div>
          ) : circuits.error ? (
            <div className="muted">{circuits.error}</div>
          ) : (
            <div className="value" data-testid="circuit-count">{circuits.data?.circuits.length ?? 0}</div>
          )}
        </div>
        <div className="stat">
          <div className="label">Gatekeeper reports</div>
          <div className="value" data-testid="gate-count">{gate.data?.count ?? 0}</div>
        </div>
      </div>

      <div className="panel">
        <h2>Registry</h2>
        {registry.data ? (
          <table>
            <tbody>
              <tr>
                <th>proxy</th>
                <td className="mono">{registry.data.proxy}</td>
              </tr>
              <tr>
                <th>schema version</th>
                <td>{registry.data.schemaVersion}</td>
              </tr>
              <tr>
                <th>total proofs</th>
                <td>{registry.data.totalProofs}</td>
              </tr>
              <tr>
                <th>paused</th>
                <td>{registry.data.paused ? 'yes' : 'no'}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="muted">registry not configured ({registry.error ?? "loading…"})</p>
        )}
      </div>

      {gate.data?.latest ? (
        <div className="panel">
          <h2>Latest gatekeeper report</h2>
          <p>
            {gate.data.latest.verified ? 'verified' : 'blocked'} for {gate.data.latest.circuitId} —{' '}
            {gate.data.latest.reasonCount} reason(s)
            {' · '}
            <a href="#/gatekeeper">all reports →</a>
          </p>
        </div>
      ) : null}

      <div className="panel">
        <h2>Circuits</h2>
        {circuits.data ? (
          <table>
            <thead>
              <tr>
                <th>circuitId</th>
                <th>version</th>
                <th>public inputs</th>
                <th>artifacts</th>
                <th>on-chain</th>
              </tr>
            </thead>
            <tbody>
              {circuits.data.circuits.map((c) => (
                <tr key={c.circuitId}>
                  <td>
                    <a href={`#/circuits/${c.circuitId}`}>{c.circuitId}</a>
                  </td>
                  <td>{c.version}</td>
                  <td>{c.nPublic}</td>
                  <td>{c.artifactsReady ? 'ready' : 'missing'}</td>
                  <td>{c.registry ? (c.registry.active ? 'active' : 'inactive') : 'unregistered'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <button className="ghost" onClick={() => onRoute({ name: 'circuits' })}>
          open circuits →
        </button>
      </div>
    </div>
  );
}