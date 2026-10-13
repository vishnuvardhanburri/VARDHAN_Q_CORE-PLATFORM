import { Signal } from './types/LoopTypes';

/**
 * SourceGraph manages the relationship between a Company, its public sources,
 * and the specific signals extracted from those sources.
 */
export interface SourceNode {
  url: string;
  type: 'BLOG' | 'API' | 'GITHUB' | 'STATUS_PAGE' | 'DOCS' | 'JOBS' | 'NEWS' | 'OTHER';
  signals: Signal[];
  references: string[]; // URLs to other sources found within this source
  lastObserved: Date;
  status: 'ACTIVE' | 'UNAVAILABLE' | 'STALE';
}

export class SourceGraph {
  private nodes: Map<string, SourceNode> = new Map();
  private companyId: string;

  constructor(companyId: string) {
    this.companyId = companyId;
  }

  public addSource(url: string, type: SourceNode['type']): void {
    if (!this.nodes.has(url)) {
      this.nodes.set(url, {
        url,
        type,
        signals: [],
        references: [],
        lastObserved: new Date(),
        status: 'ACTIVE',
      });
    }
  }

  public addSignal(url: string, signal: Signal): void {
    const node = this.nodes.get(url);
    if (!node) {
      throw new Error(`Source ${url} not found in graph. Add source first.`);
    }
    node.signals.push(signal);
  }

  public addReference(fromUrl: string, toUrl: string): void {
    const node = this.nodes.get(fromUrl);
    if (node && !node.references.includes(toUrl)) {
      node.references.push(toUrl);
    }
  }

  public markUnavailable(url: string): void {
    const node = this.nodes.get(url);
    if (node) {
      node.status = 'UNAVAILABLE';
    }
  }

  public getSourcesByType(type: SourceNode['type']): SourceNode[] {
    return Array.from(this.nodes.values()).filter(n => n.type === type);
  }

  public getAllSignals(): Signal[] {
    return Array.from(this.nodes.values()).flatMap(n => n.signals);
  }

  public getGraph(): Map<string, SourceNode> {
    return new Map(this.nodes);
  }

  public serialize(): any {
    return {
      companyId: this.companyId,
      nodes: Array.from(this.nodes.entries()),
    };
  }

  public static deserialize(data: any): SourceGraph {
    const graph = new SourceGraph(data.companyId);
    graph.nodes = new Map(data.nodes);
    return graph;
  }
}
