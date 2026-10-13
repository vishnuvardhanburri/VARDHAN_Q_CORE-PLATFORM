import { useState, useEffect } from 'react';
import { getRecentReceipts, getNodeStatus, getMetrics } from '../services/api';

export function useQuantumMetrics() {
  const [metrics, setMetrics] = useState({
    receiptsGenerated: 0,
    quorumStatus: 'UNKNOWN',
    zkProofs: 0,
    nodeCount: 0,
    packetsDropped: 0,
    activeSessions: 0,
  });

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const [ledger, raft, telemetry] = await Promise.allSettled([
          getRecentReceipts(),
          getNodeStatus(),
          getMetrics()
        ]);
        
        let newMetrics = { ...metrics };
        if (ledger.status === 'fulfilled' && ledger.value) {
          newMetrics.receiptsGenerated = ledger.value.entry_count_estimate || 0;
        }
        if (raft.status === 'fulfilled' && raft.value) {
          newMetrics.quorumStatus = raft.value.state || 'ONLINE';
          newMetrics.nodeCount = raft.value.cluster_size || 3;
        }
        if (telemetry.status === 'fulfilled' && telemetry.value) {
          newMetrics.packetsDropped = telemetry.value.rejected_frames || 0;
          newMetrics.activeSessions = telemetry.value.active_sessions || 0;
        }
        setMetrics(newMetrics);
      } catch (err) {
        console.error("Failed to fetch metrics", err);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  return metrics;
}
