/**
 * VARDHAN — TECHNICAL EVIDENCE MODEL
 * ─────────────────────────────────────────────────────────────────────────────
 * Represents a structured technical fact extracted from raw source text.
 * This separates "what happened" (the fact) from "how we found it" (the evidence).
 */

export type TechnicalFactType = 
  | 'BEHAVIOR'      // Observed runtime behavior (e.g., latency, HTTP status, headers)
  | 'ARCHITECTURE'  // Structural fact (e.g., "Uses Kubernetes", "AWS region us-east-1")
  | 'CONSTRAINT'    // Stated limitation (e.g., "Rate limited to 100req/s", "Max payload 2MB")
  | 'INCIDENT'      // Reported failure (e.g., "Outage on 2023-10-12", "Database corruption")
  | 'DEPRECATION'   // Sunset signal (e.g., "v1 API deprecated", "Moving from Jenkins to GitHub Actions")
  | 'SURFACE'       // Infrastructure discovery (e.g., "Sitemap found", "Robots.txt allows /api")
  | 'OBSERVATION';   // Generic technical observation

export interface TechnicalEvidence {
  id: string;
  fact_type: TechnicalFactType;
  fact_value: string;         // The normalized technical truth (e.g., "K8S_USED")
  raw_snippet: string;       // The exact text that proves the fact
  confidence: number;        // 0.0 - 1.0
  timestamp: string;         // When the fact was observed
  source_url: string;        // Link to the evidence
  metadata: Record<string, any>; // Extra context (e.g., latency_ms: 250)
}
