# Bank Lab Results — Lab Run 3 (Synthetic Lab — No Real Targets)

**Date:** 2026-10-17 UTC.
**Verdict: ALL PROFILES PASS — 44 PASS / 0 FAIL** (4 profiles × 11 checks; `missing=none`; `/tmp/banklab_run3.log:171-172`).

> Synthetic research labels only. `hsbc` / `jpmorgan` / `lgt` / `swift` are lab profile names, not representations of real bank systems. The attacker touched only local lab qcore containers on the isolated `banklab` bridge — no real bank infrastructure was contacted, probed, or targeted. No bank vulnerabilities, incidents, control failures, internal architectures, or regulatory deficiencies are asserted. Public quantum programmes are NOT deficiencies. Logs are sanitized (status codes + PASS/FAIL only — no tokens, passwords, or ciphertext bodies).

## Per-profile results

### `hsbc` — 11/11 (seed `753b932a`; `/tmp/banklab_run3.log:123-134`; `/tmp/banklab_evidence/hsbc.json`)

| Category | Expected | Observed | Invariant | Result |
|---|---|---|---|---|
| setup | health 200, login 200, org 201, catalog 200, plaintext lab transport | health=200 transport=plaintext_http login=200 org=201 catalog=200 | Bootstrap reaches operational on synthetic fixtures | PASS (`/tmp/banklab_run3.log:124`) |
| replay_duplicate | Duplicate submit is idempotent-same | duplicate idempotent-same (202, identical alert_id) | Replay never creates a second identity | PASS (`/tmp/banklab_run3.log:125`) |
| tamper | Tampered payloads rejected with 4xx | byte-flip -> 422, bad-enum -> 400 (both 4xx) | Integrity violations fail closed | PASS (`/tmp/banklab_run3.log:126`) |
| unauthorized_actor | No-auth access denied | no-auth members access fail-closed (401) | Auth boundary fails closed | PASS (`/tmp/banklab_run3.log:127`) |
| cross_tenant | Cross-tenant validate denied | cross-tenant validate fail-closed (403, mismatch_flag=True) | Tenant binding enforced | PASS (`/tmp/banklab_run3.log:128`) |
| mtls_triple | Live baseline + G3 cargo proof | plaintext health baseline reachable (transport=plaintext_http); mTLS assertion covered-by-g3-cargo-test | Transport posture honestly split: observed baseline + covered assertion | PASS-WITH-EXCEPTION (`/tmp/banklab_run3.log:129`) |
| concurrent_duplicates | Exactly-one identity under 20-way race | 20-way race: 20x202 same-identity + 0x400-conflict (exactly-one-identity) | Concurrency never splits identity | PASS (`/tmp/banklab_run3.log:130`) |
| restart_durability | Live consistency + G2 cargo proof | create/re-GET consistent; restart proof covered-by-g2-cargo-test | Durability honestly split: observed consistency + covered proof | PASS-WITH-EXCEPTION (`/tmp/banklab_run3.log:131`) |
| vault_rotation | LAB-ONLY rotation analog v1->v2 | rotated v1->v2, ciphertext differs, both decrypt to same plaintext | Rotation changes ciphertext, preserves plaintext (dev Vault 1.18, token banklab-dev-root, synthetic plaintext — drill analog only, NOT prod-HSM evidence) | PASS (`/tmp/banklab_run3.log:132`) |
| invalid_token | Bad bearer denied | bad bearer fail-closed (401) | Token boundary fails closed | PASS (`/tmp/banklab_run3.log:133`) |
| malformed_evidence | Garbage JSON rejected | garbage JSON rejected (400) | Malformed input rejected | PASS (`/tmp/banklab_run3.log:134`) |

### `jpmorgan` — 11/11 (seed `106a1d5b`; `/tmp/banklab_run3.log:135-146`; `/tmp/banklab_evidence/jpmorgan.json`)

