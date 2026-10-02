/**
 * Dashboard server config — env-driven, fail-closed on prod secrets.
 * No secrets are ever exposed to the browser; the browser only ever sees
 * the session cookie value (docs/20 §2).
 */

export interface DashboardConfig {
  port: number;
  host: string;
  sessionSecret: string;
  password: string;
  sessionTtlMs: number;
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
  gateReportsDir: string;
  secureCookies: boolean;
  insecureDev: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEV_SESSION_SECRET = 'zk-dashboard-dev-session-secret-0000000000000000000000';
const DEV_PASSWORD = 'zk-dashboard-dev-password';

export function parseConfig(env: NodeJS.ProcessEnv): DashboardConfig {
  const insecureDev = env.ZK_DASHBOARD_INSECURE_DEV === '1' || env.NODE_ENV === 'test';
  const sessionSecret = env.ZK_DASHBOARD_SESSION_SECRET ?? (insecureDev ? DEV_SESSION_SECRET : undefined);
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new ConfigError('ZK_DASHBOARD_SESSION_SECRET required (>= 32 chars)');
  }
  const password = env.ZK_DASHBOARD_PASSWORD ?? (insecureDev ? DEV_PASSWORD : undefined);
  if (!password) {
    throw new ConfigError('ZK_DASHBOARD_PASSWORD required (or set ZK_DASHBOARD_INSECURE_DEV=1)');
  }
  return {
    port: Number(env.ZK_DASHBOARD_PORT ?? '3000'),
    host: env.ZK_DASHBOARD_HOST ?? '127.0.0.1',
    sessionSecret,
    password,
    sessionTtlMs: Number(env.ZK_DASHBOARD_SESSION_TTL_MS ?? String(8 * 60 * 60 * 1000)),
    apiUrl: env.ZK_DASHBOARD_API_URL ?? '',
    apiKey: env.ZK_DASHBOARD_API_KEY ?? '',
    apiSecret: env.ZK_DASHBOARD_API_SECRET ?? '',
    gateReportsDir: env.ZK_DASHBOARD_GATE_REPORTS ?? 'data/gatekeeper',
    secureCookies: env.ZK_DASHBOARD_SECURE_COOKIES === '1' || env.ZK_DASHBOARD_PORT === '443',
    insecureDev,
  };
}
