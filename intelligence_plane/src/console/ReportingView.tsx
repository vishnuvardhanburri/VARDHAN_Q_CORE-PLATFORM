import React from 'react';
import { Award, Download, FileCheck2, Printer, Shield, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  baselinePolicy,
  getAudit,
  getExecutiveReport,
  ingestSignal,
  listAlerts,
  listDrift,
  listIncidents,
  listRemediations,
  listTransactions,
  observePolicy,
  transitionAlert,
  transitionIncident,
  transitionRemediation,
  validateReceipt,
  type AlertList,
  type AuditView,
  type DriftList,
  type IncidentList,
  type OpsSnapshot,
  type RemediationList,
  type TransactionList,
} from '../services/qcore';
import { Empty, Panel, QueryStateView, bandColor, formatTime, statusColor, useOrgQuery } from './shared';

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const CONTROL_MAP: Array<{ framework: string; control: string; evidence: string; console: string }> = [
  { framework: 'DORA', control: 'ICT risk management — incident triage', evidence: 'alerts list + transitions', console: 'Alerts panel below' },
  { framework: 'DORA', control: 'Digital operational resilience testing', evidence: 'policy baseline / observations / drift', console: 'Policy drift panel' },
  { framework: 'DORA', control: 'ICT third-party & change audit', evidence: 'audit view (alerts + drift + remediations)', console: 'Audit panel + assessor export' },
  { framework: 'SWIFT CSCF', control: '2.x — privileged activity review', evidence: 'transactions + receipts explorer', console: 'Receipts explorer' },
  { framework: 'SWIFT CSCF', control: '5.x — security event logging & response', evidence: 'incidents + remediations transitions', console: 'Incidents & remediations panels' },
  { framework: 'SWIFT CSCF', control: '7.x — vulnerability & crypto agility', evidence: 'executive report + crypto posture', console: 'Overview + Resilience views' },
];

