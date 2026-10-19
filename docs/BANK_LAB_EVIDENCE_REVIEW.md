# Bank Lab Evidence Review — Lab Run 3

## 1. Run identity

- **Lab Run 3**, commit `84ae56a`, date **2026-10-17 UTC**.
- Runner: `research/bank_lab/run_bank_lab.sh` (build → up → health-gate → matrix per profile → collector → teardown).
- Compose: `research/bank_lab/docker-compose.bank-lab.yml`.
- Per-profile seeds: hsbc=`753b932a` jpmorgan=`106a1d5b` lgt=`83290c5f` swift=`b7d4828d`.
- Aggregate: **44 PASS / 0 FAIL**, `missing=none` (`/tmp/banklab_run3.log:171-172`).
- Source of record: `docs/BANK_LAB_RESULTS.md` — all values below transcribed from it, no invented values.
- Evidence files live in **`/tmp` (host-local, gitignored) NOT in repo**: full log `/tmp/banklab_run3.log`, per-check JSON `/tmp/banklab_evidence/{hsbc,jpmorgan,lgt,swift}.json`.

## 2. Transport

- Attacker → qcore over **`plaintext_http`** inside the isolated `banklab` bridge network (`driver: bridge`); sole ingress `attacker` → `qcore-<profile>:8080` (host 18081–18084 → container 8080).
- Vault dev server `hashicorp/vault:1.18` (token `banklab-dev-root`, transit engine) for the **rotation analog ONLY** (host 18200 → vault 8200).
- **NO mTLS in lab transport** (dev only) — hence the `mtls_triple` exception below.

## 3. Sanitization

- Logs record **status codes + PASS/FAIL only** — no tokens, passwords, or ciphertext bodies (matrix header: "only status codes, version prefixes, lengths, and counts"; `adversarial_matrix.py` lines ~25-26).

## 4. Scope fence

- Profile names (`hsbc`/`jpmorgan`/`lgt`/`swift`) are **synthetic research labels**, not representations of real bank systems.
- The attacker targeted **only local qcore containers** on the isolated bridge; **no bank infrastructure was contacted**, probed, or targeted.
- **No bank vulnerability, incident, control failure, internal architecture, or regulatory deficiency is asserted.** Public quantum programmes are NOT deficiencies.

## 5. Verdict

- 9 checks × 4 profiles = **36 PASS** (live HTTP).
- 2 checks × 4 profiles = **8 PASS-WITH-EXCEPTION** (`mtls_triple`: live `plaintext_http` baseline + assertion `covered-by-g3-cargo-test` in `backend/control_plane_api/tests/g3_mtls_handshake.rs`; `restart_durability`: live create/re-GET consistency + restart proof `covered-by-g2-cargo-test` in `backend/control_plane_api/tests/g2_durable_idempotency.rs`).
- **Preserved as PASS-WITH-EXCEPTION on all 4 profiles; NOT upgraded.** All four profiles show identical observed behavior per `docs/BANK_LAB_RESULTS.md`.

## Evidence table (4 profiles × 11 checks = 44 rows)

