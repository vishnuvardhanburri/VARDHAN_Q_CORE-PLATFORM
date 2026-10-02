/**
 * Dashboard server entrypoint — wires config + live API port + gate store,
 * listens, and shuts down cleanly on SIGINT/SIGTERM.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildDashboardServer } from './dashboard.js';
import { parseConfig, ConfigError } from './config.js';
import { ApiClientDashboardPort } from './apiPort.js';
import { FsGateReportStore } from './gateStore.js';

/** Locate the built web bundle regardless of the run layout (dev vs dist). */
function findWebDir(dir: string): string | undefined {
  const candidates = [
    resolve(dir, '..', '..', '..', 'web'),
    resolve(dir, '..', '..', 'web'),
    resolve(dir, '..', 'dist', 'web'),
  ];
  return candidates.find((d) => existsSync(join(d, 'index.html')));
}

async function main(): Promise<void> {
  let config;
  try {
    config = parseConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`dashboard: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  const webDir = findWebDir(import.meta.dirname);
  const app = buildDashboardServer({
    config,
    api: config.apiUrl && config.apiKey && config.apiSecret
      ? new ApiClientDashboardPort({ baseUrl: config.apiUrl, clientId: config.apiKey, secret: config.apiSecret })
      : null,
    gateReports: new FsGateReportStore(config.gateReportsDir),
    ...(webDir ? { webDir } : {}),
  });

  app.listen({ port: config.port, host: config.host }, (err) => {
    if (err) {
      console.error(`[dashboard] listen failed: ${err.message}`);
      process.exit(1);
    }
    console.log(`[dashboard] listening on http://${config.host}:${config.port}`);
  });

  const stop = () =>
    app.close().finally(() => {
      process.exit(0);
    });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();