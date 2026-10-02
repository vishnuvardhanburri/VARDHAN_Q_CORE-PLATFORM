import { useState } from 'react';
import { fetchJson, ApiError } from '../api.js';
import type { SessionInfo } from '../App.js';

export function Login({ onSuccess }: { onSuccess: (session: SessionInfo) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await fetchJson<SessionInfo>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      onSuccess(session);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail : err instanceof Error ? err.message : 'login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit} data-testid="login-form">
        <h1>ZK Proof Engine</h1>
        <p className="muted">Operator login — access to read-only observability.</p>
        <input
          type="password"
          autoFocus
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="password"
          aria-label="password"
        />
        <div style={{ height: 12 }} />
        {error && <div className="error" data-testid="login-error">{error}</div>}
        <button type="submit" disabled={busy || password.length === 0}>
          {busy ? 'signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}