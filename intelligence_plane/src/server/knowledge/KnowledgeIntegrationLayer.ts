/**
 * KnowledgeIntegrationLayer
 * Normalizes and indexes security knowledge from the 4 primary repositories:
 * 1. Nuclei templates (Protocol & Matcher models)
 * 2. Vulnerable code snippets (Pattern library)
 * 3. Awesome vulnerable apps (Technology taxonomy)
 * 4. GitHub vulnerable topic (Real-world corpus)
 */

export enum KnowledgeSource {
  NUCLEI = 'NUCLEI',
  CODE_SNIPPETS = 'CODE_SNIPPETS',
  VULNERABLE_APPS = 'VULNERABLE_APPS',
  GITHUB_TOPIC = 'GITHUB_TOPIC'
}

export interface TechnicalPattern {
  id: string;
  source: KnowledgeSource;
  technology: string;
  patternType: 'HEADER' | 'BODY' | 'STATUS' | 'BEHAVIOR' | 'SKELETON';
  signature: string; // The regex or string to match
  description: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export class KnowledgeIntegrationLayer {
  private patternRegistry: Map<string, TechnicalPattern[]> = new Map();

  constructor() {
    this.initializeDefaultPatterns();
  }

  private initializeDefaultPatterns() {
    // Initial seed patterns based on security best practices
    // In a production run, these would be loaded from the actual repos
    const seedPatterns: TechnicalPattern[] = [
      {
        id: 'pat_sql_error_mysql',
        source: KnowledgeSource.CODE_SNIPPETS,
        technology: 'MySQL',
        patternType: 'BODY',
        signature: 'SQL syntax; check the manual that corresponds to your MySQL server version',
        description: 'Standard MySQL syntax error leak',
        riskLevel: 'HIGH'
      },
      {
        id: 'pat_gpu_triton_header',
        source: KnowledgeSource.NUCLEI,
        technology: 'NVIDIA Triton',
        patternType: 'HEADER',
        signature: 'X-Triton-Server',
        description: 'Direct Triton Server identification',
        riskLevel: 'LOW'
      },
      {
        id: 'pat_k8s_api_leak',
        source: KnowledgeSource.GITHUB_TOPIC,
        technology: 'Kubernetes',
        patternType: 'STATUS',
        signature: '401 Unauthorized (kube-apiserver)',
        description: 'Exposed K8s API server boundary',
        riskLevel: 'MEDIUM'
      }
    ];

    seedPatterns.forEach(p => this.registerPattern(p));
  }

  public registerPattern(pattern: TechnicalPattern) {
    const tech = pattern.technology.toLowerCase();
    const existing = this.patternRegistry.get(tech) || [];
    this.patternRegistry.set(tech, [...existing, pattern]);
  }

  public findPatternsForTech(tech: string): TechnicalPattern[] {
    return this.patternRegistry.get(tech.toLowerCase()) || [];
  }

  public matchResponse(body: string, headers: Record<string, string>, status: number): TechnicalPattern[] {
    const matches: TechnicalPattern[] = [];
    
    for (const patterns of this.patternRegistry.values()) {
      for (const p of patterns) {
        if (p.patternType === 'BODY' && body.includes(p.signature)) matches.push(p);
        if (p.patternType === 'HEADER' && Object.keys(headers).some(h => h.includes(p.signature))) matches.push(p);
        if (p.patternType === 'STATUS' && String(status).includes(p.signature)) matches.push(p);
      }
    }
    
    return matches;
  }
}

export const knowledgeLayer = new KnowledgeIntegrationLayer();
