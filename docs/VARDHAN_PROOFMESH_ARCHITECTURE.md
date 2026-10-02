# Vardhan ProofMesh: Architecture

## 1. Subsystem Interaction
ProofMesh sits natively within Vardhan's architecture as a control fabric over the verification layers.

```
Vardhan Quantum
├── L1 Enterprise Intelligence
├── L2 Adaptive Defense
├── L3 Secure Platform
└── Verification / Control Fabric
    └── ProofMesh
        ├── Verification Graph (VVG)
        ├── Adaptive Scheduler (VAS)
        ├── Execution Pools (VEP)
        ├── Replay Engine (VRE)
        ├── Fault Injection (VFI)
        ├── Evidence Quorum (VEQ)
        └── Verification Memory (Ledger)
```

## 2. Evidence Collection Pipeline
1. **Source Mutation**: Code is changed.
2. **VVG Query**: ProofMesh queries the Verification Graph to determine which claims are impacted.
3. **VAS Allocation**: The Adaptive Scheduler determines the cheapest, safest, fastest combination of test execution pools to gather mandatory evidence.
4. **Execution**: Heterogeneous pools (VEP) run tests natively in process-isolated environments (e.g., `cargo-nextest`), generating trace outputs.
5. **Escalation Loop**: If anomalous timing or flaky behavior is detected, VAS dynamically re-allocates the task to the Fault (VFI) or Replay (VRE) pools for root-cause minimization.
6. **VEQ Review**: Once all mandatory evidence blocks are cryptographically generated, the Evidence Quorum asserts completeness.
7. **Authority Certification**: Final certification occurs purely via Vardhan deterministic logic.

## 3. Hybrid Execution Model
ProofMesh supports Local, Remote, Simulation, Real Network, Replay, Fault Injection, and Formal checking modes.
Execution isolation requires:
- Ephemeral TCP/UDP ports (bind `0`)
- Unique temporary directory spaces per test
- Bounded resources, explicit timeouts
- Deterministic seeds for crypto/simulations

## 4. Integration with Vardhan Authority
ProofMesh **does not mutate** authoritative state. It acts as an intelligence and evidence-gathering substrate. The final `CERTIFY`, `REJECT`, or `ESCALATE` decision is strictly processed by the deterministic Vardhan authority boundaries.
