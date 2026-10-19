import React from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  getAerKepQ,
  getSubscription,
  getUsage,
  listMembers,
  listSessions,
  platformHealth,
  type AerKepQStatus,
  type MemberList,
  type PlatformHealth,
  type SessionEntry,
  type Subscription,
  type Usage,
} from '../services/qcore';
import { Empty, Panel, QueryStateView, formatTime, statusColor, useOrgQuery } from './shared';

export default function ClusterView(): React.ReactElement {
  const { orgId } = useAuth();
  const [health, setHealth] = React.useState<PlatformHealth | null>(null);
  const [healthError, setHealthError] = React.useState<string | null>(null);
  const aer = useOrgQuery<AerKepQStatus>(orgId, getAerKepQ);
  const members = useOrgQuery<MemberList>(orgId, listMembers);
  const sub = useOrgQuery<{ subscription: Subscription }>(orgId, getSubscription);
  const usage = useOrgQuery<{ usage: Usage }>(orgId, getUsage);
  const [sessions, setSessions] = React.useState<SessionEntry[] | null>(null);
  const [sessionsError, setSessionsError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    platformHealth()
      .then((h) => {
        if (!cancelled) {
          setHealth(h);
          setHealthError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setHealth(null);
          setHealthError(err instanceof Error ? err.message : 'Plane unreachable.');
        }
      });
    listSessions()
      .then((items) => {
        if (!cancelled) {
          setSessions(items);
          setSessionsError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSessions(null);
          setSessionsError(err instanceof Error ? err.message : 'Sessions unavailable.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5">
      <Panel title="HA cluster — heartbeat & autopilot vocabulary" hint="Control-plane health, AER-KEP-Q epoch, org membership">
        {!health && !healthError && <p className="p-4 text-center text-xs text-slate-400">Probing control plane…</p>}
        {healthError && <div className="rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-xs text-red-300">Control plane unreachable: {healthError}</div>}
        {health && (
          <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
            {[
              ['Status', health.status],
              ['Mode', health.mode],
              ['Transport', health.transport],
              ['Auth', health.authentication],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
                <p className="mt-1 font-bold text-white">{value}</p>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] text-zinc-600">
          Raft internals (term, peers, sealed state) are not exposed by the public REST surface — this console reports only what the plane
          publishes: health, AER attachment, epoch, and exposure. No peer counts are invented.
        </p>
      </Panel>

      {!orgId ? (
        <Panel title="Epoch & membership" hint="AER-KEP-Q status">
          <Empty message="Select an organization to load epoch, members, subscription, and usage." />
        </Panel>
      ) : (
        <>
          <Panel
            title="AER-KEP-Q epoch"
            hint={`Organization ${orgId}`}
            right={
              <button
                type="button"
                onClick={aer.reload}
                className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-[10px] font-bold uppercase text-zinc-300 hover:text-white"
              >
                Reload
              </button>
            }
          >
            {aer.loading && <p className="p-4 text-center text-xs text-slate-400">Loading epoch…</p>}
            {aer.error && <QueryStateView loading={false} error={aer.error} onRetry={aer.reload} />}
            {aer.data && (
              <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500">Attachment</p>
                  <p className="mt-1 font-bold text-white">{aer.data.runtime_attachment}</p>
                  <p className={`mt-2 inline-block rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${statusColor(aer.data.status)}`}>
                    {aer.data.status}
                  </p>
                  {aer.data.cipher_suite && <p className="mt-2 text-zinc-400">Cipher suite: {aer.data.cipher_suite}</p>}
                  {aer.data.security_model && <p className="text-zinc-400">Security model: {aer.data.security_model}</p>}
                  {aer.data.note && <p className="mt-2 text-zinc-500">{aer.data.note}</p>}
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500">Epoch visibility</p>
                  <p className="mt-1 text-zinc-300">Domain: {aer.data.domain_id ?? '—'}</p>
                  <p className="text-zinc-300">Active epoch: {aer.data.active_epoch ?? '—'}</p>
                  <p className="text-zinc-300">Epoch status: {aer.data.epoch_status ?? '—'}</p>
                  <p className="text-zinc-300">Pending messages: {aer.data.pending_messages ?? '—'}</p>
                  {aer.data.exposure && (
                    <p className="mt-2">
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${statusColor(aer.data.exposure.status)}`}>
                        exposure: {aer.data.exposure.status}
                      </span>{' '}
                      <span className="text-zinc-500">quarantine: {aer.data.exposure.quarantine}</span>
                    </p>
                  )}
                </div>
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Panel title="Members & roles" hint="Server-side role profiles — never assigned in the browser">
              {members.loading && <p className="p-4 text-center text-xs text-slate-400">Loading members…</p>}
              {members.error && <QueryStateView loading={false} error={members.error} onRetry={members.reload} />}
              {members.data && members.data.members.length === 0 && <Empty message="No members recorded for this organization." />}
              {members.data && members.data.members.length > 0 && (
                <ul className="space-y-1.5 text-xs">
                  {members.data.members.map((m) => (
                    <li key={m.username} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                      <span className="font-bold text-white">{m.username}</span>
                      <span className="rounded border border-slate-800 bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-300">{m.role}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Subscription & usage" hint="Billing-plane state for this tenant">
              {sub.error && <QueryStateView loading={false} error={sub.error} onRetry={sub.reload} />}
              {usage.error && <QueryStateView loading={false} error={usage.error} onRetry={usage.reload} />}
              {sub.data && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 text-xs">
                  <p className="font-bold text-white">Plan {sub.data.subscription.plan_id}</p>
                  <p className="mt-1 text-zinc-400">
                    Status <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusColor(sub.data.subscription.status)}`}>{sub.data.subscription.status}</span>{' '}
                    via {sub.data.subscription.provider}
                  </p>
                </div>
              )}
              {usage.data && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                    <p className="text-[10px] uppercase text-zinc-500">Transactions</p>
                    <p className="text-lg font-bold text-white">{usage.data.usage.transactions}</p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                    <p className="text-[10px] uppercase text-zinc-500">Bytes processed</p>
                    <p className="text-lg font-bold text-white">{usage.data.usage.bytes_processed}</p>
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <Panel title="Active sessions" hint="Admin visibility — sign-out revokes server-side">
            {sessions === null && !sessionsError && <p className="p-4 text-center text-xs text-slate-400">Loading sessions…</p>}
            {sessionsError && <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-xs text-zinc-400">Sessions unavailable: {sessionsError}</div>}
            {sessions && sessions.length === 0 && <Empty message="No active sessions reported." />}
            {sessions && sessions.length > 0 && (
              <ul className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                {sessions.map((s, i) => (
                  <li key={i} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                    <p className="font-bold text-white">{String(s.username ?? s.id ?? `session-${i}`)}</p>
                    <p className="mt-1 text-[10px] text-zinc-500">
                      issued {s.issued_at_ms ? formatTime(Number(s.issued_at_ms)) : '—'} • expires in {String(s.expires_in_secs ?? '—')}s
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
