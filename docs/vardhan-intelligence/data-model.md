# Vardhan Intelligence — Data Model

## Canonical Data Structures

### Observation

```typescript
interface Observation {
  id: string;                           // Unique observation ID
  source: string;                       // Source identifier
  source_type: SourceType;              // API_REST | WEB_CRAWL | DNS | CERT | etc.
  entity_id: string;                    // Resolved entity (or pending)
  observed_at: string;                  // ISO timestamp from source
  collected_at: string;                 // ISO timestamp collected
  first_seen: string;                   // First time this value observed
  last_seen: string;                    // Last time this value observed
  raw_reference: string;                // Raw reference (URL, identifier)
  normalized_value: string;             // Normalized/parsed value
  confidence: number;                   // 0.0 - 1.0
  source_reliability: 'HIGH' | 'MEDIUM' | 'LOW';
  verification_state: 'RAW' | 'NORMALIZED' | 'CORRELATED' | 'VERIFIED' | 'REJECTED';
  freshness: 'FRESH' | 'STALE' | 'UNKNOWN';
  corroboration_count: number;          // Independent confirmations
  contradicts: string[];                // IDs of contradicting observations
}
```

### Entity

```typescript
interface Entity {
  id: string;                           // Canonical entity ID
  type: 'ORGANIZATION' | 'ASSET' | 'DOMAIN' | 'IP' | 'PERSON' | 'VENDOR' | 'REPOSITORY';
  canonical_identifier: string;         // Canonical form (e.g., "company.com")
  aliases: string[];                    // Known aliases
  relationships: EntityRelationship[];  // Links to other entities
  confidence: number;                   // 0.0 - 1.0
  first_seen: string;
  last_seen: string;
  resolution_state: 'EXACT' | 'HIGH_CONFIDENCE' | 'PROBABLE' | 'UNCERTAIN';
}

interface EntityRelationship {
  target_entity_id: string;
  relationship_type: 'OWNS' | 'HOSTS' | 'DEPENDS_ON' | 'VENDORS' | 'SUBDOMAIN_OF';
  confidence: number;
  evidence: string[];                  // Observation IDs supporting this relationship
}
```

### Exposure

```typescript
interface Exposure {
  id: string;
  asset_id: string;                     // Entity ID of the exposed asset
  exposure_type: 'PUBLIC_SERVICE' | 'EXPOSED_DATABASE' | 'MISCONFIGURATION' |
                'CREDENTIAL_EXPOSURE' | 'VULNERABLE_SERVICE' | 'THREAT_INFRASTRUCTURE';
  evidence: EvidenceRef[];
  confidence: number;
  first_seen: string;
  last_seen: string;
  status: 'ACTIVE' | 'REMEDIATED' | 'MITIGATED' | 'ACCEPTED';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  attack_path?: AttackPath[];           // If entry-point intelligence
}
```

### IntelligenceFinding

```typescript
interface IntelligenceFinding {
  id: string;
  category: 'EXPOSURE' | 'VULNERABILITY' | 'THREAT' | 'ENTRY_POINT' | 'ANOMALY';
  entity_ids: string[];                 // Related entities
  evidence: EvidenceRef[];
  confidence: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  attack_path?: AttackPath;             // For entry-point intelligence
  provenance: Provenance;
  verification_state: 'CORRELATED' | 'VERIFIED' | 'REJECTED';
  materiality: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  differential_state: 'CONFIRMED_MISMATCH' | 'MATCH' | 'UNKNOWN';
  expected_behavior: string;
  observed_behavior: string;
  technical_area: string;
  technical_mechanism: string;
  benign_explanation?: string;
  contradictory_evidence_ids: string[];
  uncertainty: string[];
}
```

### AttackPath

```typescript
interface AttackPath {
  steps: AttackPathStep[];
  confidence: number;
  risk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  estimated_difficulty: 'TRIVIAL' | 'LOW' | 'MEDIUM' | 'HIGH';
}

interface AttackPathStep {
  asset_id: string;
  technique: string;                    // e.g., "T1190" (CVE exploitation)
  description: string;
  evidence: EvidenceRef[];
  confidence: number;
}
```

### EvidenceRef

```typescript
interface EvidenceRef {
  evidence_id: string;
  public_url: string;
  content_hash: string;                 // Full SHA-256 hex (64 chars)
  temporal_status: 'CURRENT' | 'HISTORICAL';
  evidence_origin: 'REAL_PUBLIC_OBSERVATION' | 'CONTEXT_ARTIFACT';
  is_context_artifact: boolean;
}
```

### VerifiedFindingContract

The formal contract between Intelligence and Q Core. Must pass all 22
TrustBoundaryValidator checks.

```typescript
interface VerifiedFindingContract {
  schema_version: string;               // FINDING_CONTRACT_VERSION
  finding_id: string;
  intelligence: {
    engine_id: string;
    engine_version: string;
    run_id: string;
  };
  organization: {
    organization_id: string;
    canonical_domain: string;
  };
  affected_resource: {
    canonical_url: string;
    surface_type: string;
    entry_point_id: string;
  };
  technical_area: string;
  technical_mechanism: string;
  expected_behavior: string;
  observed_behavior: string;
  differential_state: 'CONFIRMED_MISMATCH';
  materiality: 'HIGH' | 'MEDIUM' | 'LOW';
  evidence_refs: EvidenceRef[];
  provenance_chain: {
    expectation_id: string;
    observation_ids: string[];
    differential_id: string;
    hypothesis_id: string;
    verification_contract_id: string;
  };
  contradictory_evidence_ids: string[];
  uncertainty: string[];
  benign_explanation: string;
  authorization_context: {
    requires_authorized_assessment: boolean;
    authorized_by?: string;
  };
  decision_candidate: string;           // Must be "SEAL_VERIFIED_FINDING"
  policy_reference: string;             // Must be "VARDHAN_CORE_INTELLIGENCE_POLICY_V1"
  created_at: string;
  evidence_earliest_retrieved_at: string;
  evidence_latest_retrieved_at: string;
}
```

## Data Quality Attributes

Every Observation must carry provenance. Every EvidenceRef must carry a full
SHA-256 hash. Every Finding must carry confidence and verification state.

## Existing Implementations

The following existing modules implement parts of this data model:

- `VerifiedFindingContract.ts` — the formal contract
- `IntelligenceCase.ts` — intelligence case model
- `DeepTypes.ts` — technical data types
- `EvidenceLedger.ts` — evidence storage with hashing
- `findings/ProblemFinding.ts` — finding representation
- `findings/FindingGraph.ts` — finding correlation graph