| Category | Expected | Observed | Invariant | Result |
|---|---|---|---|---|
| setup | health 200, login 200, org 201, catalog 200, plaintext lab transport | health=200 transport=plaintext_http login=200 org=201 catalog=200 | Bootstrap reaches operational on synthetic fixtures | PASS (`/tmp/banklab_run3.log:136`) |
| replay_duplicate | Duplicate submit is idempotent-same | duplicate idempotent-same (202, identical alert_id) | Replay never creates a second identity | PASS (`/tmp/banklab_run3.log:137`) |
| tamper | Tampered payloads rejected with 4xx | byte-flip -> 422, bad-enum -> 400 (both 4xx) | Integrity violations fail closed | PASS (`/tmp/banklab_run3.log:138`) |
| unauthorized_actor | No-auth access denied | no-auth members access fail-closed (401) | Auth boundary fails closed | PASS (`/tmp/banklab_run3.log:139`) |
| cross_tenant | Cross-tenant validate denied | cross-tenant validate fail-closed (403, mismatch_flag=True) | Tenant binding enforced | PASS (`/tmp/banklab_run3.log:140`) |
| mtls_triple | Live baseline + G3 cargo proof | plaintext health baseline reachable (transport=plaintext_http); mTLS assertion covered-by-g3-cargo-test | Transport posture honestly split: observed baseline + covered assertion | PASS-WITH-EXCEPTION (`/tmp/banklab_run3.log:141`) |
| concurrent_duplicates | Exactly-one identity under 20-way race | 20-way race: 20x202 same-identity + 0x400-conflict (exactly-one-identity) | Concurrency never splits identity | PASS (`/tmp/banklab_run3.log:142`) |
| restart_durability | Live consistency + G2 cargo proof | create/re-GET consistent; restart proof covered-by-g2-cargo-test | Durability honestly split: observed consistency + covered proof | PASS-WITH-EXCEPTION (`/tmp/banklab_run3.log:143`) |
| vault_rotation | LAB-ONLY rotation analog v1->v2 | rotated v1->v2, ciphertext differs, both decrypt to same plaintext | Rotation changes ciphertext, preserves plaintext (dev Vault 1.18, token banklab-dev-root, synthetic plaintext — drill analog only, NOT prod-HSM evidence) | PASS (`/tmp/banklab_run3.log:144`) |
| invalid_token | Bad bearer denied | bad bearer fail-closed (401) | Token boundary fails closed | PASS (`/tmp/banklab_run3.log:145`) |
| malformed_evidence | Garbage JSON rejected | garbage JSON rejected (400) | Malformed input rejected | PASS (`/tmp/banklab_run3.log:146`) |

### `lgt` — 11/11 (seed `83290c5f`; `/tmp/banklab_run3.log:147-158`; `/tmp/banklab_evidence/lgt.json`)

| Category | Expected | Observed | Invariant | Result |
|---|---|---|---|---|
| setup | health 200, login 200, org 201, catalog 200, plaintext lab transport | health=200 transport=plaintext_http login=200 org=201 catalog=200 | Bootstrap reaches operational on synthetic fixtures | PASS (`/tmp/banklab_run3.log:148`) |
| replay_duplicate | Duplicate submit is idempotent-same | duplicate idempotent-same (202, identical alert_id) | Replay never creates a second identity | PASS (`/tmp/banklab_run3.log:149`) |
| tamper | Tampered payloads rejected with 4xx | byte-flip -> 422, bad-enum -> 400 (both 4xx) | Integrity violations fail closed | PASS (`/tmp/banklab_run3.log:150`) |
| unauthorized_actor | No-auth access denied | no-auth members access fail-closed (401) | Auth boundary fails closed | PASS (`/tmp/banklab_run3.log:151`) |
| cross_tenant | Cross-tenant validate denied | cross-tenant validate fail-closed (403, mismatch_flag=True) | Tenant binding enforced | PASS (`/tmp/banklab_run3.log:152`) |
| mtls_triple | Live baseline + G3 cargo proof | plaintext health baseline reachable (transport=plaintext_http); mTLS assertion covered-by-g3-cargo-test | Transport posture honestly split: observed baseline + covered assertion | PASS-WITH-EXCEPTION (`/tmp/banklab_run3.log:153`) |
| concurrent_duplicates | Exactly-one identity under 20-way race | 20-way race: 20x202 same-identity + 0x400-conflict (exactly-one-identity) | Concurrency never splits identity | PASS (`/tmp/banklab_run3.log:154`) |
| restart_durability | Live consistency + G2 cargo proof | create/re-GET consistent; restart proof covered-by-g2-cargo-test | Durability honestly split: observed consistency + covered proof | PASS-WITH-EXCEPTION (`/tmp/banklab_run3.log:155`) |
| vault_rotation | LAB-ONLY rotation analog v1->v2 | rotated v1->v2, ciphertext differs, both decrypt to same plaintext | Rotation changes ciphertext, preserves plaintext (dev Vault 1.18, token banklab-dev-root, synthetic plaintext — drill analog only, NOT prod-HSM evidence) | PASS (`/tmp/banklab_run3.log:156`) |
| invalid_token | Bad bearer denied | bad bearer fail-closed (401) | Token boundary fails closed | PASS (`/tmp/banklab_run3.log:157`) |
| malformed_evidence | Garbage JSON rejected | garbage JSON rejected (400) | Malformed input rejected | PASS (`/tmp/banklab_run3.log:158`) |

