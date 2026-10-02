export type SignalType = 
  | 'PUBLIC_DATA_EXPOSURE'
  | 'SECURITY_EXPOSURE'
  | 'PUBLIC_MISCONFIGURATION_SIGNAL'
  | 'RELIABILITY_SIGNAL'
  | 'PERFORMANCE_SIGNAL'
  | 'LATENCY_SIGNAL'
  | 'SCALING_SIGNAL'
  | 'ARCHITECTURE_COMPLEXITY'
  | 'INFRASTRUCTURE_CHANGE'
  | 'TECHNOLOGY_MIGRATION'
  | 'PLATFORM_EXPANSION'
  | 'GEOGRAPHIC_EXPANSION'
  | 'API_EXPANSION'
  | 'DEPLOYMENT_CHANGE'
  | 'DATA_PIPELINE_COMPLEXITY'
  | 'IDENTITY_ACCESS_COMPLEXITY'
  | 'OBSERVABILITY_SIGNAL'
  | 'PUBLIC_INCIDENT'
  | 'PUBLIC_OUTAGE'
  | 'PUBLIC_CHANGE'
  | 'COMPLIANCE_RELEVANT_SIGNAL'
  | 'OPERATIONAL_COMPLEXITY'
  | 'INTEGRATION_COMPLEXITY'
  | 'OTHER_TECHNICAL_SIGNAL';

export interface SignalDefinition {
  type: SignalType;
  description: string;
  indicators: string[]; // keywords or patterns that suggest this signal
  relevance: 'HIGH' | 'MEDIUM' | 'LOW';
}

