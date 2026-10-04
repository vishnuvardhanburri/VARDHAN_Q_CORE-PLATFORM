# Vardhan Intelligence — Verification

## Purpose

Distinguish raw observations from verified findings. Only VERIFIED findings
cross the trust boundary into Q Core.

## Verification States

| State | Description |
|---|---|
| RAW | Initial unprocessed observation |
| NORMALIZED | Parsed and structured |
| CORRELATED | Related to other observations |
| VERIFIED | Confirmed through independent validation |
| REJECTED | Disproven or unreliable |

## Verification Engine

The `FindingVerificationEngine` (TS) verifies finding legitimacy:

1. **Evidence integrity** — SHA-256 content hash matches.
2. **Source attribution** — Source is tracked and reliable.
3. **Temporal status** — Evidence is CURRENT (not historical).
4. **Corroboration** — At least one independent source confirms.
5. **Expectation check** — Behavior contradicts expected behavior.
6. **Differential validation** — Observed differs from expected.

## Verification Pipeline

```
IntelligenceFinding (CORRELATED)
    │
    ▼
FindingVerificationEngine.verify()
    │
    ├── Evidence hash validation (full SHA-256)
    ├── Source reliability check
    ├── Temporal status check
    ├── Corroboration check
    ├── Expectation check
    ├── Differential check
    │
    ▼
VERIFIED (confidence ≥ threshold)
    │
    ▼
VerifiedFindingContract
    │
    ▼
TrustBoundaryValidator.validate()  [22 checks]
    │
    ▼
Q Core Gateway  (HTTP POST /api/v1/seal)
```

## VerifiedFindingContract

The formal contract between Intelligence and Q Core. Must pass all 22
TrustBoundaryValidator checks. See `data-model.md` for full schema.

## Trust Boundary (22 checks)

Implemented in both:
- TypeScript: `intelligence_plane/src/server/TrustBoundaryValidator.ts`
- Rust: `backend/vardhan_receipt/src/trust_boundary.rs`

Both enforce identical checks. See `runtime/tests.md` for check-by-check
mapping.

## Verification Confidence

| Confidence Range | Meaning |
|---|---|
| 0.9–1.0 | Very high — multiple corroborating sources, fresh, reliable |
| 0.7–0.89 | High — strong evidence, one independent source |
| 0.5–0.69 | Medium — some evidence, single source, some uncertainty |
| 0.3–0.49 | Low — weak evidence, unreliable source |
| 0.0–0.29 | Very low — do not forward to Q Core |

Only findings with confidence ≥ 0.7 are forwarded as VERIFIED.

## Current Implementation

- `intelligence_plane/src/server/FindingVerificationEngine.ts`
- `intelligence_plane/src/server/VerificationToContractAdapter.ts`
- `intelligence_plane/src/server/VerifiedFindingContract.ts`
- `intelligence_plane/src/server/TrustBoundaryValidator.ts`
- `backend/vardhan_receipt/src/trust_boundary.rs`

## Improvements Needed

1. Add automated confidence calibration based on historical accuracy.
2. Add contradiction resolution (conflicting evidence handling).
3. Add verification state persistence (survive restart).
4. Add verification audit trail.
