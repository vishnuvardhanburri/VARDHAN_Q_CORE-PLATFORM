# Incident response and observability

Operational procedure proposed for adoption; owners, alert integrations and drills are
**NOT YET PROVEN**. Existing tracing and metrics do not establish a monitored service.

## Signals and minimum alerts

| Signal | Required action / initial threshold to validate |
|---|---|
| trust/key/policy/storage dependency unavailable | immediate admission denial and on-call page |
| signature/tenant/auth failures or replay spike | investigate against baseline; rate-limit without leaking content |
| unknown payment outcome or reconciliation backlog | immediate reconciliation; prohibit blind retry |
| quorum lost or conflicting committed state | fence dispatch and page operations/security |
| epoch quarantine, revoked key use, secret disclosure | isolate affected identities and preserve evidence |
| audit append/backup integrity failure | stop success responses; page and retain replay barriers |
| queue latency/storage exhaustion | alert before resource exhaustion using measured thresholds |

Dashboards must include request latency p50/p95/p99/max, throughput/error rates, queue age
and depth, rejection codes, storage/replication health, key-service availability and
reconciliation backlog. Tenant/transaction IDs should be minimised or pseudonymised;
never put secrets or payment payloads in labels/logs. No dashboard or alert delivery was
validated in this task.

## Response

1. Assign incident commander, security lead, operations lead and communications owner;
   record detection time and affected artifact/configuration/key epochs.
2. Contain by fencing admission or affected tenant/adapter, revoking compromised identity
   and quarantining epochs. Do not bypass mandatory validation to preserve availability.
3. Preserve restricted, hashed evidence: audit anchors, relevant redacted logs, configuration
   versions and durable transaction state. Do not collect unrestricted core dumps or tokens.
4. Rotate affected keys/credentials via authenticated custody workflow. Treat removal from
   Git as insufficient proof of rotation; assess historical clones and artifacts separately.
5. Reconcile unknown downstream outcomes; restore only verified backups and trusted epochs.
6. Verify negative tests and isolation before controlled restoration and owner approval.
7. Coordinate customer/operator/regulatory notifications with qualified counsel and contractual
   deadlines; record factual impact. Conduct a blameless review and track corrective actions.

Escalation contacts and regulatory notification applicability must be assigned by the owner
before deployment. No incident communication or credential rotation was sent/performed here.
