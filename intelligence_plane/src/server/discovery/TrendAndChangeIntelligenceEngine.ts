import { Evidence } from '../IntelligenceCase';

export interface TrendEvent {
  date: Date;
  event: string;
  evidenceId: string;
  category: 'ARCHITECTURE' | 'INFRASTRUCTURE' | 'GEOGRAPHY' | 'PRODUCT' | 'API' | 'ENGINEERING' | 'INCIDENT' | 'EXPOSURE';
}

export interface TrendSignal {
  trendId: string;
  signalType: string;
  timeline: TrendEvent[];
  description: string;
  conclusion: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

export class TrendAndChangeIntelligenceEngine {
  async analyzeTrends(evidence: Evidence[]): Promise<TrendSignal[]> {
    const trends: TrendSignal[] = [];
    
    // Sort evidence by date
    const sortedEvidence = [...evidence].sort((a, b) => 
      new Date(a.retrieved_at).getTime() - new Date(b.retrieved_at).getTime()
    );

    // Example Logic: Detect "Increasing Distributed Complexity"
    const distributionMarkers = ['multi-region', 'global', 'regional', 'edge', 'replication', 'failover'];
    const matchedEvents: TrendEvent[] = [];

    sortedEvidence.forEach(e => {
      const text = (e.factualObservation || e.observed_behavior || '').toLowerCase();
      if (distributionMarkers.some(m => text.includes(m))) {
        matchedEvents.push({
          date: new Date(e.retrieved_at),
          event: text,
          evidenceId: e.id,
          category: 'ARCHITECTURE'
        });
      }
    });

    if (matchedEvents.length >= 2) {
      trends.push({
        trendId: 'TREND_DISTRIBUTED_COMPLEXITY',
        signalType: 'INCREASING_DISTRIBUTED_SYSTEM_COMPLEXITY',
        timeline: matchedEvents,
        description: 'Observation of progressive shift towards multi-region distributed architecture.',
        conclusion: 'Organization is experiencing increasing architectural pressure from regional data coordination.',
        confidence: matchedEvents.length > 3 ? 'HIGH' : 'MEDIUM'
      });
    }

    return trends;
  }
}
