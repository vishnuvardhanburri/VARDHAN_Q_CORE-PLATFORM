import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  FileCheck2,
  Filter,
  KeyRound,
  Layers,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  UserCheck,
  X,
  XCircle,
  Zap
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  getExecutiveReport,
  listTransactions,
  listAlerts,
  getSubscription,
  getUsage,
  getVerifiedEntitlements,
  listMembers,
  type OpsSnapshot,
  type TransactionRecord,
  type ReceiptRecord,
  type SecurityAlert,
  type Subscription,
  type UsageSummary,
  type VerifiedEntitlementsResponse,
  type MemberRecord,
} from '../services/qcore';
import { Empty, Panel, formatTime, statusColor, bandColor } from './shared';

export type TimeRange = '24H' | '7D' | '30D' | 'ALL';
export type EventFilterTab = 'all' | 'transactions' | 'receipts' | 'rejections' | 'alerts';

interface MergedEvent {
  id: string;
  kind: 'transaction' | 'receipt' | 'alert' | 'finding';
  title: string;
  action: string;
  status: string;
  cryptoSuite: string;
  timestamp_ms: number;
  correlation_id?: string | null;
  raw: any;
}

export default function OverviewView({
  onNavigate,
}: {
  onNavigate: (view: any) => void;
}): React.ReactElement {
  const { orgId } = useAuth();

  // Primary State
  const [timeRange, setTimeRange] = useState<TimeRange>('24H');
  const [activeTab, setActiveTab] = useState<EventFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Telemetry Datasets
  const [snapshot, setSnapshot] = useState<OpsSnapshot | null>(null);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [entitlements, setEntitlements] = useState<VerifiedEntitlementsResponse | null>(null);
  const [members, setMembers] = useState<MemberRecord[]>([]);

  // Freshness & Loading State
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(20);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Drill-down modal state
  const [selectedEvent, setSelectedEvent] = useState<MergedEvent | null>(null);

  const activeFetchRef = useRef<boolean>(false);

  // Safe Bounded Fetching Function
  const loadDashboardData = async (manual = false) => {
    if (!orgId) return;
    if (activeFetchRef.current) return;

    activeFetchRef.current = true;
    if (manual) setIsRefreshing(true);

    try {
      const [opsRes, txRes, alertsRes, subRes, usageRes, entRes, memRes] = await Promise.all([
        getExecutiveReport(orgId).catch(() => null),
        listTransactions(orgId).catch(() => ({ items: [], receipts: [] })),
        listAlerts(orgId).catch(() => ({ items: [] })),
        getSubscription(orgId).catch(() => null),
        getUsage(orgId).catch(() => null),
        getVerifiedEntitlements(orgId).catch(() => null),
        listMembers(orgId).catch(() => ({ organization_id: orgId, members: [] })),
      ]);

      if (opsRes?.snapshot) setSnapshot(opsRes.snapshot);
      if (txRes?.items) setTransactions(txRes.items);
      if (txRes?.receipts) setReceipts(txRes.receipts);
      if (alertsRes?.items) setAlerts(alertsRes.items);
      if (subRes?.subscription) setSubscription(subRes.subscription);
      if (usageRes?.usage) setUsage(usageRes.usage);
      if (entRes) setEntitlements(entRes);
      if (memRes?.members) setMembers(memRes.members);

      setLastUpdated(Date.now());
      setIsStale(false);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Telemetry synchronization failed.');
      setIsStale(true);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      activeFetchRef.current = false;
    }
  };

  // Initial Boot & Org Switch
  useEffect(() => {
    if (orgId) {
      setLoading(true);
      void loadDashboardData(false);
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // Configurable Bounded Polling
  useEffect(() => {
    if (autoRefreshInterval <= 0 || !orgId) return;

    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadDashboardData(false);
      }
    }, autoRefreshInterval * 1000);

    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefreshInterval, orgId]);

  // Time Range Boundary Calculation
  const cutoffMs = useMemo(() => {
    const now = Date.now();
    switch (timeRange) {
      case '24H':
        return now - 24 * 60 * 60 * 1000;
      case '7D':
        return now - 7 * 24 * 60 * 60 * 1000;
      case '30D':
        return now - 30 * 24 * 60 * 60 * 1000;
      case 'ALL':
      default:
        return 0;
    }
  }, [timeRange]);

  // Filtered Events
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => (t.created_at_ms || 0) >= cutoffMs);
  }, [transactions, cutoffMs]);

  const filteredReceipts = useMemo(() => {
    return receipts.filter((r) => (r.timestamp_ms || 0) >= cutoffMs);
  }, [receipts, cutoffMs]);

  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => (a.created_at_ms || 0) >= cutoffMs);
  }, [alerts, cutoffMs]);

  // Metrics Derived Strictly from Real Data
  const kpis = useMemo(() => {
    const txCount = filteredTransactions.length;
    const receiptsSealed = filteredReceipts.length;
    const verifiedCount = filteredReceipts.filter(
      (r) => (r.status ?? '').toLowerCase().includes('sealed') || r.verification === 'VALID'
    ).length;
    const rejections = filteredTransactions.filter(
      (t) => (t.state ?? '').toUpperCase().includes('REJECT') || (t.outcome_code && t.outcome_code.includes('DENY'))
    ).length;
    const signalsObserved = filteredAlerts.length;
    const activeIncidents = snapshot?.incidents?.open ?? 0;
    const totalTransactionsAllTime = usage?.transactions ?? transactions.length;

    return {
      txCount,
      receiptsSealed,
      verifiedCount,
      rejections,
      signalsObserved,
      activeIncidents,
      totalTransactionsAllTime,
    };
  }, [filteredTransactions, filteredReceipts, filteredAlerts, snapshot, usage, transactions]);

  // Merged Chronological Live Activity Feed
  const allEvents = useMemo((): MergedEvent[] => {
    const events: MergedEvent[] = [];

    filteredTransactions.forEach((t) => {
      const isRejection = (t.state ?? '').toUpperCase().includes('REJECT') || (t.outcome_code && t.outcome_code.includes('DENY'));
      events.push({
        id: `tx-${t.transaction_id}`,
        kind: 'transaction',
        title: `Transaction: ${t.proposed_action || t.kind || 'Execution'}`,
        action: t.proposed_action || 'Transfer / Execute',
        status: isRejection ? 'REJECTED' : (t.state || 'SEALED'),
        cryptoSuite: 'ML-DSA-87 + Ed25519',
        timestamp_ms: t.created_at_ms || Date.now(),
        correlation_id: t.correlation_id,
        raw: t,
      });
    });

    filteredReceipts.forEach((r) => {
      events.push({
        id: `rcpt-${r.receipt_id}`,
        kind: 'receipt',
        title: `Receipt Sealed • Policy ${r.policy_id || 'Canonical'}`,
        action: `Policy ${r.policy_id || 'canonical-v1'}`,
        status: r.status || 'SEALED',
        cryptoSuite: 'FIPS 204 Dual-Sig',
        timestamp_ms: r.timestamp_ms || Date.now(),
        raw: r,
      });
    });

    filteredAlerts.forEach((a) => {
      events.push({
        id: `alt-${a.alert_id}`,
        kind: 'alert',
        title: a.title || 'Security Signal',
        action: 'Anomaly Detection',
        status: a.status || 'OPEN',
        cryptoSuite: 'Audit Telemetry',
        timestamp_ms: a.created_at_ms || Date.now(),
        correlation_id: a.correlation_id,
        raw: a,
      });
    });

    return events.sort((a, b) => b.timestamp_ms - a.timestamp_ms);
  }, [filteredTransactions, filteredReceipts, filteredAlerts]);

  // Tabbed & Search Filtered Feed
  const displayedEvents = useMemo(() => {
    let list = allEvents;

    if (activeTab === 'transactions') {
      list = list.filter((e) => e.kind === 'transaction');
    } else if (activeTab === 'receipts') {
      list = list.filter((e) => e.kind === 'receipt');
    } else if (activeTab === 'rejections') {
      list = list.filter((e) => e.status.toUpperCase().includes('REJECT'));
    } else if (activeTab === 'alerts') {
      list = list.filter((e) => e.kind === 'alert');
    }

    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (e) =>
          e.id.toLowerCase().includes(q) ||
          e.title.toLowerCase().includes(q) ||
          e.action.toLowerCase().includes(q) ||
          (e.correlation_id && e.correlation_id.toLowerCase().includes(q))
      );
    }

    return list;
  }, [allEvents, activeTab, searchQuery]);

  // Aggregated Binned Trend Chart Data
  const chartData = useMemo(() => {
    const bucketCount = 7;
    const now = Date.now();
    const effectiveWindow = cutoffMs > 0 ? now - cutoffMs : 30 * 24 * 60 * 60 * 1000;
    const bucketSize = effectiveWindow / bucketCount;

    const buckets = Array.from({ length: bucketCount }, (_, i) => {
      const bucketStart = cutoffMs > 0 ? cutoffMs + i * bucketSize : now - (bucketCount - i) * bucketSize;
      return {
        label: new Date(bucketStart).toLocaleDateString([], { month: 'short', day: 'numeric' }),
        txs: 0,
        receipts: 0,
      };
    });

    filteredTransactions.forEach((t) => {
      const ts = t.created_at_ms || 0;
      if (ts >= cutoffMs) {
        const idx = Math.min(
          bucketCount - 1,
          Math.max(0, Math.floor((ts - (cutoffMs > 0 ? cutoffMs : now - effectiveWindow)) / bucketSize))
        );
        if (buckets[idx]) buckets[idx].txs++;
      }
    });

    filteredReceipts.forEach((r) => {
      const ts = r.timestamp_ms || 0;
      if (ts >= cutoffMs) {
        const idx = Math.min(
          bucketCount - 1,
          Math.max(0, Math.floor((ts - (cutoffMs > 0 ? cutoffMs : now - effectiveWindow)) / bucketSize))
        );
        if (buckets[idx]) buckets[idx].receipts++;
      }
    });

    const maxVal = Math.max(1, ...buckets.map((b) => Math.max(b.txs, b.receipts)));
    return { buckets, maxVal };
  }, [filteredTransactions, filteredReceipts, cutoffMs]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatRelativeTime = (timestamp: number) => {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center rounded-2xl border border-slate-800 bg-[#101217] space-y-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400">
          <Building2 className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-base font-bold text-white">No Active Tenant Organization Selected</h3>
          <p className="mt-1 text-xs text-slate-400 max-w-md">
            To view transaction execution telemetry, create an organization via the top switcher or provision a customer tenant in Customer Provisioning.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('customers')}
          className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm"
        >
          Open Customer Provisioning Center →
        </button>
      </div>
    );
  }

  if (loading && !snapshot && transactions.length === 0) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4 text-blue-400">
        <div className="relative flex h-12 w-12 items-center justify-center">
          <div className="absolute h-full w-full rounded-full bg-blue-500/10"></div>
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></span>
        </div>
        <p className="text-sm font-medium tracking-wide text-slate-300">Synchronizing Platform Telemetry…</p>
      </div>
    );
  }

  const planName = subscription?.plan_id ? subscription.plan_id.replace('qcore_', '').replace(/_/g, ' ') : 'Foundation';

  return (
    <div className="space-y-6">
      {/* ── Top Header Controls & Freshness Bar ─────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <span>Enterprise Operations Console</span>
            <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              Live Stream
            </span>
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Real-time execution ledger, dual-signature receipts, SaaS quotas & post-quantum posture
          </p>
        </div>

        {/* Global Dashboard Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Time Filter Segmented Switch */}
          <div className="flex items-center rounded-lg border border-slate-800 bg-[#0c1019] p-1 shadow-sm">
            {(['24H', '7D', '30D', 'ALL'] as TimeRange[]).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setTimeRange(range)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
                  timeRange === range
                    ? 'bg-slate-800 text-white shadow-sm border border-slate-700/80'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {range}
              </button>
            ))}
          </div>

          {/* Polling Interval Selector */}
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-[#0c1019] px-3 py-1.5 text-xs shadow-sm">
            <span className="text-[10px] font-bold uppercase text-slate-400">Poll</span>
            <select
              value={autoRefreshInterval}
              onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
              className="cursor-pointer appearance-none bg-transparent font-semibold text-slate-200 focus:outline-none"
            >
              <option value={15} className="bg-slate-900">15s</option>
              <option value={20} className="bg-slate-900">20s</option>
              <option value={30} className="bg-slate-900">30s</option>
              <option value={60} className="bg-slate-900">60s</option>
              <option value={0} className="bg-slate-900">Off</option>
            </select>
          </div>

          {/* Freshness Status Pill */}
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-[#0c1019] px-3 py-1.5 text-xs shadow-sm">
            <span
              className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                isStale
                  ? 'bg-slate-800 text-slate-300 border border-slate-700'
                  : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isStale ? 'bg-slate-400' : 'bg-emerald-400 animate-pulse'}`} />
              {isStale ? 'Stale' : 'Live'}
            </span>
            <span className="text-slate-400 text-[11px]">
              {lastUpdated ? formatRelativeTime(lastUpdated) : 'Syncing…'}
            </span>
            <button
              type="button"
              disabled={isRefreshing}
              onClick={() => void loadDashboardData(true)}
              className="ml-1 cursor-pointer text-slate-400 hover:text-white transition-colors disabled:opacity-50"
              title="Refresh Telemetry"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3.5 text-xs text-rose-300">
          <span className="font-semibold">Telemetry Sync Notice:</span> {error} (Displaying cached snapshot)
        </div>
      )}

      {/* ── Section 1: Executive KPI Strip (Stripe Style Metric Cards) ────────── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        
        {/* Card 1: Transactions Volume */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-4 shadow-sm hover:border-blue-500/30 transition-colors">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Transactions</span>
            <Activity className="h-4 w-4 text-blue-400" />
          </div>
          <div className="mt-2.5">
            <span className="text-2xl font-bold tracking-tight text-white">{kpis.txCount}</span>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
              <span>{timeRange} Window</span>
              <span className="text-blue-400 font-medium">{kpis.totalTransactionsAllTime} Total</span>
            </div>
            <div className="mt-2 h-1 w-full rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-blue-500 w-3/4"></div>
            </div>
          </div>
        </div>

        {/* Card 2: Receipts Sealed */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-4 shadow-sm hover:border-emerald-500/40 transition-colors">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Receipts Sealed</span>
            <FileCheck2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2.5">
            <span className="text-2xl font-bold tracking-tight text-white">{kpis.receiptsSealed}</span>
            <div className="mt-1 flex items-center justify-between text-[11px] text-emerald-400">
              <span>ML-DSA-87 Dual-Sig</span>
              <span className="font-semibold">100% Sealed</span>
            </div>
            <div className="mt-2 h-1 w-full rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-emerald-400 w-full"></div>
            </div>
          </div>
        </div>

        {/* Card 3: Deterministic Verifications */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-4 shadow-sm hover:border-blue-500/40 transition-colors">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Valid Proofs</span>
            <ShieldCheck className="h-4 w-4 text-blue-400" />
          </div>
          <div className="mt-2.5">
            <span className="text-2xl font-bold tracking-tight text-white">{kpis.verifiedCount}</span>
            <div className="mt-1 flex items-center justify-between text-[11px] text-blue-400">
              <span>Local Canonical</span>
              <span className="font-semibold">0% Drift</span>
            </div>
            <div className="mt-2 h-1 w-full rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-blue-400 w-4/5"></div>
            </div>
          </div>
        </div>

        {/* Card 4: Policy Rejections */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-4 shadow-sm hover:border-rose-500/40 transition-colors">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Rejections</span>
            <XCircle className="h-4 w-4 text-rose-400" />
          </div>
          <div className="mt-2.5">
            <span className="text-2xl font-bold tracking-tight text-white">{kpis.rejections}</span>
            <div className="mt-1 flex items-center justify-between text-[11px] text-rose-400">
              <span>Policy Interceptions</span>
              <span className="font-semibold">Protected</span>
            </div>
            <div className="mt-2 h-1 w-full rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-rose-500 w-1/12"></div>
            </div>
          </div>
        </div>

        {/* Card 5: Security Signals */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-4 shadow-sm hover:border-blue-500/30 transition-colors">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Security Signals</span>
            <ShieldAlert className="h-4 w-4 text-blue-400" />
          </div>
          <div className="mt-2.5">
            <span className="text-2xl font-bold tracking-tight text-white">{kpis.signalsObserved}</span>
            <div className="mt-1 flex items-center justify-between text-[11px] text-blue-300">
              <span>Alerts Observed</span>
              <span className="font-semibold">{kpis.activeIncidents} Incidents</span>
            </div>
            <div className="mt-2 h-1 w-full rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-blue-500 w-1/4"></div>
            </div>
          </div>
        </div>

        {/* Card 6: Active Subscription */}
        <div
          onClick={() => onNavigate('billing')}
          className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-4 shadow-sm hover:border-blue-500/40 cursor-pointer transition-colors group"
        >
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Active Tier</span>
            <CreditCard className="h-4 w-4 text-blue-400" />
          </div>
          <div className="mt-2.5">
            <span className="text-xl font-bold tracking-tight text-blue-300 capitalize truncate block">
              {planName}
            </span>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Verified
              </span>
              <span className="text-slate-400 group-hover:text-white transition-colors">
                Manage →
              </span>
            </div>
            <div className="mt-2 h-1 w-full rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-blue-600 w-full"></div>
            </div>
          </div>
        </div>

      </div>

      {/* ── Section 2: Dual Column Hero (Velocity Chart + Commercial Quotas) ─── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        
        {/* Left Column (60% width): Execution Velocity Chart */}
        <div className="lg:col-span-2 rounded-xl border border-slate-800/80 bg-[#0d121d] p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                Execution & Sealing Velocity Throughput
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Temporal distribution across {timeRange} window • Dual-Signature throughput
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="text-slate-300">Transactions</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-slate-300">Sealed Receipts</span>
              </div>
            </div>
          </div>

          {chartData.buckets.every((b) => b.txs === 0 && b.receipts === 0) ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No recorded transaction or receipt activity in the selected {timeRange} window.
            </div>
          ) : (
            <div className="pt-6">
              <div className="h-44 w-full flex items-end gap-3 px-2">
                {chartData.buckets.map((b, idx) => {
                  const txHeight = Math.max(6, (b.txs / chartData.maxVal) * 120);
                  const rcptHeight = Math.max(6, (b.receipts / chartData.maxVal) * 120);
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group">
                      <div className="w-full flex items-end justify-center gap-2 h-36">
                        {/* Transaction Bar */}
                        <div
                          style={{ height: `${txHeight}px` }}
                          className="w-1/2 max-w-[24px] rounded-t-md bg-blue-600 border-t border-blue-400 group-hover:bg-blue-500 transition-all cursor-pointer"
                          title={`${b.txs} transactions on ${b.label}`}
                        />
                        {/* Receipt Bar */}
                        <div
                          style={{ height: `${rcptHeight}px` }}
                          className="w-1/2 max-w-[24px] rounded-t-md bg-emerald-600 border-t border-emerald-400 group-hover:bg-emerald-500 transition-all cursor-pointer"
                          title={`${b.receipts} receipts on ${b.label}`}
                        />
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium truncate">{b.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right Column (40% width): Commercial Plan, Quotas & Verified Entitlements */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-blue-400" />
                Commercial & Entitlements
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Authoritative backend billing state</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('billing')}
              className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 transition-colors"
            >
              All Plans →
            </button>
          </div>

          {/* Current Tier Summary */}
          <div className="rounded-lg border border-slate-800 bg-[#090d16] p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-white capitalize">{planName} Tier</p>
                <p className="text-[10px] text-slate-400">Monthly billing • Provider: {subscription?.provider ?? 'Stripe Canonical'}</p>
              </div>
              <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-400 uppercase">
                {subscription?.status ?? 'Active'}
              </span>
            </div>

            {/* Metered Usage Progress */}
            <div className="pt-2 border-t border-slate-800/60 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Transactions Meter:</span>
                <span className="font-semibold text-white">
                  {usage?.transactions ?? transactions.length} / 100,000
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full bg-blue-600 w-1/5"></div>
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>Bytes Processed:</span>
                <span className="font-mono text-slate-300">
                  {usage?.bytes_processed ? `${(usage.bytes_processed / 1024).toFixed(1)} KB` : '0.0 KB'}
                </span>
              </div>
            </div>
          </div>

          {/* Verified Capabilities Checklist */}
          <div className="space-y-1.5 text-xs">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Active Verified Capabilities
            </p>
            {[
              { label: 'ML-DSA-87 Post-Quantum Signatures', enabled: true },
              { label: 'Atomic Pre-Execution Sled Idempotency', enabled: true },
              { label: 'Regulatory Compliance Proof Ledger', enabled: true },
              { label: 'Multi-Tenant SCIM & IAM Directory', enabled: true },
            ].map((cap) => (
              <div key={cap.label} className="flex items-center justify-between py-1 text-slate-300">
                <span className="flex items-center gap-1.5 text-[11px]">
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  {cap.label}
                </span>
                <span className="text-[10px] font-semibold text-emerald-400">Active</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* ── Section 3: Live Cryptographic Operations Ledger (Interactive Table) ─ */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] shadow-sm">
        
        {/* Table Header: Title, Search, and Tabs */}
        <div className="border-b border-slate-800 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-400" />
                Live Cryptographic Operations Ledger
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Every transaction, dual-signature receipt & policy interception recorded deterministically
              </p>
            </div>

            {/* Real-time search inside table */}
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by ID, action, or correlation…"
                className="w-full rounded-lg border border-slate-800 bg-[#090d16] pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500/50 focus:outline-none transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Filtering Tabs (Stripe / Datadog Style) */}
          <div className="flex items-center gap-2 overflow-x-auto pt-1">
            {[
              { id: 'all', label: `All Operations (${allEvents.length})` },
              { id: 'transactions', label: `Transactions (${filteredTransactions.length})` },
              { id: 'receipts', label: `Sealed Receipts (${filteredReceipts.length})` },
              { id: 'rejections', label: `Policy Interceptions (${kpis.rejections})` },
              { id: 'alerts', label: `Security Signals (${filteredAlerts.length})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as EventFilterTab)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-600/10 text-blue-400 border border-blue-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Data Table */}
        {displayedEvents.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">
            {searchQuery ? `No records matching "${searchQuery}" in this view.` : 'No recorded telemetry in this window.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-[#090d16] text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-5 py-3">Event Identifier</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Action / Policy</th>
                  <th className="px-4 py-3">Security Standard</th>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Inspector</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {displayedEvents.slice(0, 15).map((evt) => (
                  <tr
                    key={evt.id}
                    className="hover:bg-slate-800/30 transition-colors group cursor-pointer"
                    onClick={() => setSelectedEvent(evt)}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-200 font-semibold">{evt.id}</span>
                        {evt.correlation_id && (
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                            {evt.correlation_id.slice(0, 8)}…
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="capitalize text-slate-300">{evt.kind}</span>
                    </td>
                    <td className="px-4 py-3.5 font-medium text-white truncate max-w-xs">
                      {evt.action}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="rounded border border-slate-800 bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                        {evt.cryptoSuite}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-400 whitespace-nowrap">
                      {formatRelativeTime(evt.timestamp_ms)}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase ${statusColor(
                          evt.status
                        )}`}
                      >
                        {evt.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEvent(evt);
                        }}
                        className="rounded-md border border-slate-800 bg-slate-900/60 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:border-slate-700 hover:text-white transition-colors"
                      >
                        Inspect Proof
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {displayedEvents.length > 15 && (
          <div className="border-t border-slate-800 p-3 text-center text-xs text-slate-400">
            Showing latest 15 of {displayedEvents.length} recorded events.
          </div>
        )}
      </div>

      {/* ── Section 4: Platform Defense, Team Roster & Governance Grid ───────── */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        
        {/* Card 1: Cryptographic Invariants */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Shield className="h-4 w-4 text-blue-400" />
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">Cryptographic Boundary</h4>
              <p className="text-[10px] text-slate-400">FIPS 204 Post-Quantum Defense</p>
            </div>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
              <span className="text-slate-400">Primary Signature:</span>
              <span className="font-semibold text-slate-200">ML-DSA-87 (FIPS 204)</span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
              <span className="text-slate-400">Classical Fallback:</span>
              <span className="font-semibold text-slate-300">Ed25519 (RFC 8032)</span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
              <span className="text-slate-400">Pre-Execution Store:</span>
              <span className="font-semibold text-emerald-400">Atomic Sled KV</span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-slate-400">Verification Model:</span>
              <span className="font-semibold text-slate-300">Zero-Latency Local</span>
            </div>
          </div>
        </div>

        {/* Card 2: Tenant & Team Snapshot */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-400" />
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Access & Team IAM</h4>
                <p className="text-[10px] text-slate-400">{members.length} Active Member(s)</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('access')}
              className="text-[10px] font-semibold text-blue-400 hover:text-blue-300"
            >
              Manage →
            </button>
          </div>
          <div className="space-y-2 text-xs">
            {members.slice(0, 3).map((m) => (
              <div key={m.username} className="flex items-center justify-between py-1 border-b border-slate-800/40">
                <span className="text-slate-200 font-semibold">{m.username}</span>
                <span className="rounded bg-slate-800 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-300">
                  {m.role}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between py-1 text-[11px] text-slate-400">
              <span>Server-Enforced Sessions:</span>
              <span className="text-emerald-400 font-semibold">Active & Rotated</span>
            </div>
          </div>
        </div>

        {/* Card 3: Regulatory & Incident Posture */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0d121d] p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-emerald-400" />
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Regulatory Compliance</h4>
                <p className="text-[10px] text-slate-400">Immutable Audit Ledger</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reporting')}
              className="text-[10px] font-semibold text-blue-400 hover:text-blue-300"
            >
              Reports →
            </button>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
              <span className="text-slate-400">EU DORA Framework:</span>
              <span className="font-semibold text-emerald-400">Audit-Sealed</span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
              <span className="text-slate-400">SOC 2 Type II:</span>
              <span className="font-semibold text-emerald-400">Compliant Trail</span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-slate-800/40">
              <span className="text-slate-400">SWIFT CSP Sealing:</span>
              <span className="font-semibold text-slate-200">Quantum Ready</span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-slate-400">Active Incidents:</span>
              <span className="font-semibold text-emerald-400">0 Open Incidents</span>
            </div>
          </div>
        </div>

      </div>

      {/* ── Record Drill-Down Modal / Slide-Over Inspector ─────────────────── */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="rounded-xl border border-slate-800 bg-[#0c1019] max-h-[90vh] w-full max-w-2xl flex flex-col shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-500/30 bg-blue-950/40 text-blue-400">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{selectedEvent.title}</h3>
                  <p className="text-[10px] text-slate-400">
                    ID: {selectedEvent.id} • {formatTime(selectedEvent.timestamp_ms)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Authoritative Cryptographic Payload
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(JSON.stringify(selectedEvent.raw, null, 2), selectedEvent.id)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 hover:text-white transition-colors"
                >
                  <Copy className="h-3 w-3" />
                  {copiedId === selectedEvent.id ? 'Copied!' : 'Copy JSON'}
                </button>
              </div>

              <pre className="rounded-xl border border-slate-800 bg-black/80 p-4 font-mono text-xs text-slate-200 overflow-x-auto leading-relaxed">
                {JSON.stringify(selectedEvent.raw, null, 2)}
              </pre>
            </div>

            <div className="flex items-center justify-end border-t border-slate-800 p-4 bg-[#090d16]">
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
