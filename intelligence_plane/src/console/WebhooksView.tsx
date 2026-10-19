import React, { useState, useEffect, useCallback } from 'react';
import {
  Webhook,
  Plus,
  Send,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  ShieldCheck,
  Code,
  Terminal,
  Activity,
  X
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  listWebhooks,
  createWebhook,
  deleteWebhook,
  testWebhook,
  listWebhookDeliveries,
  type WebhookEndpoint,
  type WebhookDeliveryLog,
} from '../services/qcore';

const AVAILABLE_EVENTS = [
  { id: 'transaction.sealed', label: 'transaction.sealed', desc: 'Triggered when a transaction is dual-signed with ML-DSA-87 & Ed25519' },
  { id: 'receipt.verified', label: 'receipt.verified', desc: 'Triggered on deterministic receipt verification against canonical engine' },
  { id: 'policy.intercepted', label: 'policy.intercepted', desc: 'Triggered on pre-execution policy denial or tenant violation' },
  { id: 'alert.drift', label: 'alert.drift', desc: 'Triggered when signature drift or key rotation anomalies are detected' },
  { id: 'quota.threshold', label: 'quota.threshold', desc: 'Triggered when monthly transaction consumption reaches 80% or 100%' },
];

export function WebhooksView(): React.ReactElement {
  const { orgId } = useAuth();

  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [logs, setLogs] = useState<WebhookDeliveryLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([
    'transaction.sealed',
    'policy.intercepted',
  ]);
  const [copiedSecretId, setCopiedSecretId] = useState<string | null>(null);
  const [pingStatus, setPingStatus] = useState<{ id: string; message: string; ok: boolean } | null>(null);
  const [pingingId, setPingingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [whRes, delRes] = await Promise.all([
        listWebhooks(orgId).catch(() => ({ organization_id: orgId, webhooks: [] })),
        listWebhookDeliveries(orgId).catch(() => ({ organization_id: orgId, deliveries: [] })),
      ]);
      setWebhooks(whRes.webhooks);
      setLogs(delRes.deliveries);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load webhooks.');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !orgId) return;
    setCreating(true);
    setError(null);
    try {
      await createWebhook(orgId, {
        url: url.trim(),
        description: description.trim() || 'Custom Outbound Notification Hook',
        events: selectedEvents.length > 0 ? selectedEvents : ['transaction.sealed'],
      });
      setUrl('');
      setDescription('');
      setIsCreateOpen(false);
      void loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create webhook.');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    if (!orgId) return;
    try {
      await deleteWebhook(orgId, id);
      void loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete webhook.');
    }
  };

  const handleToggleStatus = (id: string) => {
    // Client-side visual toggle; state persists with backend events
    setWebhooks((prev) =>
      prev.map((w) => (w.id === id ? { ...w, status: w.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' } : w))
    );
  };

  const handlePing = async (endpoint: WebhookEndpoint) => {
    if (!orgId) return;
    setPingingId(endpoint.id);
    setPingStatus(null);

    try {
      const res = await testWebhook(orgId, endpoint.id);
      setPingStatus({
        id: endpoint.id,
        message: res.success
          ? `HTTP ${res.status_code} OK — Delivered signed test payload in ${res.latency_ms}ms`
          : `HTTP ${res.status_code} — Delivery failed: ${res.error || 'Connection failed'} (${res.latency_ms}ms)`,
        ok: res.success,
      });
      void loadData();
    } catch (err: unknown) {
      setPingStatus({
        id: endpoint.id,
        message: err instanceof Error ? err.message : 'Diagnostic test delivery failed.',
        ok: false,
      });
    } finally {
      setPingingId(null);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSecretId(id);
    setTimeout(() => setCopiedSecretId(null), 2000);
  };

  const toggleEventSelect = (eventId: string) => {
    if (selectedEvents.includes(eventId)) {
      setSelectedEvents(selectedEvents.filter((e) => e !== eventId));
    } else {
      setSelectedEvents([...selectedEvents, eventId]);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Top Header & Actions ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Webhook className="h-5 w-5 text-blue-400" />
            <span>Outbound Webhooks & SIEM Dispatch</span>
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Real-time, HMAC-signed event notifications delivered directly to your SecOps, Datadog, or Slack pipelines
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          <span>Add Webhook Endpoint</span>
        </button>
      </div>

      {pingStatus && (
        <div
          className={`rounded-xl p-3.5 text-xs flex items-center justify-between ${
            pingStatus.ok
              ? 'border border-emerald-500/30 bg-emerald-950/20 text-emerald-300'
              : 'border border-rose-500/30 bg-rose-950/20 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{pingStatus.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setPingStatus(null)}
            className="text-slate-400 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Active Endpoints Table ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] shadow-sm">
        <div className="border-b border-slate-800 p-5 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-400" />
              Configured Notification Endpoints
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Every payload includes cryptographic header <span className="font-mono text-slate-200">X-Vardhan-Signature</span>
            </p>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            {webhooks.length} Active Target(s)
          </span>
        </div>

        {webhooks.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">
            No webhook endpoints registered. Click "Add Webhook Endpoint" to stream cryptographic events.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#090d16] text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-5 py-3">Destination URL & Description</th>
                  <th className="px-4 py-3">Subscribed Topics</th>
                  <th className="px-4 py-3">Signing Secret</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Success Rate</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {webhooks.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="font-mono text-slate-200 font-semibold truncate max-w-sm">{w.url}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{w.description}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {w.events.map((evt) => (
                          <span
                            key={evt}
                            className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-300"
                          >
                            {evt}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2 font-mono text-[11px] text-slate-300">
                        <span>{w.secret.slice(0, 10)}…</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(w.secret, w.id)}
                          className="text-slate-500 hover:text-white"
                          title="Copy Full Secret"
                        >
                          {copiedSecretId === w.id ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(w.id)}
                        className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase transition-colors ${
                          w.status === 'ACTIVE'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                        }`}
                      >
                        {w.status}
                      </button>
                    </td>
                    <td className="px-4 py-3.5 text-slate-300">
                      <span className="font-semibold text-emerald-400">{w.success_rate}%</span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={pingingId === w.id}
                          onClick={() => handlePing(w)}
                          className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
                        >
                          <Send className={`h-3 w-3 ${pingingId === w.id ? 'animate-pulse' : ''}`} />
                          <span>{pingingId === w.id ? 'Dispatching…' : 'Test Ping'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteWebhook(w.id)}
                          className="rounded-md p-1 text-slate-400 hover:bg-rose-950/40 hover:text-rose-300 transition-colors"
                          title="Delete Webhook"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Dual Column: Delivery Ledger & Verification Spec ──────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: Recent Delivery Ledger */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-5 shadow-sm space-y-4">
          <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              Delivery Audit Trail
            </h3>
            <span className="text-[10px] font-mono text-slate-400">Latest 10 Deliveries</span>
          </div>

          <div className="space-y-2">
            {logs.slice(0, 5).map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#090d16] p-3 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2 font-mono">
                    <span className="font-semibold text-white">{l.event}</span>
                    <span className="rounded bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 text-[9px] font-bold">
                      HTTP {l.status_code}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">{l.payload_summary}</p>
                </div>
                <div className="text-right text-[10px] text-slate-400 font-mono">
                  <span>{l.latency_ms}ms</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Signature Verification Guide */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-5 shadow-sm space-y-4">
          <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Terminal className="h-4 w-4 text-blue-400" />
              Payload Verification Specification
            </h3>
            <span className="text-[10px] font-mono text-slate-400">HMAC-SHA256</span>
          </div>

          <p className="text-xs text-slate-400">
            Verify each request header <span className="font-mono text-slate-200">X-Vardhan-Signature</span> to defend against replay attacks:
          </p>

          <pre className="rounded-lg bg-black/80 p-3.5 font-mono text-[11px] text-slate-300 overflow-x-auto leading-relaxed border border-slate-800">
{`// Node.js Verification
const crypto = require('crypto');

function verifyWebhook(payload, signatureHeader, secret) {
  const [tPart, v1Part] = signatureHeader.split(',');
  const timestamp = tPart.split('=')[1];
  const signature = v1Part.split('=')[1];

  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(\`\${timestamp}.\${payload}\`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}`}
          </pre>
        </div>
      </div>

      {/* ── Create Webhook Modal ─────────────────────────────────────────────── */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="rounded-xl border border-slate-800 bg-[#0c1019] w-full max-w-lg shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Webhook className="h-4 w-4 text-blue-400" />
                Configure Outbound Webhook
              </h3>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateWebhook} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Endpoint URL (HTTPS Required)
                </label>
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://events.yourdomain.com/vardhan/webhook"
                  className="w-full rounded-lg border border-slate-800 bg-[#090d16] px-3 py-2 text-xs text-white focus:border-blue-500/50 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Description / Purpose
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Datadog Security SIEM Ingestion"
                  className="w-full rounded-lg border border-slate-800 bg-[#090d16] px-3 py-2 text-xs text-white focus:border-blue-500/50 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Subscribed Event Topics
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {AVAILABLE_EVENTS.map((evt) => {
                    const isSelected = selectedEvents.includes(evt.id);
                    return (
                      <div
                        key={evt.id}
                        onClick={() => toggleEventSelect(evt.id)}
                        className={`flex items-start gap-3 rounded-lg border p-2.5 cursor-pointer transition-colors ${
                          isSelected
                            ? 'border-blue-500/40 bg-blue-950/20'
                            : 'border-slate-800 bg-[#090d16] hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="mt-0.5 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                        <div>
                          <p className="font-mono text-xs font-semibold text-white">{evt.label}</p>
                          <p className="text-[10px] text-slate-400">{evt.desc}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm"
                >
                  Register Webhook
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
