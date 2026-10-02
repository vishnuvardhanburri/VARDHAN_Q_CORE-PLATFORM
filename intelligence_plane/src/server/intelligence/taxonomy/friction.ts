/**
 * VARDHAN FRICTION TAXONOMY
 * ─────────────────────────────────────────────────────────────────────────────
 * This taxonomy maps raw technical signals to high-level business friction.
 * It is the bridge between "Technical Research" and "High-Ticket Sales."
 *
 * Mapping: Signal (What we see) -> Friction (The Pain) -> Impact (The Money)
 */

export interface FrictionMapping {
  signal_pattern: RegExp;
  friction_label: string;
  business_pain: string;
  financial_impact: 'REVENUE_LOSS' | 'OPEX_INEFFICIENCY' | 'CHURN_RISK' | 'LEGAL_RISK';
  executive_priority: 'HIGH' | 'CRITICAL';
  hook_template: string;
}

export const FRICTION_TAXONOMY: FrictionMapping[] = [
  {
    signal_pattern: /latency|p99|timeout|slow|performance|bottleneck/i,
    friction_label: 'Infrastructure Performance Degeneration',
    business_pain: 'Users are experiencing sluggishness, leading to drop-offs in the critical path.',
    financial_impact: 'CHURN_RISK',
    executive_priority: 'CRITICAL',
    hook_template: 'Your current P99 latency in the [component] is likely impacting your Enterprise Tier retention.',
  },
  {
    signal_pattern: /migration|legacy|rewrite|technical debt|stability|refactor/i,
    friction_label: 'Technical Debt Paralysis',
    business_pain: 'Engineering velocity has collapsed because the team is fighting the codebase rather than shipping features.',
    financial_impact: 'OPEX_INEFFICIENCY',
    executive_priority: 'HIGH',
    hook_template: 'The ongoing rewrite of [component] is creating a velocity bottleneck that is delaying your [product] roadmap.',
  },
  {
    signal_pattern: /security|breach|vulnerability|leak|compliance|audit/i,
    friction_label: 'Security Exposure / Compliance Gap',
    business_pain: 'Potential for catastrophic data loss or regulatory fines (GDPR/SOC2).',
    financial_impact: 'LEGAL_RISK',
    executive_priority: 'CRITICAL',
    hook_template: 'I noticed a potential exposure in your [surface] that could jeopardize your SOC2 compliance.',
  },
  {
    signal_pattern: /scaling|infrastructure|provisioning|cloud cost|aws bill/i,
    friction_label: 'Cloud Spend Inefficiency',
    business_pain: 'Infrastructure costs are scaling linearly with users, destroying gross margins.',
    financial_impact: 'OPEX_INEFFICIENCY',
    executive_priority: 'HIGH',
    hook_template: 'Your current infrastructure scaling pattern for [component] is creating an unsustainable OpEx trajectory.',
  },
  {
    signal_pattern: /onboarding|docs|confusing|setup|integration/i,
    friction_label: 'Product Friction / High CAC',
    business_pain: 'Potential customers are dropping off during the "Time to Value" phase.',
    financial_impact: 'REVENUE_LOSS',
    executive_priority: 'HIGH',
    hook_template: 'The integration friction in your [product] is likely increasing your CAC and slowing down your trial-to-paid conversion.',
  },
];
