import { Evidence } from './IntelligenceCase';
import { TechnicalEntity, TechnicalRelationship, EntityType } from './TechnicalEntity';

export class TechnicalEntityExtractor {
  private readonly entityDefinitions: Record<string, { type: EntityType, keywords: string[], confidence: 'LOW' | 'MEDIUM' | 'HIGH' }> = {
    // COMPUTE
    'GPU': { type: 'COMPUTE', keywords: ['gpu', 'h100', 'a100', 'cuda', 'nvidia', 'v100', 'l40', 'h200'], confidence: 'HIGH' },
    'CPU': { type: 'COMPUTE', keywords: ['cpu', 'x86', 'arm', 'graviton', ' Xeon'], confidence: 'MEDIUM' },
    'ACCELERATOR': { type: 'COMPUTE', keywords: ['tpu', 'lpu', 'accelerator', 'npu', 'groq', 'cerebras'], confidence: 'HIGH' },
    'GPU_CLUSTER': { type: 'COMPUTE', keywords: ['gpu cluster', 'cluster of gpus', 'gpu farm', 'compute cluster', 'infini-band'], confidence: 'HIGH' },
    'SERVERLESS': { type: 'COMPUTE', keywords: ['serverless', 'lambda', 'cloud functions', 'knative'], confidence: 'MEDIUM' },
    
    // WORKLOAD
    'INFERENCE': { type: 'WORKLOAD', keywords: ['inference', 'serving', 'prediction', 'llm serving', 'token generation', 'vllm', 'tgi'], confidence: 'HIGH' },
    'TRAINING': { type: 'WORKLOAD', keywords: ['training', 'fine-tuning', 'pre-training', 'sft', 'rlhf'], confidence: 'HIGH' },
    'BATCH': { type: 'WORKLOAD', keywords: ['batch processing', 'background jobs', 'offline processing', 'async jobs'], confidence: 'MEDIUM' },
    'STREAMING': { type: 'WORKLOAD', keywords: ['stream processing', 'real-time requests', 'event stream', 'websocket', 'grpc'], confidence: 'HIGH' },
    'CONCURRENCY': { type: 'WORKLOAD', keywords: ['high concurrency', 'thousand requests', 'concurrent users', 'throughput', 'rps'], confidence: 'MEDIUM' },
    
    // CONTROL
    'SCHEDULER': { type: 'CONTROL', keywords: ['scheduler', 'job scheduler', 'task scheduler', 'slurm', 'kubernetes scheduler'], confidence: 'HIGH' },
    'ORCHESTRATOR': { type: 'CONTROL', keywords: ['orchestration', 'orchestrator', 'k8s', 'kubernetes', 'eks', 'gke', 'aks'], confidence: 'HIGH' },
    'AUTOSCALER': { type: 'CONTROL', keywords: ['autoscaling', 'auto-scale', 'horizontal scaling', 'hpa', 'vpa'], confidence: 'HIGH' },
    'ROUTER': { type: 'CONTROL', keywords: ['router', 'routing', 'load balancer', 'traffic management', 'nginx', 'envoy', 'haproxy'], confidence: 'HIGH' },
    'QUEUE': { type: 'CONTROL', keywords: ['queue', 'kafka', 'rabbitmq', 'sqs', 'message broker', 'pubsub'], confidence: 'HIGH' },
    'WORKER_POOL': { type: 'CONTROL', keywords: ['worker pool', 'worker nodes', 'fleet', 'node group'], confidence: 'HIGH' },
    'CONTROL_PLANE': { type: 'CONTROL', keywords: ['control plane', 'management plane', 'api server'], confidence: 'HIGH' },
    
    // DATA
    'DATABASE': { type: 'DATA', keywords: ['database', 'postgresql', 'mongodb', 'cassandra', 'sql', 'nosql', 'dynamodb', 'spanner'], confidence: 'HIGH' },
    'SHARDING': { type: 'DATA', keywords: ['sharding', 'shard', 'partitioning', 'horizontal partitioning'], confidence: 'HIGH' },
    'REPLICATION': { type: 'DATA', keywords: ['replication', 'replica', 'mirroring', 'read replica'], confidence: 'HIGH' },
    'DATA_PIPELINE': { type: 'DATA', keywords: ['data pipeline', 'etl', 'data flow', 'spark', 'flink', 'airflow'], confidence: 'HIGH' },
    'CACHE': { type: 'DATA', keywords: ['cache', 'redis', 'memcached', 'cdn cache'], confidence: 'MEDIUM' },
    
    // NETWORK
    'MULTI_REGION': { type: 'NETWORK', keywords: ['multi-region', 'global deployment', 'across regions', 'geographical distribution'], confidence: 'HIGH' },
    'REGIONAL_ROUTING': { type: 'NETWORK', keywords: ['regional routing', 'geo-routing', 'latency-based routing', 'anycast'], confidence: 'HIGH' },
    'SERVICE_MESH': { type: 'NETWORK', keywords: ['service mesh', 'istio', 'linkerd', 'consul'], confidence: 'HIGH' },
    'EDGE': { type: 'NETWORK', keywords: ['edge', 'cdn', 'edge computing', 'cloudflare workers', 'lambda edge'], confidence: 'MEDIUM' },
    
    // CHANGE
    'MIGRATION': { type: 'TECHNICAL_CHANGE', keywords: ['migration', 'migrating', 'moved from', 'rewrite', 'porting'], confidence: 'HIGH' },
    'EXPANSION': { type: 'TECHNICAL_CHANGE', keywords: ['expansion', 'new region', 'new product', 'scaling out', 'launching'], confidence: 'MEDIUM' },
    'REWRITE': { type: 'TECHNICAL_CHANGE', keywords: ['rewrite', 'refactored', 'rebuilt', 'architectural shift'], confidence: 'HIGH' },
  };

