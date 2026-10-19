# Vardhan Intelligence — Internal Intelligence

## Purpose

Collect, normalize, and verify intelligence from internal sources. External and
internal observations must be correlatable.

## Internal Sources

| Source | Type | Description |
|---|---|---|
| Asset Inventory | Asset | Registered assets (servers, endpoints, containers) |
| IAM System | Identity | Users, service accounts, roles, groups |
| Cloud Provider APIs | Config | Cloud asset inventory, configurations |
| Kubernetes | Config | Cluster state, pod manifests, RBAC |
| Network | Config | Firewall rules, network flow, routing |
| Database | Config | Database inventory, schemas, access patterns |
| Logs | Event | SIEM, application logs, audit logs |
| Security Alerts | Event | SIEM/SOAR alerts, IDS/IPS |
| Vulnerability Scanner | Scan | Scan results (Qualys, Tenable, etc.) |
| Configuration Management | Config | Ansible/Puppet/Chef state |
| Certificate Manager | Cert | TLS certificate inventory |
| Key Management | Key | Key inventory and lifecycle |
| CI/CD | Pipeline | Build/deploy state, pipeline config |
| Repositories | Code | Git repository metadata, dependencies |
| Security Tooling | Tool | SAST/DAST/SCM tools output |
| Endpoint Agents | Telemetry | EDR, host telemetry |

## Data Flow

```
Internal Source
    │
    ▼
InternalObservation
    │
    ▼
SourceAttribution (mandatory)
    │
    ▼
Normalization
    │
    ▼
Evidence (with full SHA-256 hash)
    │
    ▼
EntityResolution (correlates with external entities)
    │
    ▼
Correlation (external + internal)
    │
    ▼
ConfidenceScoring
    │
    ▼
Finding
    │
    ▼
VerifiedFindingContract
    │
    ▼
Trust Boundary → Q Core
```

## Correlation Example

```
External Observation:  "vpn.company.com has exposed SSL-VPN"
Internal Observation:  "vpn.company.com is in asset inventory (IT-owned)"
Internal Observation:  "vpn.company.com runs FortiOS 7.2.5"
Vulnerability Intel:   "CVE-2022-39952 affects FortiOS 7.2.5 (CVSS 9.8)"
Threat Intel:          "APT28 exploits CVE-2022-39952 in SSL-VPNs"

Correlation Result:
  Asset:       vpn.company.com (confirmed internal)
  Technology:   FortiOS 7.2.5 (confirmed)
  Vulnerability: CVE-2022-39952 (confirmed)
  Exposure:      Publicly reachable SSL-VPN (confirmed)
  Threat:        APT28 active exploitation (corroborated)

Finding: HIGH-CONFIDENCE INITIAL ACCESS EXPOSURE
  - SSL-VPN (vpn.company.com) exposed to internet
  - Running vulnerable FortiOS 7.2.5 (CVE-2022-39952, CVSS 9.8)
  - Known APT28 exploitation activity targeting this CVE
  - Entry point: SSL-VPN portal → credential compromise → internal network access
```

## Internal Intelligence Collection Strategy

1. **Asset inventory sync** — periodic pull from CMDB.
2. **IAM sync** — periodic pull of users, service accounts, roles.
3. **Cloud API polling** — periodic config snapshots.
4. **Log streaming** — continuous ingestion of audit/security logs.
5. **Vulnerability scan integration** — periodic scan result import.
6. **Certificate/key inventory** — periodic TLS cert and key inventory.
7. **CI/CD integration** — pipeline event ingestion.

## Security Boundaries

- Internal observations are never directly exposed externally.
- Internal source credentials are stored in HSM/KMS, never plaintext.
- Internal observation collection is read-only.
- Internal and external entity IDs use the same canonical namespace
  for correlation.

## Current Implementation

Internal intelligence sources are partially implemented in:
- `intelligence_plane/src/server/enterprise_tenant/` (Rust backend has `enterprise_tenant` crate)
- `intelligence_plane/src/server/VardhanSystemManager.ts`
- `intelligence_plane/src/server/system/VardhanSystemManager.ts`

Full internal intelligence collection pipeline is a work in progress.
