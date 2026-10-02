# Xavira Implementation Map

## 1. Inspect Repository & Define Schemas/Contracts
- **Schemas**: I will create `IntelligenceCase.ts` and `EvidenceContract.ts` defining the exact types required by the prompt (`IntelligenceCase`, `EvidenceLevel`, etc.).
- **Isolate Synthetic Data**: `src/data/v2DataEngine.ts` and `src/services/ollamaService.ts` currently contain synthetic data and fallback copies with hardcoded assertions. I will move these out of production paths, isolating demo components explicitly.

## 2. Build Evidence Layer & Validation
- Ensure `Evidence Extraction` adheres to strict parsing rules (using the `SourceParsers`).
- **Validation Engine**: Create a `ValidationLayer` that verifies URLs, dates (no hallucinated dates), and claims (never inferring private details).

## 3. Build Hypothesis + Conversation Layer
- **Contradiction Check**: Build an adversarial review stage (asking "What would make a CTO reject this?").
- **Signal & Hypothesis Engine**: Map extracted facts to a testable technical hypothesis.
- **Conversation Angle Engine**: Generate only 1 primary angle based strictly on validated evidence, with `NO_GO` returns for insufficient evidence.

## 4. Mail Strategy & Claim QA
- Ensure Subject and Body stem from the same conversation angle.
- Strip all generic greetings (e.g., "hope you are well") and fake urgency.
- Add **Claim QA**: Any generated text gets cross-referenced against the `IntelligenceCase` facts.

## 5. End-to-End Testing
- Write unit tests (`evidence provenance`, `date handling`, `hallucination rejection`).
- Implement the final acceptance test matching the prompt (input: one company website → output: signals, hypothesis, angle, NO_GO decision, subject, body).

## Priority
**Precision > Volume, Evidence > Confidence, Truth > Wording**.
