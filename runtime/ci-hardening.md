# CI Hardening

This file records the current CI incident and verification evidence. It is updated only from fresh runs.

- Incident: Supply Chain Security failed at the Cargo formatting check.
- Root cause observed: `backend/ebpf_engine/ebpf_user/src/main.rs` differed from rustfmt output.
- Security scanner output also reported an upstream commit-resolution warning; this is tracked separately from the formatter failure.
- Required gate: `cargo fmt --all -- --check` must pass before the security workflow can be considered green.
