import { CompanyResearchContext } from './CompanyResearchContext';
import { HybridProbeEngine, ProbeIntensity } from './discovery/HybridProbeEngine';
import { ErrorSignatureAnalyzer, BoundaryType } from './discovery/ErrorSignatureAnalyzer';
import { knowledgeLayer } from './knowledge/KnowledgeIntegrationLayer';

export enum AssessmentMode {
  PUBLIC_INTELLIGENCE = 'PUBLIC_INTELLIGENCE',
  AUTHORIZED_ASSESSMENT = 'AUTHORIZED_ASSESSMENT'
}

export interface IntelligenceCase {
  company: string;
  domain: string;
  evidence: any[];
  hypotheses: any[];
  complexityMap: any;
  internalState: 'IDLE' | 'COLLECTING' | 'PIVOTING' | 'VERIFYING' | 'COMPLETE'
    | 'TECHNICAL_CONTEXT_FOUND' | 'COMPLEXITY_IDENTIFIED' | 'HYPOTHESIS_GENERATED'
    | 'VERIFICATION_REQUIRED' | 'VERIFICATION_INCONCLUSIVE' | 'VERIFIED_FINDING'
    | 'DIAGNOSTIC_ELIGIBLE' | 'OUTREACH_READY' | 'NO_ACTIONABLE_SIGNAL'
    | 'VERIFICATION_TARGET_UNAVAILABLE' | 'ADVISORY_NOTICE' | 'INVESTIGATION_CANDIDATE';
  probes: any[];
  mode: AssessmentMode;
}

export class BroadIntelligenceOrchestrator {
  constructor(private manager: any) {}

  async orchestrate(caseData: any, context: CompanyResearchContext): Promise<IntelligenceCase> {
    const intelligenceCase: IntelligenceCase = {
      ...caseData,
      internalState: 'COLLECTING',
      probes: [],
      evidence: caseData.evidence || [],
      hypotheses: caseData.hypotheses || [],
      complexityMap: caseData.complexityMap || { nodes: [], edges: [] },
      mode: caseData.mode || AssessmentMode.PUBLIC_INTELLIGENCE
    };

    const probeEngine = new HybridProbeEngine(context);
    const analyzer = new ErrorSignatureAnalyzer();

    // PHASE 1: Broad Intelligence Collection (Specialists)
    console.log(`[BroadIntel] Phase A: Collecting for ${intelligenceCase.company}...`);

    // PHASE 2: Adaptive Iterative Investigation
    let iteration = 0;
    const MAX_ITERATIONS = 3;
    let currentTarget = `https://${intelligenceCase.domain}`;

    while (iteration < MAX_ITERATIONS) {
      console.log(`[BroadIntel] Iteration ${iteration + 1}: Probing ${currentTarget}...`);

      // Determine Probe Intensity based on mode
      const intensity = intelligenceCase.mode === AssessmentMode.AUTHORIZED_ASSESSMENT
        ? ProbeIntensity.SENSITIVE
        : ProbeIntensity.LIGHT;

      const probeResult = await probeEngine.executeProbe(currentTarget, intensity);
      intelligenceCase.probes.push(probeResult);

      // Forensic Analysis
      const analysis = analyzer.analyze(probeResult);
      console.log(`[BroadIntel] Boundary: ${analysis.boundary} | Tech: ${analysis.identifiedTech.join(', ')}`);

      if (analysis.boundary === BoundaryType.OPEN_SURFACE) {
        console.log(`[BroadIntel] Found Open Surface! Transitioning to verification.`);
        intelligenceCase.internalState = 'VERIFYING';
        break;
      }

      if (analysis.boundary === BoundaryType.LEAKING_INTERNAL_STATE) {
        console.log(`[BroadIntel] Internal State Leak identified. documenting as public evidence.`);
        intelligenceCase.evidence.push({
          id: `ev_leak_${Date.now()}`,
          source: currentTarget,
          content: probeResult.body,
          type: 'INTERNAL_LEAK'
        });
        intelligenceCase.internalState = 'COMPLETE';
        break;
      }

      // Adaptive Pivot: SOURCE DISCOVERY, NOT BYPASS
      if (analysis.suggestedPivot) {
        console.log(`[BroadIntel] Pivot Suggested: ${analysis.suggestedPivot}`);
        const nextTarget = await this.findAlternatePublicSurface(intelligenceCase, analysis);

        if (nextTarget) {
          currentTarget = nextTarget;
          intelligenceCase.internalState = 'PIVOTING';
          iteration++;
          continue;
        }
      }

      iteration++;
    }

    intelligenceCase.internalState = 'COMPLETE';
    return intelligenceCase;
  }

  private async findAlternatePublicSurface(intelligenceCase: IntelligenceCase, analysis: any): Promise<string | null> {
    console.log(`[BroadIntel] Searching for alternate public surfaces for ${intelligenceCase.company}...`);

    // 1. Cross-reference with public JS bundles / SDKs (simulated for now)
    // 2. Cross-reference with known cloud naming patterns based on identifiedTech
    if (analysis.identifiedTech.includes('Kubernetes')) {
      return `https://k8s-api.${intelligenceCase.domain}`;
    }

    return null;
  }
}
