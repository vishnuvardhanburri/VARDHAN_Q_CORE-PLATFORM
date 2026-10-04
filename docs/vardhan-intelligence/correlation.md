# Vardhan Intelligence — Correlation

## Purpose

Correlate observations, entities, and findings across time, sources, and
dimensions to produce high-confidence intelligence.

## Correlation Dimensions

1. **Temporal** — Track changes over time (new exposures, disappearing services).
2. **Spatial** — Relate entities across IP ranges, domains, certificates.
3. **Thematic** — Group by threat actor, vulnerability, technology.
4. **Network** — Relate assets in the same network/service chain.
5. **Supply Chain** — Relate vendors, dependencies, third parties.
6. **Behavioral** — Relate anomalous patterns across multiple assets.

## Current Implementation

| Module | Purpose |
|---|---|
| `findings/FindingGraph.ts` | Finding correlation graph |
| `signals/SignalCorrelationEngine.ts` | Signal correlation |
| `discovery/ExposureCorrelationEngine.ts` | Exposure correlation |
| `discovery/OrganizationIdentityGraph.ts` | Organization entity graph |
| `discovery/SurfaceChangeDetectionEngine.ts` | Attack surface changes |

## Correlation Quality Gates

| Gate | Requirement |
|---|---|
| Multiple evidence types | At least 2 independent evidence types |
| Source diversity | Observations from different source types |
| Temporal consistency | Observations within reasonable time window |
| Entity resolution | Same canonical entity ID |
| Confidence threshold | Combined confidence ≥ 0.7 |

## Correlation Quality Checks

1. **Stale correlation** — if no new evidence in 7 days, lower confidence.
2. **Conflicting correlation** — if contradictory evidence emerges, flag.
3. **Source reliability degradation** — if a source becomes unreliable, lower
   confidence of all its corollaries.
4. **Duplicate correlation** — detect and merge duplicate correlations.

## Improvement Roadmap

1. Implement temporal correlation engine (track changes over time).
2. Add network-based correlation (IP range, ASN, certificate chain).
3. Add supply-chain correlation (vendor → product → vulnerability).
4. Add behavioral correlation (pattern matching across anomalies).
5. Implement correlation quality gates with automated scoring.
