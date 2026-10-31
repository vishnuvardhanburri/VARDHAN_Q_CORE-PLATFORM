import React, { useState } from 'react';
import {
  Building2,
  UserPlus,
  KeyRound,
  ShieldCheck,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Sparkles,
  Layers,
  Lock,
  UserCheck,
  CheckCheck,
  Terminal,
  FileKey,
  X,
  Eye,
  EyeOff
} from 'lucide-react';
import { useAuth, getProvisionedCustomers, saveProvisionedCustomer, type CustomerAccount } from '../auth/AuthContext';
import { createOrganization, setSubscription, mintLicense } from '../services/qcore';
import { Panel, Empty } from './shared';

export default function CustomersView(): React.ReactElement {
  const { user, selectOrg, signIn } = useAuth();
  const [customers, setCustomers] = useState<CustomerAccount[]>(() => getProvisionedCustomers());

  // Form State
  const [orgName, setOrgName] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [planId, setPlanId] = useState<string>('enterprise');
  const [licenseDays, setLicenseDays] = useState<number>(365);
  const [maxNodes, setMaxNodes] = useState<number>(10);
  const [showPassword, setShowPassword] = useState<boolean>(false);

  const [provisioning, setProvisioning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Success Modal
  const [activePack, setActivePack] = useState<{
    customer: CustomerAccount;
    initialPassword?: string;
    licenseJson: string;
  } | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Auto-generate secure password via CSPRNG (Item P1-3)
  const generateRandomPassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
    const randVals = new Uint8Array(16);
    crypto.getRandomValues(randVals);
    let res = '';
    for (let i = 0; i < 16; i++) {
      res += chars[randVals[i] % chars.length];
    }
    setPassword(res);
  };

  const handleProvisionCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim() || !username.trim() || !password.trim()) {
      setError('Organization name, customer username, and initial password are required.');
      return;
    }

    setProvisioning(true);
    setError(null);

    try {
      // 1. Create Organization in Control Plane
      const orgRes = await createOrganization(orgName.trim());
      const org = 'organization' in orgRes ? orgRes.organization : orgRes;

      // 2. Assign Plan Package
      await setSubscription(org.id, planId).catch(() => null);

      // 3. Mint Ed25519 Cold-Vault License via Control Plane
      const licenseRes = await mintLicense({
        tenant_id: org.id,
        valid_days: licenseDays,
        max_nodes: maxNodes,
        package_tier: planId,
      });

      // 4. Save Customer Account (Plaintext passwords NEVER stored in storage — Item 8)
      const newCustomer: CustomerAccount = {
        id: `cust-${Date.now().toString().slice(-6)}`,
        username: username.trim(),
        orgId: org.id,
        orgName: orgName.trim(),
        planId: planId,
        createdAtMs: Date.now(),
      };

      saveProvisionedCustomer(newCustomer);
      setCustomers(getProvisionedCustomers());

      // 5. Open Onboarding Pack
      setActivePack({
        customer: newCustomer,
        initialPassword: password.trim(),
        licenseJson: JSON.stringify(licenseRes, null, 2),
      });

      // Reset form
      setOrgName('');
      setUsername('');
      setPassword('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Customer provisioning failed.');
    } finally {
      setProvisioning(false);
    }
  };

  const copyCredentials = () => {
    if (!activePack) return;
    const portalUrl = typeof window !== 'undefined' ? window.location.origin : 'https://qcore.vardhan.local';
    const text = `VARDHAN Q-CORE ENTERPRISE — CUSTOMER ONBOARDING PACK
Portal URL: ${portalUrl}
Organization: ${activePack.customer.orgName} (ID: ${activePack.customer.orgId})
Username: ${activePack.customer.username}
Initial One-Time Password: ${activePack.initialPassword || 'Configured upon first sign-in'}
Package: ${activePack.customer.planId}

LICENSE FILE (vardhan.lic):
${activePack.licenseJson}`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadHandoverKit = () => {
    if (!activePack) return;
    const portalUrl = typeof window !== 'undefined' ? window.location.origin : 'https://qcore.vardhan.local';
    const data = {
      portal_url: portalUrl,
      customer: activePack.customer,
      license: JSON.parse(activePack.licenseJson),
      generated_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `onboarding-kit-${activePack.customer.username}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleTestLoginAsCustomer = async (cust: CustomerAccount) => {
    if (!cust.password) return;
    try {
      await signIn(cust.username, cust.password, 'customer');
      selectOrg(cust.orgId);
    } catch (err) {
      alert(`Customer login failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="space-y-7">
      {/* ── Top Header Banner ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-[#12141c] p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <UserPlus className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-tight">Customer Provisioning Center</h2>
              <span className="rounded bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 text-[10px] font-bold text-blue-300 uppercase">
                Admin Exclusive
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              Provision isolated enterprise tenants, assign commercial packages, mint cryptographic licenses, and auto-generate customer portal credentials.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-slate-800 bg-[#161824] px-3.5 py-2 text-center">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Active Customers</p>
            <p className="text-lg font-bold text-white">{customers.length}</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#161824] px-3.5 py-2 text-center">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Dual-Signatures</p>
            <p className="text-lg font-bold text-emerald-400">FIPS 204</p>
          </div>
        </div>
      </div>

      {/* ── Automated Provisioning Form ── */}
      <Panel
        title="Provision New Customer Organization & SaaS Package"
        hint="Automatically executes organization creation, plan subscription binding, and cold-vault license issuance"
      >
        <form onSubmit={handleProvisionCustomer} className="space-y-5">
          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {/* Left: Organization & Credentials */}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Customer Organization / Company Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Enterprise Global Bank or Sovereign Tenant"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-[#14161f] px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Customer Admin Username
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ops_director or tenant_admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-[#14161f] px-3 py-2 text-xs text-slate-100 placeholder-slate-500 font-mono focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-300">
                    Customer Initial Password
                  </label>
                  <button
                    type="button"
                    onClick={generateRandomPassword}
                    className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
                  >
                    + Auto-Generate
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Enter or generate strong password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-[#14161f] px-3 py-2 text-xs text-slate-100 placeholder-slate-500 font-mono pr-10 focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Package & Licensing Options */}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Assigned SaaS Package / Plan Tier
                </label>
                <select
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-[#14161f] px-3 py-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                >
                  <option value="qcore_architecture_evaluation">Architecture & Security Evaluation (£15,000 fixed fee)</option>
                  <option value="qcore_proof_of_value">Bounded Proof of Value (£65,000 fixed fee)</option>
                  <option value="foundation">Foundation (£360,000 / year)</option>
                  <option value="enterprise">Enterprise (£720,000 / year)</option>
                  <option value="advanced_resilience">Advanced Resilience (£1,200,000 / year)</option>
                  <option value="strategic">Strategic / Sovereign (£5M – £50M scoped)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Cryptographic License Validity Duration
                </label>
                <select
                  value={licenseDays}
                  onChange={(e) => setLicenseDays(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-800 bg-[#14161f] px-3 py-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                >
                  <option value={30}>30 Days (Evaluation / PoC)</option>
                  <option value={90}>90 Days (Enterprise Pilot)</option>
                  <option value={180}>180 Days (Half-Year)</option>
                  <option value={365}>365 Days (1-Year Annual Enterprise)</option>
                  <option value={730}>730 Days (2-Year Sovereign Contract)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Clustered Node Quota
                </label>
                <select
                  value={maxNodes}
                  onChange={(e) => setMaxNodes(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-800 bg-[#14161f] px-3 py-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                >
                  <option value={5}>5 Clustered Nodes</option>
                  <option value={10}>10 Clustered Nodes (Standard)</option>
                  <option value={25}>25 Clustered Nodes (Large)</option>
                  <option value={100}>100 Clustered Nodes (Sovereign)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-800/80 pt-4">
            <p className="text-[11px] text-slate-400">
              Generates organization UUID, sets subscription state, mints <code className="text-blue-400">vardhan.lic</code>, and produces customer credentials.
            </p>
            <button
              type="submit"
              disabled={provisioning}
              className="flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-40"
            >
              <Sparkles className="h-4 w-4" />
              {provisioning ? 'Provisioning Tenant…' : 'Provision Customer & Generate Login Pack'}
            </button>
          </div>
        </form>
      </Panel>

      {/* ── Directory of Provisioned Customers ── */}
      <Panel
        title="Directory of Active Customer Tenants"
        hint="Customers provisioned by the platform administrator with custom credentials and scoped access"
      >
        <div className="overflow-x-auto">
          {customers.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              No customer tenants provisioned yet. Use the form above to provision your first customer organization.
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3">Customer Organization</th>
                  <th className="px-4 py-3">Customer Username</th>
                  <th className="px-4 py-3">Package Tier</th>
                  <th className="px-4 py-3">Tenant ID</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-slate-200">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 font-sans font-semibold text-white flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-blue-400 shrink-0" />
                      <span>{c.orgName}</span>
                    </td>
                  <td className="px-4 py-3 text-blue-400">{c.username}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] uppercase font-bold text-slate-300">
                      {c.planId}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-[11px]">{c.orgId}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => void handleTestLoginAsCustomer(c)}
                      className="cursor-pointer rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold text-blue-300 hover:bg-blue-500/20 transition-colors"
                    >
                      Log in as Customer →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      </Panel>

      {/* ── Modal: Customer Onboarding & Login Pack ── */}
      {activePack && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="relative w-full max-w-xl rounded-2xl border border-slate-800 bg-[#101217] p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Customer Successfully Provisioned</h3>
                  <p className="text-[11px] text-slate-400">Generated onboarding credentials and cryptographic license</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActivePack(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Credentials Card */}
            <div className="rounded-xl border border-slate-800 bg-[#141622] p-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Customer Organization:</span>
                <span className="font-semibold text-white">{activePack.customer.orgName}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Organization ID:</span>
                <span className="font-mono text-blue-400">{activePack.customer.orgId}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Portal Login URL:</span>
                <span className="font-mono text-emerald-400">{typeof window !== 'undefined' ? window.location.origin : 'https://qcore.vardhan.local'}</span>
              </div>
              <div className="flex items-center justify-between text-xs border-t border-slate-800/80 pt-2">
                <span className="text-slate-400">Username:</span>
                <span className="font-mono font-bold text-white">{activePack.customer.username}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Initial Password:</span>
                <span className="font-mono font-bold text-blue-300 bg-blue-950/40 px-2 py-0.5 rounded border border-blue-500/30">{activePack.initialPassword || 'Configured upon first sign-in'}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Package Tier:</span>
                <span className="font-mono font-bold text-blue-400 uppercase">{activePack.customer.planId}</span>
              </div>
            </div>

            {/* License Preview */}
            <div>
              <p className="text-[11px] font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <FileKey className="h-3.5 w-3.5 text-blue-400" />
                Signed Enterprise License Token (vardhan.lic):
              </p>
              <pre className="max-h-36 overflow-x-auto rounded-lg border border-slate-800/80 bg-[#080a0f] p-3 font-mono text-[10px] text-slate-300">
                {activePack.licenseJson}
              </pre>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copyCredentials}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-700 transition-colors"
                >
                  {copied ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied to Clipboard' : 'Copy Credentials'}
                </button>
                <button
                  type="button"
                  onClick={downloadHandoverKit}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-700 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" /> Download Handover Kit
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  void handleTestLoginAsCustomer(activePack.customer);
                  setActivePack(null);
                }}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shadow-sm"
              >
                Log in as this Customer →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
