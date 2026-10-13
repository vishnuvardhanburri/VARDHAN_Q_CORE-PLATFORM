# Observability Guide

> **Author**: Vishnu Vardhan Burri  
> **Status**: Implemented (v0.2.0+)

## Health Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /v1/health` | None | Liveness probe — returns `{"status":"ok"}` always |
| `GET /v1/ready` | None | Readiness probe — checks engine + registry |
| `GET /v1/metrics` | None | Prometheus text format metrics |

### Readiness Probe Response

```json
{
  "status": "ok",
  "components": {
    "engine": true,
    "registry": "not-configured"
  }
}
```

`status: "degraded"` when any required component is unhealthy.

## Metrics (`GET /v1/metrics`)

Prometheus text format (Content-Type: `text/plain; version=0.0.4`).

### HTTP Metrics

| Metric | Labels | Description |
|---|---|---|
| `http_requests_total` | `method`, `status` | Total HTTP requests by method and status |
| `http_request_duration_ms_seconds_*` | — | Request duration histogram |

### Proof Metrics

| Metric | Labels | Description |
|---|---|---|
| `proofs_verified_total` | `circuitId`, `outcome` | Proof verification attempts |
| `proofs_registered_total` | `circuitId` | Successful on-chain registrations |
| `engine_verify_duration_seconds_*` | — | Engine verification duration |

### Registry Metrics

| Metric | Labels | Description |
|---|---|---|
| `registry_reads_total` | `op` | Registry read operations |
| `registry_writes_total` | `op` | Registry write operations |

### Self-Healing Metrics

| Metric | Labels | Description |
|---|---|---|
| `self_healing_recoveries_total` | `operation` | Successful auto-recovery |
| `self_healing_retries_total` | `operation`, `category`, `attempt` | Per-retry tracking |
| `self_healing_blocked_total` | `operation`, `category` | Fail-closed blocks |
| `self_healing_permanent_failures_total` | `operation`, `category` | Non-retryable failures |
| `self_healing_exhausted_total` | `operation`, `category` | Exhausted retries |

## Audit Log

The audit log records all security-relevant operations. Entries are append-only, immutable scalars — **never contain proofs, inputs, or secrets**.

### Audit Events

| Action | Trigger | Outcome Values |
|---|---|---|
| `auth.failed` | Authentication failure | `denied` |
| `auth.replayed` | Nonce reuse | `replayed` |
| `proof.verify` | POST /v1/proofs/verify | `granted`, `denied` |
| `proof.register` | POST /v1/proofs/register | `ok` |
| `proof.status` | GET /v1/proofs/status | `ok` |
| `registry.read` | GET /v1/registry | `ok` |
| `circuit.list` | GET /v1/circuits | `ok` |
| `audit.read` | GET /v1/audit | `ok` |
| `ratelimit.enforced` | Rate limit hit | `denied` |

### Audit Event Schema

```json
{
  "id": "aud_a1b2c3d4",
  "at": "2026-08-11T10:00:00.000Z",
  "actor": "client-prod-1",
  "tenantId": "org-acme",
  "action": "proof.verify",
  "resource": "/v1/proofs/verify",
  "outcome": "granted",
  "detail": { "circuitId": "poseidon-preimage", "verified": true },
  "ip": "10.0.0.1",
  "requestId": "req-550e8400-e29b-41d4-a716"
}
```

### Reading Audit Events

```bash
# All recent events (audit role required)
curl -H "x-zk-key: auditor-key" ... /v1/audit?limit=50

# Filter by action
curl ... /v1/audit?action=proof.register&limit=100
```

### Audit File (Optional)

Set `ZK_AUDIT_FILE=/var/log/zkpe/audit.jsonl` to persist audit events to a JSON-lines file in addition to the in-memory ring (1024-event cap).

## Distributed Tracing (OpenTelemetry)

Each HTTP request creates a root `http.request` span. Use cases create child spans (`api.verify`, `api.register`, etc.).

Configure with:
```bash
ZK_OTEL_ENDPOINT=http://jaeger:4318  # OTLP/HTTP endpoint
ZK_OTEL_SAMPLER_RATIO=0.1            # Sample 10% of traces
```

### Trace Correlation

Every response includes `X-Request-ID`. Pass `X-Request-ID: <your-id>` on requests to correlate traces with your own logs.

## Structured Logging

All logs are JSON (Pino), keyed by:

| Field | Description |
|---|---|
| `level` | `info`, `warn`, `error` |
| `reqId` | Request correlation ID |
| `msg` | Human-readable message |
| `address` | Server bind address (startup only) |
| `signal` | Signal name (shutdown only) |

Configure log level with `ZK_LOG_LEVEL=debug` (default: `info`).

## Alerting Recommendations

| Alert | Condition | Severity |
|---|---|---|
| High auth failures | `auth.failed` rate > 10/min | Warning |
| Verification failures | `proof.verify` `denied` > 5% | Warning |
| Self-healing blocked | `self_healing_blocked_total` > 0 | **Critical** |
| Rate limit enforced | `ratelimit.enforced` rate high | Info |
| Readiness degraded | `/v1/ready` status `degraded` | Critical |
