import { IntelligenceCase } from './IntelligenceCase';
import { FRICTION_TAXONOMY, FrictionMapping } from './intelligence/taxonomy/friction';

export interface StrategicThesis {
  thesis: string;
  friction_label: string;
  business_pain: string;
  financial_impact: string;
  confidence: number;
  evidence_chain: string[];
  executive_hook: string;
}

export class ThesisEngine {
  /**
   * Synthesizes raw evidence and signals into a High-Ticket Business Thesis.
   */
  public static generateThesis(currentCase: IntelligenceCase): StrategicThesis | null {
    const signals = currentCase.signals || [];
    const evidence = currentCase.evidence || [];

    if (signals.length === 0 && evidence.length === 0) return null;

    // 1. Analyze signals against the Friction Taxonomy
    const matches: { mapping: FrictionMapping; signal: any }[] = [];

    signals.forEach(sig => {
      const text = `${sig.type} ${sig.excerpt || ''}`;
      FRICTION_TAXONOMY.forEach(mapping => {
        if (mapping.signal_pattern.test(text)) {
          matches.push({ mapping, signal: sig });
        }
      });
    });

    // Add evidence checks
    evidence.forEach(ev => {
      if (FRICTION_TAXONOMY.some(m => m.signal_pattern.test(ev.evidence_text))) {
        // Simplified: we just use the signal matches for the primary thesis
      }
    });

    if (matches.length === 0) return null;

    // 2. Find the most dominant friction (highest frequency)
    const frictionCounts = new Map<string, number>();
    matches.forEach(m => {
      const label = m.mapping.friction_label;
      frictionCounts.set(label, (frictionCounts.get(label) || 0) + 1);
    });

    const topFrictionLabel = [...frictionCounts.entries()]
      .sort((a, b) => b[1] - a[1])[0][0];

    const bestMapping = FRICTION_TAXONOMY.find(m => m.friction_label === topFrictionLabel)!;

    // 3. Construct the evidence chain
    const chain = matches
      .filter(m => m.mapping.friction_label === topFrictionLabel)
      .map(m => `Signal [${m.signal.type}]: ${m.signal.excerpt?.slice(0, 100)}...`);

    // 4. Build the final thesis
    return {
      thesis: `Institutional Thesis: ${currentCase.company} is experiencing ${bestMapping.friction_label.toLowerCase()}, which is causing ${bestMapping.business_pain.toLowerCase()}`,
      friction_label: bestMapping.friction_label,
      business_pain: bestMapping.business_pain,
      financial_impact: bestMapping.financial_impact,
      confidence: Math.min(0.5 + (matches.length * 0.1), 0.95),
      evidence_chain: chain,
      executive_hook: bestMapping.hook_template.replace('[component]', 'their core infrastructure'),
    };
  }
}
