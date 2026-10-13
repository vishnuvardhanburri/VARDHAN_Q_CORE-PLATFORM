import { SearchProvider, SearchProviderResponse, SearchOptions, SearchFailureReason } from '../WebSearchProvider';

export class SerperWebSearchProvider implements SearchProvider {
  readonly name = 'SerperWebSearchProvider';
  readonly available: boolean;
  private readonly apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.SERPER_API_KEY;
    this.available = !!this.apiKey;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchProviderResponse> {
    if (!this.available) {
      return { results: [], failureReason: SearchFailureReason.SEARCH_UNAVAILABLE };
    }

    const maxResults = options.maxResults ?? 10;
    const signal = options.signal;

    try {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': this.apiKey!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: query,
          gl: 'us',
          hl: 'en',
          num: maxResults,
        }),
        signal: signal ?? AbortSignal.timeout(8000),
      });

      if (response.status === 401 || response.status === 403) {
        return { results: [], failureReason: SearchFailureReason.SEARCH_BLOCKED };
      }
      if (response.status === 429) {
        return { results: [], failureReason: SearchFailureReason.SEARCH_RATE_LIMITED };
      }
      if (!response.ok) {
        return { results: [], failureReason: SearchFailureReason.SEARCH_UNAVAILABLE };
      }

      const data = await response.json();
      const organic = data.organic || [];
      
      if (organic.length === 0) {
        return { results: [], failureReason: SearchFailureReason.SEARCH_EMPTY };
      }

      const results = organic.map((res: any) => ({
        title: res.title,
        snippet: res.snippet,
        url: res.link,
        source: 'serper-organic',
      }));

      return { results };
    } catch (e: any) {
      return {
        results: [],
        failureReason: SearchFailureReason.SEARCH_UNAVAILABLE,
      };
    }
  }
}