  extractEntities(evidence: Evidence[]): TechnicalEntity[] {
    const entities: TechnicalEntity[] = [];
    const seen = new Map<string, TechnicalEntity>();

    evidence.forEach(e => {
      const text = (e.factualObservation || e.observed_behavior || '').toLowerCase();
      
      if (/scales with your business|enterprise-grade|high performance|ai-powered platform|cloud-native platform/i.test(text)) return;

      for (const [canonicalLabel, def] of Object.entries(this.entityDefinitions)) {
        for (const kw of def.keywords) {
          if (text.includes(kw)) {
            const entityId = `ent_${canonicalLabel.toLowerCase()}`;
            
            if (seen.has(entityId)) {
              const existing = seen.get(entityId)!;
              existing.evidenceIds.push(e.id);
              existing.sourceUrls.push(e.public_url);
            } else {
              const entity: TechnicalEntity = {
                entityId,
                entityType: def.type,
                canonicalLabel,
                contextSnippet: text.substring(0, 200),
                evidenceIds: [e.id],
                sourceUrls: [e.public_url],
                confidence: def.confidence,
                subjectAttribution: e.provenance.attribution
              };
              entities.push(entity);
              seen.set(entityId, entity);
            }
          }
        }
      }
    });

    return entities;
  }

  extractRelationships(entities: TechnicalEntity[], evidence: Evidence[]): TechnicalRelationship[] {
    const relationships: TechnicalRelationship[] = [];
    
    const compute = entities.filter(e => e.entityType === 'COMPUTE');
    const workloads = entities.filter(e => e.entityType === 'WORKLOAD');
    
    compute.forEach(c => {
      workloads.forEach(w => {
        const sharedEvidence = c.evidenceIds.filter(id => w.evidenceIds.includes(id));
        if (sharedEvidence.length > 0) {
          relationships.push({
            relationshipId: `rel_${c.entityId}_${w.entityId}`,
            sourceEntityId: c.entityId,
            targetEntityId: w.entityId,
            relationshipType: 'SUPPORTS',
            evidenceIds: sharedEvidence,
            rationale: `Compute ${c.canonicalLabel} supports workload ${w.canonicalLabel} based on shared evidence.`
          });
        }
      });
    });

    const control = entities.filter(e => e.entityType === 'CONTROL');
    [...compute, ...workloads].forEach(target => {
      control.forEach(ctrl => {
        const sharedEvidence = ctrl.evidenceIds.filter(id => target.evidenceIds.includes(id));
        if (sharedEvidence.length > 0) {
          relationships.push({
            relationshipId: `rel_${ctrl.entityId}_${target.entityId}`,
            sourceEntityId: ctrl.entityId,
            targetEntityId: target.entityId,
            relationshipType: 'CONTROLLED_BY',
            evidenceIds: sharedEvidence,
            rationale: `Control mechanism ${ctrl.canonicalLabel} manages ${target.canonicalLabel}.`
          });
        }
      });
    });

    const data = entities.filter(e => e.entityType === 'DATA');
    const network = entities.filter(e => e.entityType === 'NETWORK');
    data.forEach(d => {
      network.forEach(n => {
        const sharedEvidence = d.evidenceIds.filter(id => n.evidenceIds.includes(id));
        if (sharedEvidence.length > 0) {
          relationships.push({
            relationshipId: `rel_${d.entityId}_${n.entityId}`,
            sourceEntityId: d.entityId,
            targetEntityId: n.entityId,
            relationshipType: 'DEPENDS_ON',
            evidenceIds: sharedEvidence,
            rationale: `Data architecture ${d.canonicalLabel} depends on ${n.canonicalLabel}.`
          });
        }
      });
    });

    return relationships;
  }
}
