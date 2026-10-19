import React, { useEffect, useState } from 'react';

/** Shared fetch-state hook for org-scoped console queries. */
export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useOrgQuery<T>(orgId: string | null, fetcher: (org: string) => Promise<T>): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!orgId) {
      setData(null);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError(null);
    fetcher(orgId)
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setData(null);
          setLoading(false);
          setError(err instanceof Error ? err.message : 'Request failed.');
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, nonce]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}

export function formatTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms <= 0) return '—';
  try {
    return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  } catch {
    return String(ms);
  }
}

export function bandColor(band: string | null | undefined): string {
  const b = (band ?? '').toUpperCase();
  if (b.includes('CRITICAL')) return 'text-rose-400 border border-rose-500/25 bg-rose-500/10 font-semibold';
  if (b.includes('HIGH') || b.includes('MEDIUM') || b.includes('MODERATE')) return 'text-blue-400 border border-blue-500/25 bg-blue-500/10 font-semibold';
  if (b.includes('LOW')) return 'text-emerald-400 border border-emerald-500/25 bg-emerald-500/10 font-semibold';
  return 'text-slate-300 border border-slate-700/60 bg-slate-800/40 font-medium';
}

export function statusColor(status: string | null | undefined): string {
  const s = (status ?? '').toLowerCase();
  if (s.includes('sealed') || s.includes('verified') || s.includes('resolved') || s.includes('in_sync') || s.includes('attached') || s.includes('operational') || s.includes('populated') || s.includes('healthy') || s.includes('acknowledged') || s.includes('active')) {
    return 'text-emerald-400 border border-emerald-500/25 bg-emerald-500/10 font-semibold';
  }
  if (s.includes('reject') || s.includes('revok') || s.includes('drift') || s.includes('critical') || s.includes('fail') || s.includes('denied')) {
    return 'text-rose-400 border border-rose-500/25 bg-rose-500/10 font-semibold';
  }
  if (s.includes('pending') || s.includes('rotat') || s.includes('open') || s.includes('degrad') || s.includes('observ') || s.includes('stale') || s.includes('expired')) {
    return 'text-blue-400 border border-blue-500/25 bg-blue-500/10 font-semibold';
  }
  return 'text-slate-300 border border-slate-700/60 bg-slate-800/40 font-medium';
}

export function Panel({ title, hint, right, children }: { title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="rounded-xl border border-slate-800 bg-[#12141b] p-6 shadow-sm">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-white flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            {title}
          </h2>
          {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Empty({ message }: { message: string }): React.ReactElement {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-slate-900/30 p-8 text-center text-xs text-slate-400">
      <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-slate-800/60 text-slate-500">
        ∅
      </div>
      {message}
    </div>
  );
}

export function QueryStateView({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }): React.ReactElement | null {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 p-8 text-xs text-blue-400">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        Syncing cryptographic state…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 text-xs text-rose-300 backdrop-blur-md">
        <p className="font-medium">Request failed: {error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 cursor-pointer rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 font-semibold text-rose-200 transition-all hover:bg-rose-500/20"
        >
          Retry Connection
        </button>
      </div>
    );
  }
  return null;
}
