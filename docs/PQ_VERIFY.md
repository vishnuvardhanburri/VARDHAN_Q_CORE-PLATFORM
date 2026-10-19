# pq_verify — Independent Evidence Verification

`pq_verify` is the independent evidence verifier for Vardhan Quantum Proxy.

It reconstructs and verifies the cryptographic evidence path from persisted
ledger and checkpoint artifacts. It is intentionally separate from the
runtime proxy, Raft state machine, and checkpoint writer so that evidence can
be validated outside the service that produced it.

The verifier does not create, repair, or modify evidence artifacts.

---

## Verification Scope

For a valid evidence bundle, `pq_verify` verifies four integrity layers:

1. **Ledger integrity**
   - BLAKE3 hash-chain linkage
   - ML-DSA-87 signatures on ledger blocks

2. **Checkpoint integrity**
   - canonical checkpoint encoding
   - checkpoint hash
   - ML-DSA-87 signature
   - signer public-key fingerprint
   - deterministic Merkle commitment
   - checkpoint-to-checkpoint linkage

3. **Consensus authority**
   - checkpoint Raft term
   - checkpoint Raft log index
   - checkpoint command identity
   - committed Raft evidence

4. **Evidence reconstruction**
   - referenced ledger range exists
   - ledger entries reconstruct the checkpoint Merkle root
   - checkpoint metadata is internally consistent
   - tampering, deletion, insertion, reordering, or substitution causes
     verification failure where the affected evidence is covered by a
     committed checkpoint

A successful verification means that the supplied artifacts satisfy the
verification rules implemented by this version of `pq_verify`.

It does not constitute a claim of regulatory certification, third-party
assurance, or production-environment validation.

---

## Verification Pipeline

Given `ledger.jsonl` and `checkpoints.jsonl`, `pq_verify` performs the
following checks.

### 1. Ledger Chain Integrity

Each persisted ledger block is deserialized from JSONL.

For consecutive entries:

```text
entry[i].prev_hash == hash(entry[i-1])
```

is verified.

The verifier also validates the ML-DSA-87 signature associated with each
ledger block against the supplied public verification key.

The ledger's canonical hash-chain function is distinct from the checkpoint
Merkle commitment function described below.

### 2. Checkpoint Canonical Integrity

For each `CommittedCheckpoint`:

1. Reconstruct the canonical checkpoint representation.
2. Recompute its canonical hash.
3. Verify the stored checkpoint hash.
4. Verify the ML-DSA-87 signature.
5. Verify that the supplied signer public key corresponds to
   `signer_pub_fingerprint`.

Any modification to signed checkpoint fields must cause verification failure.

### 3. Merkle Root Reconstruction

Each checkpoint identifies an exact ledger range:

```text
[ledger_first_seq, ledger_last_seq]
```

For every ledger entry in that range, the checkpoint Merkle commitment uses:

```text
BLAKE3(seq || entry_data)
```

The verifier independently reconstructs the Merkle root and compares it with
the checkpoint's:

```text
merkle_root
```

This function is deliberately distinct from the audit ledger's canonical
hash-chain function.

The checkpoint Merkle commitment is intended to provide a deterministic
commitment over the exact ledger sequence covered by the checkpoint.

### 4. Checkpoint Chain Linkage

For the first checkpoint:

```text
previous_checkpoint_hash == [0u8; 32]
```

For every subsequent checkpoint:

```text
checkpoint.previous_checkpoint_hash
    ==
previous_checkpoint.checkpoint_hash
```

This prevents an attacker from silently replacing an intermediate checkpoint
without also breaking the checkpoint chain.

### 5. Ledger Range Coverage

The verifier validates that every sequence number referenced by a checkpoint
is present and corresponds to the expected ledger entry.

The checkpoint's:

```text
ledger_first_seq
ledger_last_seq
ledger_entry_count
```

must describe the same contiguous range.

A checkpoint claiming coverage of entries that are absent from the supplied
ledger must fail verification.

This check is particularly important for detecting deletion or truncation of
ledger data covered by a committed checkpoint.

### 6. Raft Term / Log Index Binding

A checkpoint contains:

```text
raft_term
raft_log_index
```

These values identify the Raft log position at which the checkpoint command
was committed.

The corresponding Raft log evidence must contain the expected checkpoint
command identity:

```text
CHECKPOINT_CLIENT_ID
```

The verifier checks that the checkpoint metadata corresponds to the expected
committed Raft entry.

