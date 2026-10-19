# Bank Lab Architecture (Synthetic Lab — No Real Targets)

> Executed lab for the 16 traceability hypotheses on
> synthetic data only. Nothing here contacts real bank infrastructure.
> Lab run 3 (2026-10-17 UTC): ALL PROFILES PASS, 44/44 —
> see `docs/BANK_LAB_RESULTS.md` and "Lab run 3 record" in
> `research/REQUIREMENTS_TRACEABILITY.md`.

## 1. Synthetic profiles (labels, not representations)

| Profile (`VARDHAN_NODE_ID` / seed file) | Source file | Lab role |
|---|---|---|
| `banklab-hsbc` (`qcore-hsbc` / `profiles/hsbc.env`) | `research/bank_profiles/HSBC.md` | Crypto-agility + evidence-integrity demos (HSBC-02/03) |
| `banklab-jpmorgan` (`qcore-jpmorgan` / `profiles/jpmorgan.env`) | `research/bank_profiles/JPMORGAN.md` | Rotation + reproducibility demos (JPM-01/03) |
| `banklab-lgt` (`qcore-lgt` / `profiles/lgt.env`) | `research/bank_profiles/LGT.md` | Custody/tenant-bound demos (LGT-01/02) |
| `banklab-swift` (`qcore-swift` / `profiles/swift.env`) | `research/bank_profiles/SWIFT.md` | Attestation/adversarial demos (SWF-02/04) |

All four profiles run simultaneously (one qcore container each); each maps to rows in
`research/REQUIREMENTS_TRACEABILITY.md`.

## 2. Services (`banklab` compose overlay — as built)

7 containers, all prefixed `vardhan_banklab_*`, on the isolated
`banklab` bridge (compose project `vardhan-banklab`):

| Service (compose) | Container | Image / build | Purpose |
|---|---|---|---|
| `qcore-hsbc` | `vardhan_banklab_hsbc` | Built from `scripts/qcore-pov/docker/Dockerfile.pov` (context: repo root) | System under test, profile `hsbc` (`VARDHAN_NODE_ID=banklab-hsbc`), host port `18081:8080` |
| `qcore-jpmorgan` | `vardhan_banklab_jpmorgan` | Built from `scripts/qcore-pov/docker/Dockerfile.pov` | System under test, profile `jpmorgan`, host port `18082:8080` |
| `qcore-lgt` | `vardhan_banklab_lgt` | Built from `scripts/qcore-pov/docker/Dockerfile.pov` | System under test, profile `lgt`, host port `18083:8080` |
| `qcore-swift` | `vardhan_banklab_swift` | Built from `scripts/qcore-pov/docker/Dockerfile.pov` | System under test, profile `swift`, host port `18084:8080` |
| `attacker` | `vardhan_banklab_attacker` | `python:3.12-slim`, `sleep infinity`, mounts `./attacker:/work` | Sends duplicate, tampered, cross-tenant, unauthz inputs (stdlib-only `adversarial_matrix.py`, exec'd per profile by the runner) |
| `collector` | `vardhan_banklab_collector` | `python:3.12-slim`, `profiles: [collect]`, runs `collect.py` | Gathers receipts, exits, logs into per-run bundle (invoked via `--profile collect`, so plain `up -d` skips it) |
| `vault` | `vardhan_banklab_vault` | `hashicorp/vault:1.18`, `server -dev -dev-root-token-id=banklab-dev-root`, host port `18200:8200` | Transit engine for the LAB-ONLY G4 rotation analog (dev only) |

All four qcore profiles run simultaneously (one container each —
no ×2 two-org case; per-org isolation is exercised inside a single
node via synthetic orgs). Profiles map 1:1 to
`research/bank_lab/profiles/{hsbc,jpmorgan,lgt,swift}.env` seeds.

Canonical control plane + intelligence plane stay as defined in root
`docker-compose.yml`; lab overlay reuses the PoV build
(`scripts/qcore-pov/docker/Dockerfile.pov`) and adds only
attacker/collector/vault plus four named volumes
(`banklab-*-data`).

## 3. Network isolation

- Dedicated bridge network `banklab` (no host-gateway routing to the internet
- beyond image pulls; no external targets allowlisted at all).
- `qcore-<profile>` exposes its API only inside `banklab` (+ host-mapped
- ports 18081–18084 for the operator health-gate). `vault` exposes
- `18200:8200` for the operator health-gate.
- `attacker` → `qcore-<profile>:8080` is the sole ingress path; `vault`
- reachable from `qcore` (transit only, drill runs) and from the attacker
- container for the LAB-ONLY rotation analog (`VAULT_ADDR=http://vault:8200`).
- Egress to any real bank/internet endpoint is forbidden by lab rule.

## 4. Data flow

```text
attacker (synthetic inputs) → qcore-<profile> (seal/transport/verify) → collector (results bundle)
                                      ↕ (transit only, drill runs)
                                   vault (dev 1.18, LAB-ONLY analog)
```

All findings, tenants, keys, and receipts are synthetic fixtures generated
inside the run. Expected outcomes per scenario live in the traceability
matrix; collector records pass/fail + exit codes without asserting
certification.

## 5. Run + teardown

- Run: `./research/bank_lab/run_bank_lab.sh` builds images, brings up
- all 4 profiles + vault + attacker, health-gates host ports
- 18081–18084 and vault 18200, executes the 11-check adversarial matrix
- per profile inside the attacker container
- (`adversarial_matrix.py`: setup, replay_duplicate, tamper,
- unauthorized_actor, cross-tenant, mtls_triple [PARTIAL],
- concurrent_duplicates, restart_durability [PARTIAL], vault_rotation
- [LAB-ONLY analog], invalid_token, malformed_evidence), then runs the
- collector (`--profile collect`) which writes the bundle + summary.
- Teardown default ON: the runner traps EXIT and runs
- `docker compose -f research/bank_lab/docker-compose.bank-lab.yml down -v`,
- removing containers + the four named volumes + the `banklab` network;
- vault dev data is ephemeral (in-memory dev server). Pass `--keep` to
- leave the lab running for inspection (teardown later per
- `research/bank_lab/TEARDOWN.md`). See root `./qcore down`
- convention in `docker-compose.yml` header for the analogous base-stack stop.

## 6. Honesty footer

Synthetic labels only — profile names imply no bank endorsement, interest, or
system knowledge. Single-node only (per `docs/G1_ASSURANCE_PACKET.md` §1).
Dev Vault 1.18 is drill-only (LAB-ONLY rotation analog), never a prod/HSM claim.
Lab transport is plaintext HTTP (dev only); mTLS/restart deep proofs live in
G3/G2 cargo tests, so those checks are PARTIAL. G1 assessment still OPEN
(PREPARATION ONLY, no pentest/ISO 27001 claimed).
