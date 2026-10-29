import React, { useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronsUpDown,
  CreditCard,
  FileCheck2,
  FileText,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Plus,
  Radio,
  Search,
  Server,
  Shield,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Webhook,
  X
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { API_BASE, listOrganizations, createOrganization, platformHealth, type Organization, type PlatformHealth } from '../services/qcore';

export type ConsoleView =
  | 'overview'
  | 'api-keys'
  | 'webhooks'
  | 'profile'
  | 'usage'
  | 'billing'
  | 'access'
  | 'recon'
  | 'resilience'
  | 'reporting'
  | 'audit'
  | 'cluster'
  | 'customers';

interface NavItem {
  id: ConsoleView;
  label: string;
  icon: React.ReactNode;
  badge?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const CUSTOMER_NAV_GROUPS: NavGroup[] = [
  {
    label: 'TENANT OPERATIONS',
    items: [
      { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'INGRESS & SECURITY',
    items: [
      { id: 'api-keys', label: 'API Keys', icon: <KeyRound className="h-4 w-4" /> },
      { id: 'webhooks', label: 'Webhooks & Alerts', icon: <Webhook className="h-4 w-4" /> },
    ],
  },
  {
    label: 'COMMERCIAL & SAAS',
    items: [
      { id: 'billing', label: 'Billing & Invoices', icon: <CreditCard className="h-4 w-4" /> },
      { id: 'usage', label: 'Usage & Quotas', icon: <Activity className="h-4 w-4" /> },
    ],
  },
  {
    label: 'GOVERNANCE & AUDIT',
    items: [
      { id: 'reporting', label: 'Compliance Reports', icon: <FileCheck2 className="h-4 w-4" /> },
    ],
  },
];

const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    label: 'CORE PLATFORM',
    items: [
      { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'ADMINISTRATION',
    items: [
      { id: 'customers', label: 'Customer Provisioning', icon: <UserPlus className="h-4 w-4" />, badge: 'Admin' },
      { id: 'access', label: 'Members & IAM', icon: <Users className="h-4 w-4" /> },
    ],
  },
  {
    label: 'DEVELOPER & INGRESS',
    items: [
      { id: 'api-keys', label: 'API Keys', icon: <KeyRound className="h-4 w-4" /> },
      { id: 'webhooks', label: 'Webhooks & Alerts', icon: <Webhook className="h-4 w-4" /> },
    ],
  },
  {
    label: 'OPERATIONS & CRYPTO',
    items: [
      { id: 'recon', label: 'Recon & Evidence', icon: <Search className="h-4 w-4" /> },
      { id: 'resilience', label: 'Resilience & Keys', icon: <KeyRound className="h-4 w-4" /> },
    ],
  },
  {
    label: 'COMMERCIAL & SAAS',
    items: [
      { id: 'billing', label: 'Billing & Plans', icon: <CreditCard className="h-4 w-4" /> },
      { id: 'usage', label: 'Usage & Metering', icon: <Activity className="h-4 w-4" /> },
    ],
  },
  {
    label: 'GOVERNANCE & INFRA',
    items: [
      { id: 'reporting', label: 'Compliance Reports', icon: <FileCheck2 className="h-4 w-4" /> },
      { id: 'audit', label: 'Audit Ledger', icon: <FileText className="h-4 w-4" />, badge: 'Immutable' },
      { id: 'cluster', label: 'HA Cluster', icon: <Radio className="h-4 w-4" /> },
    ],
  },
];

export function Shell({
  view,
  onNavigate,
  children,
}: {
  view: ConsoleView;
  onNavigate: (view: ConsoleView) => void;
  children: React.ReactNode;
}): React.ReactElement {
  const { user, orgId, selectOrg, signOut } = useAuth();
  const [orgs, setOrgs] = React.useState<Organization[]>([]);
  const [orgsError, setOrgsError] = React.useState<string | null>(null);
  const [health, setHealth] = React.useState<PlatformHealth | null>(null);
  const [createOrgOpen, setCreateOrgOpen] = React.useState<boolean>(false);
  const [newOrgName, setNewOrgName] = React.useState<string>('');
  const [creatingOrg, setCreatingOrg] = React.useState<boolean>(false);
  const [createOrgError, setCreateOrgError] = React.useState<string | null>(null);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    setCreatingOrg(true);
    setCreateOrgError(null);
    try {
      const res = await createOrganization(newOrgName.trim());
      const org = 'organization' in res ? res.organization : res;
      setOrgs((prev) => [...prev, org]);
      selectOrg(org.id);
      setNewOrgName('');
      setCreateOrgOpen(false);
    } catch (err: unknown) {
      setCreateOrgError(err instanceof Error ? err.message : 'Failed to create organization.');
    } finally {
      setCreatingOrg(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function bootConsole(): Promise<void> {
      try {
        const res = await listOrganizations();
        if (cancelled) return;
        setOrgs(res.organizations);
        setOrgsError(null);
        if (res.organizations.length > 0) {
          const currentValid = res.organizations.some((o) => o.id === orgId);
          if (!orgId || !currentValid) {
            selectOrg(res.organizations[0].id);
          }
        } else if (orgId) {
          selectOrg(null);
        }
      } catch (err: unknown) {
        if (!cancelled) setOrgsError(err instanceof Error ? err.message : 'Failed to load organizations.');
      }
      try {
        const h = await platformHealth();
        if (!cancelled) setHealth(h);
      } catch {
        if (!cancelled) setHealth(null);
      }
    }
    void bootConsole();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentOrgName = orgs.find((o) => o.id === orgId)?.name ?? (orgId ? `Org ${orgId.slice(0, 8)}` : 'Select Organization');

  return (
    <div className="min-h-screen bg-[#0c0d12] text-slate-100 antialiased selection:bg-blue-500/20 selection:text-blue-200">
      {/* ── Left Sidebar (Stripe Layout) ────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-800/80 bg-[#101217] shadow-lg">
        
        {/* Brand Logo & Node Identifier */}
        <div className="flex h-16 items-center justify-between border-b border-slate-800/80 px-5">
          <div className="flex items-center gap-3">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-[#181a24] border border-white/10 font-bold text-white shadow-sm">
              <span className="text-xs font-bold tracking-tight text-white">Q</span>
              <span className="absolute -bottom-0.5 -right-0.5 flex h-2 w-2 rounded-full bg-emerald-400"></span>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold tracking-tight text-white">VARDHAN Q-CORE</span>
                <span className="rounded bg-white/[0.06] border border-white/10 px-1 py-0.2 text-[9px] font-semibold text-slate-300">
                  v1.1-rc
                </span>
              </div>
              <p className="text-[10px] text-slate-400">Enterprise Control Plane</p>
            </div>
          </div>
        </div>

        {/* Compact Organization Switcher + Add Org Button */}
        <div className="border-b border-slate-800/80 px-3 py-2">
          {user?.role === 'customer' ? (
            <div className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-[#12141c] px-2.5 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-blue-500/10 text-blue-400 shrink-0">
                  <Building2 className="h-3 w-3" />
                </div>
                <div className="truncate">
                  <p className="text-[11px] font-semibold text-slate-200 truncate leading-tight">
                    {user?.organizationName || currentOrgName}
                  </p>
                  <p className="text-[9px] text-slate-400 font-mono truncate">{orgId ?? 'Single-Tenant'}</p>
                </div>
              </div>
              <span className="rounded bg-blue-500/10 border border-blue-500/30 px-1.5 py-0.2 text-[9px] font-bold text-blue-400 uppercase">
                Tenant
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <div className="relative group flex-1 min-w-0">
                <div className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-[#12141c] px-2.5 py-1.5 hover:border-slate-700 hover:bg-slate-800/50 transition-all cursor-pointer">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-5 w-5 items-center justify-center rounded bg-blue-500/10 text-blue-400 shrink-0">
                      <Building2 className="h-3 w-3" />
                    </div>
                    <div className="truncate">
                      <p className="text-[11px] font-semibold text-slate-200 truncate leading-tight">{currentOrgName}</p>
                      <p className="text-[9px] text-slate-400 font-mono truncate">{orgId ?? 'No tenant selected'}</p>
                    </div>
                  </div>
                  <ChevronsUpDown className="h-3 w-3 text-slate-400 shrink-0 ml-1.5 group-hover:text-slate-300 transition-colors" />
                  <select
                    value={orgId ?? ''}
                    onChange={(e) => selectOrg(e.target.value === '' ? null : e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    title="Switch tenant organization"
                  >
                    <option value="">— Select Organization —</option>
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} ({o.id})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreateOrgOpen(true)}
                title="Create new organization"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-800 bg-[#12141c] text-slate-400 hover:text-white hover:border-slate-700 hover:bg-slate-800/60 transition-colors cursor-pointer shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Navigation Categories */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {(user?.role === 'customer' ? CUSTOMER_NAV_GROUPS : ADMIN_NAV_GROUPS).map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {group.label}
              </p>
              <div className="space-y-0.5 pt-1">
                {group.items.map((item) => {
                  const active = view === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onNavigate(item.id)}
                      className={`group flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                        active
                          ? 'bg-white/[0.08] text-white font-semibold border-l-2 border-blue-500 pl-2.5'
                          : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 border-l-2 border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className={active ? 'text-blue-400' : 'text-slate-400 group-hover:text-slate-300'}>
                          {item.icon}
                        </span>
                        <span>{item.label}</span>
                      </div>
                      {item.badge && (
                        <span className="rounded bg-slate-800/80 px-1.5 py-0.5 text-[9px] text-slate-400 border border-white/5">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Sidebar Footer: Health & User Account */}
        <div className="border-t border-slate-800/80 bg-[#080b11] p-3 space-y-2">
          {/* Live Node Beacon */}
          <div className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-900/40 px-2.5 py-1.5 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"></span>
              </span>
              <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
                {health ? `${health.status}` : 'Connecting'}
              </span>
            </div>
            <span className="font-mono text-[10px] text-slate-400">control-plane-01</span>
          </div>

          {/* User Profile & Sign Out */}
          <div className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-900/60 p-2">
            <button
              type="button"
              onClick={() => onNavigate('profile')}
              className="flex items-center gap-2 min-w-0 text-left hover:opacity-80 transition-opacity cursor-pointer flex-1 mr-2"
              title="View Operator Profile & Credentials"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-[10px] font-semibold text-white shrink-0">
                {user?.username ? user.username.charAt(0).toUpperCase() : 'U'}
              </span>
              <div className="truncate">
                <p className="text-xs font-semibold text-slate-200 truncate">{user?.username ?? 'operator'}</p>
                <p className="text-[9px] text-blue-400 uppercase font-semibold">Profile & Keys →</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-950/40 hover:text-rose-300 transition-colors"
              title="Sign Out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Canvas (Stripe Margin pl-64) ─────────────────────────────────── */}
      <div className="pl-64 flex flex-col min-h-screen">
        
        {/* Top Navbar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-800/80 bg-[#0e1015]/90 px-8 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Platform</span>
              <span className="text-slate-600">/</span>
              <span className="font-semibold text-white capitalize">{view.replace('-', ' ')}</span>
            </div>
            <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-slate-300">
              Dual-Signature Engine Active
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs">
            {/* Quick Status / Environment Pills */}
            <div className="hidden items-center gap-3 md:flex">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <ShieldCheck className="h-3.5 w-3.5 text-blue-400" />
                <span>ML-DSA-87 (FIPS 204) + Ed25519</span>
              </div>
              <div className="h-3 w-px bg-slate-800" />
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>Zero-Drift Telemetry</span>
              </div>
            </div>

            {/* Multi-Tenant Organization Quick Switcher / Customer Badge */}
            {user?.role === 'customer' ? (
              <div className="flex items-center gap-2 rounded-md border border-slate-800/90 bg-[#12141c] px-2.5 py-1 text-[11px] text-slate-300">
                <Building2 className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                <span className="font-semibold text-slate-200 truncate max-w-[140px]">
                  {user?.organizationName || currentOrgName}
                </span>
                <span className="rounded bg-blue-950/60 border border-blue-800/60 px-1 py-0.2 text-[9px] font-mono text-blue-300">
                  Tenant
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <div className="relative flex items-center gap-1.5 rounded-md border border-slate-800/90 bg-[#12141c] px-2 py-1 text-[11px] text-slate-300 hover:border-slate-700 hover:text-white transition-all cursor-pointer">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                  <span className="font-semibold text-slate-200 max-w-[110px] truncate">{currentOrgName}</span>
                  <ChevronsUpDown className="h-2.5 w-2.5 text-slate-400 shrink-0" />
                  <select
                    value={orgId ?? ''}
                    onChange={(e) => selectOrg(e.target.value === '' ? null : e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    title="Switch tenant organization"
                  >
                    <option value="">— Select Organization —</option>
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} ({o.id})
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateOrgOpen(true)}
                  title="Create New Organization"
                  className="flex items-center gap-1 rounded-md border border-slate-800 bg-[#12141c] px-2 py-1 text-[11px] text-slate-300 hover:text-white hover:border-slate-700 transition-colors cursor-pointer"
                >
                  <Plus className="h-3 w-3 text-blue-400" />
                  <span className="hidden sm:inline">Org</span>
                </button>
              </div>
            )}

            {/* Quick Terminal / API Indicator */}
            <div className="flex items-center rounded-lg border border-slate-800 bg-[#14161f] px-2.5 py-1 font-mono text-[10px] text-slate-400">
              <span className="text-slate-400">API: </span>
              <span className="ml-1 text-slate-200 font-semibold">{API_BASE}</span>
            </div>
          </div>
        </header>

        {orgsError && (
          <div className="border-b border-rose-500/30 bg-rose-950/40 px-8 py-2 text-xs text-rose-300">
            Tenant synchronization notice: {orgsError}
          </div>
        )}

        {/* Dynamic View Content */}
        <main className="flex-1 px-8 py-7 max-w-7xl w-full mx-auto space-y-6">
          {children}
        </main>

        {/* Minimal Executive Footer */}
        <footer className="border-t border-slate-800/80 bg-[#0e1015] py-4 text-xs text-slate-400">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-8">
            <p className="flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-slate-400" />
              <span>Vardhan Q-Core Enterprise • Post-Quantum Cryptographic Verification Infrastructure</span>
            </p>
            <p className="font-mono text-[11px] text-slate-400">
              Session Enforced • FIPS 204 Compliant
            </p>
          </div>
        </footer>
      </div>

      {/* ── Create Organization Modal ── */}
      {createOrgOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-[#101217] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Create Organization</h3>
                  <p className="text-[11px] text-slate-400">Provision a new isolated tenant control plane</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreateOrgOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateOrg} className="mt-4 space-y-4">
              {createOrgError && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-2.5 text-xs text-rose-300">
                  {createOrgError}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Organization Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Global Clearing Corp"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-[#14161f] px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  autoFocus
                />
                <p className="mt-1 text-[10px] text-slate-400">
                  Name must be 2-120 characters. You will automatically become the owner.
                </p>
              </div>

              <div className="rounded-lg border border-slate-800/80 bg-slate-900/40 p-3 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Default Provisioning</p>
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Initial Plan</span>
                  <span className="font-mono text-blue-400 font-semibold">foundation</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Isolation Model</span>
                  <span className="text-slate-400 font-mono text-[11px]">Strict Multi-Tenant</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOrgOpen(false)}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingOrg || !newOrgName.trim()}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40 transition-colors shadow-sm cursor-pointer"
                >
                  {creatingOrg ? 'Creating…' : 'Create & Switch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function LegendStrip(): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800/80 bg-[#12141b] px-4 py-2.5 text-xs text-slate-400 shadow-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-blue-400" />
        <span className="font-semibold text-slate-200">Vardhan Q-Core Enterprise:</span>
        <span className="hidden sm:inline">
          Real-time post-quantum transaction verification, cryptographic receipts & commercial sovereign metering.
        </span>
      </div>
      <div className="flex items-center gap-3 text-[11px]">
        <span className="flex items-center gap-1.5 text-blue-400 font-medium">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          FIPS 204 ML-DSA-87 Active
        </span>
        <span className="flex items-center gap-1.5 text-slate-300 font-medium">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          RFC 8032 Dual-Signature
        </span>
      </div>
    </div>
  );
}