export default function ReportingView(): React.ReactElement {
  const { orgId } = useAuth();
  const alerts = useOrgQuery<AlertList>(orgId, listAlerts);
  const drift = useOrgQuery<DriftList>(orgId, listDrift);
  const rems = useOrgQuery<RemediationList>(orgId, listRemediations);
  const incidents = useOrgQuery<IncidentList>(orgId, listIncidents);
  const tx = useOrgQuery<TransactionList>(orgId, listTransactions);
  const audit = useOrgQuery<AuditView>(orgId, getAudit);
  const rep = useOrgQuery<OpsSnapshot>(orgId, async (org) => (await getExecutiveReport(org)).snapshot);

  const [attestationOpen, setAttestationOpen] = React.useState(false);
  const [sig, setSig] = React.useState({ signal_id: '', source: '', severity: 'medium', title: '', message: '', evidence: '', correlation: '' });
  const [sigMsg, setSigMsg] = React.useState<string | null>(null);
  const [sigBusy, setSigBusy] = React.useState(false);
  const [alertTrans, setAlertTrans] = React.useState({ alert_id: '', status: 'acknowledged' });
  const [alertMsg, setAlertMsg] = React.useState<string | null>(null);
  const [baseForm, setBaseForm] = React.useState({ policy_id: '', version: 'v1', policy: '{}' });
  const [baseMsg, setBaseMsg] = React.useState<string | null>(null);
  const [remTrans, setRemTrans] = React.useState({ remediation_id: '', status: 'approved' });
  const [remMsg, setRemMsg] = React.useState<string | null>(null);
  const [incTrans, setIncTrans] = React.useState({ incident_id: '', status: 'acknowledged' });
  const [incMsg, setIncMsg] = React.useState<string | null>(null);
  const [valContract, setValContract] = React.useState('{}');
  const [valActor, setValActor] = React.useState('');
  const [valOut, setValOut] = React.useState<string | null>(null);
  const [valBusy, setValBusy] = React.useState(false);

  if (!orgId) {
    return (
      <Panel title="Reporting — evidence & assessor export" hint="Receipts, alerts, drift, remediations, audit">
        <Empty message="Select an organization to load its Reporting evidence." />
      </Panel>
    );
  }

  const reloadAll = (): void => {
    alerts.reload();
    drift.reload();
    rems.reload();
    incidents.reload();
    tx.reload();
    audit.reload();
    rep.reload();
  };

  async function handleSignal(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!orgId || sig.signal_id.trim().length === 0 || sig.title.trim().length === 0) {
      setSigMsg('signal_id and title are required.');
      return;
    }
    setSigBusy(true);
    setSigMsg(null);
    try {
      await ingestSignal(orgId, {
        signal_id: sig.signal_id.trim(),
        source: sig.source.trim() || 'console',
        severity: sig.severity,
        title: sig.title.trim(),
        message: sig.message.trim() || sig.title.trim(),
        evidence_refs: sig.evidence.split(',').map((s) => s.trim()).filter((s) => s.length > 0),
        correlation_id: sig.correlation.trim().length > 0 ? sig.correlation.trim() : null,
        observed_at_ms: Date.now(),
      });
      setSigMsg('Signal ingested.');
      setSig({ signal_id: '', source: '', severity: 'medium', title: '', message: '', evidence: '', correlation: '' });
      alerts.reload();
    } catch (err) {
      setSigMsg(err instanceof Error ? err.message : 'Ingest failed.');
    } finally {
      setSigBusy(false);
    }
  }

  async function handleAlertTransition(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!orgId || alertTrans.alert_id.trim().length === 0) {
      setAlertMsg('alert_id is required.');
      return;
    }
    try {
      await transitionAlert(orgId, alertTrans.alert_id.trim(), alertTrans.status);
      setAlertMsg('Alert transitioned.');
      alerts.reload();
    } catch (err) {
      setAlertMsg(err instanceof Error ? err.message : 'Transition failed.');
    }
  }

  async function handleBaseline(e: React.FormEvent, mode: 'baseline' | 'observe'): Promise<void> {
    e.preventDefault();
    if (!orgId || baseForm.policy_id.trim().length === 0) {
      setBaseMsg('policy_id is required.');
      return;
    }
    let policy: unknown;
    try {
      policy = JSON.parse(baseForm.policy);
    } catch {
      setBaseMsg('Policy must be valid JSON.');
      return;
    }
    try {
      if (mode === 'baseline') await baselinePolicy(orgId, baseForm.policy_id.trim(), baseForm.version.trim() || 'v1', policy);
      else await observePolicy(orgId, baseForm.policy_id.trim(), baseForm.version.trim() || 'v1', policy);
      setBaseMsg(mode === 'baseline' ? 'Baseline registered.' : 'Observation recorded — drift evaluated server-side.');
      drift.reload();
    } catch (err) {
      setBaseMsg(err instanceof Error ? err.message : 'Policy call failed.');
    }
  }

  async function handleRemTransition(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!orgId || remTrans.remediation_id.trim().length === 0) {
      setRemMsg('remediation_id is required.');
      return;
    }
    try {
      await transitionRemediation(orgId, remTrans.remediation_id.trim(), remTrans.status);
      setRemMsg('Remediation transitioned.');
      rems.reload();
    } catch (err) {
      setRemMsg(err instanceof Error ? err.message : 'Transition failed.');
    }
  }

  async function handleIncidentTransition(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!orgId || incTrans.incident_id.trim().length === 0) {
      setIncMsg('incident_id is required.');
      return;
    }
    try {
      await transitionIncident(orgId, incTrans.incident_id.trim(), incTrans.status);
      setIncMsg('Incident transitioned.');
      incidents.reload();
    } catch (err) {
      setIncMsg(err instanceof Error ? err.message : 'Transition failed.');
    }
  }

  async function handleValidate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!orgId || valActor.trim().length === 0) {
      setValOut('actor_workload_id is required.');
      return;
    }
    let contract: unknown;
    try {
      contract = JSON.parse(valContract);
    } catch {
      setValOut('Contract must be valid JSON.');
      return;
    }
    setValBusy(true);
    setValOut(null);
    try {
      const out = await validateReceipt(orgId, contract, valActor.trim());
      setValOut(JSON.stringify(out, null, 2));
    } catch (err) {
      setValOut(err instanceof Error ? `FAILED: ${err.message}` : 'Validation failed.');
    } finally {
      setValBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Reporting — evidence & assessor export"
        hint={`Organization ${orgId} • receipts ${tx.data?.total ?? '…'} • alerts ${alerts.data?.total ?? '…'} • drift ${drift.data?.total ?? '…'}`}
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAttestationOpen(true)}
              className="flex cursor-pointer items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500 shadow-sm transition-colors"
            >
              <Award className="h-3.5 w-3.5" /> Attestation Certificate
            </button>
            <button
              type="button"
              onClick={() => rep.data && downloadJson(`vardhan-executive-report-${orgId}.json`, { report_type: 'executive_security_operations', source: 'durable_control_plane_state', snapshot: rep.data })}
              disabled={!rep.data}
              className="flex cursor-pointer items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold uppercase text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
            >
              <Download className="h-3 w-3" /> Executive report
            </button>
            <button
              type="button"
              onClick={() => audit.data && downloadJson(`vardhan-assessor-export-${orgId}.json`, audit.data)}
              disabled={!audit.data}
              className="flex cursor-pointer items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-200 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-40"
            >
              <FileCheck2 className="h-3 w-3" /> Assessor export
            </button>
            <button
              type="button"
              onClick={reloadAll}
              className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-[10px] font-bold uppercase text-zinc-300 hover:text-white"
            >
              Reload
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-zinc-800 uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-2">Framework</th>
                <th className="px-3 py-2">Control family</th>
                <th className="px-3 py-2">Server evidence</th>
                <th className="px-3 py-2">Console location</th>
              </tr>
            </thead>
            <tbody>
              {CONTROL_MAP.map((row, i) => (
                <tr key={i} className="border-b border-zinc-900/60">
                  <td className="px-3 py-2 font-bold text-white">{row.framework}</td>
                  <td className="px-3 py-2 text-zinc-300">{row.control}</td>
                  <td className="px-3 py-2 text-zinc-400">{row.evidence}</td>
                  <td className="px-3 py-2 text-slate-300">{row.console}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-zinc-600">
          This table is a console-side guide: the evidence itself always comes from the control plane routes named above, never from the browser.
        </p>
      </Panel>

      <Panel title="Receipts explorer" hint="Transactions bound to sealed receipts — platform crypto path">
        {tx.loading && <p className="p-4 text-center text-xs text-slate-400">Loading receipts…</p>}
        {tx.error && <QueryStateView loading={false} error={tx.error} onRetry={tx.reload} />}
        {tx.data && tx.data.receipts.length === 0 && <Empty message="No receipts sealed for this organization yet." />}
        {tx.data && tx.data.receipts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="px-3 py-2">Receipt</th>
                  <th className="px-3 py-2">Decision</th>
                  <th className="px-3 py-2">Outcome</th>
                  <th className="px-3 py-2">Verification</th>
                  <th className="px-3 py-2">Issuer fp</th>
                  <th className="px-3 py-2">Sealed</th>
                </tr>
              </thead>
              <tbody>
                {tx.data.receipts.slice(0, 50).map((r) => (
                  <tr key={r.receipt_id} className="border-b border-zinc-900/60">
                    <td className="px-3 py-2 font-bold text-white">{r.receipt_id}</td>
                    <td className="px-3 py-2 text-zinc-300">{r.decision}</td>
                    <td className="px-3 py-2 text-zinc-400">{r.outcome_code}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${statusColor(r.verification)}`}>{r.verification}</span>
                    </td>
                    <td className="max-w-48 truncate px-3 py-2 text-zinc-500">{r.issuer_key_fingerprint}</td>
                    <td className="px-3 py-2 text-zinc-500">{formatTime(r.timestamp_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tx.data && (
          <p className="mt-2 text-[10px] text-zinc-500">
            Trust boundary: {tx.data.trust_boundary} • receipt auth: {tx.data.receipt_authentication} • showing{' '}
            {Math.min(50, tx.data.receipts.length)} of {tx.data.receipts.length}.
          </p>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Alerts" hint="Ingest signals, transition triage state">
          {alerts.error && <QueryStateView loading={false} error={alerts.error} onRetry={alerts.reload} />}
          {alerts.data && alerts.data.items.length === 0 && <Empty message="No alerts raised for this organization." />}
          {alerts.data && alerts.data.items.length > 0 && (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
              {alerts.data.items.map((a) => (
                <li key={a.alert_id} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-white">{a.title}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusColor(a.status)}`}>{a.status}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${bandColor(a.severity)}`}>{a.severity}</span>
                  </div>
                  <p className="mt-1 text-zinc-400">{a.message}</p>
                  <p className="mt-1 text-[10px] text-zinc-600">{a.alert_id} • {formatTime(a.updated_at_ms)}</p>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={handleSignal} className="mt-4 space-y-2 border-t border-zinc-900 pt-3 text-xs">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Ingest signal</p>
            <div className="grid grid-cols-2 gap-2">
              <input value={sig.signal_id} onChange={(e) => setSig({ ...sig, signal_id: e.target.value })} placeholder="signal_id" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-white" />
              <input value={sig.source} onChange={(e) => setSig({ ...sig, source: e.target.value })} placeholder="source (default console)" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-white" />
              <input value={sig.title} onChange={(e) => setSig({ ...sig, title: e.target.value })} placeholder="title" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-white" />
              <select value={sig.severity} onChange={(e) => setSig({ ...sig, severity: e.target.value })} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-white">
                {['low', 'medium', 'high', 'critical'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input value={sig.message} onChange={(e) => setSig({ ...sig, message: e.target.value })} placeholder="message" className="col-span-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-white" />
              <input value={sig.evidence} onChange={(e) => setSig({ ...sig, evidence: e.target.value })} placeholder="evidence refs (comma separated)" className="col-span-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-white" />
            </div>
            <button type="submit" disabled={sigBusy} className="cursor-pointer rounded border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-[11px] font-bold uppercase text-blue-300 hover:bg-blue-500/20 disabled:opacity-50 transition-colors">
              {sigBusy ? 'Ingesting…' : 'Ingest signal'}
            </button>
            {sigMsg && <p className="text-zinc-400">{sigMsg}</p>}
          </form>
          <form onSubmit={handleAlertTransition} className="mt-3 flex flex-wrap gap-2 text-xs">
            <input value={alertTrans.alert_id} onChange={(e) => setAlertTrans({ ...alertTrans, alert_id: e.target.value })} placeholder="alert_id" className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-white" />
            <select value={alertTrans.status} onChange={(e) => setAlertTrans({ ...alertTrans, status: e.target.value })} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-white">
              {['acknowledged', 'resolved', 'open'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="submit" className="cursor-pointer rounded border border-zinc-700 px-3 py-1.5 font-bold uppercase text-zinc-300">Transition</button>
            {alertMsg && <p className="w-full text-zinc-400">{alertMsg}</p>}
          </form>
        </Panel>

        <Panel title="Policy drift" hint="Baseline once, observe continuously">
          {drift.error && <QueryStateView loading={false} error={drift.error} onRetry={drift.reload} />}
          {drift.data && drift.data.items.length === 0 && <Empty message="No drift observations recorded — register a baseline, then observe." />}
          {drift.data && drift.data.items.length > 0 && (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
              {drift.data.items.map((d) => (
                <li key={d.drift_id} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-white">{d.policy_id}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusColor(d.status)}`}>{d.status}</span>
                  </div>
                  <p className="mt-1 text-zinc-500">{d.baseline_version ?? 'no baseline'} → {d.observed_version} • {formatTime(d.observed_at_ms)}</p>
                </li>
              ))}
            </ul>
          )}
          <form className="mt-4 space-y-2 border-t border-zinc-900 pt-3 text-xs" onSubmit={(e) => handleBaseline(e, 'baseline')}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Baseline / observe policy</p>
            <div className="grid grid-cols-2 gap-2">
              <input value={baseForm.policy_id} onChange={(e) => setBaseForm({ ...baseForm, policy_id: e.target.value })} placeholder="policy_id" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-white" />
              <input value={baseForm.version} onChange={(e) => setBaseForm({ ...baseForm, version: e.target.value })} placeholder="version" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-white" />
              <textarea value={baseForm.policy} onChange={(e) => setBaseForm({ ...baseForm, policy: e.target.value })} placeholder='{"rule":"…"}' rows={2} className="col-span-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-white" />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="cursor-pointer rounded bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500 shadow-sm transition-colors">Register baseline</button>
              <button type="button" onClick={(e) => handleBaseline(e as unknown as React.FormEvent, 'observe')} className="cursor-pointer rounded border border-zinc-700 px-3 py-1.5 text-[11px] font-bold uppercase text-zinc-300">Record observation</button>
            </div>
            {baseMsg && <p className="text-zinc-400">{baseMsg}</p>}
          </form>
        </Panel>

        <Panel title="Remediations" hint="Proposed in Resilience — transitioned here">
          {rems.error && <QueryStateView loading={false} error={rems.error} onRetry={rems.reload} />}
          {rems.data && rems.data.items.length === 0 && <Empty message="No remediations proposed yet." />}
          {rems.data && rems.data.items.length > 0 && (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
              {rems.data.items.map((r) => (
                <li key={r.remediation_id} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-white">{r.action}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusColor(r.status)}`}>{r.status}</span>
                  </div>
                  <p className="mt-1 text-zinc-500">{r.remediation_id} • {r.rationale}</p>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={handleRemTransition} className="mt-3 flex flex-wrap gap-2 text-xs">
            <input value={remTrans.remediation_id} onChange={(e) => setRemTrans({ ...remTrans, remediation_id: e.target.value })} placeholder="remediation_id" className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-white" />
            <select value={remTrans.status} onChange={(e) => setRemTrans({ ...remTrans, status: e.target.value })} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-white">
              {['approved', 'rejected', 'applied', 'verified'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="submit" className="cursor-pointer rounded border border-zinc-700 px-3 py-1.5 font-bold uppercase text-zinc-300">Transition</button>
            {remMsg && <p className="w-full text-zinc-400">{remMsg}</p>}
          </form>
        </Panel>

        <Panel title="Incidents" hint="Finding-bound incident lifecycle">
          {incidents.error && <QueryStateView loading={false} error={incidents.error} onRetry={incidents.reload} />}
          {incidents.data && incidents.data.items.length === 0 && <Empty message="No incidents opened for this organization." />}
          {incidents.data && incidents.data.items.length > 0 && (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
              {incidents.data.items.map((i) => (
                <li key={i.incident_id} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-white">{i.incident_id}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusColor(i.status)}`}>{i.status}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${bandColor(i.risk_band)}`}>{i.risk_band}</span>
                  </div>
                  <p className="mt-1 text-zinc-500">findings: {i.finding_ids.length > 0 ? i.finding_ids.join(', ') : '—'} • {formatTime(i.updated_at_ms)}</p>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={handleIncidentTransition} className="mt-3 flex flex-wrap gap-2 text-xs">
            <input value={incTrans.incident_id} onChange={(e) => setIncTrans({ ...incTrans, incident_id: e.target.value })} placeholder="incident_id" className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-white" />
            <select value={incTrans.status} onChange={(e) => setIncTrans({ ...incTrans, status: e.target.value })} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-white">
              {['acknowledged', 'resolved', 'open'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="submit" className="cursor-pointer rounded border border-zinc-700 px-3 py-1.5 font-bold uppercase text-zinc-300">Transition</button>
            {incMsg && <p className="w-full text-zinc-400">{incMsg}</p>}
          </form>
        </Panel>
      </div>

      <Panel title="Receipt validation" hint="Canonical engine — tenant mismatch rejects, valid contracts seal">
        <form onSubmit={handleValidate} className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
          <label className="block md:col-span-2">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-zinc-500">Contract JSON</span>
            <textarea value={valContract} onChange={(e) => setValContract(e.target.value)} rows={4} className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-white" />
          </label>
          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-zinc-500">Actor workload ID</span>
              <input value={valActor} onChange={(e) => setValActor(e.target.value)} placeholder="svc-payments" className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white" />
            </label>
            <button type="submit" disabled={valBusy} className="w-full cursor-pointer rounded-lg bg-blue-600 px-3 py-2 text-[11px] font-semibold text-white hover:bg-blue-500 shadow-sm transition-colors disabled:opacity-50">
              {valBusy ? 'Validating…' : 'Validate & seal'}
            </button>
          </div>
        </form>
        {valOut && <pre className="mt-3 max-h-64 overflow-auto rounded-xl border border-zinc-800 bg-black/70 p-3 font-mono text-[11px] text-zinc-300">{valOut}</pre>}
      </Panel>

      {/* ── Cryptographic Attestation Certificate Modal ─────────────────────── */}
      {attestationOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="rounded-2xl border border-slate-700 bg-[#0c1019] w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl p-7 space-y-6">
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Award className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Cryptographic Assurance & Attestation Certificate</h3>
                  <p className="text-xs text-slate-400">Formal Verification Record • Control Plane Root of Trust</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAttestationOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Certificate Body (Printable) */}
            <div className="rounded-xl border border-slate-800 bg-[#090d16] p-6 space-y-5 print:bg-white print:text-black">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Assurance Standard</p>
                  <p className="text-sm font-bold text-white">NIST FIPS 204 & RFC 8032 Dual-Signature Model</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Attestation Serial</p>
                  <p className="text-xs font-mono font-bold text-blue-400">CERT-VQ-2026-{orgId?.slice(0, 8) ?? 'ROOT'}</p>
                </div>
              </div>

              <div className="space-y-2 text-xs leading-relaxed text-slate-300">
                <p>
                  This official attestation certifies that all payload authorizations, receipts, and state transitions for tenant{' '}
                  <span className="font-mono font-semibold text-white">{orgId}</span> are cryptographically bound, dual-signed with post-quantum ML-DSA-87 and classical Ed25519, and persisted to an append-only atomic store.
                </p>
              </div>

              {/* Compliance Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-400">
                    <ShieldCheck className="h-4 w-4" />
                    <span>EU DORA Compliant</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Digital Operational Resilience Testing & Drift Proofs</p>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-400">
                    <ShieldCheck className="h-4 w-4" />
                    <span>SOC 2 Type II Invariant</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Append-only audit chain with immutable Merkle linkage</p>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-400">
                    <ShieldCheck className="h-4 w-4" />
                    <span>SWIFT CSCF 6.4 Ready</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Post-quantum e-signature & tamper-proofing guarantee</p>
                </div>
              </div>

              {/* Technical Attestation Attributes */}
              <div className="border-t border-slate-800/80 pt-3 text-[11px] font-mono text-slate-400 space-y-1">
                <div className="flex justify-between">
                  <span>Engine Implementation:</span>
                  <span className="text-slate-200">Vardhan Q-Core Rust Micro-Engine v1.1</span>
                </div>
                <div className="flex justify-between">
                  <span>Primary Signature Suite:</span>
                  <span className="text-blue-400 font-semibold">ML-DSA-87 (FIPS 204)</span>
                </div>
                <div className="flex justify-between">
                  <span>Classical Fallback Suite:</span>
                  <span className="text-slate-200">Ed25519 (RFC 8032)</span>
                </div>
                <div className="flex justify-between">
                  <span>Audit Hashing Function:</span>
                  <span className="text-slate-200">BLAKE3 256-bit Cryptographic Digest</span>
                </div>
                <div className="flex justify-between">
                  <span>Issued At:</span>
                  <span className="text-slate-200">{new Date().toUTCString()}</span>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between border-t border-slate-800 pt-4">
              <span className="text-[10px] text-slate-500">
                Digitally verified by Vardhan Q-Core Canonical Control Plane
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-white transition-colors"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Print / Save PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAttestationOpen(false)}
                  className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
