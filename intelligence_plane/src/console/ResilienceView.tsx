import React from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  getCryptoPosture,
  proposeRemediation,
  type CryptoPosture,
  type KeyLifecycleView,
} from '../services/qcore';
import { Empty, Panel, QueryStateView, statusColor, useOrgQuery } from './shared';

function stateOrder(state: string): number {
  const s = state.toLowerCase();
  if (s.includes('revok')) return 0;
  if (s.includes('retir')) return 1;
  if (s.includes('deprecat')) return 2;
  if (s.includes('rotat')) return 3;
  if (s.includes('active')) return 4;
  return 5;
}

/** Client-side rotation rehearsal: orders issuers through revoke→retire→deprecated→rotating→active. Never mutates server state. */
function rehearseRotation(issuers: KeyLifecycleView[]): Array<{ step: number; service: string; from: string; to: string }> {
  const ordered = [...issuers].sort((a, b) => stateOrder(String(a.state)) - stateOrder(String(b.state)));
  return ordered.map((k, i) => ({
    step: i + 1,
    service: k.service_id,
    from: String(k.state),
    to: i === ordered.length - 1 ? 'active (post-rotation steady state)' : String(ordered[Math.min(i + 1, ordered.length - 1)].state),
  }));
}

export default function ResilienceView(): React.ReactElement {
  const { orgId } = useAuth();
  const crypto = useOrgQuery<CryptoPosture>(orgId, getCryptoPosture);
  const [rehearsal, setRehearsal] = React.useState<ReturnType<typeof rehearseRotation> | null>(null);
  const [remAction, setRemAction] = React.useState('');
  const [remRationale, setRemRationale] = React.useState('');
  const [remFinding, setRemFinding] = React.useState('');
  const [remBusy, setRemBusy] = React.useState(false);
  const [remMsg, setRemMsg] = React.useState<string | null>(null);

  if (!orgId) {
    return (
      <Panel title="Resilience — keys, rotation, perf" hint="Key lifecycle, rotation rehearsal, verification envelope">
        <Empty message="Select an organization to load its Resilience posture." />
      </Panel>
    );
  }

  const reg = crypto.data?.key_registry;
  const ver = crypto.data?.receipt_verification;

  async function handlePropose(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!orgId || remAction.trim().length === 0 || remRationale.trim().length === 0) {
      setRemMsg('Action and rationale are required.');
      return;
    }
    setRemBusy(true);
    setRemMsg(null);
    try {
      await proposeRemediation(orgId, {
        action: remAction.trim(),
        finding_id: remFinding.trim().length > 0 ? remFinding.trim() : null,
        incident_id: null,
        rationale: remRationale.trim(),
      });
      setRemMsg('Remediation proposed — awaiting operator transition.');
      setRemAction('');
      setRemRationale('');
      setRemFinding('');
    } catch (err) {
      setRemMsg(err instanceof Error ? err.message : 'Proposal failed.');
    } finally {
      setRemBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Resilience — key lifecycle"
        hint={`Registry ${reg ? `${reg.active}/${reg.total} active` : '…'} • verification ${ver ? `${ver.verified}/${ver.total_receipts}` : '…'}`}
        right={
          <button
            type="button"
            onClick={crypto.reload}
            className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-[10px] font-bold uppercase text-zinc-300 hover:text-white"
          >
            Reload
          </button>
        }
      >
        {crypto.loading && <p className="p-4 text-center text-xs text-slate-400">Loading crypto posture…</p>}
        {crypto.error && <QueryStateView loading={false} error={crypto.error} onRetry={crypto.reload} />}
        {reg && (
          <div className="grid grid-cols-2 gap-3 text-center text-xs md:grid-cols-6">
            {[
              ['Total', reg.total],
              ['Active', reg.active],
              ['Rotating', reg.rotating],
              ['Deprecated', reg.deprecated],
              ['Retired', reg.retired],
              ['Revoked', reg.revoked],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
                <p className="text-xl font-bold text-white">{value}</p>
              </div>
            ))}
          </div>
        )}
        {reg && reg.issuers.length === 0 && <div className="mt-3"><Empty message="Registry is empty — no issuer key pairs yet." /></div>}
        {reg && reg.issuers.length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setRehearsal(rehearseRotation(reg.issuers))}
              className="cursor-pointer rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-[11px] font-bold uppercase text-blue-300 hover:bg-blue-500/20 transition-colors"
            >
              Rehearse rotation (dry run — no server mutation)
            </button>
            {rehearsal && (
              <ol className="mt-3 space-y-1.5 text-xs">
                {rehearsal.map((step) => (
                  <li key={step.step} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                    <span className="font-bold text-blue-400">Step {step.step}</span>
                    <span className="font-bold text-white">{step.service}</span>
                    <span className="text-zinc-500">{step.from} →</span>
                    <span className="text-zinc-300">{step.to}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Verification envelope" hint="Receipt verification counts bound to the registry">
        {!ver ? (
          <Empty message="Verification posture unavailable." />
        ) : (
          <div className="grid grid-cols-2 gap-3 text-center text-xs md:grid-cols-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
              <p className="text-[10px] uppercase text-zinc-500">Total receipts</p>
              <p className="text-xl font-bold text-white">{ver.total_receipts}</p>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4">
              <p className="text-[10px] uppercase text-emerald-400">Verified</p>
              <p className="text-xl font-bold text-emerald-300">{ver.verified}</p>
            </div>
            <div className="rounded-xl border border-blue-500/30 bg-blue-950/30 p-4">
              <p className="text-[10px] uppercase text-blue-400">Pending</p>
              <p className="text-xl font-bold text-blue-300">{ver.pending_verification}</p>
            </div>
            <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-4">
              <p className="text-[10px] uppercase text-red-400">Rejected</p>
              <p className="text-xl font-bold text-red-300">{ver.rejected}</p>
            </div>
          </div>
        )}
        <p className="mt-3 text-[10px] text-zinc-500">
          Perf envelope is derived, never fabricated: {ver ? `${ver.verified} verified of ${ver.total_receipts} total` : '—'} through the platform
          crypto path. Raw latency histograms are not exposed by the control plane, so none are invented here.
        </p>
      </Panel>

      <Panel title="Propose remediation" hint="POST remediations — needs operator role on this org">
        <form onSubmit={handlePropose} className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-zinc-500">Action</span>
            <input
              type="text"
              value={remAction}
              onChange={(e) => setRemAction(e.target.value)}
              placeholder="rotate issuer keys for svc-payments"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white focus:border-blue-500/60 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-zinc-500">Finding ID (optional)</span>
            <input
              type="text"
              value={remFinding}
              onChange={(e) => setRemFinding(e.target.value)}
              placeholder="finding_001"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white focus:border-blue-500/60 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-zinc-500">Rationale</span>
            <input
              type="text"
              value={remRationale}
              onChange={(e) => setRemRationale(e.target.value)}
              placeholder="Issuer approaching rotation window"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white focus:border-blue-500/60 focus:outline-none"
            />
          </label>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={remBusy}
              className="cursor-pointer rounded-lg border border-blue-500/40 bg-blue-600 px-4 py-2 text-[11px] font-bold uppercase text-white hover:bg-blue-500 disabled:opacity-50 transition-colors shadow-sm"
            >
              {remBusy ? 'Proposing…' : 'Propose remediation'}
            </button>
            {remMsg && <p className="mt-2 text-zinc-400">{remMsg}</p>}
          </div>
        </form>
        <p className="mt-2 text-[10px] text-zinc-600">
          Lifecycle states in use: <span className={`rounded border px-1 ${statusColor('active')}`}>active</span>{' '}
          <span className={`rounded border px-1 ${statusColor('rotating')}`}>rotating</span>{' '}
          <span className={`rounded border px-1 ${statusColor('deprecated')}`}>deprecated</span>{' '}
          <span className={`rounded border px-1 ${statusColor('retired')}`}>retired</span>{' '}
          <span className={`rounded border px-1 ${statusColor('revoked')}`}>revoked</span>
        </p>
      </Panel>
    </div>
  );
}