| Profile | Test | Expected behavior | Observed behavior | Execution method | Evidence reference | Result | Exception | Remaining gap |
|---|---|---|---|---|---|---|---|---|
| hsbc | setup | health 200, login 200, org 201, catalog 200, plaintext lab transport | health=200 transport=plaintext_http login=200 org=201 catalog=200 | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:124, hsbc.json | PASS | none | single-node only |
| hsbc | replay_duplicate | Duplicate submit is idempotent-same | duplicate idempotent-same (202, identical alert_id) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:125, hsbc.json | PASS | none | single-node only |
| hsbc | tamper | Tampered payloads rejected with 4xx | byte-flip -> 422, bad-enum -> 400 (both 4xx) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:126, hsbc.json | PASS | none | synthetic payloads only |
| hsbc | unauthorized_actor | No-auth access denied | no-auth members access fail-closed (401) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:127, hsbc.json | PASS | none | lab auth only |
| hsbc | cross_tenant | Cross-tenant validate denied | cross-tenant validate fail-closed (403, mismatch_flag=True) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:128, hsbc.json | PASS | none | synthetic orgs only |
| hsbc | mtls_triple | Live baseline + G3 cargo proof | plaintext health baseline reachable (transport=plaintext_http); mTLS assertion covered-by-g3-cargo-test | split: live baseline via attacker + cargo test backend/control_plane_api/tests/g3_mtls_handshake.rs | /tmp/banklab_run3.log:129, hsbc.json | PASS-WITH-EXCEPTION | no mTLS in lab transport; deep assertion in G3 cargo test | lab transport is plaintext_http |
| hsbc | concurrent_duplicates | Exactly-one identity under 20-way race | 20-way race: 20x202 same-identity + 0x400-conflict (exactly-one-identity) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:130, hsbc.json | PASS | none | single-node race only |
| hsbc | restart_durability | Live consistency + G2 cargo proof | create/re-GET consistent; restart proof covered-by-g2-cargo-test | split: live create/re-GET via attacker + cargo test backend/control_plane_api/tests/g2_durable_idempotency.rs | /tmp/banklab_run3.log:131, hsbc.json | PASS-WITH-EXCEPTION | no in-lab restart; persistence proof in G2 cargo test | restart not exercised in lab |
| hsbc | vault_rotation | LAB-ONLY rotation analog v1->v2 | rotated v1->v2, ciphertext differs, both decrypt to same plaintext | live HTTP via attacker (python:3.12-slim stdlib urllib) to dev Vault | /tmp/banklab_run3.log:132, hsbc.json | PASS | lab-only dev-Vault 1.18 analog, not prod-HSM evidence | dev-Vault != HSM/prod |
| hsbc | invalid_token | Bad bearer denied | bad bearer fail-closed (401) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:133, hsbc.json | PASS | none | lab tokens only |
| hsbc | malformed_evidence | Garbage JSON rejected | garbage JSON rejected (400) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:134, hsbc.json | PASS | none | synthetic input only |
| jpmorgan | setup | health 200, login 200, org 201, catalog 200, plaintext lab transport | health=200 transport=plaintext_http login=200 org=201 catalog=200 | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:136, jpmorgan.json | PASS | none | single-node only |
| jpmorgan | replay_duplicate | Duplicate submit is idempotent-same | duplicate idempotent-same (202, identical alert_id) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:137, jpmorgan.json | PASS | none | single-node only |
| jpmorgan | tamper | Tampered payloads rejected with 4xx | byte-flip -> 422, bad-enum -> 400 (both 4xx) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:138, jpmorgan.json | PASS | none | synthetic payloads only |
| jpmorgan | unauthorized_actor | No-auth access denied | no-auth members access fail-closed (401) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:139, jpmorgan.json | PASS | none | lab auth only |
| jpmorgan | cross_tenant | Cross-tenant validate denied | cross-tenant validate fail-closed (403, mismatch_flag=True) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:140, jpmorgan.json | PASS | none | synthetic orgs only |
| jpmorgan | mtls_triple | Live baseline + G3 cargo proof | plaintext health baseline reachable (transport=plaintext_http); mTLS assertion covered-by-g3-cargo-test | split: live baseline via attacker + cargo test backend/control_plane_api/tests/g3_mtls_handshake.rs | /tmp/banklab_run3.log:141, jpmorgan.json | PASS-WITH-EXCEPTION | no mTLS in lab transport; deep assertion in G3 cargo test | lab transport is plaintext_http |
| jpmorgan | concurrent_duplicates | Exactly-one identity under 20-way race | 20-way race: 20x202 same-identity + 0x400-conflict (exactly-one-identity) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:142, jpmorgan.json | PASS | none | single-node race only |
| jpmorgan | restart_durability | Live consistency + G2 cargo proof | create/re-GET consistent; restart proof covered-by-g2-cargo-test | split: live create/re-GET via attacker + cargo test backend/control_plane_api/tests/g2_durable_idempotency.rs | /tmp/banklab_run3.log:143, jpmorgan.json | PASS-WITH-EXCEPTION | no in-lab restart; persistence proof in G2 cargo test | restart not exercised in lab |
| jpmorgan | vault_rotation | LAB-ONLY rotation analog v1->v2 | rotated v1->v2, ciphertext differs, both decrypt to same plaintext | live HTTP via attacker (python:3.12-slim stdlib urllib) to dev Vault | /tmp/banklab_run3.log:144, jpmorgan.json | PASS | lab-only dev-Vault 1.18 analog, not prod-HSM evidence | dev-Vault != HSM/prod |
| jpmorgan | invalid_token | Bad bearer denied | bad bearer fail-closed (401) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:145, jpmorgan.json | PASS | none | lab tokens only |
| jpmorgan | malformed_evidence | Garbage JSON rejected | garbage JSON rejected (400) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:146, jpmorgan.json | PASS | none | synthetic input only |
| lgt | setup | health 200, login 200, org 201, catalog 200, plaintext lab transport | health=200 transport=plaintext_http login=200 org=201 catalog=200 | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:148, lgt.json | PASS | none | single-node only |
| lgt | replay_duplicate | Duplicate submit is idempotent-same | duplicate idempotent-same (202, identical alert_id) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:149, lgt.json | PASS | none | single-node only |
| lgt | tamper | Tampered payloads rejected with 4xx | byte-flip -> 422, bad-enum -> 400 (both 4xx) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:150, lgt.json | PASS | none | synthetic payloads only |
| lgt | unauthorized_actor | No-auth access denied | no-auth members access fail-closed (401) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:151, lgt.json | PASS | none | lab auth only |
| lgt | cross_tenant | Cross-tenant validate denied | cross-tenant validate fail-closed (403, mismatch_flag=True) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:152, lgt.json | PASS | none | synthetic orgs only |
| lgt | mtls_triple | Live baseline + G3 cargo proof | plaintext health baseline reachable (transport=plaintext_http); mTLS assertion covered-by-g3-cargo-test | split: live baseline via attacker + cargo test backend/control_plane_api/tests/g3_mtls_handshake.rs | /tmp/banklab_run3.log:153, lgt.json | PASS-WITH-EXCEPTION | no mTLS in lab transport; deep assertion in G3 cargo test | lab transport is plaintext_http |
| lgt | concurrent_duplicates | Exactly-one identity under 20-way race | 20-way race: 20x202 same-identity + 0x400-conflict (exactly-one-identity) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:154, lgt.json | PASS | none | single-node race only |
| lgt | restart_durability | Live consistency + G2 cargo proof | create/re-GET consistent; restart proof covered-by-g2-cargo-test | split: live create/re-GET via attacker + cargo test backend/control_plane_api/tests/g2_durable_idempotency.rs | /tmp/banklab_run3.log:155, lgt.json | PASS-WITH-EXCEPTION | no in-lab restart; persistence proof in G2 cargo test | restart not exercised in lab |
| lgt | vault_rotation | LAB-ONLY rotation analog v1->v2 | rotated v1->v2, ciphertext differs, both decrypt to same plaintext | live HTTP via attacker (python:3.12-slim stdlib urllib) to dev Vault | /tmp/banklab_run3.log:156, lgt.json | PASS | lab-only dev-Vault 1.18 analog, not prod-HSM evidence | dev-Vault != HSM/prod |
| lgt | invalid_token | Bad bearer denied | bad bearer fail-closed (401) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:157, lgt.json | PASS | none | lab tokens only |
| lgt | malformed_evidence | Garbage JSON rejected | garbage JSON rejected (400) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:158, lgt.json | PASS | none | synthetic input only |
| swift | setup | health 200, login 200, org 201, catalog 200, plaintext lab transport | health=200 transport=plaintext_http login=200 org=201 catalog=200 | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:160, swift.json | PASS | none | single-node only |
| swift | replay_duplicate | Duplicate submit is idempotent-same | duplicate idempotent-same (202, identical alert_id) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:161, swift.json | PASS | none | single-node only |
| swift | tamper | Tampered payloads rejected with 4xx | byte-flip -> 422, bad-enum -> 400 (both 4xx) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:162, swift.json | PASS | none | synthetic payloads only |
| swift | unauthorized_actor | No-auth access denied | no-auth members access fail-closed (401) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:163, swift.json | PASS | none | lab auth only |
| swift | cross_tenant | Cross-tenant validate denied | cross-tenant validate fail-closed (403, mismatch_flag=True) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:164, swift.json | PASS | none | synthetic orgs only |
| swift | mtls_triple | Live baseline + G3 cargo proof | plaintext health baseline reachable (transport=plaintext_http); mTLS assertion covered-by-g3-cargo-test | split: live baseline via attacker + cargo test backend/control_plane_api/tests/g3_mtls_handshake.rs | /tmp/banklab_run3.log:165, swift.json | PASS-WITH-EXCEPTION | no mTLS in lab transport; deep assertion in G3 cargo test | lab transport is plaintext_http |
| swift | concurrent_duplicates | Exactly-one identity under 20-way race | 20-way race: 20x202 same-identity + 0x400-conflict (exactly-one-identity) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:166, swift.json | PASS | none | single-node race only |
| swift | restart_durability | Live consistency + G2 cargo proof | create/re-GET consistent; restart proof covered-by-g2-cargo-test | split: live create/re-GET via attacker + cargo test backend/control_plane_api/tests/g2_durable_idempotency.rs | /tmp/banklab_run3.log:167, swift.json | PASS-WITH-EXCEPTION | no in-lab restart; persistence proof in G2 cargo test | restart not exercised in lab |
| swift | vault_rotation | LAB-ONLY rotation analog v1->v2 | rotated v1->v2, ciphertext differs, both decrypt to same plaintext | live HTTP via attacker (python:3.12-slim stdlib urllib) to dev Vault | /tmp/banklab_run3.log:168, swift.json | PASS | lab-only dev-Vault 1.18 analog, not prod-HSM evidence | dev-Vault != HSM/prod |
| swift | invalid_token | Bad bearer denied | bad bearer fail-closed (401) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:169, swift.json | PASS | none | lab tokens only |
| swift | malformed_evidence | Garbage JSON rejected | garbage JSON rejected (400) | live HTTP via attacker (python:3.12-slim stdlib urllib) | /tmp/banklab_run3.log:170, swift.json | PASS | none | synthetic input only |

*Notes: identical observed behavior across all four profiles per `docs/BANK_LAB_RESULTS.md`. Full summary table `/tmp/banklab_run3.log:119-175`, aggregate + verdict `:171-172`. Rerun: `./research/bank_lab/run_bank_lab.sh`.*
