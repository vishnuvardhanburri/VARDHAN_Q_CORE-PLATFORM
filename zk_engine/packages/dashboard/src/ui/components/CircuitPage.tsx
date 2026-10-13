import { useFetch } from '../hooks.js';
import type { CircuitDetail } from '../../shared/types.js';
import { StatusBadge } from './StatusBadge.js';

export function CircuitPage({ circuitId }: { circuitId: string }) {
  const { data, error, loading } = useFetch<CircuitDetail>(`/api/circuits/${encodeURIComponent(circuitId)}`);

  if (error) return <div className="error">{error}</div>;
  if (loading || !data) return <p className="muted">loading…</p>;

  return (
    <div>
      <h1>
        {data.circuitId} <span className="muted">v{data.version}</span>
      </h1>
      <div className="row">
        {data.certified ? <StatusBadge tone="ok">certified manifest</StatusBadge> : <StatusBadge tone="warn">no local manifest</StatusBadge>}
        {data.registry ? (
          data.registry.active ? (
            <StatusBadge tone="ok">registered + active</StatusBadge>
          ) : (
            <StatusBadge tone="warn">registered + inactive</StatusBadge>
          )
        ) : (
          <StatusBadge tone="bad">unregistered on-chain</StatusBadge>
        )}
      </div>

      <div className="panel">
        <h2>On-chain registry config</h2>
        {data.registry ? (
          <table>
            <tbody>
              <tr>
                <th>verifier</th>
                <td className="mono">{data.registry.verifier}</td>
              </tr>
              <tr>
                <th>vkHash</th>
                <td className="mono">{data.registry.vkHash}</td>
              </tr>
              <tr>
                <th>active</th>
                <td>{data.registry.active ? 'yes' : 'no'}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="muted">not present in the registry</p>
        )}
      </div>

      <div className="panel">
        <h2>Certified artifacts (circuit-lib)</h2>
        {data.manifest ? (
          <>
            <table>
              <tbody>
                <tr>
                  <th>manifest hash</th>
                  <td className="mono">{data.manifest.manifestHash}</td>
                </tr>
                <tr>
                  <th>certified vkHash</th>
                  <td className="mono">{data.manifest.vkHash}</td>
                </tr>
                <tr>
                  <th>artifact bundle hash</th>
                  <td className="mono">{data.manifest.artifactBundleHash}</td>
                </tr>
                <tr>
                  <th>r1cs</th>
                  <td className="mono">{data.manifest.artifacts.r1cs}</td>
                </tr>
                <tr>
                  <th>wasm</th>
                  <td className="mono">{data.manifest.artifacts.wasm}</td>
                </tr>
                <tr>
                  <th>zkey</th>
                  <td className="mono">{data.manifest.artifacts.zkey}</td>
                </tr>
                <tr>
                  <th>vk sha256</th>
                  <td className="mono">{data.manifest.artifacts.vkSha256}</td>
                </tr>
              </tbody>
            </table>
            {data.files && (
              <p>
                on-disk files: r1cs {data.files.r1cs ? '✓' : '✗'} · wasm {data.files.wasm ? '✓' : '✗'} · zkey{' '}
                {data.files.zkey ? '✓' : '✗'} · vkey {data.files.vkey ? '✓' : '✗'}
              </p>
            )}
          </>
        ) : (
          <p className="muted">no certified manifest available for this circuit</p>
        )}
      </div>

      <div className="panel">
        <h2>Proof status probe</h2>
        <p className="muted">
          Use the <a href="#/proofs">Proofs</a> page to look up a public-input anchor for this circuit.
        </p>
      </div>
    </div>
  );
}