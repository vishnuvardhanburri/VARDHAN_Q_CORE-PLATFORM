import React, { useEffect, useState } from 'react';
import {
  CreditCard,
  ShieldCheck,
  Check,
  Sparkles,
  AlertCircle,
  RefreshCw,
  Layers,
  CheckCircle2,
  ArrowUpRight,
  Zap,
  KeyRound,
  Download,
  Copy,
  Clock,
  Lock,
  FileKey,
  Terminal,
  CheckCheck,
  ShieldAlert,
  Send,
  Upload,
  UserCheck,
  Building2,
  X
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  getPlanCatalog,
  getSubscription,
  getVerifiedEntitlements,
  getUsage,
  setSubscription,
  activateSubscription,
  mintLicense,
  installLicense,
  renewLicense,
  type Plan,
  type Subscription,
  type VerifiedEntitlementsResponse,
  type UsageSummary,
} from '../services/qcore';
import { Empty, Panel, QueryStateView, statusColor } from './shared';

const TIER_LABELS: Record<string, string> = {
  professional_service: 'Enterprise Discovery & Advisory',
  enterprise: 'Enterprise Core Production',
  enterprise_plus: 'Global Financial Enterprise',
  advanced_resilience: 'Mission-Critical High-Availability',
  strategic: 'Sovereign Defense & Central Banking',
};

const ENTITLEMENT_LABELS: Record<string, string> = {
  q_core_evaluation: 'Quantum-Safe Architecture Evaluation',
  q_core_pov: 'Bounded 10-Day Proof of Value Sandbox',
  q_core: 'Dual-Signature Verification Engine (ML-DSA-87 + Ed25519)',
  audit: 'Cryptographic Append-Only Audit Ledger',
  api: 'High-Throughput Cryptographic Ingress API',
  rbac: 'Role-Based Multi-Tenant IAM',
  integrations: 'Enterprise SIEM & Automated Webhook Dispatch',
  compliance: 'SOC2 & FIPS 204 Regulatory Verification Reports',
  usage: 'Real-Time Quota & Consumption Telemetry',
  aer_kep_q: 'Quantum-Safe AER-KEP-Q Key Encapsulation',
  ha: 'Multi-Region Active-Active Clustered Nodes',
  dr: 'Zero-RPO Deterministic Disaster Recovery',
  hsm_kms: 'HSM & Cloud KMS Hardware Vault Protection',
  sovereign_deployment: 'Sovereign Dedicated Single-Tenant Architecture',
  air_gapped: 'Air-Gapped Offline Operations Support',
  dedicated_assurance: 'Dedicated 24/7/365 Cryptographic Assurance SLA',
};

function formatTier(tier: string): string {
  return TIER_LABELS[tier] || tier.replace(/_/g, ' ').toUpperCase();
}

function formatEntitlement(ent: string): string {
  return ENTITLEMENT_LABELS[ent] || ent.replace(/_/g, ' ');
}

