import { Evidence } from './IntelligenceCase';

export interface JSEndpoint {
  endpoint: string;
  method: string;
  assetUrl: string;
  pageUrl: string;
  snippet: string;
  evidenceId: string;
}

export class JSAssetInspector {
  /**
   * Inspects publicly linked JS assets for explicit HTTP references.
   */
  async inspectAssets(pageUrl: string, assets: string[], evidenceStore: Evidence[]): Promise<JSEndpoint[]> {
    const endpoints: JSEndpoint[] = [];

    for (const assetUrl of assets) {
      try {
        const response = await fetch(assetUrl);
        if (!response.ok) continue;
        const content = await response.text();

        // Search for explicit API call patterns
        // 1. fetch('/api/...')
        // 2. axios.get('/api/...')
        // 3. XMLHttpRequest.open('GET', '/api/...')
        const patterns = [
          { regex: /fetch\(['"]([^'"]+['"])/g, method: 'GET' },
          { regex: /axios\.(get|post|put|delete)\(['"]([^'"]+['"])/gi, method: 'DYNAMIC' },
          { regex: /\.open\(['"]([A-Z]+)['"],\s*['"]([^'"]+['"])/gi, method: 'DYNAMIC' }
        ];

        for (const { regex, method } of patterns) {
          let match;
          while ((match = regex.exec(content)) !== null) {
            let extractedMethod = method;
            let extractedEndpoint = '';

            if (method === 'DYNAMIC') {
              extractedMethod = match[1].toUpperCase();
              extractedEndpoint = match[2].replace(/['"]/g, '');
            } else {
              extractedEndpoint = match[1].replace(/['"]/g, '');
            }

            // Only keep read-only
            if (!['GET', 'HEAD'].includes(extractedMethod)) continue;
            if (extractedEndpoint.length < 2) continue;

            // Resolve relative URLs
            const fullUrl = new URL(extractedEndpoint, pageUrl).href;

            endpoints.push({
              endpoint: extractedEndpoint,
              method: extractedMethod,
              assetUrl: assetUrl,
              pageUrl: pageUrl,
              snippet: content.substring(Math.max(0, match.index - 20), Math.min(content.length, match.index + 100)),
              evidenceId: 'js_discovery'
            });
          }
        }
      } catch (e) {
        // Silently fail for inaccessible assets
      }
    }

    return endpoints;
  }
}
