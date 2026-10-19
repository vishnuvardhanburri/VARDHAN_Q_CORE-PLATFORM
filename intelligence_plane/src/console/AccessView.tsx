import React, { useEffect, useState } from 'react';
import { Users, UserPlus, Shield, Trash2, Mail, RefreshCw, CheckCircle2, UserCheck, KeyRound } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  listMembers,
  setMemberRole,
  listInvitations,
  createInvitation,
  revokeInvitation,
  type MemberRecord,
  type InvitationRecord,
} from '../services/qcore';
import { Empty, Panel, QueryStateView, formatTime, statusColor } from './shared';

export default function AccessView(): React.ReactElement {
  const { orgId, user } = useAuth();
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [invitations, setInvitations] = useState<InvitationRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Invite state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('operator');
  const [submittingInvite, setSubmittingInvite] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);

  const fetchData = async (targetOrg: string) => {
    setLoading(true);
    setError(null);
    try {
      const [mRes, iRes] = await Promise.all([
        listMembers(targetOrg).catch(() => ({ organization_id: targetOrg, members: [] })),
        listInvitations(targetOrg).catch(() => ({ organization_id: targetOrg, invitations: [] })),
      ]);
      setMembers(mRes.members);
      setInvitations(iRes.invitations);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve access records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orgId) {
      void fetchData(orgId);
    }
  }, [orgId]);

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !inviteEmail.trim()) return;
    setSubmittingInvite(true);
    setInviteFeedback(null);
    try {
      await createInvitation(orgId, inviteEmail.trim(), inviteRole);
      setInviteFeedback(`Invitation successfully dispatched to ${inviteEmail}.`);
      setInviteEmail('');
      void fetchData(orgId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create invitation.');
    } finally {
      setSubmittingInvite(false);
    }
  };

  const handleRevokeInvite = async (invitationId: string) => {
    if (!orgId) return;
    try {
      await revokeInvitation(orgId, invitationId);
      void fetchData(orgId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke invitation.');
    }
  };

  const handleRoleChange = async (username: string, newRole: string) => {
    if (!orgId) return;
    try {
      await setMemberRole(orgId, username, newRole);
      void fetchData(orgId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update member role.');
    }
  };

  if (!orgId) {
    return (
      <Panel title="Members & Access Management" hint="Organization membership, roles, and invitation administration">
        <Empty message="Select an organization in the header to manage members and permissions." />
      </Panel>
    );
  }

  return (
    <div className="space-y-7">
      <Panel
        title="Active Organization Members"
        hint={`Organization ${orgId} • Cryptographic role-based access control (RBAC)`}
        right={
          <button
            type="button"
            onClick={() => void fetchData(orgId)}
            className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/[0.08] bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300 hover:text-white transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        }
      >
        <QueryStateView loading={loading} error={error} onRetry={() => void fetchData(orgId)} />

        {members.length === 0 && !loading ? (
          <Empty message="No explicit members listed in this organization." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] text-slate-400 font-semibold uppercase text-[11px]">
                  <th className="pb-3.5 pl-2">User Identity</th>
                  <th className="pb-3.5">Assigned Role</th>
                  <th className="pb-3.5">Joined Timestamp</th>
                  <th className="pb-3.5 text-right pr-2">Access Mutation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {members.map((m) => (
                  <tr key={m.username} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 pl-2 font-medium text-white flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                        <Shield className="h-3.5 w-3.5" />
                      </div>
                      <span className="font-semibold">{m.username}</span>
                      {m.username === user?.username && (
                        <span className="rounded-full bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-[10px] font-semibold text-blue-400">
                          Active Session
                        </span>
                      )}
                    </td>
                    <td className="py-3.5">
                      <span className={`rounded-full border px-2.5 py-0.5 uppercase font-bold text-[10px] ${statusColor(m.role)}`}>
                        {m.role}
                      </span>
                    </td>
                    <td className="py-3.5 text-slate-400 font-mono text-[11px]">{formatTime(m.joined_at_ms)}</td>
                    <td className="py-3.5 text-right pr-2">
                      <select
                        value={m.role}
                        onChange={(e) => void handleRoleChange(m.username, e.target.value)}
                        className="cursor-pointer rounded-xl border border-white/[0.08] bg-slate-900/80 px-2.5 py-1 text-xs text-slate-200 font-medium hover:border-slate-700 transition-colors focus:outline-none"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="operator">Operator</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Invitations Section */}
      <Panel title="Issue Team Invitation" hint="Generate time-bounded, cryptographically signed invitations">
        {inviteFeedback && (
          <div className="mb-5 flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3.5 text-xs text-emerald-300 backdrop-blur-md">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {inviteFeedback}
          </div>
        )}
        <form onSubmit={handleCreateInvite} className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[260px]">
            <input
              type="email"
              required
              placeholder="colleague@enterprise.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-full rounded-xl border border-white/[0.08] bg-slate-900/80 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-blue-500/50 focus:outline-none transition-colors"
            />
          </div>
          <div>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="rounded-xl border border-white/[0.08] bg-slate-900/80 px-3 py-2.5 text-xs font-semibold text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="operator">Operator (Standard Execution)</option>
              <option value="viewer">Viewer (Read-Only Audit)</option>
              <option value="admin">Administrator (Full Control)</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={submittingInvite || !inviteEmail.trim()}
            className="flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-500 shadow-sm disabled:cursor-not-allowed disabled:opacity-50 transition-all"
          >
            <UserPlus className="h-3.5 w-3.5" />
            {submittingInvite ? 'Dispatching…' : 'Dispatch Invite'}
          </button>
        </form>

        {invitations.length > 0 && (
          <div className="mt-7 border-t border-white/[0.06] pt-5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3.5">
              Pending Dispatched Invitations
            </h4>
            <div className="space-y-2.5">
              {invitations.map((inv) => (
                <div key={inv.id} className="bento-card flex items-center justify-between p-3.5 text-xs">
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-400">
                      <Mail className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <span className="font-semibold text-white">{inv.email}</span>
                      <span className="ml-2 text-slate-400">({inv.role})</span>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[9px] uppercase font-bold ${statusColor(inv.status)}`}>
                      {inv.status}
                    </span>
                  </div>
                  {inv.status === 'PENDING' && (
                    <button
                      type="button"
                      onClick={() => void handleRevokeInvite(inv.id)}
                      className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-rose-400 hover:text-rose-300 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" /> Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
