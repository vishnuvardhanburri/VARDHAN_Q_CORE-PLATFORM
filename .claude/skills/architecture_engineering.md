---
name: architecture-engineering
description: Guide for navigating and modifying the Vardhan codebase while preserving architectural boundaries.
---

# Vardhan Architecture and Engineering Skill

## Scope
This skill covers the end-to-end engineering lifecycle of the Vardhan platform, focusing on the interaction between the Intelligence Plane (Discovery/Risk) and the Control Plane (Authorization/Evidence).

## Mandatory Checks
- **Boundary Preservation**: Ensure changes in `intelligence_plane` do not bypass `control_plane_api` when modifying state.
- **Contract Adherence**: Any change to API response formats must be reflected in `api/openapi.yaml` and corresponding SDKs.
- **Persistence Integrity**: Changes to Sled DB keys must follow the prefix patterns defined in `backend/control_plane_api/src/lib.rs`.
- **No Shadow Architectures**: Do not implement a second "receipt" or "passport" logic; use existing `vardhan_receipt` and `passport_api`.

## Failure Conditions
- Introducing circular dependencies between `backend` crates.
- Bypassing the `auth_service` middleware for protected routes.
- Modifying cryptographic primitives without updating corresponding verification logic in `vardhan_verifier`.

## Engineering Workflow
1. **Trace**: Identify the entry point (e.g., a route in `lib.rs`) and follow the call stack to the service logic.
2. **Implement**: Apply changes following the naming and idiomatic patterns of the surrounding code.
3. **Verify**: Run associated unit tests and the `e2e_vertical_slice.sh` or `qtf_passport_demo.sh` scripts.
4. **Document**: Update `ARCHITECTURE.md` if a structural change was made.
