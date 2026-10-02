/**
 * VARDHAN — RESEARCH BUDGET (§17)
 * ─────────────────────────────────────────────────────────────────────────────
 * Adaptive budget controller with tiered budgets (TRIAGE → TARGETED → DEEP → VERIFY).
 */

export type BudgetTier = 'TRIAGE' | 'TARGETED' | 'DEEP' | 'VERIFY';

export type BudgetResource = 'httpRequests' | 'searchQueries' | 'browserPages' | 'modelCalls';

export interface BudgetAllocation {
  budget: {
    maxHttpRequests: number;
    maxSearchQueries: number;
    maxBrowserPages: number;
    maxModelCalls: number;
    maxRuntimeMs: number;
  };
  consumed: {
    httpRequests: number;
    searchQueries: number;
    browserPages: number;
    modelCalls: number;
  };
  exhausted: boolean;
  stopEarly: boolean;
}

export interface BudgetConfig {
  maxHttpRequests: number;
  maxSearchQueries: number;
  maxBrowserPages: number;
  maxModelCalls: number;
  maxRuntimeMs: number;
}

export const BUDGET_TIERS: Record<BudgetTier, BudgetConfig> = {
  TRIAGE: { maxHttpRequests: 10, maxSearchQueries: 3, maxBrowserPages: 0, maxModelCalls: 1, maxRuntimeMs: 30_000 },
  TARGETED: { maxHttpRequests: 30, maxSearchQueries: 8, maxBrowserPages: 3, maxModelCalls: 3, maxRuntimeMs: 120_000 },
  DEEP: { maxHttpRequests: 100, maxSearchQueries: 20, maxBrowserPages: 15, maxModelCalls: 8, maxRuntimeMs: 600_000 },
  VERIFY: { maxHttpRequests: 50, maxSearchQueries: 10, maxBrowserPages: 10, maxModelCalls: 5, maxRuntimeMs: 300_000 },
};

export type ResearchBudget = BudgetAllocation;

/** Adaptive budget controller managing resource usage across research tiers. */
export class BudgetController {
  private currentTier: BudgetTier;
  private startedAt: number;
  private consumed: Map<BudgetTier, Record<BudgetResource, number>> = new Map();
  private stopEarlyFlags: Set<BudgetTier> = new Set();
  private escalated: boolean = false;

  constructor(initialTier: BudgetTier = 'TRIAGE') {
    this.currentTier = initialTier;
    this.startedAt = Date.now();
    for (const tier of ['TRIAGE', 'TARGETED', 'DEEP', 'VERIFY'] as BudgetTier[]) {
      this.consumed.set(tier, { httpRequests: 0, searchQueries: 0, browserPages: 0, modelCalls: 0 });
    }
  }

  /** Get the budget allocation for a tier. */
  get(tier: BudgetTier): BudgetAllocation {
    const cfg = BUDGET_TIERS[tier];
    const c = this.consumed.get(tier) || { httpRequests: 0, searchQueries: 0, browserPages: 0, modelCalls: 0 };
    const exhausted =
      c.httpRequests >= cfg.maxHttpRequests &&
      c.searchQueries >= cfg.maxSearchQueries &&
      c.modelCalls >= cfg.maxModelCalls;
    return {
      budget: {
        maxHttpRequests: cfg.maxHttpRequests,
        maxSearchQueries: cfg.maxSearchQueries,
        maxBrowserPages: cfg.maxBrowserPages,
        maxModelCalls: cfg.maxModelCalls,
        maxRuntimeMs: cfg.maxRuntimeMs,
      },
      consumed: { ...c },
      exhausted,
      stopEarly: this.stopEarlyFlags.has(tier),
    };
  }

  /** Consume a unit of a resource. */
  consume(tier: BudgetTier, resource: BudgetResource, amount: number = 1): boolean {
    const c = this.consumed.get(tier);
    if (!c) return false;
    c[resource] += amount;
    return true;
  }

  /** Check if the tier can afford an action. */
  canAfford(tier: BudgetTier, action: 'http' | 'search' | 'browser' | 'model'): boolean {
    const cfg = BUDGET_TIERS[tier];
    const c = this.consumed.get(tier) || { httpRequests: 0, searchQueries: 0, browserPages: 0, modelCalls: 0 };
    if (action === 'http') return c.httpRequests < cfg.maxHttpRequests;
    if (action === 'search') return c.searchQueries < cfg.maxSearchQueries;
    if (action === 'browser') return c.browserPages < cfg.maxBrowserPages;
    if (action === 'model') return c.modelCalls < cfg.maxModelCalls;
    return false;
  }

  /** Check if the tier's budget is exhausted. */
  isExhausted(tier: BudgetTier): boolean {
    const a = this.get(tier);
    return a.exhausted || (a.consumed.httpRequests >= a.budget.maxHttpRequests);
  }

  /** Check if research should stop early for this tier. */
  shouldStop(tier: BudgetTier): boolean {
    return this.stopEarlyFlags.has(tier) || this.isExhausted(tier);
  }

  /** Escalate from one tier to another. */
  escalate(from: BudgetTier, to: BudgetTier): void {
    this.currentTier = to;
    this.escalated = true;
  }

  /** Mark a tier as stop-early. */
  stopEarly(tier: BudgetTier): void {
    this.stopEarlyFlags.add(tier);
  }

  /** Tick elapsed time. */
  tick(tier: BudgetTier, ms: number): boolean {
    return (Date.now() - this.startedAt) > BUDGET_TIERS[tier].maxRuntimeMs;
  }

  /** Check if runtime has been exceeded. */
  isRuntimeExceeded(tier: BudgetTier): boolean {
    return (Date.now() - this.startedAt) > BUDGET_TIERS[tier].maxRuntimeMs;
  }

  /** Get a summary string of budget usage for a tier. */
  summarize(tier: BudgetTier): string {
    const a = this.get(tier);
    return `${tier}: ${a.consumed.httpRequests}/${a.budget.maxHttpRequests} requests, exhausted=${a.exhausted}`;
  }

  /** Allocate (mark as active) a tier. */
  allocate(tier: BudgetTier): void {
    this.currentTier = tier;
  }

  /** Get the current tier. */
  getTier(): BudgetTier {
    return this.currentTier;
  }

  /** Check if escalation occurred. */
  hasEscalated(): boolean {
    return this.escalated;
  }
}
