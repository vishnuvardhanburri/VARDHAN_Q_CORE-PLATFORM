# GitHub Issues / Historical Engineering Roadmap

> **Current product roadmap:** [`VARDHAN_ROADMAP.md`](./VARDHAN_ROADMAP.md)
>
> **Current visual architecture:** [`VARDHAN_ARCHITECTURE_REALTIME.md`](./VARDHAN_ARCHITECTURE_REALTIME.md)

This file is retained as a historical engineering record. Earlier versions described a separate **Vardhan Quantum Proxy** roadmap and numbered issue milestones that no longer represent the current two-pillar Vardhan Technologies product architecture.

## Current Product Model

```text
Vardhan Technologies
├── Vardhan Intelligence
└── Vardhan Q Core
    ├── PQ / Quantum Security
    ├── AER-KEP-Q
    ├── Seven Industry Planes
    ├── Trust / Authority / Policy
    ├── Secure Transactions
    └── Evidence / Ledger / Verification
```

Quantum/PQ security is a Q Core capability, not a third business pillar.

## Current GitHub Issue State

The repository currently has no open GitHub Issues. Repository-level technical debt and production-readiness work are tracked through the engineering roadmap, runtime evidence, CI, security assessment, and dedicated documentation rather than an obsolete numbered issue list.

## Historical Records

The previous issue numbers and detailed implementation notes are preserved in Git history. They should not be interpreted as current open work unless the corresponding capability is explicitly listed in the current roadmap or runtime status.

For current execution, use:

1. `docs/VARDHAN_ROADMAP.md`
2. `docs/VARDHAN_ARCHITECTURE_REALTIME.md`
3. `docs/BACKEND_ARCHITECTURE_AUDIT.md`
4. `runtime/status.md`
5. GitHub Actions results for the target commit
