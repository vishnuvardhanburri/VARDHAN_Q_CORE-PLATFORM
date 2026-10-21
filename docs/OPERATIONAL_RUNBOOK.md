# Vardhan Q-Core — Enterprise Operational Runbook

## Document Control

- **Document Version:** 1.0.0
- **Classification:** Production Operations Runbook
- **Product:** Vardhan Q-Core
- **Target Audience:** Site Reliability Engineers (SRE), Platform Security Engineers, DevSecOps

---

## 1. System Overview & Service Ports

Vardhan Q-Core runs as a self-contained submission integrity and cryptographic receipt engine.

| Service Component | Process Name | Default Port | Internal / External | Description |
|---|---|---|---|---|
| Edge Proxy | Caddy / Envoy | 443 (TCP) | External (Ingress) | TLS 1.3 termination, security headers, rate limiting |
| Control Plane API | `control_plane_api` | 8080 (TCP) | Internal (Loopback) | Receipt submission, policy evaluation, RBAC, telemetry |
| Relational Storage | PostgreSQL | 5432 (TCP) | Internal (Loopback) | Multi-node transactional idempotency & session persistence |
| Embedded Storage | Sled Engine | Embedded (FS) | Host filesystem | Single-node ACID key-value journal (`/var/lib/vardhan/data`) |

---

## 2. Standard Service Lifecycle Operations

### 2.1 Starting Services

#### Docker Compose Deployment:
```bash
cd /opt/vardhan
docker compose -f docker-compose.enterprise.yml --env-file .env.enterprise up -d
```

#### Systemd Bare-Metal Deployment:
```bash
sudo systemctl start vardhan-qcore
sudo systemctl status vardhan-qcore
```

### 2.2 Health Probes & Readiness Checks

Execute standard HTTP health probes to confirm operational status:

```bash
# Basic Liveness Probe
curl -fsS http://127.0.0.1:8080/api/v1/platform/health

# Detailed Service Readiness Probe
curl -fsS http://127.0.0.1:8080/api/v1/auth/status
```

Expected HTTP response for healthy state:
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "storage": "connected"
}
```

### 2.3 Graceful Drain & Shutdown

Before patching, upgrading, or terminating a node:
1. Signal the load balancer to remove the node from active routing (fail readiness check).
2. Allow ongoing transaction sealing to complete (drain timeout: 15 seconds).
3. Stop the service:
   ```bash
   sudo systemctl stop vardhan-qcore
   ```
4. Verify all write locks and Sled lock files (`control-plane.sled.lock`) are cleanly released before reboot or volume detachment.

---

## 3. Cryptographic Key Lifecycle, KMS/HSM Integration & Rotation

### 3.1 Production KMS/HSM Configuration
Q-Core enforces hardware or cloud KMS-backed envelope encryption in production (`VARDHAN_ENV=production`). Configure the target provider via environment variables:

| Provider | `VARDHAN_KMS_PROVIDER` | Mandatory Configuration Variables | Notes |
|---|---|---|---|
| AWS KMS | `aws-kms` | `VARDHAN_AWS_KMS_KEY_ID`, `AWS_REGION` | Backed by AWS KMS symmetric CMK. Uses instance IAM role or AWS credentials. |
| GCP Cloud KMS | `gcp-kms` | `VARDHAN_GCP_KMS_KEY_NAME` | Format: `projects/{p}/locations/{l}/keyRings/{r}/cryptoKeys/{k}`. |
| HashiCorp Vault | `vault` / `vault-transit` | `VARDHAN_VAULT_ADDR`, `VARDHAN_VAULT_TOKEN`, `VARDHAN_VAULT_KEY_NAME` | Vault 1.15+ with Transit engine. Supports `min_decryption_version`. |
| PKCS#11 HSM | `pkcs11` / `hsm` | `VARDHAN_PKCS11_SLOT_ID`, `VARDHAN_PKCS11_PIN`, `VARDHAN_PKCS11_KEY_LABEL` | For physical PCIe/USB HSMs (Thales Luna, Utimaco, Nitrokey). |
| Envelope KEK | `envelope-kek` | `VARDHAN_PRODUCTION_KEK` | Hex-encoded 32-byte KEK from certified offline KMS. |

### 3.2 Initiating Key Rotation
When rotating signing keys (scheduled annual rotation or key replacement):

1. **Invoke Rotation API:**
   ```bash
   curl -X POST https://127.0.0.1/api/v1/keys/rotate \
     -H "Authorization: Bearer ${OPERATOR_TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"key_type": "all", "reason": "scheduled_rotation"}'
   ```
2. **Lifecycle State Transition & Historical Preservation:**
   - The current active public keys are archived into `historical_keys.json` with status `Retired`.
   - A fresh keypair is generated (ML-DSA-87 + Ed25519) and marked `Active` with `key_version = previous_version + 1`.
   - New incoming submissions immediately use the new `Active` key.
   - Older receipts remain independently verifiable via `HistoricalKeyRegistry` lookup by `issuer_key_fingerprint`.
   - Private key material is encrypted under the configured KMS/HSM provider before touching storage.

### 3.3 Emergency Key Revocation Procedure
If a key compromise is suspected:
1. **Revoke Specific Key Fingerprint:**
   ```bash
   curl -X POST https://127.0.0.1/api/v1/keys/revoke \
     -H "Authorization: Bearer ${OPERATOR_TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"fingerprint": "${TARGET_FINGERPRINT}", "reason": "suspected_compromise"}'
   ```
2. **Revocation Effect:**
   - Active signing is immediately terminated if the compromised key was active.
   - The key status in `keystore_meta.json` and `historical_keys.json` transitions to `Revoked`.
   - Standalone verifiers flag any receipt signed with this key with a security alert.

### 3.4 Key Lifecycle Verification Drill
Execute the automated test drill to verify all KMS adapters, SoftHSM emulation, and multi-version historical verification:
```bash
cargo test -p vardhan_keystore --test production_kms_hsm_drill -- --nocapture
```

---

## 4. Backup & Disaster Recovery Procedures

### 4.1 Scheduled Automated Backup
Execute backup during maintenance window or via automated cron:
```bash
# Snapshot data directory with atomic copy
SNAPSHOT_DIR="/var/backups/vardhan/$(date +%Y%m%d_%H%M%S)"
mkdir -p "${SNAPSHOT_DIR}"