Raft's consensus model requires committed log entries to be preserved by
future leaders through the leader-completeness property. ([Raft][2])

**Important:** Raft term/index binding is only independently verifiable when
the verification bundle contains the required Raft evidence. A ledger and
checkpoint file alone cannot prove the external fact that a particular Raft
entry reached quorum and was committed.

---

## Evidence Model

The complete evidence relationship is:

```text
Ledger Entries
      │
      ▼
BLAKE3 Ledger Chain
      │
      ├── ML-DSA-87 block signatures
      │
      ▼
Exact Ledger Range
      │
      ▼
Deterministic Merkle Commitment
      │
      ▼
Signed Checkpoint
      │
      ├── cluster_id
      ├── config_epoch
      ├── raft_term
      └── raft_log_index
      │
      ▼
Raft Replication
      │
      ▼
Quorum
      │
      ▼
Committed Checkpoint
      │
      ▼
Independent pq_verify
```

The important distinction is:

```text
Ledger hash-chain validity
        ≠
Checkpoint validity
        ≠
Raft commitment
        ≠
Complete independent evidence verification
```

Each layer provides a separate property.

---

## Cluster and Configuration Binding

Checkpoints contain the authoritative cluster identity and configuration
epoch:

```text
cluster_id
config_epoch
```

`cluster_id` identifies the persistent cluster.

`config_epoch` identifies the cluster configuration generation.

A normal Raft leader election changes `raft_term` but does not by itself
change `config_epoch`.

A membership/configuration change advances `config_epoch` through the
authoritative cluster configuration mechanism.

These values must not be reconstructed from the current peer list,
timestamps, or node count.

---

## Cryptographic Primitives

| Purpose                     | Algorithm     | Standard / Reference |
| --------------------------- | ------------- | -------------------- |
| Ledger / checkpoint hashing | BLAKE3        | BLAKE3 specification |
| Ledger signatures           | ML-DSA-87     | NIST FIPS 204        |
| Checkpoint signatures       | ML-DSA-87     | NIST FIPS 204        |
| Proxy key establishment     | ML-KEM-1024   | NIST FIPS 203        |

NIST finalized FIPS 203 as the **ML-KEM** standard and FIPS 204 as the
**ML-DSA** digital-signature standard in August 2024. ML-KEM-1024 is the
highest parameter set specified by FIPS 203; ML-DSA-87 is the highest
parameter set specified by FIPS 204. ([NIST Computer Security Resource Center][1])

`pq_verify` does not introduce or implement a proprietary post-quantum
primitive.

---

## Command Line

Basic verification:

```bash
cargo run --release -p pq_verify -- \
    --ledger /path/to/ledger.jsonl \
    --checkpoints /path/to/checkpoints.jsonl \
    --pub-key <hex-encoded-ML-DSA-87-public-key>
```

If Raft evidence is required by the verifier implementation, provide the
corresponding Raft artifact using the CLI option implemented by that build.

Do not interpret a verification run that omits required Raft evidence as
independent proof of Raft quorum commitment.

---

## Exit Codes

| Code | Meaning                              |
| ---: | ------------------------------------ |
|  `0` | All requested evidence checks passed |
|  `1` | Verification failed                  |

On failure, the verifier should identify the failing evidence layer and
prefer a deterministic error category over an ambiguous generic error.

Examples include:

```text
LEDGER_CHAIN_INVALID
LEDGER_SIGNATURE_INVALID
CHECKPOINT_HASH_INVALID
CHECKPOINT_SIGNATURE_INVALID
SIGNER_FINGERPRINT_MISMATCH
MERKLE_ROOT_MISMATCH
CHECKPOINT_CHAIN_INVALID
LEDGER_RANGE_MISSING
LEDGER_RANGE_NONCONTIGUOUS
RAFT_TERM_MISMATCH
RAFT_INDEX_MISMATCH
RAFT_COMMITMENT_MISSING
CLUSTER_ID_MISMATCH
CONFIG_EPOCH_MISMATCH
```

---

## Tamper Detection

The verifier is expected to reject evidence affected by:

* ledger entry modification
* ledger entry signature modification
* checkpoint modification
* invalid checkpoint signature
* wrong signing key
* incorrect Merkle root
* incorrect previous checkpoint hash
* incorrect Raft term
* incorrect Raft log index
* missing ledger entries within a checkpointed range
* checkpoint deletion or substitution
* checkpoint reordering
* inconsistent cluster/configuration metadata

