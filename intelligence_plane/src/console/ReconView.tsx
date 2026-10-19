import React from 'react';
import { Download } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  getCryptoPosture,
  listFindings,
  listTransactions,
  type CryptoPosture,
  type FindingList,
  type TransactionList,
} from '../services/qcore';
import { Empty, Panel, QueryStateView, bandColor, formatTime, statusColor, useOrgQuery } from './shared';

/** Map a live finding onto a pseudo asset row: severity+status become crypto-object state. */
function findingRow(f: FindingList['items'][number]): { object: string; owner: string; state: string; band: string } {
  return {
    object: `${f.finding_id} → receipt ${f.receipt_id}`,
    owner: f.severity,
    state: f.status,
    band: f.risk_band,
  };
}

export default function ReconView(): React.ReactElement {
  const { orgId } = useAuth();
  const findings = useOrgQuery<FindingList>(orgId, listFindings);
  const crypto = useOrgQuery<CryptoPosture>(orgId, getCryptoPosture);
  const tx = useOrgQuery<TransactionList>(orgId, listTransactions);
  const [filter, setFilter] = React.useState('');

  if (!orgId) {
    return (
      <Panel title="Recon — asset & exposure inventory" hint="Live findings, crypto objects, telemetry">
        <Empty message="Select an organization to load its Recon inventory." />
      </Panel>
    );
  }

  const filtered =
    findings.data?.items.filter(
      (f) =>
        filter.trim().length === 0 ||
        f.finding_id.toLowerCase().includes(filter.toLowerCase()) ||
        f.receipt_id.toLowerCase().includes(filter.toLowerCase()) ||
        f.severity.toLowerCase().includes(filter.toLowerCase()),
    ) ?? [];

  function exportCbom(): void {
    const payload = {
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        component: { type: 'application', name: 'vardhan-qcore-console', description: 'Tenant-scoped sealed crypto inventory export' },
        properties: [{ name: 'vardhan:tenant', value: orgId }, { name: 'vardhan:data_state', value: findings.data?.data_state ?? 'unknown' }],
      },
      components: (findings.data?.items ?? []).map((f) => ({
        type: 'cryptographic-asset',
        'bom-ref': f.finding_id,
        name: f.finding_id,
        version: String(f.updated_at_ms),
        description: `Finding bound to receipt ${f.receipt_id}`,
        properties: [
          { name: 'vardhan:receipt_id', value: f.receipt_id },
          { name: 'vardhan:severity', value: f.severity },
          { name: 'vardhan:status', value: f.status },
          { name: 'vardhan:risk_band', value: f.risk_band },
          { name: 'vardhan:risk_score', value: String(f.risk_score) },
        ],
        evidence: { references: f.evidence_refs.map((r) => ({ url: r })) },
      })),
      cryptoObjects: (crypto.data?.key_registry.issuers ?? []).map((k) => ({
        serviceId: k.service_id,
        ed25519KeyId: k.ed25519_key_id,
        mlDsa87KeyId: k.ml_dsa_87_key_id,
        issuerFingerprint: k.issuer_key_fingerprint,
        state: k.state,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vardhan-cbom-${orgId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Recon — asset & exposure inventory"
        hint={`Organization ${orgId} • findings ${findings.data?.data_state ?? '…'} • telemetry ${tx.data?.data_state ?? '…'}`}
        right={
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter findings…"
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-blue-500/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={exportCbom}
              className="flex cursor-pointer items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-200 hover:text-white hover:bg-slate-700 transition-colors"
            >
              <Download className="h-3 w-3" /> CBOM
            </button>
            <button
              type="button"
              onClick={() => {
                findings.reload();
                crypto.reload();
                tx.reload();
              }}
              className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-[10px] font-bold uppercase text-zinc-300 hover:text-white"
            >
              Reload
            </button>
          </div>
        }
      >
        {(findings.loading || crypto.loading || tx.loading) && (
          <p className="p-4 text-center font-mono text-xs text-slate-400">Loading live inventory…</p>
        )}
        {findings.error && <QueryStateView loading={false} error={findings.error} onRetry={findings.reload} />}
        {findings.data && findings.data.items.length === 0 && (
          <Empty message="No findings recorded for this organization yet — inventory is empty, not hidden." />
        )}
        {filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="px-3 py-2">Crypto object (finding → receipt)</th>
                  <th className="px-3 py-2">Severity / owner signal</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Risk band</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => {
                  const row = findingRow(f);
                  return (
                    <tr key={f.finding_id} className="border-b border-zinc-900/60 hover:bg-zinc-950/60">
                      <td className="px-3 py-2 font-bold text-white">{row.object}</td>
                      <td className="px-3 py-2 text-zinc-300">{row.owner}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${statusColor(row.state)}`}>{row.state}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${bandColor(row.band)}`}>{row.band}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-300">{f.risk_score}</td>
                      <td className="px-3 py-2 text-zinc-500">{formatTime(f.updated_at_ms)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {findings.data && findings.data.items.length > 0 && (
          <p className="mt-3 text-[10px] text-zinc-500">
            Blast radius: {findings.data.total} live findings across {new Set(findings.data.items.map((f) => f.receipt_id)).size} sealed receipts •{' '}
            {tx.data ? `${tx.data.total} telemetry transactions` : 'telemetry unavailable'} • evidence refs stay server-side until drilled into Reporting.
          </p>
        )}
      </Panel>

      <Panel title="Key registry issuers" hint="Issuer fingerprint → Ed25519 + ML-DSA-87 key pair state">
        {crypto.loading && <p className="p-4 text-center text-xs text-slate-400">Loading key registry…</p>}
        {crypto.error && <QueryStateView loading={false} error={crypto.error} onRetry={crypto.reload} />}
        {crypto.data && crypto.data.key_registry.issuers.length === 0 && (
          <Empty message="No key issuers registered for this organization yet." />
        )}
        {crypto.data && crypto.data.key_registry.issuers.length > 0 && (
          <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
            {crypto.data.key_registry.issuers.map((k) => (
              <div key={`${k.service_id}-${k.ed25519_key_id}`} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="font-bold text-white">{k.service_id}</p>
                <p className="mt-1 break-all text-zinc-400">ed25519: {k.ed25519_key_id}</p>
                <p className="break-all text-zinc-400">ml-dsa-87: {k.ml_dsa_87_key_id}</p>
                <p className="break-all text-zinc-500">issuer fp: {k.issuer_key_fingerprint}</p>
                <span className={`mt-2 inline-block rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${statusColor(String(k.state))}`}>
                  {String(k.state)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
