# Idempotency and recovery

**No exactly-once payment execution claim.** Multiple implementations exist:
control-plane sled/PostgreSQL queues; receipt CLI files; payment-library in-memory store;
Raft-ledger state. Their guarantees do not automatically compose.

## Receipt file reservation repair

`vardhan_receipt/src/main.rs` rejects unsafe filename identifiers, reserves with exclusive
create, rechecks committed state while owning the reservation, then writes and
syncs the reservation and directory. After sealing, it syncs the marker, renames it to `.flag`
and syncs the directory. Failure retains the admission barrier. Commit or audit failures
return `OUTCOME_UNKNOWN`; they do not return a successful receipt. Existing flag names and
`SEALED` marker content remain compatible. Filesystem errors must not be treated as absence.
A concurrent submitter cannot exploit the initial lookup/commit race to reserve a committed ID.

Assumptions: one trusted local POSIX filesystem, exclusive directory ownership and honest
fsync/rename semantics. Parent creation above one level, hostile symlinks, remote filesystem
semantics, physical power loss and shared multi-host storage are not proven. IDs remain globally
scoped on this CLI path; tenant scoping/migration and retention require a versioned design.
Do not delete old flags as a cleanup policy. Failures before any signing may release a
reservation; failures after signing or ambiguous I/O require reconciliation.

## Crash/retry table

| Crash point | Expected barrier | Recovery rule |
|---|---|---|
| before reservation | none | normal admission |
| after reservation sync, before signing | reserve | reconcile ownership; do not blindly expire |
| after signing, before durable commit | reserve | outcome unknown; locate audit/receipt evidence |
| after rename, before directory sync | reserve or flag expected; durability uncertain | isolate/reconcile storage before admission |
| after flag, before audit / lost response | flag | return replay/unknown, recover evidence; never re-execute |
| after downstream payment dispatch | no integrated boundary proven | block production until adapter reconciliation exists |

## Required distributed transaction design

Define identity as tenant + institution + operation + business transaction ID; bind a
collision-resistant content digest and reject ID reuse with changed content. Use one
authoritative transactional uniqueness store and outbox/inbox with Reserved, Validated,
Authorised, DispatchPending, Dispatched, Confirmed/Rejected/Unknown and Receipted states.
Commit dispatch intent before external effects. Use downstream idempotency keys when
supported; otherwise manual/automated reconciliation is required before any retry.
Never convert timeout into rejected/unexecuted automatically.

Sled is embedded and not a multi-node consensus service. Existing PostgreSQL adapters
are candidates, not proof of integrated exactly-once semantics. Compare transactional
uniqueness, failover fencing, backup/restore, migration of legacy flags, retention,
operational maintenance and cost before selecting a production store. Crash-kill,
power-loss, disk-full, node-failure and cross-node stress remain release gates. Added
regressions cover local commit race and failed-commit retention only.
