import { useEffect, useState } from 'react';
import { fetchJson } from './api.js';

interface LoadState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Fetch on mount; never throws — errors land in `state.error`. */
export function useFetch<T>(path: string | null): LoadState<T> & { reload: () => void } {
  const [state, setState] = useState<LoadState<T>>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchJson<T>(path)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((err) => alive && setState({ data: null, error: err instanceof Error ? err.message : 'request failed', loading: false }));
    return () => {
      alive = false;
    };
  }, [path, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}