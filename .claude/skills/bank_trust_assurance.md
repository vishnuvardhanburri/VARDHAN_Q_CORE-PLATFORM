---
name: bank-trust-assurance
description: Evaluation and documentation of product controls from a bank's operational risk and procurement perspective.
---

# Bank Trust and Supplier Assurance Skill

## Scope
Building the evidence required for a bank's vendor risk management (VRM) and procurement process.

## Mandatory Checks
- **Data Sovereignty**: Verify that the system supports deployment options where customer data never leaves the bank's perimeter.
- **Least Privilege**: Ensure the platform operates as a "read-only" observer by default.
- **Exit Strategy**: Document how a bank can retrieve all evidence and revoke all Vardhan access without losing their migration history.
- **Auditability**: Every action in the Control Plane must be linked to an authenticated identity and a timestamped ledger entry.

## Failure Conditions
- Claims of "production readiness" without accompanying test evidence or a security audit.
- Lack of a clear data-flow diagram showing trust boundaries.
- Relying on "trust us" instead of "verify this".

## Assurance Workflow
1. **Map**: Link a business requirement (e.g., "No data leakage") to a technical control (e.g., "Tenant Isolation in Sled DB").
2. **Evidence**: Produce a test log or a code snippet proving the control is active.
3. **Document**: Add the finding to the `Security Controls Matrix` in the Bank Trust Architecture docs.
