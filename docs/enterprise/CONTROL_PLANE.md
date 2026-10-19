# Enterprise Control Plane

## Scope
Phase 1 engineering contract for Vardhan Q Core.

## Required boundaries
- Tenant → organization → project → environment isolation
- User identity → role → permission evaluation
- Asset → owner → environment association
- Policy → scope → version → enforcement state
- Secret/key reference → provider → lifecycle metadata
- Audit event → actor → tenant → resource → action → outcome

## Security invariants
1. No tenant-scoped object may be read or mutated across tenant boundaries.
2. Authorization is deny-by-default.
3. Administrative actions are auditable.
4. Secrets and private keys are never persisted in plaintext application records.
5. Policy changes are versioned and attributable.
6. Existing Q-Core trust, receipt, ledger and crypto paths remain authoritative for security transactions.

## Delivery order
1. Domain model and persistence
2. RBAC and authorization middleware
3. Tenant isolation tests
4. Asset and policy APIs
5. Audit events
6. Health/notifications
7. Entitlements
8. Admin UI integration

## Completion evidence
The phase is complete only when unit, integration and tenant-isolation tests pass and the resulting APIs are documented.
