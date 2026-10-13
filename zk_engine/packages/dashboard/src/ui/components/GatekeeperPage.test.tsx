import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { GatekeeperPage } from './GatekeeperPage.js';
import type { GateReportDetail, GateOverview } from '../../shared/types.js';

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const route = routes[String(url).split('?')[0] ?? ''];
    if (!route) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => JSON.stringify(route) };
  }));
}

const overview: GateOverview = {
  count: 1,
  byCircuit: {},
  latest: {
    file: '2026-08-09-registered-pass.json',
    verified: true,
    circuitId: 'poseidon-preimage@1',
    vkHash: 'vk-abc',
    artifactHash: 'art-1234567890abcdef12',
    publicInputHash: null,
    keyId: 'key-1',
    reasonCount: 0,
    failedChecks: [],
  },
  reports: [
    {
      file: '2026-08-09-registered-pass.json',
      verified: true,
      circuitId: 'poseidon-preimage@1',
      vkHash: 'vk-abc',
      artifactHash: 'art-1234567890abcdef12',
      publicInputHash: null,
      keyId: 'key-1',
      reasonCount: 0,
      failedChecks: [],
    },
    {
      file: '2026-08-08-registered-blocked.json',
      verified: false,
      circuitId: 'poseidon-preimage@1',
      vkHash: 'vk-abc',
      artifactHash: 'art-dead',
      publicInputHash: null,
      keyId: 'key-2',
      reasonCount: 2,
      failedChecks: ['metadata.author', 'metadata.hash'],
    },
  ],
};

const detail: GateReportDetail = {
  ...overview.reports[1]!,
  reasons: ['author mismatch', 'artifact hash mismatch'],
  checks: [
    { name: 'artifact.hash', ok: false, detail: 'hash differs' },
    { name: 'metadata.author', ok: false, detail: 'author not in allowlist' },
  ],
  onChain: null,
};

describe('GatekeeperPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists stored reports with result badges', async () => {
    mockFetch({ '/api/gatekeeper': overview });
    render(<GatekeeperPage onRoute={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('report-list')).toBeTruthy());
    const rows = Array.from(document.querySelectorAll('[data-testid="report-list"] tbody tr'));
    expect(rows).toHaveLength(2);
    expect(screen.getByText(/art-1234567890abcd/)).toBeTruthy();
    expect(screen.getByText(/metadata\.author/)).toBeTruthy();
    const blocked = screen.getAllByText('blocked');
    expect(blocked.length).toBeGreaterThan(0);
  });

  it('renders empty state when no reports', async () => {
    mockFetch({ '/api/gatekeeper': { ...overview, count: 0, latest: null, reports: [] } });
    render(<GatekeeperPage onRoute={() => {}} />);
    await waitFor(() => expect(screen.getByText('no gate reports stored')).toBeTruthy());
  });

  it('shows detail with reasons for a blocked report', async () => {
    mockFetch({
      '/api/gatekeeper': overview,
      '/api/gatekeeper/report/2026-08-08-registered-blocked.json': detail,
    });
    render(<GatekeeperPage reportFile="2026-08-08-registered-blocked.json" onRoute={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('report-checks')).toBeTruthy());
    expect(screen.getByText('← all reports')).toBeTruthy();
    expect(screen.getByText(/artifact hash mismatch/)).toBeTruthy();
    const rows = Array.from(document.querySelectorAll('[data-testid="report-checks"] tbody tr'));
    expect(rows).toHaveLength(2);
  });
});