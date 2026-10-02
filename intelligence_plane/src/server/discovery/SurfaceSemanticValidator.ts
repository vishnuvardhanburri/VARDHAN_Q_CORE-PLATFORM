import { ExternalSurface } from './SurfaceTypes';
import { Evidence } from '../IntelligenceCase';
import { OrganizationIdentityGraph } from './OrganizationIdentityGraph';
import { SurfaceSemanticAssessment, FunctionalRole, AuthExpectation } from './SemanticTypes';

export class SurfaceSemanticValidator {
  async validate(
    surface: ExternalSurface,
    evidenceStore: Evidence[],
    identityGraph: OrganizationIdentityGraph
  ): Promise<SurfaceSemanticAssessment> {
    const surfaceEvidence = evidenceStore.filter(e => e.public_url === surface.url);
    const allText = surfaceEvidence.map(e => e.observed_behavior || '').join(' ').toLowerCase();

    // GOLD MINE LOGIC: Use the discovery surface type as a primary hint.
    let role: FunctionalRole = 'UNKNOWN';

    // Mapping discovery types to functional roles
    const typeMap: Record<string, FunctionalRole> = {
      'API': 'API',
      'AUTH': 'AUTHENTICATION',
      'ADMIN': 'ADMINISTRATION',
      'STATUS': 'STATUS',
      'DOCS': 'DOCUMENTATION',
      'SERVICE': 'SERVICE'
    };

    role = typeMap[surface.type] || 'UNKNOWN';

    // Override role if explicit evidence is found
    if (allText.includes('api') || allText.includes('endpoint') || allText.includes('json')) {
      role = 'API';
    } else if (allText.includes('login') || allText.includes('sign-in') || allText.includes('auth')) {
      role = 'AUTHENTICATION';
    } else if (allText.includes('status') || allText.includes('health')) {
      role = 'STATUS';
    } else if (allText.includes('admin') || allText.includes('dashboard')) {
      role = 'ADMINISTRATION';
    }

    let authExpectation: AuthExpectation = 'AUTH_UNKNOWN';

    if (allText.includes('requires authentication') || allText.includes('protected')) {
      authExpectation = 'AUTH_EXPECTED';
    } else if (allText.includes('public endpoint') || allText.includes('unauthenticated')) {
      authExpectation = 'AUTH_NOT_EXPECTED';
    }

    return {
      surfaceId: surface.id,
      surfaceType: surface.type,
      functionalRole: role,
      organizationAttribution: surface.provenance,
      ownershipEvidence: surfaceEvidence.map(e => e.id),
      currentState: 'DISCOVERED',
      recency: new Date().toISOString(),
      expectedBehavior: `Expected ${role} behavior with ${authExpectation} authentication.`,
      authExpectation: authExpectation,
      boundaryType: 'UNKNOWN',
      evidenceIds: surfaceEvidence.map(e => e.id),
      confidence: 0.7,
      unknowns: authExpectation === 'AUTH_UNKNOWN' ? ['Actual authentication requirement'] : []
    };
  }
}
