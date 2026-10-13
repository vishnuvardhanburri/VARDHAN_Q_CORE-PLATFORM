# Enterprise Demonstration Runbook: Vardhan Q Core & Intelligence

This document provides the step-by-step procedure for demonstrating the high-assurance integration between Vardhan Intelligence (Evidence Discovery) and Vardhan Q Core (Trust & Authorization).

## 1. Architecture Overview
The demonstration showcases the transition from a prototype (local binary calls) to an enterprise-ready network API.
- **Intelligence Plane:** Discovers findings and proposes a "Seal" request.
- **Control Plane API:** Acts as the secure gateway.
- **Receipt Engine (vardhan-receipt):** The high-assurance core that validates the contract, checks for replays, and applies hybrid signatures.

## 2. Environment Setup
Ensure the following components are running:
1. **Control Plane API:** `cargo run --release` in `backend/control_plane_api`.
2. **Receipt Engine:** Compiled binary available at `/Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE-PLATFORM-main/target/release/vardhan-receipt`.
3. **Auth Config:** Ensure `lab_config/auth_config.json` is present with valid tenant policies.

## 3. Demonstration Scenarios

### Scenario A: Successful High-Assurance Sealing
**Goal:** Demonstrate a valid evidence discovery being authorized and sealed.
- **Action:** Execute `./lab_demo_verify.sh --scenario valid`.
- **Expected Result:**
    - API returns `HTTP 200 OK`.
    - Receipt status is `SEALED`.
    - Presence of both `ed25519_sig` and `ml_dsa_87_sig`.

### Scenario B: Replay Attack Prevention
**Goal:** Demonstrate that the same finding cannot be sealed twice (Idempotency).
- **Action:** Execute the same "valid" request a second time.
- **Expected Result:**
    - Receipt engine detects the `finding_id` in the `sled` database.
    - Status returns `REJECTED_REPLAY`.

### Scenario C: Trust Boundary Violation
**Goal:** Demonstrate that malformed or unauthorized contracts are rejected.
- **Action:** Execute `./lab_demo_verify.sh --scenario malformed`.
- **Expected Result:**
    - Status returns `REJECTED_MALFORMED` or `REJECTED_UNAUTHORIZED`.

## 4. Commercial Validation
Navigate to the Frontend Dashboard:
- Verify the removal of legacy pricing claims.
- Confirm the **Phased Engagement Model**:
    - Stage 1: Architecture Evaluation (£15k)
    - Stage 2: Proof of Value (£60k)
