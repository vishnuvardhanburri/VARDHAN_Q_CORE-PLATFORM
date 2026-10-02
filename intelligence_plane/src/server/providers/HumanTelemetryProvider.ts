import { IntelligenceCase, Evidence } from '../IntelligenceCase';

export interface HumanSignal {
  type: 'KNOWLEDGE_BOTTLENECK' | 'SENTIMENT_DROP' | 'TALENT_FLUX' | 'BURNOUT_SIGNAL';
  developer: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  rationale: string;
  evidence_link: string;
}

export class HumanTelemetryProvider {
  /**
   * Analyzes commit history and public profiles to find human-centric vulnerabilities.
   */
  public async analyzeHumanTelemetry(currentCase: IntelligenceCase): Promise<{
    signals: HumanSignal[];
    evidence: Evidence[];
  }> {
    console.log(`[HumanTelemetry] Analyzing engineering team dynamics for ${currentCase.company}...`);

    const signals: HumanSignal[] = [];
    const evidence: Evidence[] = [];

    // SIMULATION: In production, this would use GitHub API for commit messages
    // and LinkedIn/Twitter scrapers for sentiment.
    if (currentCase.company.toLowerCase().includes('vercel')) {

      // 1. Knowledge Bottleneck Detection
      // Logic: One developer has 80% of the commits in the 'core-runtime' directory
      signals.push({
        type: 'KNOWLEDGE_BOTTLENECK',
        developer: 'Lead-Dev-X',
        severity: 'HIGH',
        rationale: 'Single point of failure detected: Lead-Dev-X owns 85% of core-runtime logic. Loss of this individual would be catastrophic.',
        evidence_link: 'github.com/vercel/core-runtime/commits'
      });
      evidence.push({
        id: `ev-human-bot-${Math.random().toString(36).substr(2, 9)}`,
        evidence_origin: 'HUMAN_TELEMETRY',
        public_url: 'github.com/vercel/core-runtime/commits',
        source_type: 'GITHUB',
        observed_behavior: 'Extreme knowledge concentration in a single contributor',
        retrieved_at: new Date().toISOString(),
        evidence_text: 'Commit distribution analysis shows >80% ownership of critical path by one user.',
        reproductions: 1, repeatable: true, tested_without_auth: true, not_tested: []
      });

      // 2. Sentiment/Burnout Analysis
      // Logic: Searching for frustration keywords in commit messages ("fix again", "hack", "temporary")
      signals.push({
        type: 'BURNOUT_SIGNAL',
        developer: 'Dev-Y',
        severity: 'MEDIUM',
        rationale: 'Detected patterns of frustration in commit messages: "another hack to fix the memory leak" repeated 4x in 2 weeks.',
        evidence_link: 'github.com/vercel/edge-runtime/commits'
      });
      evidence.push({
        id: `ev-human-sent-${Math.random().toString(36).substr(2, 9)}`,
        evidence_origin: 'HUMAN_TELEMETRY',
        public_url: 'github.com/vercel/edge-runtime/commits',
        source_type: 'COMMIT_SENTIMENT',
        observed_behavior: 'Developer frustration signals in public commit logs',
        retrieved_at: new Date().toISOString(),
        evidence_text: 'Commit message: "Temporary hack to stop the P99 spikes... I cannot believe this is still happening"',
        reproductions: 1, repeatable: true, tested_without_auth: true, not_tested: []
      });
    }

    return { signals, evidence };
  }
}
