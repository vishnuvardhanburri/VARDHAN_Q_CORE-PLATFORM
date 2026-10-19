import { OpportunityDecisionEngine } from '../src/server/discovery/OpportunityDecisionEngine';
import { SurfaceSemanticAssessment } from '../src/server/discovery/SemanticTypes';

async function debug() {
  const engine = new OpportunityDecisionEngine();
  
  const mockAssessments: SurfaceSemanticAssessment[] = [
    {
      surfaceId: 's1',
      surfaceType: 'ADMIN',
      functionalRole: 'ADMINISTRATION',
      organizationAttribution: 'Test Org',
      ownershipEvidence: [],
      currentState: 'DISCOVERED',
      recency: new Date().toISOString(),
      expectedBehavior: '...',
      authExpectation: 'AUTH_UNKNOWN',
      boundaryType: 'UNKNOWN',
      evidenceIds: [],
      confidence: 0.7,
      unknowns: []
    }
  ];

  const decision = await engine.decide(
    { organizationName: 'Test Org', domain: 'test.com' },
    [], [], { nodes: [] } as any, { nodes: new Map(), edges: [] },
    mockAssessments, [], [], [], {}
  );

  console.log(`Decision state: ${decision.state}`);
  console.log(`Reason: ${decision.reason}`);
}

debug().catch(console.error);
