import { knowledgeLayer, TechnicalPattern } from '../knowledge/KnowledgeIntegrationLayer';
import { CompanyResearchContext } from '../CompanyResearchContext';

export enum ProbeIntensity {
  PASSIVE = 'PASSIVE',     // No requests, only analysis of existing data
  LIGHT = 'LIGHT',         // Standard requests, minimal variation
  SENSITIVE = 'SENSITIVE'  // Semi-malformed requests to trigger specific error signatures
}

export interface ProbeResult {
  target: string;
  intensity: ProbeIntensity;
  status: number;
  headers: Record<string, string>;
  body: string;
  matches: TechnicalPattern[];
  isBoundaryMarker: boolean;
}

export class HybridProbeEngine {
  constructor(private context: CompanyResearchContext) {}

  /**
   * Executes a layered probe. 
   * Instead of just checking if a target exists, it analyzes the "reaction" of the server.
   */
  async executeProbe(url: string, intensity: ProbeIntensity = ProbeIntensity.LIGHT): Promise<ProbeResult> {
    console.log(`[HybridProbe] Executing ${intensity} probe on ${url}...`);
    
    let requestUrl = url;
    let options: RequestInit = { method: 'GET' };

    // If intensity is SENSITIVE, we apply "Semi-Malformed" logic to trigger signatures
    if (intensity === ProbeIntensity.SENSITIVE) {
      // Example: adding a single quote to trigger SQL error signatures
      // This is a "Safe Probe" - it doesn't extract data, but triggers a signature
      requestUrl += (url.includes('?') ? '&' : '?') + 'q=\'';
    }

    try {
      const response = await fetch(requestUrl, options);
      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => headers[k] = v);

      // Cross-reference the response with the Knowledge Layer
      const matches = knowledgeLayer.matchResponse(body, headers, response.status);

      return {
        target: url,
        intensity,
        status: response.status,
        headers,
        body,
        matches,
        isBoundaryMarker: this.isBoundaryMarker(response.status, matches)
      };
    } catch (e) {
      return {
        target: url,
        intensity,
        status: 0,
        headers: {},
        body: String(e),
        matches: [],
        isBoundaryMarker: true // Connection failure is often a boundary marker
      };
    }
  }

  private isBoundaryMarker(status: number, matches: TechnicalPattern[]): boolean {
    // A response is a boundary marker if:
    // 1. It's a 403/401 (explicit block)
    // 2. It's a 500 (internal failure)
    // 3. It matches a known technical pattern from the knowledge repos
    return status === 403 || status === 401 || status === 500 || matches.length > 0;
  }
}
