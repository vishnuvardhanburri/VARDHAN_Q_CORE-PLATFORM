# Enterprise Server Deployment Guide — Vardhan Q-Core

## 1. Executive Summary & Architecture

Vardhan Q-Core provides an authoritative cryptographic receipt and policy enforcement substrate designed for deployment inside Tier-1 banking environments. The system is engineered to operate strictly within institutional security boundaries with zero outbound internet dependencies.

### Supported Operating Models

1. **Air-Gapped Bare Metal / VM (systemd):** High-throughput, sub-millisecond execution for algorithmic trading desks and clearing pipelines.
2. **Hardened Container Appliance (Docker / Podman):** Standalone server deployment with PostgreSQL transactional durability and edge TLS termination.
3. **Institutional Kubernetes / OpenShift:** Enterprise orchestration via Helm chart with secret management integration.

---

## 2. Server Prerequisites

### Hardware Requirements
- **CPU:** Minimum 4 vCPUs (x86_64 with AVX2 or aarch64). Recommended: 8+ vCPUs.
- **Memory:** Minimum 8 GB RAM. Recommended: 16 GB+ RAM.
- **Storage:** Minimum 20 GB high-IOPS NVMe or SSD mounted at `/var/lib/vardhan`.
- **Entropy:** Hardware CSPRNG or reliable Linux `/dev/urandom` source.

### Network Ingress & Egress Rules
- **Ingress Port 443 (TCP):** Edge HTTPS proxy (Caddy / Ingress Controller).
- **Ingress Port 80 (TCP):** HTTP-to-HTTPS redirect.
- **Internal Port 8080 (TCP):** Control Plane API (bound strictly to `127.0.0.1` or internal overlay network).
- **Internal Port 5432 (TCP):** PostgreSQL (bound strictly to loopback or managed database cluster).
- **Egress:** Zero outbound internet access required (100% air-gap capable).

---

## 3. Pre-Flight Server Diagnostics

Before installing, execute the automated pre-flight diagnostic script on the target host:

```bash
./scripts/server_preflight.sh
```

The diagnostic validates:
- Supported Linux distribution (RHEL 8/9, Rocky Linux, Ubuntu LTS) and kernel version (>= 5.15).
- Sufficient RAM (>= 4GB required, >= 8GB recommended).
- Storage headroom on target volume.
- Port availability on 443, 80, 8080, 3000, and 5432.
- Entropy availability on `/dev/urandom`.
- Validity and expiry status of custom TLS certificates in `./certs`.

---

## 4. Deployment Model A: Hardened Container Appliance (Docker Compose)

### 1. Configure Environment
Copy the production environment template:
```bash
cp .env.example .env.enterprise
```

Edit `.env.enterprise` to supply enterprise configuration:
- `VARDHAN_ADMIN_PASSWORD`: High-entropy administrator credential (or provide via `VARDHAN_ADMIN_PASSWORD_FILE`).
- `POSTGRES_PASSWORD`: Transactional database credential.
- `VARDHAN_DOMAIN`: Fully qualified domain name (e.g., `qcore.internal.bank`).

### 2. Supply TLS Certificates
Place the bank's internal CA-signed certificates in `./certs`:
- `./certs/server.crt`
- `./certs/server.key`

### 3. Launch the Stack
```bash
docker compose -f docker-compose.enterprise.yml --env-file .env.enterprise up -d
```

### 4. Verify Health
```bash
curl -fsS https://127.0.0.1/api/v1/platform/health --insecure
```

---

## 5. Deployment Model B: Bare Metal / VM (systemd)

For trading desks requiring sub-millisecond latency without container virtualization overhead:

### 1. Provision System User & Directories
```bash
groupadd -g 10001 vardhan
useradd -u 10001 -g vardhan -m -d /var/lib/vardhan -s /sbin/nologin vardhan
mkdir -p /var/lib/vardhan/control-plane \
         /var/lib/vardhan/keystore \
         /var/lib/vardhan/idempotency \
         /var/lib/vardhan/auth_config \
         /etc/vardhan
chown -R vardhan:vardhan /var/lib/vardhan /etc/vardhan
chmod 750 /var/lib/vardhan
```

### 2. Install Release Binaries
```bash
cp target/release/control_plane_api /usr/local/bin/
cp target/release/vardhan-receipt /usr/local/bin/
cp target/release/vardhan_verifier /usr/local/bin/
chmod 755 /usr/local/bin/control_plane_api /usr/local/bin/vardhan-receipt /usr/local/bin/vardhan_verifier
```

### 3. Configure systemd Service
```bash
cp deploy/systemd/vardhan-control-plane.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now vardhan-control-plane
```

---

## 6. Deployment Model C: Kubernetes & OpenShift (Helm)

For cloud-native banking platforms (EKS, AKS, OpenShift):

```bash
# 1. Create dedicated namespace
kubectl create namespace vardhan-qcore

# 2. Provision database secret
kubectl create secret generic vardhan-db-secret \
  --from-literal=DATABASE_URL="postgres://user:pass@postgres-service:5432/vardhan" \
  -n vardhan-qcore

# 3. Deploy Helm chart
helm install vardhan-qcore deploy/helm/q-core \
  --namespace vardhan-qcore \
  --values deploy/helm/q-core/values.yaml
```

---

## 7. Air-Gapped Offline Packaging Runbook

To package the complete system for delivery into disconnected bank environments:

```bash
./scripts/package_offline_bundle.sh 2026.1-enterprise
```

This generates `dist/vardhan-qcore-2026.1-enterprise.tar.gz` containing:
- Pre-compiled release binaries (`control_plane_api`, `vardhan-receipt`, `vardhan_verifier`).
- Systemd service units and Docker Compose specifications.
- Helm chart and OpenShift manifests.
- Automated `install.sh` and pre-flight validation tooling.
