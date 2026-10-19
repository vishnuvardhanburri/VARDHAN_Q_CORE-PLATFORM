import { useFetch } from '../hooks.js';
import type { GateOverview, GateReportDetail } from '../../shared/types.js';
import type { DashboardRoute } from '../router.js';
import { StatusBadge } from './StatusBadge.js';

export function GatekeeperPage({
  reportFile,
  onRoute,
}: {
  reportFile?: string;
  onRoute: (r: DashboardRoute) => void;
}) {
  const overview = useFetch<GateOverview>('/api/gatekeeper');
  const detail = useFetch<GateReportDetail | null>(reportFile ? `/api/gatekeeper/report/${encodeURIComponent(reportFile)}` : null);

  if (reportFile && detail.data) {
    const r = detail.data;
    return (
      <div>
        <div className="row" style={{ marginBottom: 8 }}>
          <button className="ghost" onClick={() => onRoute({ name: 'gatekeeper' })}>
            ← all reports
          </button>
          <h1 style={{ margin: 0 }}>Gate report</h1>
        </div>
        <div className="panel">
          <div className="row">
            {r.verified ? <StatusBadge tone="ok">verified</StatusBadge> : <StatusBadge tone="bad">blocked</StatusBadge>}
            <span className="mono">{r.file}</span>
          </div>
          <table>
            <tbody>
              <tr>
                <th>circuitId</th>
                <td>{r.circuitId ?? '—'}</td>
              </tr>
              <tr>
                <th>vkHash</th>
                <td className="mono">{r.vkHash ?? '—'}</td>
              </tr>
              <tr>
                <th>artifactHash</th>
                <td className="mono">{r.artifactHash ?? '—'}</td>
              </tr>
              <tr>
                <th>publicInputHash</th>
                <td className="mono">{r.publicInputHash ?? '—'}</td>
              </tr>
              <tr>
                <th>signing keyId</th>
                <td className="mono">{r.keyId ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>Checks</h2>
          <table data-testid="report-checks">
            <thead>
              <tr>
                <th>check</th>
                <th>result</th>
                <th>detail</th>
              </tr>
            </thead>
            <tbody>
              {r.checks.map((c) => (
                <tr key={c.name}>
                  <td className="mono">{c.name}</td>
                  <td>{c.ok ? <StatusBadge tone="ok">ok</StatusBadge> : <StatusBadge tone="bad">fail</StatusBadge>}</td>
                  <td className="mono">{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.reasons.length > 0 && (
          <div className="panel">
            <h2>Reasons</h2>
            <pre>{r.reasons.join('\n')}</pre>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <h1>Gatekeeper</h1>
      <p className="muted">
        Stored M8 gate results — read-only. The gate itself runs in CI from the trusted base branch;
        this view only presents recorded reports.
      </p>
      {overview.error && <div className="error">{overview.error}</div>}
      {overview.data && (
        <div className="grid">
          <div className="stat">
            <div className="label">reports</div>
            <div className="value">{overview.data.count}</div>
          </div>
          <div className="stat">
            <div className="label">latest</div>
            <div className="value">
              {overview.data.latest ? (
                overview.data.latest.verified ? (
                  <StatusBadge tone="ok">verified</StatusBadge>
                ) : (
                  <StatusBadge tone="bad">blocked</StatusBadge>
                )
              ) : (
                <span className="muted">none</span>
              )}
            </div>
          </div>
        </div>
      )}
      {overview.data && (
        <div className="panel">
          <h2>Reports</h2>
          <table data-testid="report-list">
            <thead>
              <tr>
                <th>file</th>
                <th>circuit</th>
                <th>result</th>
                <th>failed checks</th>
                <th>artifactHash</th>
              </tr>
            </thead>
            <tbody>
              {overview.data.reports.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    no gate reports stored
                  </td>
                </tr>
              )}
              {overview.data.reports.map((s) => (
                <tr key={s.file}>
                  <td>
                    <a href={`#/gatekeeper/${encodeURIComponent(s.file)}`} onClick={() => onRoute({ name: 'gatekeeper', reportFile: s.file })}>
                      {s.file}
                    </a>
                  </td>
                  <td>{s.circuitId ?? '—'}</td>
                  <td>
                    {s.verified ? <StatusBadge tone="ok">verified</StatusBadge> : <StatusBadge tone="bad">blocked</StatusBadge>}
                  </td>
                  <td>{s.failedChecks.join(', ') || '—'}</td>
                  <td className="mono">{s.artifactHash ? s.artifactHash.slice(0, 18) + '…' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}