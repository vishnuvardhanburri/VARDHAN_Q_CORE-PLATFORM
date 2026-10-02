# Vardhan ProofMesh: Threat Model

## 1. Scope
This document outlines the security boundaries and defensive posturing of the ProofMesh verification fabric itself.

## 2. Protected Assets
- Verification Evidence Objects (Cryptographic Hashes, Trace Data)
- Certification Policies (Evidence Quorums)
- The Vardhan Verification Graph (VVG) State

## 3. Threat Vectors
### 3.1 AI Overreach
- **Threat**: Heuristics or AI agents bypass a mandatory test or approve a failed state based on inferred intent.
- **Mitigation**: AI components can only *propose* scheduling and execution paths. Certification paths enforce deterministic policy checks that cannot be overridden by heuristic subsystems.

### 3.2 Evidence Forgery or Replay
- **Threat**: A compromised test execution pool submits forged evidence of a passing security test.
- **Mitigation**: Evidence Objects are content-addressed and cryptographically signed/hashed containing execution trace digests, environment fingerprints, and random seeds.

### 3.3 Resource Exhaustion / DoS
- **Threat**: Deep verification escalation or fuzzing cascades indefinitely, exhausting CI resources and blocking releases.
- **Mitigation**: Explicit concurrency and depth limits per pool. The Adaptive Scheduler strictly enforces resource bounds before transitioning states to `TIMEOUT` or `ESCALATING`.

### 3.4 Fault Injection Spillage
- **Threat**: Fault injection mechanisms used in testing (Byzantine actors, node crashing) bleed into production builds.
- **Mitigation**: Fault injection capabilities are strictly confined to the `VFI` engine and require specific compilation features and environment contexts to compile. No retaliatory logic exists.
