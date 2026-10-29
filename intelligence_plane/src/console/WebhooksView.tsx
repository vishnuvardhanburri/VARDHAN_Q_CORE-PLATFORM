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
  X,
  Mail,
  Bell
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  listWebhooks,
  createWebhook,
  deleteWebhook,
  testWebhook,
  listWebhookDeliveries,
  getEmailNotificationConfig,
  updateEmailNotificationConfig,
  sendTestEmailNotification,
  type WebhookEndpoint,
  type WebhookDeliveryLog,
  type OrganizationEmailConfig,
  type EmailNotificationLog,
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

  const [activeTab, setActiveTab] = useState<'webhooks' | 'email'>('webhooks');
  const [emailConfig, setEmailConfig] = useState<OrganizationEmailConfig | null>(null);
  const [emailLogs, setEmailLogs] = useState<EmailNotificationLog[]>([]);
  const [emailRecipients, setEmailRecipients] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [testEmailSending, setTestEmailSending] = useState(false);

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
      const [whRes, delRes, emailRes] = await Promise.all([
        listWebhooks(orgId).catch(() => ({ organization_id: orgId, webhooks: [] })),
        listWebhookDeliveries(orgId).catch(() => ({ organization_id: orgId, deliveries: [] })),
        getEmailNotificationConfig(orgId).catch(() => null),
      ]);
      setWebhooks(whRes.webhooks);
      setLogs(delRes.deliveries);
      if (emailRes) {
        setEmailConfig(emailRes.config);
        setEmailLogs(emailRes.recent_dispatches);
        setEmailRecipients(emailRes.config.recipients.join(', '));
      }
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

  const handleSaveEmailConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setSavingEmail(true);
    setEmailNotice(null);
    try {
      const recipients = emailRecipients
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const res = await updateEmailNotificationConfig(orgId, {
        recipients,
        enabled: emailConfig?.enabled ?? true,
        notify_on_critical_finding: emailConfig?.notify_on_critical_finding ?? true,
        notify_on_replay_attack: emailConfig?.notify_on_replay_attack ?? true,
        notify_on_tamper: emailConfig?.notify_on_tamper ?? true,
      });
      setEmailConfig(res.config);
      setEmailNotice('Email notification preferences saved successfully.');
    } catch (err: unknown) {
      setEmailNotice(err instanceof Error ? err.message : 'Failed to save email settings.');
    } finally {
      setSavingEmail(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!orgId) return;
    setTestEmailSending(true);
    setEmailNotice(null);
    try {
      const res = await sendTestEmailNotification(orgId);
      setEmailNotice(`Test security notification dispatched to ${res.recipient} (Proof: ${res.proof_blake3.slice(0, 16)}…)`);
      void loadData();
    } catch (err: unknown) {
      setEmailNotice(err instanceof Error ? err.message : 'Failed to send test email.');
    } finally {
      setTestEmailSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Top Header & Actions ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2.5">
            {activeTab === 'webhooks' ? (
              <>
                <Webhook className="h-5 w-5 text-blue-400" />
                <span>Outbound Webhooks & SIEM Dispatch</span>
              </>
            ) : (
              <>
                <Mail className="h-5 w-5 text-blue-400" />
                <span>Organization Email Notifications & Alerting</span>
              </>
            )}
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {activeTab === 'webhooks'
              ? 'Real-time, HMAC-signed event notifications delivered directly to your SecOps, Datadog, or Slack pipelines'
              : 'Automated post-quantum verification notifications and cryptographic replay alerts routed to your security team'}
          </p>
        </div>

        {activeTab === 'webhooks' ? (
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Add Webhook Endpoint</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSendTestEmail}
            disabled={testEmailSending}
            className="flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-950/40 px-3.5 py-1.5 text-xs font-semibold text-blue-300 hover:bg-blue-900/50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            <span>{testEmailSending ? 'Dispatching…' : 'Send Test Notification'}</span>
          </button>
        )}
      </div>

      {/* ── Channel Selector Tabs ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-slate-800">
        <button
          type="button"
          onClick={() => setActiveTab('webhooks')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
            activeTab === 'webhooks'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Webhook className="h-3.5 w-3.5 text-blue-400" />
          <span>Outbound Webhooks ({webhooks.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('email')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
            activeTab === 'email'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Mail className="h-3.5 w-3.5 text-blue-400" />
          <span>Organization Email Alerts ({emailConfig?.recipients.length || 0})</span>
        </button>
      </div>

      {emailNotice && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-3.5 text-xs text-blue-300 flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4 text-blue-400 shrink-0" />
            <span>{emailNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setEmailNotice(null)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {activeTab === 'email' ? (
        /* ── Email Notifications & Alerting Management ────────────────────── */
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-6 shadow-sm">
            <div className="border-b border-slate-800 pb-4 mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Mail className="h-4 w-4 text-blue-400" />
                  Organization Security Email Notifications
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Automated dispatch of verified post-quantum transaction receipts, tamper alerts, and blocked replay attempts
                </p>
              </div>
              <span className="rounded bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-mono text-emerald-400 font-bold uppercase">
                {emailConfig?.enabled ? 'Active Alerts' : 'Disabled'}
              </span>
            </div>

            <form onSubmit={handleSaveEmailConfig} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Notification Recipients (Comma separated)
                </label>
                <input
                  type="text"
                  value={emailRecipients}
                  onChange={(e) => setEmailRecipients(e.target.value)}
                  placeholder="e.g. security-team@acmebank.com, ciso@acmebank.com, compliance@acmebank.com"
                  className="w-full rounded-lg border border-slate-800 bg-[#070a10] px-3.5 py-2.5 text-xs font-mono text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  All recipients will receive signed notifications with verifiable BLAKE3 integrity proofs.
                </p>
              </div>

              <div className="space-y-3 pt-2">
                <p className="text-xs font-semibold text-slate-300">Subscribed Event Categories</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className="flex items-start gap-2.5 rounded-lg border border-slate-800/80 bg-[#090d16] p-3 text-xs cursor-pointer hover:border-slate-700">
                    <input
                      type="checkbox"
                      checked={emailConfig?.notify_on_critical_finding ?? true}
                      onChange={(e) =>
                        setEmailConfig(
                          emailConfig
                            ? { ...emailConfig, notify_on_critical_finding: e.target.checked }
                            : null
                        )
                      }
                      className="mt-0.5 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-0"
                    />
                    <div>
                      <span className="font-semibold text-white block text-[11px]">Post-Quantum Seals</span>
                      <span className="text-[10px] text-slate-400">ML-DSA-87 + Ed25519 dual-signed transactions</span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 rounded-lg border border-slate-800/80 bg-[#090d16] p-3 text-xs cursor-pointer hover:border-slate-700">
                    <input
                      type="checkbox"
                      checked={emailConfig?.notify_on_replay_attack ?? true}
                      onChange={(e) =>
                        setEmailConfig(
                          emailConfig
                            ? { ...emailConfig, notify_on_replay_attack: e.target.checked }
                            : null
                        )
                      }
                      className="mt-0.5 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-0"
                    />
                    <div>
                      <span className="font-semibold text-white block text-[11px]">Replay Attacks Blocked</span>
                      <span className="text-[10px] text-slate-400">Sub-millisecond idempotency lease violations</span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 rounded-lg border border-slate-800/80 bg-[#090d16] p-3 text-xs cursor-pointer hover:border-slate-700">
                    <input
                      type="checkbox"
                      checked={emailConfig?.notify_on_tamper ?? true}
                      onChange={(e) =>
                        setEmailConfig(
                          emailConfig
                            ? { ...emailConfig, notify_on_tamper: e.target.checked }
                            : null
                        )
                      }
                      className="mt-0.5 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-0"
                    />
                    <div>
                      <span className="font-semibold text-white block text-[11px]">Signature Tamper Detected</span>
                      <span className="text-[10px] text-slate-400">Invalid lattice equations or actor mismatches</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                <span className="text-[11px] font-mono text-slate-400">
                  Relay Mode: {emailConfig?.relay_mode ?? 'simulated_relay'}
                </span>
                <button
                  type="submit"
                  disabled={savingEmail}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {savingEmail ? 'Saving Preferences…' : 'Save Notification Preferences'}
                </button>
              </div>
            </form>
          </div>

          {/* ── Email Notification History Table ── */}
          <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] shadow-sm">
            <div className="border-b border-slate-800 p-5 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Activity className="h-4 w-4 text-blue-400" />
                  Recent Email Security Dispatches
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Cryptographically audited email dispatch ledger with BLAKE3 non-repudiation proofs
                </p>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {emailLogs.length} Dispatched Alerts
              </span>
            </div>

            {emailLogs.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-400">
                No email notifications dispatched yet for this tenant. Click "Send Test Notification" above to verify routing.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 bg-[#090d16] text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-5 py-3">Event Type</th>
                      <th className="px-4 py-3">Recipient(s)</th>
                      <th className="px-4 py-3">Subject & Snippet</th>
                      <th className="px-4 py-3">Proof Hash (BLAKE3)</th>
                      <th className="px-4 py-3 text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                    {emailLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-800/20">
                        <td className="px-5 py-3 font-semibold text-blue-400">
                          {log.event_type}
                        </td>
                        <td className="px-4 py-3 text-slate-300">
                          {log.recipients.join(', ')}
                        </td>
                        <td className="px-4 py-3 text-slate-200">
                          <p className="font-semibold text-white">{log.subject}</p>
                          <p className="text-[10px] text-slate-400 font-sans truncate max-w-sm">{log.body_snippet}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-400 font-mono text-[10px]">
                          {log.proof_hash.slice(0, 16)}…
                        </td>
                        <td className="px-4 py-3 text-right text-slate-400">
                          {new Date(log.timestamp_ms).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Webhooks Channel View ─────────────────────────────────────────── */
        <>

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
      </>
      )}

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
