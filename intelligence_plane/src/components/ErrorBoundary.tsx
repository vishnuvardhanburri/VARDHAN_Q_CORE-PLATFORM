import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RefreshCw, LogOut } from 'lucide-react';
import { clearToken } from '../services/qcore';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Uncaught Console UI Error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  private handleClearSession = (): void => {
    clearToken();
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    window.location.href = '/';
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center p-6 text-slate-100 antialiased">
          <div className="relative w-full max-w-xl rounded-2xl border border-rose-500/30 bg-[#0d1117] p-8 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-xl">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-rose-500/40 bg-rose-950/40 text-rose-400">
                <AlertOctagon className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">Console Runtime Boundary Caught</h1>
                <p className="text-xs text-rose-300">An unexpected execution fault occurred in the interface</p>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-white/[0.08] bg-black/60 p-4 font-mono text-xs">
              <p className="font-semibold text-rose-400">
                {this.state.error?.name}: {this.state.error?.message}
              </p>
              {this.state.error?.stack && (
                <pre className="max-h-48 overflow-y-auto text-[11px] text-slate-400 whitespace-pre-wrap leading-relaxed">
                  {this.state.error.stack}
                </pre>
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 shadow-sm transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Retry View
              </button>

              <button
                type="button"
                onClick={this.handleClearSession}
                className="flex cursor-pointer items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-900/40 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Reset Session & Return to Login
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
