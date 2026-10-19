# VARDHAN Q-CORE — Service Port Registry (Phase 2)

> **Scope:** documentation + `qcore doctor` warnings ONLY.
> **No default ports were changed in this phase.** All services keep their
> compiled-in defaults; collisions are resolved operationally via the
> documented env/CLI overrides.

## Registry

| Service / Binary | Default port (bind) | Env / CLI override | File:line evidence |
|---|---|---|---|
| control-plane API (`control_plane_api`) | **8080** (`127.0.0.1:8080`) | `VARDHAN_CONTROL_PLANE_ADDR` (full socket addr) | `backend/control_plane_api/src/main.rs:110` |
| pq-shield ingress (`pq_shield`) | **8080** (`0.0.0.0:{VARDHAN_PORT}`) | `VARDHAN_PORT` | `backend/pq_shield/src/main.rs:24` |
| receipt gateway (`vardhan-receipt Serve`) | **8080** (`--port` default) | `--port <N>` CLI flag | `backend/vardhan_receipt/src/main.rs:45` (`#[arg(long, default_value = "8080")]`), serve at `:397-398` |
| load-tester target | **8080** (`127.0.0.1:8080` default target) | `--target <addr>` CLI flag | `backend/load_tester/src/main.rs:13` |
| verifier dial target (`verifier` binary) | **8080** (`TcpStream::connect("127.0.0.1:8080")`) | none (test client; point at overridden server addr manually) | `backend/verifier/src/main.rs:14` |
| intelligence-plane UI | **3000** (compose-mapped) | `VARDHAN_INTELLIGENCE_PORT` | `docker-compose.yml:58` (`${VARDHAN_INTELLIGENCE_PORT:-3000}:3000`); `qcore:30` |
| mock upstream (`mock_upstream`) | **9090** (`127.0.0.1:9090`) | none (fixed test double) | `backend/mock_upstream/src/main.rs:6-7` |
| pq-shield upstream default | **9090** (`127.0.0.1:9090`) | `VARDHAN_UPSTREAM` | `backend/pq_shield/src/main.rs:27` |
| pq-shield heartbeat | **18080** | `VARDHAN_HEARTBEAT_PORT` | `backend/pq_shield/src/main.rs:126` |
| pq-shield raft | **18090** | `VARDHAN_RAFT_PORT` | `backend/pq_shield/src/main.rs:192` |
| pq-shield admin API | **8081** | `VARDHAN_ADMIN_PORT` | `backend/pq_shield/src/admin.rs:167` |
| OTLP test collector (`otlp_test_collector` bin) | **4318** (`127.0.0.1:4318/v1/traces`) | none (test-only binary) | `backend/pq_shield/src/bin/otlp_test_collector.rs:12` |
| quantum node (`quantum_node` proxy) | **8443** (`127.0.0.1:8443`) | `--bind <addr>` CLI flag | `backend/quantum_node/src/main.rs:25` (`default_value = "127.0.0.1:8443"`) |
| qcore control-plane alias | 8080 | `VARDHAN_CONTROL_PLANE_PORT` | `qcore:29` |

## ⚠️ Known collision: port 8080

Three servers default to **8080** on the same host:

1. `control_plane_api` (127.0.0.1:8080)
2. `pq_shield` ingress (0.0.0.0:8080 — binds ALL interfaces, so it conflicts even with 127.0.0.1 binds)
3. `vardhan-receipt Serve` (default `--port 8080`)

Plus two *clients* assume 8080: `load_tester` (default `--target 127.0.0.1:8080`)
and the `verifier` binary (hardcoded dial `127.0.0.1:8080`).

**Rule (operational, Phase 2):** do NOT run control-plane + shield +
receipt-serve on defaults simultaneously. Stagger them with overrides, e.g.:

```bash
VARDHAN_CONTROL_PLANE_ADDR=127.0.0.1:8080  ./target/debug/control_plane_api &
VARDHAN_PORT=8082 VARDHAN_UPSTREAM=127.0.0.1:9090 ./target/debug/pq_shield &
./target/debug/vardhan-receipt Serve --port 8083
```

`qcore doctor` now prints a WARN (never a hard error, never kills
anything) for each registry port that appears occupied:
8080 / 3000 / 9090 / 18080 / 18090 / 8081.
See `docs/PHASE_2_BACKEND_REPORT.md` for verification evidence.