### `swift` — 11/11 (seed `b7d4828d`; `/tmp/banklab_run3.log:159-170`; `/tmp/banklab_evidence/swift.json`)

| Category | Expected | Observed | Invariant | Result |
|---|---|---|---|---|
| setup | health 200, login 200, org 201, catalog 200, plaintext lab transport | health=200 transport=plaintext_http login=200 org=201 catalog=200 | Bootstrap reaches operational on synthetic fixtures | PASS (`/tmp/banklab_run3.log:160`) |
| replay_duplicate | Duplicate submit is idempotent-same | duplicate idempotent-same (202, identical alert_id) | Replay never creates a second identity | PASS (`/tmp/banklab_run3.log:161`) |
| tamper | Tampered payloads rejected with 4xx | byte-flip -> 422, bad-enum -> 400 (both 4xx) | Integrity violations fail closed | PASS (`/tmp/banklab_run3.log:162`) |
| unauthorized_actor | No-auth access denied | no-auth members access fail-closed (401) | Auth boundary fails closed | PASS (`/tmp/banklab_run3.log:163`) |
| cross_tenant | Cross-tenant validate denied | cross-tenant validate fail-closed (403, mismatch_flag=True) | Tenant binding enforced | PASS (`/tmp/banklab_run3.log:164`) |
| mtls_triple | Live baseline + G3 cargo proof | plaintext health baseline reachable (transport=plaintext_http); mTLS assertion covered-by-g3-cargo-test | Transport posture honestly split: observed baseline + covered assertion | PASS-WITH-EXCEPTION (`/tmp/banklab_run3.log:165`) |
| concurrent_duplicates | Exactly-one identity under 20-way race | 20-way race: 20x202 same-identity + 0x400-conflict (exactly-one-identity) | Concurrency never splits identity | PASS (`/tmp/banklab_run3.log:166`) |
| restart_durability | Live consistency + G2 cargo proof | create/re-GET consistent; restart proof covered-by-g2-cargo-test | Durability honestly split: observed consistency + covered proof | PASS-WITH-EXCEPTION (`/tmp/banklab_run3.log:167`) |
| vault_rotation | LAB-ONLY rotation analog v1->v2 | rotated v1->v2, ciphertext differs, both decrypt to same plaintext | Rotation changes ciphertext, preserves plaintext (dev Vault 1.18, token banklab-dev-root, synthetic plaintext — drill analog only, NOT prod-HSM evidence) | PASS (`/tmp/banklab_run3.log:168`) |
| invalid_token | Bad bearer denied | bad bearer fail-closed (401) | Token boundary fails closed | PASS (`/tmp/banklab_run3.log:169`) |
| malformed_evidence | Garbage JSON rejected | garbage JSON rejected (400) | Malformed input rejected | PASS (`/tmp/banklab_run3.log:170`) |

## Environment

- **qcore image:** built from `scripts/qcore-pov/docker/Dockerfile.pov` (same PoV build as the main PoV compose; no new Dockerfile), one service per synthetic profile.
- **vault:** `hashicorp/vault:1.18` dev server (`vault server -dev -dev-root-token-id=banklab-dev-root`), transit engine for the rotation drill only. LAB-ONLY analog — never a prod/HSM claim.
- **attacker:** `python:3.12-slim` container running `research/bank_lab/attacker/adversarial_matrix.py` — python3 stdlib-only (`urllib`, `concurrent.futures`, `json`, `argparse`; no third-party deps). Sole ingress path `attacker` → `qcore-<profile>:8080`.
- **collector:** `python:3.12-slim` one-shot (`profiles: [collect]`, runs `collect.py`, invoked by the runner via `--profile collect`) writing the per-run bundle + summary.
- **Network:** isolated `banklab` bridge (`driver: bridge`); no external targets allowlisted.
- **Ports:** host `18081` (hsbc) / `18082` (jpmorgan) / `18083` (lgt) / `18084` (swift) → container `8080`; host `18200` → vault `8200`.
- **Per-profile seeds:** hsbc=`753b932a`, jpmorgan=`106a1d5b`, lgt=`83290c5f`, swift=`b7d4828d` (matrix invocations at `/tmp/banklab_run3.log:63,77,91,105`; evidence `seed` fields in `/tmp/banklab_evidence/*.json`).
- **Full summary table:** `/tmp/banklab_run3.log:119-175` (collector output: per-profile blocks `:123`, `:135`, `:147`, `:159`; aggregate `:171`; verdict `:172`).
- **Teardown:** verified clean — 0 `vardhan_banklab_*` containers, `banklab` network removed, no `banklab-*` volumes (runner teardown default ON; see `research/bank_lab/TEARDOWN.md`).

