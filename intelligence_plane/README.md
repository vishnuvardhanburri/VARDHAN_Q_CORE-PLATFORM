# XAVIRA Technical Intelligence Pipeline

XAVIRA is a high-precision technical intelligence system designed to transition from simple symptom hunting to a broad company intelligence investigation model. It autonomously maps organizational technical complexity, identifies architectural pressure points, and verifies them through observable public boundaries.

## Architecture

The system operates through a multi-phase intelligence pipeline:

1. **Autonomous Discovery**: Zero-input organization discovery based on technical footprints.
2. **Broad Intelligence Collection**: Concurrent execution of specialized research tasks to build a `CompanyIntelligenceProfile`.
3. **Complexity Mapping**: Synthesis of evidence into a `ComplexityMap` to identify architectural bottlenecks.
4. **Surface Intelligence**: Mapping the external attack surface, validating functional roles, and reconciling boundary evidence.
5. **Exposure Graphing**: Connecting discovered surfaces via relationships to reason about trust boundaries.
6. **Opportunity Decision**: A deterministic engine that classifies the intelligence into actionable states (Verified Finding, Advisory Opportunity, etc.).
7. **Outreach Eligibility**: A final quality gate ensuring all claims are supportable, attributable, and non-speculative.

## Key Principles

- **Anti-Guessing Invariant**: No endpoints are guessed; every target must be explicitly discovered in public evidence.
- **Signal-First Discovery**: Decoupling discovery from industry filters to find technical signals first.
- **Observable Public Boundary**: Verification is performed only against independently discovered public surfaces.
- **Authority Chain**: Evidence $\rightarrow$ Technical Entity $\rightarrow$ Relationship $\rightarrow$ ComplexityNode $\rightarrow$ Hypothesis $\rightarrow$ Verification $\rightarrow$ Verified Finding.

## Project Structure

- `src/server/discovery/`: Core intelligence engines (Surface, Boundary, Exposure, and Decision).
- `src/server/specialists/`: Specialist research agents for targeted evidence collection.
- `src/server/system/`: Central orchestration and lifecycle management.
- `scripts/`: Validation and experiment runners.

## Setup

```bash
npm install
# Run specific validation scripts
npx tsx scripts/opportunity-validation.ts
```
