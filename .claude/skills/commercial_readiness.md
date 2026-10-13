---
name: commercial-readiness
description: Verification of test results, release gates, and commercial offer structures.
---

# Evidence, Release and Commercial Readiness Skill

## Scope
Bridging the gap between "code works" and "product is sellable".

## Mandatory Checks
- **Release Gate Integrity**: A `PASS` status for a release gate must be linked to a specific test run or document.
- **Offer Boundaries**: The £15k Diagnostic and £60k Proof of Market Product must have explicit "Out of Scope" sections.
- **Commercial Truth**: Distinguish between "Pipeline" (lead) and "Contracted" (cash).

## Failure Conditions
- Marking a feature as "Ready" when it has not passed the security regression tests.
- Offering a production SLA for a feature that is still in "Demonstration Only" mode.

## Readiness Workflow
1. **Verify**: Run the E2E vertical slice demo and record the results.
2. **Audit**: Check the security regression tests for the "Tamper Test" (modify receipt $\rightarrow$ reject).
3. **Offer Design**: Draft the la-hoc scope for the diagnostic based on existing codebase capabilities.
4. **Gate Check**: Update the Release Gate report.
