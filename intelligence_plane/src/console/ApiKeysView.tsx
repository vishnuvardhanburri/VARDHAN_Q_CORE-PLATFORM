import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Key,
  KeyRound,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  Terminal,
  Trash2,
  X
} from 'lucide-react';
import {
  API_BASE,
  listApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKeyItem,
  type CreateApiKeyResult,
} from '../services/qcore';
import { Empty, Panel, formatTime, statusColor } from './shared';

export default function ApiKeysView(): React.ReactElement {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Create Modal State
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [keyName, setKeyName] = useState<string>('');
  const [expiryDays, setExpiryDays] = useState<number>(30);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // One-time secret state
  const [newKeySecret, setNewKeySecret] = useState<CreateApiKeyResult | null>(null);
  const [copiedSecret, setCopiedSecret] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Revoke state
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchKeys = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listApiKeys();
      setKeys(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve API keys.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchKeys();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) {
      setCreateError('Please specify a descriptive name for the API key.');
      return;
    }

    setSubmitting(true);
    setCreateError(null);
    try {
      const result = await createApiKey(keyName.trim(), expiryDays > 0 ? expiryDays : undefined);
      setNewKeySecret(result);
      setIsCreateOpen(false);
      setKeyName('');
      void fetchKeys();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to generate API key.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!window.confirm('Are you sure you want to revoke this API key? Any active scripts or ingress agents using this key will be denied immediately.')) {
      return;
    }
    setRevokingId(id);
    try {
      await revokeApiKey(id);
      void fetchKeys();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to revoke API key.');
    } finally {
      setRevokingId(null);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const copySecret = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* ── Top Header & Actions ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <KeyRound className="h-5 w-5 text-blue-400" />
            <span>Developer & Ingress API Keys</span>
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Generate and manage BLAKE3 hashed credentials for CLI, automated pipelines, and ingress agents
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void fetchKeys()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0d121d] px-3 py-1.5 text-xs text-slate-300 hover:text-white transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>Create API Key</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3.5 text-xs text-rose-300">
          <span className="font-semibold">Notice:</span> {error}
        </div>
      )}

      {/* ── One-Time Secret Reveal Banner ───────────────────────────────────── */}
      {newKeySecret && (
        <div className="rounded-xl border border-blue-500/40 bg-blue-950/30 p-5 space-y-3 shadow-lg">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 text-blue-300 font-bold text-sm">
              <Key className="h-5 w-5 text-blue-400 shrink-0" />
              <span>Save Your API Secret — Shown Only Once</span>
            </div>
            <button
              type="button"
              onClick={() => setNewKeySecret(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="text-xs text-slate-300">
            For security reasons, your key secret is hashed with BLAKE3 in our database and will never be shown again.
            Copy it and store it securely in your secret manager.
          </p>

          <div className="flex items-center justify-between rounded-lg border border-blue-500/30 bg-black/80 px-3.5 py-2.5 font-mono text-xs text-blue-200">
            <span className="truncate pr-3 select-all">{newKeySecret.secret}</span>
            <button
              type="button"
              onClick={() => copySecret(newKeySecret.secret)}
              className="flex items-center gap-1.5 rounded bg-blue-600/30 px-2.5 py-1 text-[11px] font-semibold text-blue-300 hover:bg-blue-600/50 transition-colors shrink-0"
            >
              {copiedSecret ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              <span>{copiedSecret ? 'Copied!' : 'Copy Secret'}</span>
            </button>
          </div>
        </div>
      )}

      {/* ── API Keys Table ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] shadow-sm">
        <div className="border-b border-slate-800 p-5">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Key className="h-4 w-4 text-blue-400" />
            Active Credentials Roster
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Direct ingress tokens authenticated under authoritative RBAC profiles
          </p>
        </div>

        {loading && keys.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">Loading API keys…</div>
        ) : keys.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">
            No API keys created yet. Click "Create API Key" to provision ingress credentials.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#090d16] text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-4 py-3">Key Identifier</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Created By</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {keys.map((k) => {
                  const isExpired = k.expires_at ? Date.now() >= k.expires_at : false;
                  return (
                    <tr key={k.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-5 py-3.5 font-bold text-white">{k.name}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2 font-mono text-slate-200">
                          <span>{k.id}</span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(k.id, k.id)}
                            className="text-slate-500 hover:text-white"
                            title="Copy Key ID"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-slate-400 whitespace-nowrap">
                        {formatTime(k.created_at)}
                      </td>
                      <td className="px-4 py-3.5 text-slate-400 whitespace-nowrap">
                        {k.expires_at ? formatTime(k.expires_at) : 'Never'}
                      </td>
                      <td className="px-4 py-3.5 text-slate-300 font-semibold">{k.created_by}</td>
                      <td className="px-4 py-3.5">
                        {k.revoked ? (
                          <span className="rounded-full border border-rose-500/30 bg-rose-950/40 px-2.5 py-0.5 text-[10px] font-bold text-rose-300 uppercase">
                            Revoked
                          </span>
                        ) : isExpired ? (
                          <span className="rounded-full border border-slate-700 bg-slate-850 px-2.5 py-0.5 text-[10px] font-bold text-slate-400 uppercase">
                            Expired
                          </span>
                        ) : (
                          <span className="rounded-full border border-emerald-500/30 bg-emerald-950/40 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300 uppercase">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {!k.revoked && (
                          <button
                            type="button"
                            disabled={revokingId === k.id}
                            onClick={() => void handleRevoke(k.id)}
                            className="rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-rose-400 hover:border-rose-500/40 hover:bg-rose-950/30 transition-colors disabled:opacity-50"
                          >
                            {revokingId === k.id ? 'Revoking…' : 'Revoke'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Developer Integration Quickstart ─────────────────────────────────── */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-5 shadow-sm space-y-4">
        <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-blue-400" />
            <h3 className="text-sm font-bold text-white">Developer Integration Quickstart</h3>
          </div>
          <span className="text-[10px] font-mono text-slate-400">Bearer Token Header</span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-[#090d16] p-4 space-y-2">
            <p className="text-xs font-bold text-slate-200">cURL API Access</p>
            <pre className="rounded bg-black/60 p-3 font-mono text-[11px] text-slate-300 overflow-x-auto leading-relaxed">
{`curl -X GET "${API_BASE}/api/v1/organizations" \\
  -H "Authorization: Bearer vq_live_..." \\
  -H "Accept: application/json"`}
            </pre>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#090d16] p-4 space-y-2">
            <p className="text-xs font-bold text-slate-200">TypeScript SDK</p>
            <pre className="rounded bg-black/60 p-3 font-mono text-[11px] text-slate-300 overflow-x-auto leading-relaxed">
{`import { QCoreClient } from 'vardhan-qcore';

const client = new QCoreClient({
  baseUrl: '${API_BASE}',
  apiKey: 'vq_live_...'
});`}
            </pre>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#090d16] p-4 space-y-2">
            <p className="text-xs font-bold text-slate-200">Python Client</p>
            <pre className="rounded bg-black/60 p-3 font-mono text-[11px] text-slate-300 overflow-x-auto leading-relaxed">
{`from vardhan_qcore import VardhanQCore

client = VardhanQCore(
    base_url="${API_BASE}",
    api_key="vq_live_..."
)`}
            </pre>
          </div>
        </div>
      </div>

      {/* ── Create API Key Modal ─────────────────────────────────────────────── */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="rounded-xl border border-slate-800 bg-[#0c1019] w-full max-w-md shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-blue-400" />
                Generate New API Key
              </h3>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {createError && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-950/40 p-2.5 text-xs text-rose-300">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Key Description / Name
                </label>
                <input
                  type="text"
                  required
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="e.g. Production Ingress Agent, CI Pipeline"
                  className="w-full rounded-lg border border-slate-800 bg-[#090d16] px-3 py-2 text-xs text-white focus:border-blue-500/50 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Expiration Window
                </label>
                <select
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-800 bg-[#090d16] px-3 py-2 text-xs text-white focus:border-blue-500/50 focus:outline-none"
                >
                  <option value={30}>30 Days</option>
                  <option value={60}>60 Days</option>
                  <option value={90}>90 Days</option>
                  <option value={365}>1 Year (365 Days)</option>
                  <option value={0}>Never Expires</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {submitting ? 'Generating…' : 'Generate Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
