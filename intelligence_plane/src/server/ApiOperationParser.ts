import { Evidence } from './IntelligenceCase';

export interface DocumentedApiOperation {
  operationId: string;
  endpoint: string;
  method: string;
  baseUrl: string;
  fullUrl: string;
  documentationUrl: string;
  discoverySource: 'OPENAPI' | 'CURL' | 'SDK' | 'REFERENCE';
  authRequirement: 'PUBLIC_UNAUTHENTICATED' | 'PUBLIC_AUTH_REQUIRED' | 'UNKNOWN';
  parameters: Record<string, any>;
  requestSafety: 'SAFE' | 'UNSAFE' | 'UNKNOWN';
  responseObservableProperties: string[];
  evidenceIds: string[];
}

export class ApiOperationParser {
  /**
   * Parses API documentation evidence to extract explicit executable operations.
   */
  async extractOperations(evidence: Evidence[], baseUrl?: string): Promise<DocumentedApiOperation[]> {
    const operations: DocumentedApiOperation[] = [];

    for (const e of evidence) {
      const text = (e.factualObservation || e.observed_behavior || '').toLowerCase();
      const url = e.public_url;

      // 1. OpenAPI/Swagger Discovery
      if (url.endsWith('.json') || url.endsWith('.yaml') || url.includes('openapi') || url.includes('swagger')) {
        const specOps = await this.parseOpenApiSpec(url, e.id);
        operations.push(...specOps);
      }

      // 2. CURL / HTTP Example Extraction
      const curlOps = this.extractCurlExamples(text, url, e.id);
      operations.push(...curlOps);

      // 3. Reference Extraction (METHOD /path)
      const refOps = this.extractReferenceOperations(text, url, e.id);
      operations.push(...refOps);
    }

    return operations;
  }

  private async parseOpenApiSpec(url: string, evidenceId: string): Promise<DocumentedApiOperation[]> {
    try {
      const response = await fetch(url);
      if (!response.ok) return [];
      const spec = await response.json();
      
      const ops: DocumentedApiOperation[] = [];
      const base = spec.servers?.[0]?.url || '';
      
      if (!spec.paths) return [];

      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, opData] of Object.entries(methods as any)) {
          const m = method.toUpperCase();
          if (!['GET', 'HEAD'].includes(m)) continue; // Safe operations only

          const op = opData as any;
          ops.push({
            operationId: op.operationId || `${m}_${path}`,
            endpoint: path,
            method: m,
            baseUrl: base,
            fullUrl: `${base}${path}`,
            documentationUrl: url,
            discoverySource: 'OPENAPI',
            authRequirement: this.determineAuth(op),
            parameters: op.parameters || {},
            requestSafety: 'SAFE',
            responseObservableProperties: op.responses?.['200']?.content?.['application/json']?.schema?.properties 
              ? Object.keys(op.responses['200'].content['application/json'].schema.properties) 
              : [],
            evidenceIds: [evidenceId]
          });
        }
      }
      return ops;
    } catch (e) {
      return [];
    }
  }

  private extractCurlExamples(text: string, docUrl: string, evidenceId: string): DocumentedApiOperation[] {
    const ops: DocumentedApiOperation[] = [];
    // Match the curl command line roughly up to a newline that doesn't end with a slash, or end of string.
    // We'll just grab chunks of text that start with curl and grab the next 500 chars to analyze.
    const curlRegex = /curl\s+[^]+?(?=

|$)/gi;
    let match;
    while ((match = curlRegex.exec(text)) !== null) {
      const curlBlock = match[0];
      
      const urlMatch = /(https?:\/\/[^\s"']+)/i.exec(curlBlock);
      if (!urlMatch) continue;
      
      const fullUrl = urlMatch[1];
      const methodMatch = /-X\s+([A-Z]+)/i.exec(curlBlock);
      const method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';
      
      if (!['GET', 'HEAD'].includes(method)) continue;

      const urlObj = new URL(fullUrl);
      
      const curlLower = curlBlock.toLowerCase();
      const hasAuthHeader = curlLower.includes('authorization:') || curlLower.includes('x-api-key') || curlLower.includes('bearer ');
      
      ops.push({
        operationId: `curl_${Math.random().toString(36).substr(2, 5)}`,
        endpoint: urlObj.pathname,
        method: method,
        baseUrl: `${urlObj.protocol}//${urlObj.hostname}`,
        fullUrl,
        documentationUrl: docUrl,
        discoverySource: 'CURL',
        authRequirement: hasAuthHeader ? 'PUBLIC_AUTH_REQUIRED' : 'UNKNOWN',
        parameters: {},
        requestSafety: 'SAFE',
        responseObservableProperties: [],
        evidenceIds: [evidenceId]
      });
    }
    return ops;
  }

  private extractReferenceOperations(text: string, docUrl: string, evidenceId: string): DocumentedApiOperation[] {
    const ops: DocumentedApiOperation[] = [];
    // Match "GET /v1/models"
    const refRegex = /\b(GET|HEAD)\s+(\/[a-zA-Z0-9\/_-]+)\b/gi;
    let match;
    while ((match = refRegex.exec(text)) !== null) {
      const method = match[1].toUpperCase();
      const path = match[2];
      
      // We need a base URL to make it executable. 
      // For now, we assume the company's domain from the docUrl.
      const urlObj = new URL(docUrl);
      const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;

      ops.push({
        operationId: `ref_${Math.random().toString(36).substr(2, 5)}`,
        endpoint: path,
        method: method,
        baseUrl: baseUrl,
        fullUrl: `${baseUrl}${path}`,
        documentationUrl: docUrl,
        discoverySource: 'REFERENCE',
        authRequirement: 'UNKNOWN',
        parameters: {},
        requestSafety: 'SAFE',
        responseObservableProperties: [],
        evidenceIds: [evidenceId]
      });
    }
    return ops;
  }

  private determineAuth(op: any): 'PUBLIC_UNAUTHENTICATED' | 'PUBLIC_AUTH_REQUIRED' | 'UNKNOWN' {
    if (!op.security || op.security.length === 0) return 'PUBLIC_UNAUTHENTICATED';
    return 'PUBLIC_AUTH_REQUIRED';
  }
}
