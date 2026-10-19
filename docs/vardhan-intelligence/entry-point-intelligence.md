# Vardhan Intelligence — Entry-Point Intelligence

## Purpose

Identify possible initial-access paths. This is a FIRST-CLASS Vardhan
Intelligence capability.

## Entry-Point Categories

| Category | Description |
|---|---|
| PHISHING | Phishing infrastructure targeting organization |
| CREDENTIAL_EXPOSURE | Credentials found in breaches, repos, pastes |
| EXPOSED_SERVICE | Publicly accessible service (RDP, SSH, VPN, etc.) |
| VULNERABLE_SERVICE | Public service with known vulnerability |
| CLOUD_MISCONFIG | Cloud resource misconfiguration |
| EXPOSED_STORAGE | Exposed S3 bucket, database, file share |
| EXPOSED_SECRETS | Secrets/credentials in public repositories |
| SUPPLY_CHAIN | Third-party/vendor compromise |
| THREAT_INFRA | Known malicious infrastructure targeting org |
| IDENTITY_WEAKNESS | Weak identity controls (MFA disabled, etc.) |
| ADMIN_INTERFACE | Public administrative interface |
| COMPROMISED_ACCOUNT | Evidence of account compromise |
| VULNERABLE_DEPS | Dependencies with known vulnerabilities |
| INSIDER | Insider-related indicators |
| WATERING_HOLE | Compromise of sites org frequents |

## Attack Path Model

```
Asset
  │
  ▼
Exposure (publicly reachable?)
  │
  ▼
Technology (what is running?)
  │
  ▼
Vulnerability (known CVE/cwe?)
  │
  ▼
Threat Activity (is it exploited?)
  │
  ▼
Access Path (how to get in?)
  │
  ▼
Evidence (proof)
  │
  ▼
Confidence (how sure?)
  │
  ▼
Risk (impact if exploited)
```

## Current Implementation

| Module | Purpose |
|---|---|
| `discovery/ExternalAttackSurfaceExpansionEngine.ts` | Surface expansion |
| `discovery/ExternalBoundaryCapabilityEngine.ts` | Boundary capability mapping |
| `discovery/ExternalSurfaceDisciplerationEngine.ts` | Surface discovery |
| `discovery/ExposureCorrelationEngine.ts` | Exposure correlation |
| `discovery/ExposureNarrativeGenerator.ts` | Narrative generation |
| `discovery/HybridProbeEngine.ts` | Hybrid probing |
| `discovery/SurfaceInvestigationPrioritizer.ts` | Prioritization |
| `discovery/SurfaceSemanticValidator.ts` | Semantic validation |

## Entry-Point Intelligence Quality

Every entry-point finding must answer:

1. **WHAT?** — What is the entry point? (e.g., exposed SSL-VPN)
2. **WHERE?** — Where is it? (e.g., `vpn.company.com`)
3. **WHEN?** — When was it observed?
4. **WHY?** — Why is it an entry point? (vulnerable + exposed + targeted)
5. **HOW?** — How could an attacker exploit it?
6. **EVIDENCE?** — What proof supports this finding?
7. **CONFIDENCE?** — How confident are we?
8. **RISK?** — What is the risk if exploited?

## Do Not Claim Without Evidence

Do not label an asset as an "entry point" without sufficient evidence:

- The asset must be publicly reachable
- It must run a known-vulnerable technology
- There must be threat intelligence showing active exploitation
- Evidence must be corroborated by multiple sources

## Improvement Roadmap

1. Implement structured attack-path model.
2. Add entry-point narrative generation (human-readable explanation).
3. Add entry-point confidence scoring.
4. Add entry-point risk scoring.
5. Add entry-point remediation tracking.
