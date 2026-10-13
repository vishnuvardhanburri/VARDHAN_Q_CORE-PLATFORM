import { ResearchBudgetState } from './IntelligenceCase';

export class CompanyResearchContext {
  private budget: ResearchBudgetState = {
    requestsUsed: 0,
    queriesUsed: 0,
    githubObservations: 0,
    stoppedEarly: false,
  };
  private cache = new Map<string, any>();
  private inFlight = new Map<string, Promise<any>>();
  private discoveredSources = new Set<string>();

  constructor(public companyName: string, public config: { maxSearchQueries: number, maxPagesFetched: number, maxGithubRequests: number }) {}

  async executeRequest(url: string, options: RequestInit = {}): Promise<Response> {
    if (this.budget.stoppedEarly) throw new Error('Budget exhausted');

    // De-duplication: coalesce identical requests
    const requestKey = `${options.method || 'GET'}:${url}`;
    if (this.inFlight.has(requestKey)) {
      return this.inFlight.get(requestKey)!;
    }

    const requestPromise = (async () => {
      try {
        this.budget.requestsUsed++;
        
        // Implement basic fallback/retry logic
        let response: Response | undefined;
        let attempts = 0;
        const maxAttempts = 2;

        while (attempts < maxAttempts) {
          try {
            response = await fetch(url, options);
            if (response.ok) break;
            
            // If blocked (403) or unavailable (503), we mark it as blocked
            if (response.status === 403 || response.status === 503) {
              console.log(`[Context] Source ${url} blocked/unavailable (Status: ${response.status})`);
              break; 
            }
            
            if (response.status >= 500) {
              attempts++;
              await new Promise(r => setTimeout(r, 500 * attempts));
            } else {
              break;
            }
          } catch (e) {
            attempts++;
            if (attempts >= maxAttempts) throw e;
            await new Promise(r => setTimeout(r, 500 * attempts));
          }
        }

        return response!;
      } finally {
        this.inFlight.delete(requestKey);
      }
    })();

    this.inFlight.set(requestKey, requestPromise);
    return requestPromise;
  }

  addDiscoveredSource(url: string) {
    this.discoveredSources.add(url);
  }

  getDiscoveredSources() {
    return Array.from(this.discoveredSources);
  }

  getBudgetState() {
    return { ...this.budget };
  }

  setStoppedEarly(reason: string) {
    this.budget.stoppedEarly = true;
    this.budget.stopReason = reason;
  }
}