export const SIGNAL_TAXONOMY: Record<SignalType, SignalDefinition> = {
  PUBLIC_DATA_EXPOSURE: {
    type: 'PUBLIC_DATA_EXPOSURE',
    description: 'Evidence of sensitive information being publicly accessible.',
    indicators: ['exposed', 'leak', 'publicly accessible', 'unprotected'],
    relevance: 'HIGH'
  },
  SECURITY_EXPOSURE: {
    type: 'SECURITY_EXPOSURE',
    description: 'Publicly observable security misconfigurations or exposures.',
    indicators: ['cve', 'vulnerability', 'misconfigured', 'security flaw'],
    relevance: 'HIGH'
  },
  PUBLIC_MISCONFIGURATION_SIGNAL: {
    type: 'PUBLIC_MISCONFIGURATION_SIGNAL',
    description: 'Technical evidence of incorrect system configuration.',
    indicators: ['misconfigured', 'default settings', 'wrong config'],
    relevance: 'MEDIUM'
  },
  RELIABILITY_SIGNAL: {
    type: 'RELIABILITY_SIGNAL',
    description: 'Patterns indicating instability or reliability issues.',
    indicators: ['unstable', 'intermittent', 'flaky', 'reliability'],
    relevance: 'HIGH'
  },
  PERFORMANCE_SIGNAL: {
    type: 'PERFORMANCE_SIGNAL',
    description: 'Observable performance degradation or bottlenecks.',
    indicators: ['slow', 'latency', 'bottleneck', 'performance drop'],
    relevance: 'MEDIUM'
  },
  LATENCY_SIGNAL: {
    type: 'LATENCY_SIGNAL',
    description: 'High latency reported or observed in public surfaces.',
    indicators: ['ms', 'timeout', 'lag', 'slow response'],
    relevance: 'MEDIUM'
  },
  SCALING_SIGNAL: {
    type: 'SCALING_SIGNAL',
    description: 'Evidence of struggle with rapid growth or scaling.',
    indicators: ['scaling', 'growth pains', 'cannot handle', 'overloaded'],
    relevance: 'HIGH'
  },
  ARCHITECTURE_COMPLEXITY: {
    type: 'ARCHITECTURE_COMPLEXITY',
    description: 'Complexity arising from architectural choices or legacy debt.',
    indicators: ['complex', 'legacy', 'technical debt', 'monolith'],
    relevance: 'MEDIUM'
  },
  INFRASTRUCTURE_CHANGE: {
    type: 'INFRASTRUCTURE_CHANGE',
    description: 'Significant changes in underlying infrastructure.',
    indicators: ['migration', 'moving to', 'switched to', 'new infra'],
    relevance: 'MEDIUM'
  },
  TECHNOLOGY_MIGRATION: {
    type: 'TECHNOLOGY_MIGRATION',
    description: 'Active migration between technology stacks.',
    indicators: ['migrating', 'replacing', 'deprecated'],
    relevance: 'MEDIUM'
  },
  PLATFORM_EXPANSION: {
    type: 'PLATFORM_EXPANSION',
    description: 'Expanding capabilities to new platforms or models.',
    indicators: ['expanding', 'launching', 'new platform', 'adding support'],
    relevance: 'LOW'
  },
  GEOGRAPHIC_EXPANSION: {
    type: 'GEOGRAPHIC_EXPANSION',
    description: 'Expanding services to new geographic regions.',
    indicators: ['region', 'global', 'international', 'new market'],
    relevance: 'LOW'
  },
  API_EXPANSION: {
    type: 'API_EXPANSION',
    description: 'Significant growth or change in public API surfaces.',
    indicators: ['new api', 'v2', 'endpoint expansion', 'api redesign'],
    relevance: 'MEDIUM'
  },
  DEPLOYMENT_CHANGE: {
    type: 'DEPLOYMENT_CHANGE',
    description: 'Changes in how software is deployed or delivered.',
    indicators: ['deployment', 'ci/cd', 'pipeline change', 'release process'],
    relevance: 'LOW'
  },
  DATA_PIPELINE_COMPLEXITY: {
    type: 'DATA_PIPELINE_COMPLEXITY',
    description: 'Evidence of complex data movement or processing pipelines.',
    indicators: ['etl', 'pipeline', 'data flow', 'stream processing'],
    relevance: 'MEDIUM'
  },
  IDENTITY_ACCESS_COMPLEXITY: {
    type: 'IDENTITY_ACCESS_COMPLEXITY',
    description: 'Complexity in identity and access management.',
    indicators: ['iam', 'auth', 'sso', 'permissions', 'access control'],
    relevance: 'MEDIUM'
  },
  OBSERVABILITY_SIGNAL: {
    type: 'OBSERVABILITY_SIGNAL',
    description: 'Public signals related to monitoring and observability.',
    indicators: ['monitoring', 'metrics', 'logging', 'observability'],
    relevance: 'LOW'
  },
  PUBLIC_INCIDENT: {
    type: 'PUBLIC_INCIDENT',
    description: 'Publicly acknowledged incidents or failures.',
    indicators: ['incident', 'outage', 'down', 'service disruption'],
    relevance: 'HIGH'
  },
  PUBLIC_OUTAGE: {
    type: 'PUBLIC_OUTAGE',
    description: 'Complete or partial public service outages.',
    indicators: ['outage', 'down', 'unavailable', 'offline'],
    relevance: 'HIGH'
  },
  PUBLIC_CHANGE: {
    type: 'PUBLIC_CHANGE',
    description: 'Significant public-facing changes to technical behavior.',
    indicators: ['changed', 'updated', 'modified', 'new version'],
    relevance: 'LOW'
  },
  COMPLIANCE_RELEVANT_SIGNAL: {
    type: 'COMPLIANCE_RELEVANT_SIGNAL',
    description: 'Signals related to regulatory or compliance requirements.',
    indicators: ['gdpr', 'hipaa', 'soc2', 'compliance', 'regulatory'],
    relevance: 'MEDIUM'
  },
  OPERATIONAL_COMPLEXITY: {
    type: 'OPERATIONAL_COMPLEXITY',
    description: 'Evidence of operational struggle or complex manual processes.',
    indicators: ['manual', 'operational overhead', 'toil', 'maintenance'],
    relevance: 'MEDIUM'
  },
  INTEGRATION_COMPLEXITY: {
    type: 'INTEGRATION_COMPLEXITY',
    description: 'Complexity in integrating with third-party systems.',
    indicators: ['integration', 'third-party', 'partner api', 'webhook'],
    relevance: 'MEDIUM'
  },
  OTHER_TECHNICAL_SIGNAL: {
    type: 'OTHER_TECHNICAL_SIGNAL',
    description: 'Any other relevant technical signal.',
    indicators: ['technical', 'engineering', 'infrastructure'],
    relevance: 'LOW'
  },
};
