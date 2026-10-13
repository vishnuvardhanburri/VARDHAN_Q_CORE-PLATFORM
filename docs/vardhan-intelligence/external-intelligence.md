# Vardhan Intelligence — External Intelligence

## Purpose

Collect, normalize, and verify intelligence from external sources.

## Current External Sources

| Provider | Module | Source Type |
|---|---|---|
| Serper Search | `SerperSearchProvider.ts` | Web search |
| Serper Web Search | `SerperWebSearchProvider.ts` | Web search |
| GitHub | `GitHubProvider.ts` | Code repository |
| GitHub Web | `GitHubWebProvider.ts` | Web scraping |
| Passive Recon | `PassiveReconProvider.ts` | Passive DNS/IP |
| Job Signal | `market/JobSignalProvider.ts` | Job posting intel |
| Human Telemetry | `HumanTelemetryProvider.ts` | People/infra data |
| CSV Dataset | `CSVProvider.ts` | Structured dataset |
| Public Dataset | `PublicDatasetProvider.ts` | Public bulk data |
| Growjo | `GrowjoProvider.ts` | Company intelligence |
| JS Bundle Analyzer | `JSBundleAnalyzer.ts` | Frontend analysis |
| Live Web Research | `LiveWebSearchProvider.ts` | Real-time web |
| Public Source Graph | `PublicSourceGraph.ts` | Public graph data |

## Intelligence Categories

- Domains and subdomains
- IP addresses
- ASN
- DNS records
- TLS certificates
- Public cloud assets
- Internet-facing services
- Technology fingerprints
- Exposed web applications
- APIs
- Public repositories
- Leaked-secret indicators
- Vulnerability intelligence
- Known exploited vulnerabilities
- Threat infrastructure
- Malicious infrastructure
- Malware indicators
- Phishing infrastructure
- Threat actors and campaigns
- Organizations and vendors
- Supply-chain relationships
- Public breach indicators
- Security advisories and disclosures
- Exploit intelligence
- Technology lifecycle
- Authentication surfaces

## Provenance Requirements

Every external observation must carry:

```typescript
{
  source: "serper-web-search",
  source_type: "WEB_SEARCH",
  collection_time: "2026-10-04T14:30:00Z",
  observation_time: "2026-10-04T14:25:00Z",
  first_seen: "2026-10-04T14:25:00Z",
  last_seen: "2026-10-04T14:25:00Z",
  raw_reference: "https://example.com/page",
  normalized_value: "example.com",
  entity_id: "ent_abc123",
  confidence: 0.91,
  source_reliability: "HIGH",
  verification_state: "VERIFIED"
}
```

## Source Reliability Scoring

| Reliability | Criteria |
|---|---|
| HIGH | Direct API, authoritative source, structured data |
| MEDIUM | Web scraping, requires parsing, some noise |
| LOW | User-submitted, unverified, high noise potential |

## Data Flow

```
External Source
    │
    ▼
RawObservation
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
EntityResolution
    │
    ▼
Correlation
    │
    ▼
ConfidenceScoring
    │
    ▼
Finding (RAW → NORMALIZED → CORRELATED → VERIFIED)
    │
    ▼
VerifiedFindingContract
    │
    ▼
Trust Boundary (22 checks)
    │
    ▼
Q Core
```

## Current Gaps

1. **Source reliability scoring** is not implemented programmatically —
   currently manual.
2. **Automatic freshness tracking** — `LastSeen` updates need automation.
3. **Confidence calibration** — confidence is heuristic, not statistically
   calibrated.
4. **Corroboration counting** — no automatic multi-source confirmation.

## Improvement Roadmap

1. Implement source reliability scoring engine.
2. Add freshness tracking to all observations.
3. Add confidence calibration based on historical accuracy.
4. Add automatic corroboration counting.
5. Add contradiction detection for conflicting observations.
