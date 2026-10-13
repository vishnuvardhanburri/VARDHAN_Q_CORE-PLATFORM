import { useState } from 'react';
import { fetchJson, ApiError } from '../api.js';
import type { ProofStatus } from '../../shared/types.js';
import { StatusBadge } from './StatusBadge.js';

const HASH_RE = /^0x[0-9a-f]{64}$/;

export function ProofsPage() {
  const [circuitId, setCircuitId] = useState('');
  const [hash, setHash] = useState('');
  const [status, setStatus] = useState<ProofStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const valid = circuitId.length > 0 && HASH_RE.test(hash);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetchJson<ProofStatus>(
        `/api/proofs/status/${encodeURIComponent(circuitId)}/${hash}`,
      );
      setStatus(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail : err instanceof Error ? err.message : 'lookup failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Proof status</h1>
      <p className="muted">
        Look up the on-chain status of a proof by its circuit and public-input anchor. Only public
        identifiers are handled here — no witness or private input data ever enters this page.
      </p>
      <form className="panel" onSubmit={lookup}>
        <div className="row">
          <input
            placeholder="circuitId (e.g. poseidon-preimage)"
            value={circuitId}
            onChange={(e) => setCircuitId(e.target.value)}
            data-testid="circuit-id"
            aria-label="circuitId"
          />
          <input
            style={{ flex: 1 }}
            placeholder="0x… (64-hex publicInputHash)"
            value={hash}
            onChange={(e) => setHash(e.target.value)}
            data-testid="public-input-hash"
            aria-label="publicInputHash"
          />
          <button type="submit" disabled={busy || !valid} data-testid="lookup">
            lookup
          </button>
        </div>
      </form>

      {error && <div className="error" data-testid="proof-error">{error}</div>}

      {status && (
        <div className="panel" data-testid="proof-result">
          <table>
            <tbody>
              <tr>
                <th>circuitId</th>
                <td>{status.circuitId}</td>
              </tr>
              <tr>
                <th>status</th>
                <td>
                  {status.status === 'proved' ? (
                    <StatusBadge tone="ok">proved</StatusBadge>
                  ) : status.status === 'revoked' ? (
                    <StatusBadge tone="bad">revoked</StatusBadge>
                  ) : (
                    <StatusBadge tone="warn">unproved</StatusBadge>
                  )}
                </td>
              </tr>
              <tr>
                <th>proved at</th>
                <td className="mono">{status.provedAt}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}