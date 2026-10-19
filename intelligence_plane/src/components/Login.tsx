import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Building2,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Shield,
  ShieldCheck,
  TriangleAlert,
  User,
  Wifi,
  WifiOff
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { API_BASE, ApiError, platformHealth } from '../services/qcore';

export default function Login(): React.ReactElement {
  const { signIn, confirmMfa, cancelMfa, mfaChallenge, authBusy, authError, clearAuthError } = useAuth();
  
  const [portalMode, setPortalMode] = useState<'customer' | 'admin'>('admin');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [planeState, setPlaneState] = useState<'checking' | 'reachable' | 'unreachable'>('checking');

  useEffect(() => {
    clearAuthError();
    let cancelled = false;
    platformHealth()
      .then(() => {
        if (!cancelled) setPlaneState('reachable');
      })
      .catch(() => {
        if (!cancelled) setPlaneState('unreachable');
      });
    return () => {
      cancelled = true;
    };
  }, [clearAuthError]);

  const handleModeSwitch = (mode: 'customer' | 'admin') => {
    setPortalMode(mode);
    setLocalError(null);
    clearAuthError();
    if (mode === 'admin') {
      setUsername('admin');
      setPassword('');
    } else {
      setUsername('');
      setPassword('');
    }
  };

  async function handleSignIn(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLocalError(null);
    if (username.trim().length === 0 || password.length === 0) {
      setLocalError('Username and password are required.');
      return;
    }
    try {
      await signIn(username, password, portalMode);
    } catch (err) {
      if (err instanceof Error) {
        setLocalError(err.message);
      } else if (!(err instanceof ApiError)) {
        setLocalError('Sign-in failed. Please verify credentials.');
      }
    }
  }

  async function handleMfa(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLocalError(null);
    if (mfaCode.trim().length === 0) {
      setLocalError('Enter the MFA code from your authenticator.');
      return;
    }
    try {
      await confirmMfa(mfaCode);
    } catch (err) {
      if (!(err instanceof ApiError)) setLocalError('MFA verification failed.');
    }
  }

  const busy = authBusy;
  const error = localError ?? authError;

  return (
    <div className="flex min-h-screen items-center justify-center p-4 text-slate-200 antialiased bg-[#0c0d12]">
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative z-10 w-full max-w-md rounded-2xl border border-slate-800 bg-[#101217] p-8 shadow-2xl"
      >
        {/* Brand & System Status */}
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-800 bg-[#161822] text-white shadow-sm">
            <ShieldCheck className="h-6 w-6 text-blue-500" />
          </div>
          <h1 className="text-center text-lg font-bold tracking-tight text-white">
            Vardhan Q-Core Enterprise
          </h1>
          <p className="mt-0.5 text-xs text-slate-400 text-center">
            Post-Quantum Cryptographic Verification Infrastructure
          </p>
          <div
            className={`mt-2.5 flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              planeState === 'reachable'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : planeState === 'unreachable'
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                  : 'border-slate-800 bg-slate-900 text-slate-400'
            }`}
            title={`Control plane: ${API_BASE}`}
          >
            {planeState === 'reachable' ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {planeState === 'checking'
              ? 'Probing control plane…'
              : planeState === 'reachable'
                ? `Operational • ${API_BASE}`
                : `Unreachable • ${API_BASE}`}
          </div>
        </div>

        {/* ── Dual Login Portal Tabs (Strict 2-Color Palette: Charcoal + Cobalt) ── */}
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-[#0c0d12] p-1">
          <button
            type="button"
            onClick={() => handleModeSwitch('customer')}
            className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all cursor-pointer ${
              portalMode === 'customer'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>Customer Portal</span>
          </button>

          <button
            type="button"
            onClick={() => handleModeSwitch('admin')}
            className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all cursor-pointer ${
              portalMode === 'admin'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
            }`}
          >
            <Shield className="h-3.5 w-3.5" />
            <span>Platform Admin</span>
          </button>
        </div>

        {/* Portal Information Description */}
        <div className="mb-5 rounded-lg border border-slate-800 bg-[#14161f] p-3 text-xs">
          {portalMode === 'customer' ? (
            <div className="flex items-start gap-2.5">
              <Building2 className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-slate-200">Customer Tenant Ingress</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Single-tenant isolated access to cryptographic verification, API keys, webhooks, and billing invoices.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2.5">
              <Shield className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-slate-200">Platform Administrator Ingress</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Root administrative control: Provision new customer organizations, mint cold-vault licenses, and manage HA cluster.
                </p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-300">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!mfaChallenge ? (
          <form onSubmit={handleSignIn} className="space-y-4">
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-slate-400">
                <User className="h-3 w-3 text-slate-400" />
                {portalMode === 'customer' ? 'Customer Operator Username' : 'Administrator Username'}
              </span>
              <input
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                disabled={busy}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={portalMode === 'customer' ? 'e.g. operator_name' : 'admin'}
                className="w-full rounded-lg border border-slate-800 bg-[#0c0d12] px-3.5 py-2.5 text-xs text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                <KeyRound className="h-3 w-3 text-slate-400" /> Password
              </span>
              <span className="relative block">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-800 bg-[#0c0d12] px-3.5 py-2.5 pr-11 text-xs text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1.5 text-slate-500 hover:text-slate-300 disabled:opacity-50"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
            </label>

            <button
              type="submit"
              disabled={busy}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 py-2.5 text-xs font-semibold text-white transition-all disabled:opacity-50 shadow-sm"
            >
              <Fingerprint className="h-4 w-4" />
              {busy
                ? 'Opening Session…'
                : portalMode === 'customer'
                  ? 'Sign In to Customer Workspace'
                  : 'Authenticate Admin Console'}
            </button>

            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
              <span>FIPS 204 ML-DSA-87 Ready</span>
              <span>
                {portalMode === 'customer' ? 'Isolated Single Tenant' : 'Full Cluster Authority'}
              </span>
            </div>
          </form>
        ) : (
          <form onSubmit={handleMfa} className="space-y-4">
            <div className="rounded-lg border border-blue-500/30 bg-blue-950/20 p-3 text-xs text-blue-300">
              Multi-factor challenge issued. Enter the code from your authenticator.
            </div>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-400">MFA code</span>
              <input
                type="text"
                inputMode="numeric"
                value={mfaCode}
                disabled={busy}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="123456"
                className="w-full rounded-lg border border-slate-800 bg-[#0c0d12] px-4 py-3 text-center text-lg tracking-[0.4em] text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full cursor-pointer rounded-lg bg-blue-600 py-2.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 shadow-sm"
            >
              {busy ? 'Verifying…' : 'Verify MFA Code'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={cancelMfa}
              className="w-full cursor-pointer rounded-lg border border-slate-800 py-2 text-xs text-slate-400 hover:text-white disabled:opacity-50"
            >
              Back to sign in
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
