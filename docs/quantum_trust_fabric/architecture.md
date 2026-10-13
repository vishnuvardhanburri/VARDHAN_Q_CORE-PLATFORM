# Vardhan Quantum Trust Fabric: Architecture & Data Model

The Quantum Trust Fabric (QTF) is a solution layer that integrates **Vardhan Intelligence** (for discovery and reasoning) and **Vardhan Q Core** (for authorization and evidence).

## 1. The Core Workflow (The Vertical Slice)

`Inventory Ingestion` $\rightarrow$ `Asset Classification` $\rightarrow$ `Risk Prioritization` $\rightarrow$ `Migration Blueprint` $\rightarrow$ `Q Core Authorization` $\rightarrow$ `Migration Execution` $\rightarrow$ `Verification` $\rightarrow$ `Migration Passport`.

## 2. Data Model: The Quantum Exposure Graph

Every node in the graph is an **Evidence-Backed Asset**.

### Cryptographic Asset Schema
- `asset_id`: Unique identifier.
- `type`: (e.g., "Certificate", "SSH Key", "API Key", "KMS Key").
- `algorithm`: The current algorithm (e.g., "RSA-2048", "ECDSA-P256").
- `role`: The purpose (e.g., "Identity", "Encryption", "Digital Signature").
- `location`: Path, URL, or system identifier.
- `dependencies`: List of systems/applications relying on this asset.
- `confidence`: 0.0 - 1.0 based on the source of evidence.
- `quantum_risk_score`: Calculated based on algorithm and data sensitivity.

### Migration Blueprint Schema
- `blueprint_id`: Unique identifier.
- `asset_id`: Link to the target asset.
- `current_state`: Current algorithm and configuration.
- `target_state`: Recommended PQ algorithm (e.g., "ML-DSA-87", "ML-KEM-1024").
- `rationale`: Explainable reason for the recommendation based on NIST standards.
- `dependencies`: Assets that must be migrated first.
- `acceptance_criteria`: Tests required to mark the migration as successful.
- `rollback_plan`: Steps to revert to the classical state.

## 3. The Quantum Migration Passport (Evidence Record)

The Passport is a high-assurance record produced by **Q Core**. It is essentially a sequence of linked, dual-signed receipts.

**Passport Fields:**
- `passport_id`: UUID.
- `migration_id`: Link to the Blueprint.
- `authorization_receipt`: Q Core receipt proving the change was approved.
- `execution_evidence`: Fingerprints of the configuration before and after.
- `verification_receipt`: Q Core receipt proving the new configuration was independently verified.
- `timestamp_chain`: Chronological record of events.
- `final_status`: (e.g., "COMPLETED", "PARTIAL", "FAILED").

## 4. Component Integration Map

| QTF Layer | Implementation Point | Engine Used | Role |
| :--- | :--- | :--- | :--- |
| **Discovery** | `intelligence_plane/src/services` | Intelligence | Inventory and Asset Classification |
| **Risk Engine** | `intelligence_plane/src/utils` | Intelligence | Explainable Prioritization |
| **Blueprint** | `intelligence_plane/src/services` | Intelligence | Migration Planning |
| **Authorization** | `backend/control_plane_api` | Q Core | Policy-based approval of Blueprints |
| **Evidence/Seal** | `backend/vardhan_receipt` | Q Core | Dual-signed Migration Passports |
| **Verification** | `backend/vardhan_verifier` | Q Core | Independent Passport validation |
