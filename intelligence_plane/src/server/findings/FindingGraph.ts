/**
 * VARDHAN — FINDING GRAPH (§9)
 * ─────────────────────────────────────────────────────────────────────────────
 * A finding must be represented as a graph of evidence.
 *
 * Finding → Signal → Evidence → Source → URL → Timestamp
 *
 * Also tracks corroborating signals from independent sources.
 */

import type { Evidence } from '../IntelligenceCase';
import type { DeepSignal } from '../DeepTypes';

export interface FindingNode {
  findingId: string;
  title: string;
  type: string;
  status: string;
  /** Evidence IDs directly linked to this finding. */
  evidenceIds: string[];
  /** Signal IDs that contributed. */
  signalIds: string[];
  /** Source IDs (URLs) referenced. */
  sourceIds: string[];
  /** When this finding was first identified. */
  createdAt: string;
  /** Last time this finding was verified. */
  lastVerifiedAt: string | null;
  /** Corroborating signals from independent sources. */
  corroboratingSignalIds: string[];
  /** Confidence level. */
  confidence: number;
}

export interface GraphEdge {
  fromId: string;
  toId: string;
  relationship: string;
  evidenceIds: string[];
  /** Evidence-based confidence in this edge (0–1). */
  confidence: number;
}

export class FindingGraph {
  private nodes: Map<string, FindingNode> = new Map();
  private edges: GraphEdge[] = [];

  /** Add a finding node. */
  addFinding(node: FindingNode): void {
    this.nodes.set(node.findingId, node);
  }

  /** Add an edge (e.g. finding→signal, signal→evidence). */
  addEdge(fromId: string, toId: string, relationship: string, evidenceIds: string[] = [], confidence: number = 1.0): void {
    this.edges.push({ fromId, toId, relationship, evidenceIds, confidence });
  }

  /** Build a finding graph from signals and evidence. */
  static build(findingId: string, title: string, type: string, signals: DeepSignal[], evidence: Evidence[]): FindingGraph {
    const graph = new FindingGraph();

    const node: FindingNode = {
      findingId,
      title,
      type,
      status: 'ACTIVE',
      evidenceIds: evidence.map(e => e.id),
      signalIds: signals.map(s => s.signal_id),
      sourceIds: Array.from(new Set([...signals.map(s => s.source_url), ...evidence.map(e => e.public_url)])),
      createdAt: new Date().toISOString(),
      lastVerifiedAt: null,
      corroboratingSignalIds: [],
      confidence: 0,
    };

    graph.addFinding(node);

    // Edges: Finding → Signal → Evidence → Source
    for (const s of signals) {
      graph.addEdge(findingId, s.signal_id, 'HAS_SIGNAL', s.related_evidence_ids || [], 1.0);
      for (const evId of (s.related_evidence_ids || [])) {
        const ev = evidence.find(e => e.id === evId);
        if (ev) {
          graph.addEdge(s.signal_id, evId, 'HAS_EVIDENCE', [evId], 1.0);
          graph.addEdge(evId, ev.public_url, 'SOURCE_URL', [evId], 1.0);
          graph.addEdge(ev.public_url, ev.id, 'TIMESTAMP', [evId], 1.0);
        }
      }
    }

    // Compute confidence based on number of independent sources
    const independentSources = new Set(evidence.map(e => {
      try { return new URL(e.public_url).hostname; } catch { return e.public_url; }
    }));
    node.confidence = Math.min(1.0, (evidence.length * 0.1) + (independentSources.size * 0.15));

    return graph;
  }

  /** Get the full backward trace from a finding to sources. */
  traceBackward(id: string): GraphEdge[] {
    return this.edges.filter(e => e.fromId === id || e.toId === id);
  }

  /** Get all edge chains from a finding to its source URLs. */
  getEvidenceChain(findingId: string): string[] {
    const chain: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = [findingId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      chain.push(current);

      for (const edge of this.edges) {
        if (edge.fromId === current) queue.push(edge.toId);
      }
    }

    return chain;
  }

  /** Get the finding node. */
  getFinding(id: string): FindingNode | undefined {
    return this.nodes.get(id);
  }

  /** Serialize to JSON for persistence. */
  toJSON(): { nodes: FindingNode[]; edges: GraphEdge[] } {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
    };
  }
}
