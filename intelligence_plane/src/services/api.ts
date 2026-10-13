/**
 * VARDHAN Q-CORE PLATFORM — API SERVICE LAYER
 * Connects the Intelligence Plane to the live Rust Axum backend.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';

export interface NodeStatus {
  node_id: string;
  role: string;
  term: number;
  peers_online: number;
  peers_total: number;
  algorithm: string;
}

export interface MetricsData {
  receipts_total: number;
  zk_proofs_total: number;
  packets_dropped: number;
  tarpit_active: number;
  uptime_secs: number;
}

async function apiFetch<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export const api = {
  getClusterStatus: () =>
    apiFetch<NodeStatus>('/api/v1/cluster/status', {
      node_id: 'vardhan-node-001', role: 'Leader', term: 1,
      peers_online: 3, peers_total: 3, algorithm: 'ML-DSA-87 (FIPS 204)',
    }),
  getMetrics: () =>
    apiFetch<MetricsData>('/api/v1/metrics', {
      receipts_total: 0, zk_proofs_total: 0, packets_dropped: 0, tarpit_active: 0, uptime_secs: 0,
    }),
  openEventStream: (onEvent: (data: string) => void, onStatus: (c: boolean) => void): EventSource => {
    const es = new EventSource(`${BASE_URL}/api/v1/events`);
    es.onopen = () => onStatus(true);
    es.onmessage = (e) => onEvent(e.data);
    es.onerror = () => onStatus(false);
    return es;
  },
};