A valid prefix of a hash chain may remain cryptographically valid after
tail truncation. Therefore, **hash-chain validity alone does not prove
completeness**.

Completeness is established only for the ranges anchored by valid committed
checkpoints and the corresponding evidence required to establish their
commitment.

---

## P7.3 Validation

P7.3 validated the checkpoint implementation using a local three-node TCP
Raft cluster.

### Checkpoint Suite

```text
raft_l3_2_checkpoints
C1–C24 + C25–C27 regression tests

27 passed
0 failed
```

The additional regression tests cover the three implementation defects
discovered during adversarial validation.

### Existing L3 Suites

| Suite                     | Result |
| ------------------------- | -----: |
| `raft_l3_2_checkpoints`   |  27/27 |
| `raft_l3_validation`      |    1/1 |
| `raft_l3_replication`     |  11/11 |
| `raft_l3_failure`         |  14/14 |
| `raft_l3_1_hardening`     |  12/12 |
| `pq_shield` release build |   PASS |

Total reported tests:

```text
62 / 62 passing
```

---

## P7.3 Regression Defects

### Defect 1 — Non-deterministic checkpoint Merkle root

The initial checkpoint Merkle calculation reused the ledger canonical hash,
which included node-local timestamps and previous-chain state.

Because replicas can apply the same Raft command at different wall-clock
times, independently generated roots differed.

The checkpoint Merkle commitment was changed to:

```text
BLAKE3(seq || entry_data)
```

This makes the checkpoint commitment deterministic across replicas.

### Defect 2 — Ledger sequence coupled to Raft log index

Checkpoint commands occupy Raft log positions but are not ordinary ledger
entries.

Using the Raft log index for `LedgerBlock.index` therefore coupled two
different namespaces.

The implementation now uses the ledger sequence counter for ordinary ledger
blocks:

```text
LedgerBlock::new(seq, ...)
```

where `seq` advances only for regular ledger entries.

### Defect 3 — Idempotency fall-through

The state machine detected an already-applied `(client_id, request_id)` but
continued processing the entry.

This could create a duplicate ledger block.

The duplicate path now terminates immediately:

```text
already applied
      │
      └── continue
```

Regression coverage was added to prevent the defect from returning.

---

## Security Boundary

`pq_verify` is an evidence verifier, not a consensus implementation.

It does not:

* elect Raft leaders
* replicate log entries
* create quorum commitments
* repair corrupted evidence
* recover missing ledger entries
* generate signatures
* replace the runtime audit ledger
* establish AWS/EKS security
* establish HSM/KMS security
* provide Byzantine fault tolerance

Its purpose is to independently validate the artifacts presented to it.

---

## P7.3 Assurance Boundary

P7.3 provides engineering validation of the Vardhan evidence path through
adversarial testing on a local three-node TCP cluster.

P7.3 does **not** establish:

* live AWS/EKS deployment validation
* production HSM/KMS integration
* Byzantine fault tolerance
* third-party penetration testing
* production multi-region validation
* regulatory certification
* formal verification of the complete Vardhan implementation

These require separate evidence.

---

## Reproducibility

The P7.3 checkpoint suite can be reproduced with:

```bash
cargo test -p ha_cluster \
    --test raft_l3_2_checkpoints \
    -- --test-threads=1
```

The expected checkpoint-suite result is:

```text
27 passed
0 failed
```

The complete P7.3 evidence is documented in:

```text
docs/P7.3_EVIDENCE.md
docs/SECURITY_ISSUE_TRACKER.md
docs/GITHUB_ISSUES_ROADMAP.md
```

---

## Verification Principle

The verifier follows one core rule:

> **Evidence is valid only when every required layer independently validates.**

In particular:

```text
VALID LEDGER
    ↓
VALID CHECKPOINT
    ↓
VALID SIGNATURE
    ↓
VALID MERKLE RANGE
    ↓
VALID CHECKPOINT CHAIN
    ↓
VALID RAFT BINDING
    ↓
VALID COMMIT EVIDENCE
    ↓
VERIFIED EVIDENCE
```

A failure at any required layer makes the corresponding evidence
unverified.

[1]: https://csrc.nist.gov/pubs/fips/203/final?utm_source=chatgpt.com "FIPS 203, Module-Lattice-Based Key-Encapsulation Mechanism Standard | CSRC"
[2]: https://raft.github.io/raft.pdf?utm_source=chatgpt.com "In Search of an Understandable Consensus Algorithm"
