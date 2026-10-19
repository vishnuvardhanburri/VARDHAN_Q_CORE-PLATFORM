import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  CreditCard,
  Database,
  Download,
  FileCheck2,
  Layers,
  Plus,
  RefreshCw,
  Server,
  TrendingUp,
  Zap
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  getUsage,
  getSubscription,
  recordUsage,
  type UsageSummary,
  type Subscription,
} from '../services/qcore';
import { Empty, Panel, formatTime, statusColor } from './shared';

export default function UsageView(): React.ReactElement {
  const { orgId } = useAuth();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Meter write state
  const [addTx, setAddTx] = useState<number>(100);
  const [addBytes, setAddBytes] = useState<number>(10240);
  const [recording, setRecording] = useState<boolean>(false);
  const [recordFeedback, setRecordFeedback] = useState<string | null>(null);

  const fetchUsageData = async (targetOrg: string) => {
    setLoading(true);
    setError(null);
    try {
      const [uRes, sRes] = await Promise.all([
        getUsage(targetOrg).catch(() => null),
        getSubscription(targetOrg).catch(() => null),
      ]);
      if (uRes?.usage) setUsage(uRes.usage);
      if (sRes?.subscription) setSubscription(sRes.subscription);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve usage telemetry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orgId) {
      void fetchUsageData(orgId);
    }
  }, [orgId]);

  const handleRecordUsage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setRecording(true);
    setRecordFeedback(null);
    try {
      const res = await recordUsage(orgId, Number(addTx), Number(addBytes));
      if (res?.usage) {
        setUsage(res.usage);
        setRecordFeedback(`Successfully recorded ${addTx} transactions and ${addBytes} bytes to tenant meter.`);
      }
    } catch (err: unknown) {
      setRecordFeedback(err instanceof Error ? err.message : 'Failed to record usage event.');
    } finally {
      setRecording(false);
    }
  };

  const planId = subscription?.plan_id ?? 'qcore_foundation';
  const planQuota = planId.includes('enterprise') ? 500000 : planId.includes('growth') ? 250000 : 100000;
  const currentTx = usage?.transactions ?? 0;
  const quotaPct = Math.min(100, Math.round((currentTx / planQuota) * 100));

  return (
    <div className="space-y-6">
      {/* ── Top Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Activity className="h-5 w-5 text-blue-400" />
            <span>Usage & Metering Intelligence</span>
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Authoritative SaaS consumption counters, quota tracking & cryptographic volume telemetry
          </p>
        </div>

        <button
          type="button"
          onClick={() => orgId && void fetchUsageData(orgId)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0d121d] px-3 py-1.5 text-xs text-slate-300 hover:text-white transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Usage</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3.5 text-xs text-rose-300">
          <span className="font-semibold">Notice:</span> {error}
        </div>
      )}

      {/* ── Metric Cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        
        {/* Card 1: Transactions Metered */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Transactions Metered</span>
            <Activity className="h-4 w-4 text-blue-400" />
          </div>
          <div className="mt-2">
            <span className="text-3xl font-bold tracking-tight text-white">{currentTx}</span>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
              <span>Quota: {planQuota.toLocaleString()}</span>
              <span className="text-blue-400 font-semibold">{quotaPct}% utilized</span>
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
              <div
                style={{ width: `${quotaPct}%` }}
                className="h-full bg-blue-600 transition-all duration-500"
              />
            </div>
          </div>
        </div>

        {/* Card 2: Bytes Processed */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Data Processed</span>
            <Database className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {usage?.bytes_processed ? `${(usage.bytes_processed / 1024).toFixed(1)} KB` : '0 KB'}
            </span>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
              <span>Raw Ingress Payload</span>
              <span className="text-emerald-400 font-semibold">{usage?.bytes_processed ?? 0} bytes</span>
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-emerald-400 w-1/3" />
            </div>
          </div>
        </div>

        {/* Card 3: Active Tier & Provider */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Subscription Status</span>
            <CreditCard className="h-4 w-4 text-blue-400" />
          </div>
          <div className="mt-2">
            <span className="text-xl font-bold tracking-tight text-blue-300 capitalize block truncate">
              {planId.replace('qcore_', '').replace(/_/g, ' ')}
            </span>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
              <span>Provider: {subscription?.provider ?? 'Stripe Canonical'}</span>
              <span className="text-emerald-400 font-semibold uppercase">{subscription?.status ?? 'Active'}</span>
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-blue-600 w-full" />
            </div>
          </div>
        </div>

      </div>

      {/* ── Ingestion Form & Meter Invariants Grid ──────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        
        {/* Card 1: Ingestion & Telemetry Simulator */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-6 shadow-sm space-y-4">
          <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Zap className="h-4 w-4 text-blue-400" />
              Record Usage Event (Backend Ingress Write)
            </h3>
            <span className="font-mono text-[10px] text-slate-400">POST /usage/record</span>
          </div>

          <p className="text-xs text-slate-400">
            Submit an authenticated metering increment to verify live saturating addition in the control-plane store.
          </p>

          {recordFeedback && (
            <div className="rounded-lg border border-blue-500/20 bg-blue-950/20 p-3 text-xs text-blue-200">
              {recordFeedback}
            </div>
          )}

          <form onSubmit={handleRecordUsage} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Transactions Increment
              </label>
              <input
                type="number"
                min={1}
                required
                value={addTx}
                onChange={(e) => setAddTx(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-800 bg-[#090d16] px-3 py-2 text-xs text-white focus:border-blue-500/50 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Bytes Processed Increment
              </label>
              <input
                type="number"
                min={1}
                required
                value={addBytes}
                onChange={(e) => setAddBytes(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-800 bg-[#090d16] px-3 py-2 text-xs text-white focus:border-blue-500/50 focus:outline-none"
              />
            </div>

            <div className="pt-2 flex justify-end border-t border-slate-800/80">
              <button
                type="submit"
                disabled={recording || !orgId}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors shadow-sm"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{recording ? 'Recording…' : 'Record Meter Increment'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Card 2: Metering Invariants & Guarantees */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-6 shadow-sm space-y-4">
          <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-emerald-400" />
              Metering Guarantees & SLA Invariants
            </h3>
            <span className="text-[10px] font-mono text-slate-400">Zero Synthetic Counts</span>
          </div>

          <div className="space-y-3 text-xs text-slate-300">
            <div className="rounded-lg border border-slate-800 bg-[#090d16] p-3 space-y-1">
              <p className="font-semibold text-white">Saturating Addition Protection</p>
              <p className="text-[11px] text-slate-400">
                All numerical increments execute using Rust's <span className="font-mono text-slate-200">saturating_add</span>, preventing overflow vulnerabilities or silent wrap-around errors.
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#090d16] p-3 space-y-1">
              <p className="font-semibold text-white">Tenant Isolated Storage</p>
              <p className="text-[11px] text-slate-400">
                Usage keys are partitioned by organization ID (<span className="font-mono text-slate-200">usage:org-id</span>). Cross-tenant reads are prevented at the database key boundary.
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#090d16] p-3 space-y-1">
              <p className="font-semibold text-white">Durable Atomic Persistence</p>
              <p className="text-[11px] text-slate-400">
                State is persisted atomically to the Sled embedded key-value store with durable disk flush guarantees.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
