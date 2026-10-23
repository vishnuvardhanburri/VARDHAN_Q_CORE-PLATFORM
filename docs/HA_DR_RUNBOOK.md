# HA and disaster recovery runbook

**Procedure to validate; deployment RPO/RTO NOT YET PROVEN.** `ha_cluster` includes
Raft transport/ledger tests. Passing loopback tests is not production HA evidence.

## Failure policy

On quorum loss, conflicting configuration, stale key state or ambiguous persisted state,
fence admission and dispatch. Never acknowledge uncommitted work. Distinguish replicated
log receipt from quorum commitment and from downstream confirmation. Reconnect with
fresh authenticated sessions after key rotation; do not assume connection resumption.

## Recovery drill (isolated synthetic environment only)

1. Record commit, binaries, configuration hashes, node IDs, trust/key epoch, dataset and time source.
2. Snapshot the authoritative store consistently with audit anchors, receipt registry,
   schema versions and encrypted key metadata. Keep backup decryption custody separate.
3. Inject leader/follower termination, partitions/quorum loss, delayed/duplicate messages,
   disk full/corruption, skew and configuration mismatch. Record committed indices and responses.
4. Restore on fresh isolated nodes. Validate backup checksums, ledger signatures/chains,
   database invariants, tenant isolation and revoked-key enforcement before opening ingress.
5. Reconcile every in-flight/unknown downstream operation and replay the synthetic workload.
   Prove no conflicting successful outcomes across nodes or restored snapshots.
6. Measure last confirmed durable operation versus restored state (RPO) and time to safely
   resumed service (RTO); record p50/p95/p99/max, failures and manual steps.
7. Repeat during rolling upgrade and key rotation, including rollback with compatible schemas.

Production owner must approve numerical RPO/RTO, retention, off-site locations, restore
access controls, exercise cadence and accountable responders. No numerical target is
asserted achieved here. Never restore an older replay database while reopening payment
admission until downstream reconciliation prevents re-execution.
