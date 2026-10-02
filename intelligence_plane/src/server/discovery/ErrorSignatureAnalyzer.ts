import { knowledgeLayer, TechnicalPattern } from '../knowledge/KnowledgeIntegrationLayer';
import { ProbeResult } from './HybridProbeEngine';

export enum BoundaryType {
  WAF_PROTECTED = 'WAF_PROTECTED',
  APP_LAYER_BLOCK = 'APP_LAYER_BLOCK',
  NETWORK_LEVEL_DROP = 'NETWORK_LEVEL_DROP',
  LEAKING_INTERNAL_STATE = 'LEAKING_INTERNAL_STATE',
  OPEN_SURFACE = 'OPEN_SURFACE',
  UNKNOWN = 'UNKNOWN'
}

export interface ForensicAnalysis {
  boundary: BoundaryType;
  identifiedTech: string[];
  patternsMatched: TechnicalPattern[];
  confidence: number;
  suggestedPivot: string | null;
  isAuthorizedRequired: boolean;
}

export class ErrorSignatureAnalyzer {
  /**
   * Analyzes a ProbeResult to determine the nature of the boundary.
   * Strict Separation: Source Discovery != Boundary Bypass.
   */
  public analyze(result: ProbeResult): ForensicAnalysis {
    const { status, body, headers, matches } = result;
    
    let boundary = BoundaryType.UNKNOWN;
    let suggestedPivot = null;
    const identifiedTech = matches.map(m => m.technology);

    // 1. Check for explicit leaks (Internal State) - Legitimate Public Evidence
    if (status === 500 || (status === 200 && matches.length > 0 && matches.some(m => m.riskLevel === 'HIGH'))) {
      boundary = BoundaryType.LEAKING_INTERNAL_STATE;
      suggestedPivot = 'Correlate leak with other public surfaces to identify the internal source';
    } 
    // 2. Check for WAF/Proxy signatures
    else if (this.isWafSignature(headers, body, status)) {
      boundary = BoundaryType.WAF_PROTECTED;
      suggestedPivot = 'Search for alternate public surfaces (JS bundles, SDKs, linked domains) to find the origin';
    }
    // 3. Check for Application-level blocks
    else if (status === 403 || status === 401) {
      boundary = BoundaryType.APP_LAYER_BLOCK;
      suggestedPivot = 'Consult public documentation and SDKs for legitimate alternate access paths';
    }
    // 4. Check for Network drops
    else if (status === 0) {
      boundary = BoundaryType.NETWORK_LEVEL_DROP;
      suggestedPivot = 'Identify related public domains or cloud provider infrastructure';
    }
    // 5. Open surface
    else if (status >= 200 && status < 300) {
      boundary = BoundaryType.OPEN_SURFACE;
      suggestedPivot = 'Proceed to observable verification';
    }

    return {
      boundary,
      identifiedTech,
      patternsMatched: matches,
      confidence: matches.length > 0 ? 0.9 : 0.4,
      suggestedPivot,
      isAuthorizedRequired: boundary === BoundaryType.WAF_PROTECTED || boundary === BoundaryType.APP_LAYER_BLOCK
    };
  }

  private isWafSignature(headers: Record<string, string>, body: string, status: number): boolean {
    const wafHeaders = ['cf-ray', 'x-cdn', 'x-akamai', 'server: cloudflare', 'server: aws-waf'];
    const hasWafHeader = Object.keys(headers).some(h => 
      wafHeaders.some(wh => h.toLowerCase().includes(wh.split(':')[0]))
    );
    
    const wafBodyMarkers = ['cloudflare', 'akamai', 'sucuri', 'imperva', 'incapsula'];
    const hasWafBody = wafBodyMarkers.some(marker => body.toLowerCase().includes(marker));

    return hasWafHeader || hasWafBody;
  }
}

export const errorAnalyzer = new ErrorSignatureAnalyzer();
