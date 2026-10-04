# Vardhan Intelligence — Data Quality

## Data Quality Framework

Vardhan Intelligence prioritizes DATA QUALITY above all. Intelligence that
cannot be attributed, verified, or correlated is noise.

## Observation Quality Attributes

| Attribute | Description | Minimum Requirement |
|---|---|---|
| Provenance | Source attribution | Must have source + source_type |
| Freshness | Data age | Must have observation_time |
| Confidence | Quality score | Must have confidence level |
| Source Reliability | Trust in source | Must have reliability rating |
| Corroboration | Independent confirmation | Minimum 1 source |
| Contradiction State | Conflicting data | Must be resolved or flagged |
| Verification State | Verification status | RAW/NORMALIZED/CORRELATED/VERIFIED/REJECTED |

## Quality Gates

### Gate 1: Source Attribution
Every observation must carry:
- `source` (who collected it)
- `source_type` (API_REST, WEB_CRAWL, DNS, etc.)
- `collection_time` (when collected)
- `observation_time` (when observed at source)
- `first_seen` / `last_seen` (temporal bounds)

### Gate 2: Evidence Integrity
Every evidence item must carry:
- `evidence_id` (unique identifier)
- `public_url` (source URL)
- `content_hash` (full SHA-256, no truncation)
- `temporal_status` (CURRENT or HISTORICAL)
- `evidence_origin` (REAL_PUBLIC_OBSERVATION or CONTEXT_ARTIFACT)
- `is_context_artifact` (boolean)

### Gate 3: Entity Resolution
Entities must have:
- Canonical IDs (no silent merges)
- Resolution state (EXACT/HIGH_CONFIDENCE/PROBABLE/UNCERTAIN)
- Explicit contradiction handling
- Relationship tracking (organization → asset → technology → vulnerability)

### Gate 4: Confidence Scoring
Every finding must have:
- Confidence level (based on source reliability + corroboration)
- Materiality (HIGH/MEDIUM/LOW)
- Risk context (based on exposure + threat activity)
- Temporal state (fresh/stale)

### Gate 5: Verification
Only VERIFIED findings cross the trust boundary:
- `FindingVerificationEngine` promotes findings
- `VerifiedFindingContract` is the formal contract
- `TrustBoundaryValidator` runs 22 checks
- No intelligence bypasses Q Core authority

## Data Flow

```
Observation
  │
  ├── Source Attribution (mandatory)
  ├── Evidence Hashing (full SHA-256)
  ├── Entity Resolution (explicit, no silent merges)
  ├── Confidence Scoring (multi-factor)
  ├── Freshness Check (temporal bounds)
  ├── Corroboration (multiple sources)
  ├── Contradiction Detection (conflict resolution)
  ├── Finding Generation (only from verified evidence)
  └── VerifiedFindingContract (formal contract to Q Core)
```

## Quality Violations

| Violation | Action |
|---|---|
| Missing source attribution | Observation rejected |
| Missing evidence hash | Evidence rejected |
| Hash mismatch | Finding rejected |
| Historical evidence as current | Finding rejected |
| Uncorroborated single-source | Confidence lowered |
| Contradictory evidence | Finding flagged for review |
| Low confidence (< threshold) | Finding not forwarded to Q Core |
| Duplicate entity | Merged with resolution state |
| Stale observation (> 7 days) | Freshness flag set |
