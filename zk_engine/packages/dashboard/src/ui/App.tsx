import { useEffect, useState } from 'react';
import { fetchJson } from './api.js';
import { Login } from './components/Login.js';
import { Layout } from './components/Layout.js';
import type { DashboardRoute } from './router.js';
import { navigate, parseHash } from './router.js';

export interface SessionInfo {
  ok: boolean;
  expiresMs: number;
}

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [checked, setChecked] = useState(false);
  const [route, setRoute] = useState<DashboardRoute>(() => parseHash(location.hash));

  useEffect(() => {
    let alive = true;
    fetchJson<SessionInfo>('/api/auth/whoami')
      .then((s) => alive && setSession(s))
      .catch(() => alive && setSession(null))
      .finally(() => alive && setChecked(true));
    const onHash = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => {
      alive = false;
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  if (!checked) {
    return (
      <div className="boot" data-testid="boot">
        loading…
      </div>
    );
  }

  if (!session) {
    return (
      <Login
        onSuccess={(s) => {
          setSession(s);
          navigate('/overview');
        }}
      />
    );
  }

  return <Layout session={session} route={route} onRoute={setRoute} onLogout={() => setSession(null)} />;
}