# Export database / volume
sudo tar -czf "${SNAPSHOT_DIR}/vardhan_data.tar.gz" -C /var/lib/vardhan .
sudo sha256sum "${SNAPSHOT_DIR}/vardhan_data.tar.gz" > "${SNAPSHOT_DIR}/checksum.sha256"
```

### 4.2 Disaster Recovery Verification Drill
Regularly execute the automated restore drill:
```bash
./scripts/durability_backup_restore_drill.sh
```

---

## 5. Monitoring, Metrics & Alert Thresholds

| Metric | Target SLA | Warning Threshold | Critical Alert | SRE Action |
|---|---|---|---|---|
| Receipt Sealing Latency (p95) | < 10 ms | > 25 ms | > 50 ms | Check CPU throttling and disk IOPS |
| Receipt Verification Latency (p99) | < 60 ms | > 100 ms | > 200 ms | Check crypto thread pool saturation |
| Replay Rejection Rate | < 0.1% | > 2% | > 10% | Investigate potential replay attack or client retry storm |
| 5xx Server Error Rate | 0.00% | > 0.05% | > 0.5% | Inspect API error logs and database connection pool |
| Sled Storage Utilization | < 70% | > 80% | > 90% | Expand `/var/lib/vardhan` persistent volume |

---

## 6. Incident Response Playbooks

### Playbook 1: Elevated Replay Rate / Suspected Replay Attack
- **Trigger:** Metric `qcore_replay_rejection_total` spikes above normal threshold.
- **Verification:**
  1. Inspect ingress audit log: `GET /api/v1/audit/events?type=replay_rejection`.
  2. Identify client tenant ID and incoming IP addresses.
  3. Determine if caused by client network timeout retry loop or malicious replays.
- **Remediation:**
  - If client retry bug: coordinate with client to implement exponential backoff with jitter.
  - If malicious: apply edge rate limiting or IP blocklist at the reverse proxy (Caddy / Envoy).

### Playbook 2: Cryptographic Signature Verification Failure
- **Trigger:** Independent verifier reports `VerificationStatus::Invalid` on incoming receipt.
- **Verification:**
  1. Inspect verifier failure code: `tampered_hash`, `ed25519_invalid`, or `ml_dsa_87_invalid`.
  2. Verify if the issuer key referenced in the receipt exists in the trusted public key directory.
  3. Recompute canonical hash of the payload to confirm whether payload bytes were modified in transit.
- **Remediation:**
  - If payload hash mismatch: transaction was altered after sealing; reject transaction and notify compliance / SOC.
  - If key missing: distribute updated public key directory bundle to verifier nodes.

### Playbook 3: Cold Disaster Recovery Restore
- **Trigger:** Complete host failure or storage volume corruption.
- **Remediation:**
  1. Provision a new server meeting minimum requirements (8 GB RAM, 4 vCPUs, Linux 5.15+).
  2. Extract the latest verified backup:
     ```bash
     tar -xzf /mnt/backups/vardhan_data.tar.gz -C /var/lib/vardhan
     ```
  3. Run preflight diagnostics:
     ```bash
     ./scripts/server_preflight.sh
     ```
  4. Start the service and run verification:
     ```bash
     ./lab_demo_verify.sh
     ```
  5. Verify that all 5 verification checks pass before redirecting live network traffic.
