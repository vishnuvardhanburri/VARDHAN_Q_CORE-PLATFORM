# 19 — CI/CD Gatekeeper (M7–M8)

## What the gate does

Every pull request runs `.github/workflows/gatekeeper.yml`. The **`gate`** job
requires a **signed** proof envelope that passes all of these checks
(`packages/cli/scripts/gatekeeper-probe.mjs`, logic in
`packages/cli/scripts/gatekeeper-lib.mjs`):

1. **Shape** — the envelope is valid proof-format JSON (v1 or v2).
2. **Circuit match** — `circuitId` equals the required circuit and is a
   certified circuit in `@zkpe/circuit-lib`.
3. **vkHash certification + allow-list** — the envelope `vkHash` must equal
   the certified manifest vkHash and (when provided) match the
   `vk-allowlist` input.
4. **Artifact binding** — the envelope must carry `artifactHash` = sha256 of
   the canonical artifact bundle (r1cs + wasm + zkey + vk digests). The gate
   recomputes the bundle digest from the deployed artifact directory and from
   the certified circuit-lib manifest and rejects any mismatch — a proof for
   a different artifact build cannot pass.
5. **Proof validity** — the engine re-verifies the proof against the
   certified VK (not just the signature).
6. **Signature (trusted key)** — `require-signed: true` rejects v1
   (unsigned) envelopes; v2 envelopes must verify under the **trusted
   public key supplied from a repository secret** (`ZK_GATEKEEPER_PUBLIC_KEY`)
   with matching `keyId`. The gate is fail-closed: with no trusted key it
   blocks.
7. **On-chain enforcement** — when `rpc-url` + `registry-address` are set,
   the gate queries the live registry and requires:
   - the circuit is **registered and active** (`circuits(bytes32)`,
     verifier ≠ address(0), active = true),
   - the on-chain **vkHash equals the envelope vkHash**,
   - the anchor `publicInputHash` is `Proved` (`getProofStatus` — `revoked`
     or `unregistered` fails the gate),
   - `requireProved(circuitId, anchor, maxAge)` **does not revert** — a
     revoked, expired (beyond `maxAge`), or never-registered proof blocks
     the gate.

## Trust boundary (security review, M8)

The workflow runs on **`pull_request_target`**, which resolves the
workflow/action/scripts from the **base branch** so an untrusted PR can never
rewrite the gate. Concretely:

- The gate job checks out the (trusted) base ref; `npm ci` + `npm run build`
  come from trusted code.
- The PR head is checked out **read-only** into `runner.temp/zk-pr-head`;
  only its proof envelope is read — PR code is never executed, and secrets
  (the trusted public key, client credentials) are never exposed to
  PR-controlled steps.
- The envelope path default `.gitgate/gate-envelope.json` and all other
  gate parameters come from **repo `vars`** (trusted), not from the PR.
- `.gitgate/gate-envelope.json` and `.gitgate/gate-key.pub.jwk` are
  **committed** (public material only); the dev gate's private key stays
  offline. The CI gate trusts **only** the `ZK_GATEKEEPER_PUBLIC_KEY`
  repository secret — the action fails fast when a signed envelope is
  required and no secret key is present. `public-key-file` in
  `.github/actions/zk-verify` is a **local development convenience only**
  and is never used by the workflow.
- `gatekeeper-fixture.mjs` is a **local development helper only** (it
  generates an ephemeral key); it is never invoked in CI. Production keys
  live in the repo secret `ZK_GATEKEEPER_PUBLIC_KEY` and the matching
  private key stays offline with maintainers.

On failure the gate fails the job (required status check → merge blocked)
and posts a PR comment with the gate report.

## What the gate does NOT prove (consistency with docs/09 §2.2)

A passing gate proves the seven checks above — nothing more. In particular
it does **not** prove:

- that the PR's **source code produced the attested binary** (v1 circuits
  carry no source→binary relation; docs/09 §2.2/§7.3);
- that `artifactHash` (a hash of the *circuit* r1cs/wasm/zkey/vk bundle)
  is application-binary provenance — it binds which circuit implementation
  was used, not what the application executable is;
- code review quality, vulnerability status, or the real-world identity of
  the signer (the signature only binds the envelope to a key known to the
  repo secret).

Reporting these claims as gate outputs would be wrong; treat the gate as a
cryptographic *consistency* gate, not a binary provenance gate.

## Negative suite

`packages/cli/test/gatekeeper.test.ts` proves the gate blocks bypass
attempts (14 cases): malformed envelope, wrong circuit, uncertified vkHash,
allow-list violation, missing artifactHash, artifactHash mismatch, on-disk
artifact mismatch, invalid proof, missing/forged/wrong-key signature, no
trusted key, unregistered/revoked/expired on-chain states. The CI
**`gate-negative`** job runs this suite on the trusted base code.

`packages/cli/scripts/gatekeeper-e2e.mjs` exercises the **real gate** against
a live anvil registry:

```
registered proof      → PASS
expired (maxAge=3600) → BLOCK (revert ProofExpired)
revoked (revokeProof) → BLOCK (status reports 'revoked')
unregistered proof    → BLOCK (NotProved / requireProved revert)
```

## On-chain gating

The registry exposes `requireProved(circuitId, publicInputHash, maxAge)`
(`contracts/src/ZKVerifierRegistry.sol`). A call that does **not** revert
means the proof is registered and unexpired. Revert signatures:
`NotProved`, `ProofExpired`, and `ProofIsRevoked` (after the M8 `revokeProof`
change, revoked entries are permanent tombstones — re-registration reverts
`ProofIsRevoked`). Downstream contracts call `requireProved` in their own
`_checkGate` to inherit the same policy (ADR-0004).

## Branch protection (how to make the gate required)

The gate job is only a *required status check* once branch protection says
so. Via the web UI: **Settings → Branches → Add rule → main** → enable
*Require status checks to pass* and select the `Gatekeeper / zk-verify gate`
check.

## Repo configuration (once)

1. Create the secret: `ZK_GATEKEEPER_PUBLIC_KEY` = the Ed25519 public JWK of
   the signing key (offline private key with the signing operator).
2. Optional repo variables: `ZK_GATE_ENVELOPE`, `ZK_GATE_CIRCUIT`,
   `ZK_VK_ALLOWLIST`, `ZK_REGISTRY_RPC_URL`, `ZK_REGISTRY_ADDRESS`,
   `ZK_GATE_MAX_AGE`, `ZK_VERIFY_API_URL`.
3. Maintainers sign envelopes for each PR with the private key and commit
   them at `.gitgate/gate-envelope.json` (gitignored key material stays
   local).