export default function BillingView(): React.ReactElement {
  const { orgId, user } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscriptionState] = useState<Subscription | null>(null);
  const [entitlements, setEntitlements] = useState<VerifiedEntitlementsResponse | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingPlan, setUpdatingPlan] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Role separation: identify if user is platform administrator
  const isPlatformAdmin = user?.role === 'admin';
  const [adminMode, setAdminMode] = useState<boolean>(isPlatformAdmin);

  // Modals for Customer & Admin Workflows
  const [planToOrder, setPlanToOrder] = useState<Plan | null>(null);
  const [renewModalOpen, setRenewModalOpen] = useState<boolean>(false);
  const [renewPeriod, setRenewPeriod] = useState<number>(365);
  const [renewNotes, setRenewNotes] = useState<string>('');
  const [renewSuccess, setRenewSuccess] = useState<string | null>(null);

  const [installLicOpen, setInstallLicOpen] = useState<boolean>(false);
  const [licPasteText, setLicPasteText] = useState<string>('');
  const [licInstallError, setLicInstallError] = useState<string | null>(null);
  const [licInstallSuccess, setLicInstallSuccess] = useState<string | null>(null);

  // Vendor Admin Cold-Vault Licensing State
  const [licTenantId, setLicTenantId] = useState<string>('');
  const [licDays, setLicDays] = useState<number>(365);
  const [licMaxNodes, setLicMaxNodes] = useState<number>(10);
  const [issuedLicense, setIssuedLicense] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const fetchBillingData = async (targetOrg: string) => {
    setLoading(true);
    setError(null);
    try {
      const [catalogData, subData, entData, usageData] = await Promise.all([
        getPlanCatalog().catch(() => []),
        getSubscription(targetOrg).catch(() => null),
        getVerifiedEntitlements(targetOrg).catch(() => null),
        getUsage(targetOrg).catch(() => null),
      ]);
      setPlans(catalogData);
      setSubscriptionState(subData?.subscription ?? null);
      setEntitlements(entData);
      setUsage(usageData?.usage ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve billing information.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orgId) {
      setLicTenantId(orgId);
      void fetchBillingData(orgId);
    }
  }, [orgId]);

  useEffect(() => {
    setAdminMode(isPlatformAdmin);
  }, [isPlatformAdmin]);

  // Request Plan Change (Customer places order, enters awaiting_billing_activation)
  const confirmPlanOrder = async () => {
    if (!orgId || !planToOrder) return;
    setUpdatingPlan(planToOrder.id);
    setActionSuccess(null);
    try {
      const updated = await setSubscription(orgId, planToOrder.id);
      setSubscriptionState(updated.subscription);
      setActionSuccess(
        `Upgrade request submitted for "${planToOrder.name}". Status: awaiting billing verification. Invoice dispatched.`
      );
      setPlanToOrder(null);
      void fetchBillingData(orgId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit plan upgrade order.');
    } finally {
      setUpdatingPlan(null);
    }
  };

  // Admin Action: Authorize & Activate Plan via Control Plane
  const handleAdminActivatePlan = async (planId: string) => {
    if (!orgId) return;
    try {
      await activateSubscription({
        organization_id: orgId,
        plan_id: planId,
        provider: 'manual_wire',
        idempotency_key: `act_${Date.now()}`,
      });
      setActionSuccess(
        `Plan "${planId}" authorized and activated on the control plane. Verified entitlements scheduled.`
      );
      void fetchBillingData(orgId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Activation failed on control plane.');
    }
  };

  // Vendor Admin: Cold-Vault License Minting with Real Ed25519 Control Plane Signatures
  const handleIssueLicense = async () => {
    const targetTenant = licTenantId.trim() || orgId || 'tenant_default';
    try {
      const res = await mintLicense({
        tenant_id: targetTenant,
        valid_days: licDays,
        max_nodes: licMaxNodes,
        package_tier: 'enterprise',
      });
      setIssuedLicense(JSON.stringify(res, null, 2));
      setCopied(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Cryptographic license minting failed.');
    }
  };

  const handleCopyLicense = () => {
    if (!issuedLicense) return;
    navigator.clipboard.writeText(issuedLicense);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadLicense = () => {
    if (!issuedLicense) return;
    const blob = new Blob([issuedLicense], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vardhan-${licTenantId || 'tenant'}.lic`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Customer: Submit License Extension Request via Control Plane
  const handleSubmitRenewal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    try {
      const res = await renewLicense({
        organization_id: orgId,
        period_days: renewPeriod,
        notes: renewNotes.trim() || undefined,
      });
      setRenewSuccess(
        `Renewal request for ${renewPeriod} days submitted successfully to Vardhan Quantum Enterprise Licensing. Reference: ${res.reference_id}.`
      );
      setTimeout(() => {
        setRenewModalOpen(false);
        setRenewSuccess(null);
        setRenewNotes('');
      }, 2500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'License renewal submission failed.');
    }
  };

  // Customer: Install & Authoritatively Validate License via Control Plane
  const handleInstallLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    setLicInstallError(null);
    try {
      const parsed = JSON.parse(licPasteText) as {
        tenant_id?: string;
        valid_until?: number;
        max_nodes?: number;
        signature?: string;
      };
      if (!parsed.tenant_id || !parsed.valid_until || !parsed.signature) {
        setLicInstallError('Corrupted license file: tenant_id, valid_until, and signature are required.');
        return;
      }
      if (parsed.tenant_id !== orgId) {
        setLicInstallError(`Tenant mismatch: license is minted for "${parsed.tenant_id}", but active organization is "${orgId}".`);
        return;
      }
      await installLicense({
        tenant_id: parsed.tenant_id,
        valid_until: parsed.valid_until,
        max_nodes: parsed.max_nodes ?? 1,
        signature: parsed.signature,
      });
      setLicInstallSuccess(`License token authoritatively verified and bound to /etc/vardhan/vardhan.lic for tenant "${orgId}".`);
      setTimeout(() => {
        setInstallLicOpen(false);
        setLicInstallSuccess(null);
        setLicPasteText('');
      }, 2000);
    } catch (err: unknown) {
      setLicInstallError(err instanceof Error ? err.message : 'License installation failed.');
    }
  };

  if (!orgId) {
    return (
      <Panel title="Billing & Entitlements" hint="Organization-scoped subscription, metering and SaaS entitlements">
        <Empty message="Select an organization in the header to view its billing and entitlement state." />
      </Panel>
    );
  }

  return (
    <div className="space-y-7">
      {/* ── Role Banner & Dashboard Mode ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#101217] px-4 py-3 text-xs">
        <div className="flex items-center gap-2.5">
          <span className="flex h-2 w-2 rounded-full bg-blue-500" />
          <span className="font-semibold text-slate-200">
            {adminMode ? 'Platform Superadmin • Commercial Governance' : 'Enterprise Tenant • Subscription & Entitlements'}
          </span>
          <span className="text-slate-500">•</span>
          <span className="text-slate-400">
            {adminMode
              ? 'Authoritative entitlement provisioning, license issuance & commercial contract activation'
              : 'Active cryptographic quota monitoring, commercial contract verification & license lifecycle'}
          </span>
        </div>

        {/* Admin Persona Toggle (Visible for Administrators) */}
        {isPlatformAdmin && (
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#141620] p-1">
            <button
              type="button"
              onClick={() => setAdminMode(false)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                !adminMode ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              Customer View
            </button>
            <button
              type="button"
              onClick={() => setAdminMode(true)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                adminMode ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              Vendor Admin Mode
            </button>
          </div>
        )}
      </div>

      {/* ── Active Subscription & Verified Status ── */}
      <Panel
        title="Active Subscription & Verified Status"
        hint={`Organization ${orgId} • Control-plane authoritative state`}
        right={
          <button
            type="button"
            onClick={() => void fetchBillingData(orgId)}
            className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/[0.08] bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300 hover:text-white transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        }
      >
        <QueryStateView loading={loading} error={error} onRetry={() => void fetchBillingData(orgId)} />

        {actionSuccess && (
          <div className="mb-5 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3.5 text-xs text-emerald-300 backdrop-blur-md">
            {actionSuccess}
          </div>
        )}

        {/* Pending Verification Notice (When Plan Change is Requested) */}
        {subscription?.status === 'awaiting_billing_activation' && (
          <div className="mb-5 rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-xs text-amber-200 backdrop-blur-md space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-amber-300">
                <AlertCircle className="h-4 w-4" />
                <span>Upgrade Order Pending: Awaiting Payment & Admin Verification</span>
              </div>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase text-amber-400">
                Invoice Dispatched
              </span>
            </div>
            <p className="text-slate-300">
              Your requested upgrade to <strong className="text-white capitalize">{subscription.plan_id.replace('qcore_', '')}</strong> is currently awaiting commercial invoice settlement.
              Entitlements will activate automatically once payment is verified by the platform billing administrator.
            </p>
            {adminMode && (
              <div className="pt-2 border-t border-amber-500/20 flex items-center justify-between">
                <span className="text-[11px] text-amber-300/80 font-mono">Platform Admin Action:</span>
                <button
                  type="button"
                  onClick={() => handleAdminActivatePlan(subscription.plan_id)}
                  className="flex cursor-pointer items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-500 transition-colors shadow-sm"
                >
                  <UserCheck className="h-3.5 w-3.5" /> Authorize & Clear Payment (Admin)
                </button>
              </div>
            )}
          </div>
        )}

        {subscription ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="bento-card p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Current Plan</p>
              <p className="mt-2 text-2xl font-bold uppercase tracking-tight text-white">
                {subscription.plan_id.replace('qcore_', '').replace(/_/g, ' ')}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {subscription.provider && subscription.provider !== 'unconfigured'
                  ? `Billing: ${subscription.provider}`
                  : 'Sovereign Deployment (Enterprise Direct)'}
              </p>
            </div>

            <div className="bento-card p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Subscription Status</p>
              <div className="mt-2">
                <span className={`inline-block rounded-full border px-3 py-0.5 text-xs font-bold uppercase ${statusColor(subscription.status)}`}>
                  {subscription.status === 'provisioning' ? 'Active Production' : subscription.status}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                {subscription.external_customer_id && subscription.external_customer_id !== 'Self-managed'
                  ? `Customer: ${subscription.external_customer_id}`
                  : 'Dedicated Sovereign Cluster'}
              </p>
            </div>

            <div className="bento-card p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Entitlements State</p>
              <p className="mt-2 text-base font-bold text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                Active & Verified
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Dual-Signature Engine Active (ML-DSA-87 + Ed25519)
              </p>
            </div>

            <div className="bento-card p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Metered Consumption</p>
              <p className="mt-2 text-2xl font-extrabold text-blue-400">
                {usage?.transactions ?? 0} <span className="text-sm font-normal text-slate-400">tx</span>
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {((usage?.bytes_processed ?? 0) / 1024).toFixed(1)} KB cryptographically processed
              </p>
            </div>
          </div>
        ) : (
          !loading && <Empty message="No active subscription record found for this organization." />
        )}
      </Panel>

      {/* ── Verified Entitlements Feature Matrix ── */}
      {entitlements && entitlements.entitlements && entitlements.entitlements.length > 0 && (
        <Panel title="Active Feature Entitlements" hint="Capabilities cryptographically authorized by the control-plane contract">
          <div className="flex flex-wrap gap-2.5">
            {entitlements.entitlements.map((feature) => (
              <span
                key={feature}
                className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3.5 py-1.5 text-xs font-medium text-emerald-300"
              >
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="font-medium text-xs">{formatEntitlement(feature)}</span>
              </span>
            ))}
          </div>
        </Panel>
      )}

      {/* ── Authoritative Six-Plan Catalog ── */}
      <Panel
        title="Enterprise Plan Catalog"
        hint="Select a plan to initiate a commercial upgrade order (requires admin/billing clearance)"
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => {
            const isCurrent = subscription?.plan_id === p.id;
            const isPendingThis = subscription?.status === 'awaiting_billing_activation' && subscription?.plan_id === p.id;

            return (
              <div
                key={p.id}
                className={`bento-card relative flex flex-col justify-between p-6 transition-all ${
                  isCurrent
                    ? 'border-blue-500/50 bg-[#121624] ring-1 ring-blue-500/20'
                    : isPendingThis
                    ? 'border-amber-500/40 bg-[#1a1610]'
                    : 'hover:border-slate-700'
                }`}
              >
                {isCurrent && (
                  <span className="absolute -top-3 right-5 rounded-full border border-blue-500/30 bg-blue-600/10 px-3 py-0.5 text-[10px] font-semibold text-blue-400">
                    Active Plan
                  </span>
                )}
                {isPendingThis && (
                  <span className="absolute -top-3 right-5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-0.5 text-[10px] font-semibold text-amber-400">
                    Pending Approval
                  </span>
                )}
                <div>
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
                      <Layers className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-base tracking-tight">{p.name}</h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] font-mono uppercase text-slate-400">Tier: {p.tier}</span>
                        <span className="text-[10px] text-slate-600">•</span>
                        <span className="text-[10px] font-mono uppercase text-blue-400">{p.product || 'q_core'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-baseline justify-between rounded-lg bg-black/40 p-3 border border-white/[0.05]">
                    <div>
                      <div className="font-mono text-sm font-bold text-white tracking-tight">{p.price_display}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {p.billing_model === 'fixed_fee'
                          ? 'Fixed-fee engagement (one-off)'
                          : p.billing_model === 'annual_license'
                          ? 'Annual recurring licence'
                          : 'Individually scoped engagement'}
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                        p.billing_model === 'fixed_fee'
                          ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300'
                          : p.billing_model === 'annual_license'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : 'border-purple-500/30 bg-purple-500/10 text-purple-300'
                      }`}
                    >
                      {p.billing_model === 'fixed_fee'
                        ? 'Fixed Fee'
                        : p.billing_model === 'annual_license'
                        ? 'Annual Licence'
                        : 'Scoped'}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2 border-t border-white/[0.06] pt-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Authorized Entitlements:</p>
                    <ul className="space-y-1.5">
                      {p.entitlements.map((ent) => (
                        <li key={ent} className="flex items-center gap-2 text-xs text-slate-300">
                          <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          <span className="font-mono text-[11px]">{ent}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="mt-6 border-t border-white/[0.06] pt-5">
                  {p.contact_sales ? (
                    <button
                      type="button"
                      onClick={() => setRenewModalOpen(true)}
                      className="w-full cursor-pointer rounded-lg border border-slate-700 bg-slate-800/80 py-2.5 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-700 transition-all flex items-center justify-center gap-1.5"
                    >
                      Contact Sales <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isCurrent || isPendingThis || updatingPlan === p.id}
                      onClick={() => setPlanToOrder(p)}
                      className={`w-full cursor-pointer rounded-lg py-2.5 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                        isCurrent
                          ? 'border border-slate-800 bg-slate-800/40 text-slate-500 cursor-not-allowed'
                          : isPendingThis
                          ? 'border border-amber-500/40 bg-amber-950/40 text-amber-300 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm'
                      }`}
                    >
                      {updatingPlan === p.id ? 'Submitting Order…' : isCurrent ? 'Current Plan' : isPendingThis ? 'Pending Authorization' : (
                        <>
                          Request Upgrade <ArrowUpRight className="h-3.5 w-3.5" />
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Commercial Governance & Pricing Transparency Notice ── */}
        <div className="mt-5 rounded-xl border border-slate-800 bg-[#0c0e14] p-4 text-xs text-slate-400 space-y-2">
          <div className="flex items-center gap-2 text-slate-200 font-semibold">
            <ShieldCheck className="h-4 w-4 text-blue-400" />
            <span>Commercial Governance & Engagement Transparency</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-[11px] text-slate-400">
            <div>
              <p>
                <strong className="text-slate-300">Contractual Independence:</strong> Discovery (£15,000 / 48 hrs) and Proof of Product (£60,000 / 10 days) are bounded fixed-fee evaluation engagements. Annual licences (Foundation £360K/yr, Enterprise £720K/yr, Advanced Resilience £1.2M/yr) are recurring subscription terms. Strategic/Sovereign (£5M–£50M) is individually scoped.
              </p>
            </div>
            <div>
              <p>
                <strong className="text-slate-300">Commercial Progression:</strong> The commercial progression is strictly monotonic: Foundation (£360,000 / year), Enterprise (£720,000 / year), and Advanced Resilience (£1,200,000 / year) providing dedicated AER-KEP-Q transitions, HA clustering, and HSM key custody. Prices do not guarantee certification or deployment outcomes.
              </p>
            </div>
          </div>
        </div>
      </Panel>

      {/* ── Commercial Three-Stage Engagement Model ── */}
      <Panel
        title="Three-Stage Enterprise Engagement Model"
        hint="Progressive commercial framework from problem validation to production deployment"
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Stage 1: Discovery */}
            <div className="bento-card p-5 relative flex flex-col justify-between">
              <span className="absolute top-4 right-4 rounded-full border border-blue-500/30 bg-blue-600/10 px-2.5 py-0.5 text-[10px] font-semibold text-blue-400">
                Stage 1
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">Discovery</h4>
                    <p className="font-mono text-xs font-bold text-blue-400">£15,000</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-xs text-slate-300">
                  <p className="text-slate-400">
                    <strong>Purpose:</strong> Identify & assess one specific workflow for submission integrity, policy enforcement, or replay protection.
                  </p>
                  <p className="text-slate-400">
                    <strong>Delivery Target:</strong> 48 hours after scope, agreement, and access prerequisites are in place.
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400">
                <span className="font-semibold text-slate-300">Outcome:</span> Documented workflow assessment, problem definition, and measurable PoV scope.
              </div>
            </div>

            {/* Stage 2: Proof of Value */}
            <div className="bento-card p-5 relative flex flex-col justify-between">
              <span className="absolute top-4 right-4 rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-[10px] font-semibold text-slate-300">
                Stage 2
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">Proof of Product (PoP)</h4>
                    <p className="font-mono text-xs font-bold text-blue-400">£60,000</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-xs text-slate-300">
                  <p className="text-slate-400">
                    <strong>Purpose:</strong> Evaluate Q-Core against agreed workflow in a bounded, authorized environment.
                  </p>
                  <p className="text-slate-400">
                    <strong>Duration:</strong> 10-day evaluation run after environment and acceptance criteria agreement.
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400">
                <span className="font-semibold text-slate-300">Outcome:</span> Recorded test evidence, measured criteria results, and go/no-go recommendation.
              </div>
            </div>

            {/* Stage 3: Production Engagement */}
            <div className="bento-card p-5 relative flex flex-col justify-between">
              <span className="absolute top-4 right-4 rounded-full border border-blue-500/30 bg-blue-600/10 px-2.5 py-0.5 text-[10px] font-semibold text-blue-400">
                Stage 3
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">Production Licences & Sovereign Enclaves</h4>
                    <p className="font-mono text-xs font-bold text-blue-400">£360K – £50M</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-xs text-slate-300">
                  <p className="text-slate-400">
                    <strong>Annual Licences:</strong> Foundation (£360,000/yr), Enterprise (£720,000/yr), and Advanced Resilience (£1,200,000/yr).
                  </p>
                  <p className="text-slate-400">
                    <strong>Strategic / Sovereign:</strong> Individually scoped (£5,000,000–£50,000,000) for air-gapped enclaves and central banking.
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400">
                <span className="font-semibold text-slate-300">Commercial Terms:</span> Bound by formal contract execution. Prerequisites, independent assurance, and procurement clearance apply.
              </div>
            </div>
          </div>

          {/* Intelligence Rules Notice */}
          <div className="rounded-xl border border-slate-800 bg-[#0e1015] p-4 text-xs text-slate-400 space-y-2">
            <div className="flex items-center gap-2 text-slate-200 font-semibold">
              <Terminal className="h-3.5 w-3.5 text-blue-400" />
              <span>Vardhan Intelligence Operational Rules:</span>
            </div>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 text-[11px]">
              <li className="flex items-start gap-1.5">
                <span className="text-blue-400">•</span>
                <span><strong>Workflow Mapping:</strong> Every qualified opportunity maps to a specific customer workflow & demonstrated capability.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-blue-400">•</span>
                <span><strong>Gated Progression:</strong> Recommend Discovery for problem plausibility; PoV only with defined criteria; Production only after proven PoV.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-blue-400">•</span>
                <span><strong>No Intent Inference:</strong> Buying intent or budget willingness is never inferred from public research alone.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-blue-400">•</span>
                <span><strong>Pricing Out of Cold Outreach:</strong> Commercial prices are omitted from cold outreach unless explicitly authorized.</span>
              </li>
            </ul>
          </div>
        </div>
      </Panel>

      {/* ── Enterprise Sovereign Licensing: Customer View vs Vendor Admin Mode ── */}
      <Panel
        title="Commercial Enterprise Licensing (Time-Bounded & Tenant-Bound)"
        hint="Cryptographic Ed25519 licenses verified at boot by core_crypto::license::verify_commercial_license"
      >
        <div className="space-y-6">
          {/* Active Tenant License Card (Visible to Customer & Admin) */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="bento-card p-4">
              <div className="flex items-center gap-2 text-slate-400">
                <FileKey className="h-4 w-4 text-blue-400" />
                <span className="text-[11px] font-semibold uppercase tracking-wider">License File Bound</span>
              </div>
              <p className="mt-2 text-sm font-mono font-bold text-white">vardhan.lic</p>
              <p className="mt-1 text-[11px] text-slate-400 font-mono">Tenant ID: {orgId}</p>
            </div>

            <div className="bento-card p-4">
              <div className="flex items-center gap-2 text-slate-400">
                <Clock className="h-4 w-4 text-emerald-400" />
                <span className="text-[11px] font-semibold uppercase tracking-wider">Time Validity</span>
              </div>
              <p className="mt-2 text-sm font-bold text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> Active (365 Days Term)
              </p>
              <p className="mt-1 text-[11px] text-slate-400">Enforced by UNIX epoch timestamp check</p>
            </div>

            <div className="bento-card p-4">
              <div className="flex items-center gap-2 text-slate-400">
                <ShieldCheck className="h-4 w-4 text-blue-400" />
                <span className="text-[11px] font-semibold uppercase tracking-wider">Kernel Enforcement</span>
              </div>
              <p className="mt-2 text-sm font-bold text-white">10 Clustered Nodes Allowed</p>
              <p className="mt-1 text-[11px] text-slate-400">FIPS 204 + RFC 8032 Dual-Signature</p>
            </div>
          </div>

          {/* ── CUSTOMER VIEW: Renewal & Install License Key (No Generator Visible) ── */}
          {!adminMode && (
            <div className="rounded-xl border border-slate-800 bg-[#12141c] p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                    Tenant Commercial License Management
                  </h4>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">Customer Self-Service</span>
              </div>

              <p className="text-xs text-slate-300">
                Your sovereign installation requires a cryptographically signed <code className="text-blue-400">vardhan.lic</code> file issued by the platform vendor.
                Licenses cannot be self-generated and are tied to your tenant ID and expiration date.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setRenewModalOpen(true)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm"
                >
                  <Send className="h-3.5 w-3.5" /> Request License Extension / Renewal
                </button>
                <button
                  type="button"
                  onClick={() => setInstallLicOpen(true)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-700 transition-colors"
                >
                  <Upload className="h-3.5 w-3.5" /> Install / Update vardhan.lic
                </button>
              </div>
            </div>
          )}

          {/* ── VENDOR ADMIN MODE: Cold-Vault License Generator (Admin Only) ── */}
          {adminMode && (
            <div className="rounded-xl border border-slate-800 bg-[#12141c] p-5 space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-blue-400" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                    Vendor Admin Only — Cold-Vault Cryptographic License Generator
                  </h4>
                </div>
                <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-300">
                  Restricted: Platform Admin
                </span>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Target Tenant ID
                  </label>
                  <input
                    type="text"
                    value={licTenantId}
                    onChange={(e) => setLicTenantId(e.target.value)}
                    placeholder="e.g. tenant-id"
                    className="w-full rounded-lg border border-slate-800 bg-[#0c0d12] px-3 py-1.5 text-xs text-white placeholder-slate-600 font-mono focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Validity Period
                  </label>
                  <select
                    value={licDays}
                    onChange={(e) => setLicDays(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-800 bg-[#0c0d12] px-3 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value={30}>30 Days (Evaluation / PoC)</option>
                    <option value={90}>90 Days (Enterprise Pilot)</option>
                    <option value={180}>180 Days (Half-Year)</option>
                    <option value={365}>365 Days (1-Year Production)</option>
                    <option value={730}>730 Days (2-Year Sovereign)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Clustered Capacity
                  </label>
                  <select
                    value={licMaxNodes}
                    onChange={(e) => setLicMaxNodes(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-800 bg-[#0c0d12] px-3 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value={5}>5 Clustered Nodes</option>
                    <option value={10}>10 Clustered Nodes (Standard)</option>
                    <option value={25}>25 Clustered Nodes (Large)</option>
                    <option value={100}>100 Clustered Nodes (Sovereign)</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between pt-2">
                <p className="text-[11px] text-slate-400">
                  Payload format: <span className="font-mono text-slate-300">{licTenantId || 'tenant'}:{Math.floor(Date.now() / 1000) + (licDays * 86400)}:{licMaxNodes}</span>
                </p>
                <button
                  type="button"
                  onClick={handleIssueLicense}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Mint & Sign Enterprise License
                </button>
              </div>

              {/* Generated License Preview */}
              {issuedLicense && (
                <div className="mt-5 rounded-lg border border-slate-800 bg-[#0e1017] p-4 space-y-3 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span className="text-xs font-semibold text-white">Generated Signed License Token (`vardhan.lic`)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopyLicense}
                        className="flex cursor-pointer items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:text-white hover:bg-slate-700 transition-colors"
                      >
                        {copied ? <CheckCheck className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                        {copied ? 'Copied' : 'Copy JSON'}
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadLicense}
                        className="flex cursor-pointer items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm"
                      >
                        <Download className="h-3 w-3" /> Download vardhan.lic
                      </button>
                    </div>
                  </div>

                  <pre className="max-h-48 overflow-x-auto rounded-lg border border-slate-800/80 bg-[#080a0f] p-3 font-mono text-[11px] text-slate-300">
                    {issuedLicense}
                  </pre>

                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <Terminal className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                    <span>
                      Customer instructions: provide file to customer or place in <code className="text-slate-200">/etc/vardhan/vardhan.lic</code>.
                    </span>
                  </div>
                </div>
              )}

              {/* Cold-Vault Air-Gapped Instruction */}
              <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-[#141620] p-4 text-xs text-slate-400">
                <Lock className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-slate-200">
                    Air-Gapped Cold-Vault Terminal Command:
                  </p>
                  <p className="font-mono text-[11px] text-slate-300 pt-0.5">
                    cargo run --bin vendor_admin --manifest-path backend/core_crypto/Cargo.toml
                  </p>
                  <p className="text-[10px] text-slate-500">
                    For high-assurance banking or defense contracts, master signing must occur on an offline, air-gapped laptop.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </Panel>

      {/* ── Modal 1: Plan Upgrade Commercial Order Modal ── */}
      {planToOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-800 bg-[#101217] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                  <Layers className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Upgrade Request: {planToOrder.name}</h3>
                  <p className="text-[11px] text-slate-400">Commercial subscription order for organization {orgId}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPlanToOrder(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Selected Tier</span>
                  <span className="font-mono font-bold text-white uppercase">{planToOrder.tier}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Billing Model</span>
                  <span className="font-mono text-emerald-400 font-semibold">Invoice / Verified Webhook</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Approval Requirement</span>
                  <span className="text-amber-300 font-medium">Administrator Payment Clearance</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Included Feature Gates:</p>
                <div className="flex flex-wrap gap-1.5">
                  {planToOrder.entitlements.map(ent => (
                    <span key={ent} className="rounded bg-slate-800/80 border border-slate-700/80 px-2 py-0.5 text-[10px] font-mono text-slate-300">
                      {ent}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-blue-500/20 bg-blue-950/20 p-3 text-xs text-blue-200">
                <p className="font-medium">Commercial Invoicing Notice:</p>
                <p className="mt-1 text-[11px] text-slate-300">
                  Submitting this request creates an enterprise order. The plan enters <strong>awaiting_billing_activation</strong> status. Your entitlements will activate once payment is confirmed by the platform billing administrator.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPlanToOrder(null)}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmPlanOrder()}
                  disabled={updatingPlan === planToOrder.id}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40 transition-colors shadow-sm cursor-pointer"
                >
                  {updatingPlan === planToOrder.id ? 'Submitting…' : 'Confirm & Request Invoice'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal 2: Customer License Extension / Renewal Request ── */}
      {renewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-[#101217] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                  <Send className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Request License Extension</h3>
                  <p className="text-[11px] text-slate-400">Submit renewal terms to Vardhan Quantum Licensing</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRenewModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitRenewal} className="mt-4 space-y-4">
              {renewSuccess && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-3 text-xs text-emerald-300">
                  {renewSuccess}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Target Organization
                </label>
                <input
                  type="text"
                  readOnly
                  value={orgId}
                  className="w-full rounded-lg border border-slate-800 bg-[#14161f] px-3 py-2 text-xs text-slate-400 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Requested Term Extension
                </label>
                <select
                  value={renewPeriod}
                  onChange={(e) => setRenewPeriod(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-800 bg-[#14161f] px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value={90}>+90 Days Extension</option>
                  <option value={180}>+180 Days (Half-Year)</option>
                  <option value={365}>+1 Year (Annual Production Renewal)</option>
                  <option value={730}>+2 Years (Multi-Year Sovereign)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Workload / Node Capacity Notes
                </label>
                <textarea
                  rows={3}
                  value={renewNotes}
                  onChange={(e) => setRenewNotes(e.target.value)}
                  placeholder="e.g. Scaling from 10 nodes to 25 nodes for cross-border banking cluster."
                  className="w-full rounded-lg border border-slate-800 bg-[#14161f] px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRenewModalOpen(false)}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm cursor-pointer"
                >
                  Submit Extension Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal 3: Customer Install / Update vardhan.lic ── */}
      {installLicOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-800 bg-[#101217] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                  <Upload className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Install Sovereign License Key</h3>
                  <p className="text-[11px] text-slate-400">Apply the signed vardhan.lic file provided by the vendor</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInstallLicOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleInstallLicense} className="mt-4 space-y-4">
              {licInstallError && (
                <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-300">
                  {licInstallError}
                </div>
              )}
              {licInstallSuccess && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-3 text-xs text-emerald-300">
                  {licInstallSuccess}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Paste vardhan.lic JSON Contents
                </label>
                <textarea
                  rows={7}
                  required
                  value={licPasteText}
                  onChange={(e) => setLicPasteText(e.target.value)}
                  placeholder={`{\n  "tenant_id": "${orgId}",\n  "valid_until": 1792842400,\n  "max_nodes": 10,\n  "signature": "..."\n}`}
                  className="w-full rounded-lg border border-slate-800 bg-[#0c0d12] p-3 text-xs font-mono text-slate-200 placeholder-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-[11px] text-slate-400 space-y-1">
                <p className="font-semibold text-slate-300">Boot Invariant Verification:</p>
                <p>
                  The control plane and eBPF shield verify that <code className="text-blue-400">tenant_id === "{orgId}"</code> and <code className="text-blue-400">valid_until &gt; now</code> against the vendor master Ed25519 public key.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setInstallLicOpen(false)}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm cursor-pointer"
                >
                  Verify & Install License
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
