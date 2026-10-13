import { ResearchMode, ResearchPolicy } from './IntelligenceCase';

export class ResearchPolicyManager {
  private static currentPolicy: ResearchPolicy;

  static initialize(mode: ResearchMode = 'FREE_ONLY') {
    this.currentPolicy = this.createPolicyForMode(mode);
  }

  private static createPolicyForMode(mode: ResearchMode): ResearchPolicy {
    switch (mode) {
      case 'FREE_ONLY':
        return {
          mode: 'FREE_ONLY',
          allowPaidProviders: false,
          costBudget: 0,
          freeFallback: true,
          paidFallback: false,
        };
      case 'NORMAL':
        return {
          mode: 'NORMAL',
          allowPaidProviders: true,
          costBudget: 100,
          freeFallback: true,
          paidFallback: true,
        };
      case 'PAID_AGGRESSIVE':
        return {
          mode: 'PAID_AGGRESSIVE',
          allowPaidProviders: true,
          costBudget: 1000,
          freeFallback: true,
          paidFallback: true,
        };
      default:
        throw new Error('Unsupported ResearchMode: ' + mode);
    }
  }


  public static getPolicy(): ResearchPolicy {
    if (!this.currentPolicy) {
      this.initialize('FREE_ONLY');
    }
    return this.currentPolicy;
  }

  public static isProviderAllowed(costClass: 'FREE' | 'PAID'): boolean {
    const policy = this.getPolicy();
    if (costClass === 'FREE') return true;
    return policy.allowPaidProviders;
  }

  public static getBlockedReason(): string {
    return 'RESEARCH_MODE_' + this.getPolicy().mode;
  }

}
