# Vardhan Intelligence — Architecture

**Pillar:** Vardhan Intelligence
**Tagline:** BE DIFFERENT

## Purpose

**DISCOVER → CORRELATE → UNDERSTAND → VERIFY**

Vardhan Intelligence is the intelligence and discovery layer of the Vardhan
Technologies unified platform. It aggressively discovers security-relevant
intelligence from external and internal sources, correlates findings, and
produces verified intelligence that crosses the trust boundary into Vardhan
Q Core.

## Core Principle

> Intelligence may discover. Only Q Core may authorize trusted execution.

Vardhan Intelligence MUST NOT directly execute privileged security actions.
It produces `VerifiedFindingContract` objects that are the sole input to
the Q Core trust boundary.

## Architecture

```
External Sources     Internal Sources
       │                   │
       ▼                   ▼
  Collection         Collection
       │                   │
       ▼                   ▼
 Normalization      Normalization
       │                   │
       ▼                   ▼
Entity Resolution ◄──► Entity Resolution
       │                   │
       ▼                   ▼
   Enrichment          Enrichment
       │                   │
       ▼                   ▼
 Correlation          Correlation
       │                   │
       ▼                   ▼
 Verification         Verification
       │                   │
       ▼                   ▼
Confidence Scoring ◄─► Confidence Scoring
       │                   │
       └────────┬──────────┘
                ▼
      Intelligence Finding
                │
                ▼
 VerifiedFindingContract  ←── Trust Boundary
                │
                ▼
          Q Core Gateway
```

## Module Map (intelligence_plane/src/server/)

| Module | Responsibility |
|---|---|
| `VardhanOperator.ts` | Interactive terminal operator entry point |
| `IntelligenceEngine.ts` | Core observation → evidence → finding → owner pipeline |
| `LivePublicObservationProvider.ts` | Real public observation (production mode) |
| `LiveWebResearchProvider.ts` | Web research with real-time browsing |
| `PublicLinkDiscovery.ts` | Bounded same-origin professional page discovery |
| `PeopleExtractor.ts` | Public people/owner extraction |
| `OwnerSelector.ts` | Evidence-backed owner selection |
| `DeepProspectBuilder.ts` | Deep company profiling |
| `DeepSignalExtractor.ts` | Signal extraction from observations |
| `DeepEmailGenerator.ts` | Email generation for outreach |
| `IcpQualificationEngine.ts` | ICP (Ideal Customer Profile) qualification |
| `ContactabilityFinder.ts` | Contactability assessment |
| `DomainResolver.ts` | Domain resolution |
| `GitHubDiscovery.ts` | GitHub-based discovery |
| `CompanyQueue.ts` | Company research queue |
| `SourceDiscoveryOrchestrator.ts` | External source discovery orchestration |
| `DiscoveryQualityGate.ts` | Discovery quality gates |

### Intelligence Submodules

| Directory | Purpose |
|---|---|
| `discovery/` | External boundary discovery, attack surface expansion |
| `findings/` | Finding generation, noise filtering, opportunity detection |
| `research/` | Hypothesis, triage, research budget, research controller |
| `signals/` | Signal correlation engine |
| `freshness/` | Temporal change detection |
| `knowledge/` | Knowledge integration layer |
| `extractors/` | Technical entity/extractors |
| `specialists/` | Specialist intelligence modules |
| `types/` | Type definitions |
| `integration/` | Integration tests |
| `providers/` | External data source providers |
| `system/` | System-level managers (VardhanSystemManager, etc.) |

## Intelligence Pipeline Stages

### Stage 1: Collection

- **Sources:** Public DNS, TLS certificates, cloud asset APIs, GitHub/GitLab,
  Shodan/Censys, public breaches, threat feeds, GitHub, serper web search,
  job signals.
- **Providers:** `ProviderRegistry` manages all source providers.
- **Attribution:** Every observation carries source, source_type,
  collection_time, observation_time, first_seen, last_seen.

### Stage 2: Normalization

- Raw observations are normalized into canonical `Evidence` objects.
- `EvidenceLedger.hashContent()` computes full SHA-256 hashes (no truncation).
- Evidence is stored with provenance metadata.

### Stage 3: Entity Resolution

- `EntityResolver` resolves duplicate entities.
- Resolution states: EXACT, HIGH_CONFIDENCE, PROBABLE, UNCERTAIN.
- Canonical entity IDs maintained.
- `OrganizationIdentityGraph` tracks organization→asset→technology relationships.

### Stage 4: Enrichment

- Assets are enriched with technology fingerprints, vulnerability data,
  threat actor associations, and contextual information.
- `DeepProspectBuilder` and `DeepSignalExtractor` perform deep enrichment.

### Stage 5: Correlation

- `SignalCorrelationEngine` and `DiscoveryQualityGate` correlate related signals.
- `TrendAndChangeIntelligenceEngine` tracks temporal changes.
- `ExternalSurfaceIntelligenceService` provides surface-level correlation.

### Stage 6: Verification

- `FindingVerificationEngine` verifies finding legitimacy.
- `ExpectationEngine` checks expected vs observed behavior.
- `DifferentialFindingEngine` generates differential findings.
- Only VERIFIED findings proceed to contract generation.

### Stage 7: Confidence Scoring

- Findings are scored for confidence based on:
  - Source reliability
  - Evidence corroboration
  - Freshness
  - Provenance quality
  - Contradiction state
- `EvidenceScoringEngine` assigns confidence scores.

### Stage 8: Contract Generation

- Verified findings are converted to `VerifiedFindingContract` via
  `VerificationToContractAdapter`.
- The contract is the formal interface to Q Core.
- `trust_boundary.test.ts` validates all 22 checks before submission.

## Trust Boundary (Intelligence → Q Core)

The `TrustBoundaryValidator` (22 checks) enforces:

1. Schema version must match
2. Finding ID must be present
3. Organization ID must be present
4. Canonical URL must be present
5. Evidence refs must be non-empty
6. Evidence must be resolvable in store
7. Evidence temporal status must be CURRENT
8. Evidence must not be a context artifact
9. Content hash must match (full SHA-256)
10. Contradictory evidence IDs must be explicit array
11. Differential state must be CONFIRMED_MISMATCH
12. Materiality must be HIGH/MEDIUM/LOW
13. Provenance chain must be complete
14. Authorization context must be present
15. Engine ID must be present
16. Canonical domain must be present
17. Entry point ID must be present
18. Evidence origin must be present
19. Observation IDs must be present
20. Verification contract ID must be present
21. Decision candidate must be authorized
22. Policy reference must be registered

## Data Quality

Every observation must answer:

| Question | Field |
|---|---|
| WHAT? | technical_area, technical_mechanism |
| WHERE? | organization.canonical_domain, affected_resource.canonical_url |
| WHEN? | evidence_earliest_retrieved_at, evidence_latest_retrieved_at |
| WHY? | expected_behavior, observed_behavior, differential_state |
| HOW? | evidence_refs, provenance_chain |
| SOURCE? | intelligence.engine_id, evidence_origin |
| EVIDENCE? | evidence_refs[].content_hash |
| CONFIDENCE? | materiality, differential_state |
| RISK? | materiality |
| LIKELY ENTRY POINT? | affected_resource.entry_point_id |

## Security Posture

- Vardhan Intelligence is **aggressive in discovery**.
- Vardhan Intelligence is **conservative in authorization**.
- Vardhan Intelligence **must not** directly execute privileged actions.
- All intelligence must pass Q Core verification before action.
- Evidence is hashed with full SHA-256 (no truncation).
- Idempotency is persistent (survives process restart).
- Source attribution is mandatory for every observation.
