import { IntelligenceCase } from './IntelligenceCase';
import { BehavioralXRayResult } from './BehavioralXRayAnalyzer';

export enum EdgeType {
  OBSERVED_EDGE = 'OBSERVED_EDGE',
  SUPPORTED_INFERENCE = 'SUPPORTED_INFERENCE',
  HYPOTHETICAL_EDGE = 'HYPOTHETICAL_EDGE'
}

export interface MapNode {
  id: string;
  type: 'FRONTEND' | 'API_GATEWAY' | 'MICROSERVICE' | 'DATABASE' | 'CACHE' | 'CDN' | 'LOAD_BALANCER' | 'UNKNOWN';
  technology: string;
  confidence: number;
  evidence_ids: string[];
}

export interface MapEdge {
  source: string;
  target: string;
  type: EdgeType;
  confidence: number;
  evidence_ids: string[];
  observation_method: string;
}

export interface ArchitectureBottleneck {
  node_id: string;
  issue: string;
  impact: 'LATENCY' | 'STABILITY' | 'SCALABILITY';
  certainty: number;
  alternative_explanations: string[];
}

export interface ArchitectureMap {
  nodes: MapNode[];
  edges: MapEdge[];
  bottlenecks: ArchitectureBottleneck[];
  final_classification: 'AMBIGUOUS_ATTRIBUTION' | 'SPECIFIC_ATTRIBUTION';
}

export class DependencyGraphReconstructor {
  /**
   * Reconstructs the internal technical flow with explicit uncertainty.
   */
  public static reconstruct(currentCase: IntelligenceCase, xrayResult?: BehavioralXRayResult): ArchitectureMap {
    const nodes: MapNode[] = [];
    const edges: MapEdge[] = [];
    const bottlenecks: ArchitectureBottleneck[] = [];

    // 1. Frontend Node (Observed)
    const feNode = {
      id: 'fe-01',
      type: 'FRONTEND' as const,
      technology: 'Web Application',
      confidence: 1.0,
      evidence_ids: currentCase.evidence.filter(e => e.source_type === 'JS_BUNDLE').map(e => e.id)
    };
    nodes.push(feNode);

    // 2. API Gateway / Edge Node (Observed if XRay exists)
    if (xrayResult && xrayResult.finalClassification !== 'INSUFFICIENT_EVIDENCE') {
      const apiNode = {
        id: 'api-01',
        type: 'API_GATEWAY' as const,
        technology: xrayResult.candidateNodes[0] || 'Unknown',
        confidence: xrayResult.confidence,
        evidence_ids: currentCase.evidence.filter(e => e.source_type === 'TIMING_ANALYSIS').map(e => e.id)
      };
      nodes.push(apiNode);

      edges.push({
        source: 'fe-01',
        target: 'api-01',
        type: EdgeType.OBSERVED_EDGE,
        confidence: 1.0,
        evidence_ids: [],
        observation_method: 'HTTP_REQUEST_FLOW'
      });

      // Detect Bottlenecks with Attribution Candidates
      if (xrayResult.confidence > 0.6) {
        bottlenecks.push({
          node_id: 'api-01',
          issue: xrayResult.supportedInference,
          impact: 'LATENCY',
          certainty: xrayResult.confidence,
          alternative_explanations: xrayResult.alternativeExplanations
        });
      }
    }

    // 3. Database Node (Inferred)
    const dbSignal = currentCase.signals?.find(s => s.excerpt?.includes('PostgreSQL') || s.excerpt?.includes('MongoDB'));
    if (dbSignal) {
      nodes.push({
        id: 'db-01',
        type: 'DATABASE' as const,
        technology: dbSignal.excerpt,
        confidence: 0.5,
        evidence_ids: []
      });

      edges.push({
        source: 'api-01',
        target: 'db-01',
        type: EdgeType.SUPPORTED_INFERENCE,
        confidence: 0.4,
        evidence_ids: [],
        observation_method: 'SIGNAL_CORRELATION'
      });
    }

    const finalClassification = bottlenecks.length > 0 && bottlenecks[0].certainty > 0.8
      ? 'SPECIFIC_ATTRIBUTION'
      : 'AMBIGUOUS_ATTRIBUTION';

    return {
      nodes,
      edges,
      bottlenecks,
      final_classification: finalClassification
    };
  }
}