## Fixed defects (runs 1–2 → run 3)

- **Run 1 → run 2 — `vault_rotation` transport error surfaced as `status=0`:** root cause was a code bug, not infra flake — `Matrix._vault()` referenced `self.timeout`, which `Matrix.__init__` never set (only the inner `Client` sets it), so every Vault call raised `AttributeError`, caught by the `except Exception` guard and recorded as `status=0` (all 4 profiles; all 40 qcore checks passed that run). Fix: set `self.timeout = 10.0` in `Matrix.__init__` (`research/bank_lab/attacker/adversarial_matrix.py`). Verified by direct attacker→vault POSTs succeeding while the matrix reported `status=0`.
- **Run 2 — Vault version parse returned `differ=False`:** the rotation check parsed the `vault:v<version>:<data>` envelope with `split(':',1)[0]`, which yields the literal `'vault'` on both sides, so version comparison always reported `differ=False`. Fix: parse index 1 — `ct.split(":")[1]` with a `count(":") >= 2` guard (`research/bank_lab/attacker/adversarial_matrix.py:527-528`) — so `v1`/`v2` are the real key versions and `differ = ct1 != ct2 and v1 != v2` (`:534`) correctly gates the pass. Run 3 records `rotated v1->v2, ciphertext differs, both decrypt to same plaintext` on all four profiles.

## Limitations (explicit non-claims)

- **Dev-Vault drill only:** `vault_rotation` is a LAB-ONLY rotation analog against dev Vault 1.18 (token `banklab-dev-root`, synthetic plaintext). It is NOT prod-HSM evidence and proves nothing about production key management.
- **Single-node only:** one qcore container per profile; no multi-node, multi-region, zero-downtime, or RAFT claim (single-node scope per `docs/G1_ASSURANCE_PACKET.md` §1).
- **Prod CA/HSM owner-provisioned:** production certificate authority and HSM/KMS are owner-provisioned and were never part of this lab.
- **G1 still open:** G1 assessment stays OPEN-prepared — no pentest commissioned, no ISO 27001 (or any) certification claimed.
- **Plaintext lab transport:** in-lab qcore transport is `plaintext_http` (dev only); the mTLS deep assertion lives in the G3 cargo test (`backend/control_plane_api/tests/g3_mtls_handshake.rs`), and restart persistence in G2 (`backend/control_plane_api/tests/g2_durable_idempotency.rs`) — hence `mtls_triple` / `restart_durability` are PARTIAL (Observed=PASS-WITH-EXCEPTION), not full PASS.
- **Q-Core scope:** Q-Core does NOT replace crypto inventory, PQC migration programmes, HSM/KMS, Swift CSP, or audit/assessor functions — at most a complementary discovery aid on synthetic data (PRODUCT_HYPOTHESIS; CUSTOMER_VALIDATION_REQUIRED for any customer need, interest, or procurement path).
- **NOT_SUPPORTED:** no bank vulnerabilities, incidents beyond documented ones, control failures, internal architectures, or regulatory deficiencies are asserted against HSBC, JPMorgan, LGT, or Swift.

## Rerun

```sh
./research/bank_lab/run_bank_lab.sh
# --keep to leave the lab running for inspection; default tears down (down -v).
# See research/bank_lab/TEARDOWN.md for clean-state verification.
```

Evidence: full log `/tmp/banklab_run3.log`; per-check JSON `/tmp/banklab_evidence/{hsbc,jpmorgan,lgt,swift}.json`; runner `research/bank_lab/run_bank_lab.sh`; compose `research/bank_lab/docker-compose.bank-lab.yml`.
