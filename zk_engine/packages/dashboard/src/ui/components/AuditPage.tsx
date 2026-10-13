import { useState } from 'react';
import { useFetch } from '../hooks.js';
import type { AuditEntry } from '../../shared/types.js';
import { StatusBadge } from './StatusBadge.js';

export function AuditPage() {
  const [limit, setLimit] = useState(50);
  const { data, error, loading, reload } = useFetch<{ entries: AuditEntry[] }>(`/api/audit?limit=${limit}`);

  return (
    <div>
      <h1>Audit log</h1>
      <div className="row" style={{ marginBottom: 8 }}>
        <label htmlFor="audit-limit" className="muted">
          limit
        </label>
        <select id="audit-limit" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          {[20, 50, 100, 200].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button className="ghost" onClick={reload}>
          refresh
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {loading && <p className="muted">loading…</p>}
      {data && (
        <div className="panel">
          <table data-testid="audit-table">
            <thead>
              <tr>
                <th>at</th>
                <th>actor</th>
                <th>action</th>
                <th>resource</th>
                <th>outcome</th>
                <th>ip</th>
                <th>requestId</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.at}</td>
                  <td>{e.actor}</td>
                  <td className="mono">{e.action}</td>
                  <td className="mono">{e.resource}</td>
                  <td>
                    {e.outcome === 'ok' || e.outcome === 'granted' ? (
                      <StatusBadge tone="ok">{e.outcome}</StatusBadge>
                    ) : (
                      <StatusBadge tone="bad">{e.outcome}</StatusBadge>
                    )}
                  </td>
                  <td className="mono">{e.ip ?? '—'}</td>
                  <td className="mono">{e.requestId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}