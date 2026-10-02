import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { OverviewPage } from './OverviewPage.js';
import type { CircuitSummary, GateOverview, RegistryInfo } from '../../shared/types.js';

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const route = routes[String(url).split('?')[0] ?? ''];
    if (!route) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => JSON.stringify(route) };
  }));
}

const registry: RegistryInfo = {
  proxy: 'http://contract-registry.svc:8545',
  schemaVersion: '1',
  totalProofs: '42',
  paused: false,
  circuits: {},
};

const circuits: CircuitSummary[] = [
  {
    circuitId: 'poseidon-preimage@1',
    version: '1',
    label: 'Poseidon preimage',
    nPublic: 4,
    artifactsReady: true,
    registry: { active: true, verifier: '0x00', vkHash: 'vk' },
  },
];

const gate: GateOverview = {
  count: 3,
  latest: {
    file: '2026-08-09-registered-pass.json',
    verified: true,
    circuitId: 'poseidon-preimage@1',
    vkHash: 'vk',
    artifactHash: 'art',
    publicInputHash: null,
    keyId: null,
    reasonCount: 0,
    failedChecks: [],
  },
  reports: [],
  byCircuit: {},
};

describe('OverviewPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders registry status, circuit count, and latest gate result', async () => {
    mockFetch({ '/api/registry': registry, '/api/circuits': { circuits }, '/api/gatekeeper': gate });
    render(<OverviewPage onRoute={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('registry-status').textContent).toBe('active'));
    expect(screen.getByTestId('circuit-count').textContent).toBe('1');
    expect(screen.getByTestId('gate-count').textContent).toBe('3');
    expect(screen.getByText(/verified for poseidon-preimage@1 — 0 reason/)).toBeTruthy();
  });

  it('shows registry paused state', async () => {
    mockFetch({ '/api/registry': { ...registry, paused: true }, '/api/circuits': { circuits }, '/api/gatekeeper': gate });
    render(<OverviewPage onRoute={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('registry-status').textContent).toBe('paused'));
  });
});