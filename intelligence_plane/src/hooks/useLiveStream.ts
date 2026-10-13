import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../services/api';

export interface QuantumEvent {
  event_id: string;
  message?: string;
  [key: string]: any;
}

export function useLiveStream() {
  const [events, setEvents] = useState<QuantumEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [nodeStatus, setNodeStatus] = useState<any>(null);
  const [receipts, setReceipts] = useState<any[]>([]);

  useEffect(() => {
    const url = `${API_BASE_URL}/api/v1/events`;
    let eventSource: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      eventSource = new EventSource(url);

      eventSource.onopen = () => {
        setIsConnected(true);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setEvents((prev) => {
            const newEvents = [...prev, data];
            return newEvents.slice(-50); // Keep last 50
          });
        } catch (e) {
          console.error("Failed to parse SSE event", e);
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);
        if (eventSource) {
          eventSource.close();
        }
        reconnectTimeout = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      clearTimeout(reconnectTimeout);
    };
  }, []);

  return { events, nodeStatus, receipts, isConnected };
}
