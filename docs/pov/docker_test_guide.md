# Docker Test Environment Guide

## Overview

The VARDHAN Q-Core PoV uses a **multi-stage Docker build** to produce a reproducible test environment with both Rust binaries and Python benchmark scripts.

## Prerequisites

- Docker Desktop 29.2.0+ (macOS arm64)
- 2GB+ available disk space
- Rust toolchain (built inside Docker — no local Rust required)

## Quick Start

```bash
cd scripts/qcore-pov

# One-command build, start, and test run
./run.sh
```

This will:
1. Build the Docker image (`vardhan-qcore-pov:latest`)
2. Start the container (`qcore-pov`) on port 8080
3. Run security tests (20/20 expected to pass)
4. Run performance benchmarks
5. Run cryptographic benchmarks
6. Collect all results in `scripts/qcore-pov/results/`

## Manual Build & Run

```bash
# Build
docker build -f scripts/qcore-pov/docker/Dockerfile.pov -t vardhan-qcore-pov:latest .

# Start
docker run -d \
    --name qcore-pov \
    -p 8080:8080 \
    -e VARDHAN_ENV=development \
    -v "$(pwd)/scripts/qcore-pov/secrets:/run/secrets:ro" \
    vardhan-qcore-pov:latest

# Wait for health
curl http://localhost:8080/api/v1/platform/health

# Run tests
docker cp scripts/qcore-pov/security_test.py qcore-pov:/usr/local/bin/
docker exec qcore-pov python3 /usr/local/bin/security_test.py

docker cp scripts/qcore-pov/perf_bench.py qcore-pov:/usr/local/bin/
docker exec qcore-pov python3 /usr/local/bin/perf_bench.py

docker cp scripts/qcore-pov/crypto_bench.py qcore-pov:/usr/local/bin/
docker exec qcore-pov python3 /usr/local/bin/crypto_bench.py
```

## Docker Image Details

### Multi-Stage Build (`Dockerfile.pov`)

- **Stage 1 (builder):** `rust:1.98-bookworm` — compiles `vardhan_receipt` and `control_plane_api` binaries
- **Stage 2 (runtime):** `rust:1.98-bookworm` — installs `curl`, `jq`, `python3`, `cryptography`, `blake3`

### Pre-Configured Dev Environment

- **Tenants:** `org-vardhan-intelligence`, `org-acme-bank-poc`, `org-test-tenant-valid`
- **Actor prefix:** `svc:vardhan-intelligence:`
- **Issuer:** `dev-local`
- **Admin bootstrap password:** Stored in Docker secret at `/run/secrets/admin_password` (read via `VARDHAN_ADMIN_PASSWORD_FILE`)

### Environment Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| `VARDHAN_ENV` | `development` | Environment enforcement |
| `VARDHAN_KEYSTORE_DIR` | `/var/lib/vardhan/keystore` | Signing keys location |
| `VARDHAN_IDEMPOTENCY_DIR` | `/var/lib/vardhan/idempotency` | Replay protection flag files |
| `VARDHAN_RECEIPT_ENGINE_BIN` | `/usr/local/bin/vardhan-receipt` | Path to receipt binary |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/auth/login` | Login, returns token (one-time-use, rotates on each request) |
| `POST` | `/api/v1/organizations` | Create organization |
| `GET` | `/api/v1/organizations/{id}` | Get organization |
| `POST` | `/api/v1/organizations/{id}/security/validate` | Seal finding contract (spawns receipt engine subprocess) |
| `GET` | `/api/v1/organizations/{id}/security/audit` | Retrieve audit trail |
| `GET` | `/api/v1/platform/health` | Health check |

## Token Rotation

Every authenticated response includes the `Authorization-New-Token` header. The old token is invalidated immediately. Test clients must capture and use the new token for subsequent requests.

## Known Limitations

- The `VARDHAN_IDEMPOTENCY_DIR` must be **cleared between benchmark runs** — flag files persist across runs within the same container
- Finding IDs must be **globally unique** across all test groups to avoid `REJECTED_REPLAY` errors
