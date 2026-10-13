/**
 * VARDHAN — ENTRY POINT CHANGE DETECTION
 * ─────────────────────────────────────────────────────────────────────────────
 * Detects changes in the entry-point inventory between runs, enabling temporal
 * technical intelligence:
 *
 *   new entry point
 *   removed entry point
 *   changed authentication behavior
 *   changed documentation
 *   changed public behavior
 *   new API version
 *   deprecated API
 *   new subdomain
 *   new developer surface
 *   new cloud reference
 *   new public integration
 *
 * Every change is evidence-backed and tied to the specific evidence IDs
 * that support the old and new states.
 */

import type {
  EntryPoint, EntryPointChange, EntryPointTelemetry,
  EntryPointSnapshot, EntryPointStatus,
} from './EntryPointModel';

/** Deep-compare two entry points for field differences. */
function diffEntryPoints(
  oldEp: EntryPoint | null,
  newEp: EntryPoint | null
): { changedFields: string[]; significant: boolean } {
  if (!oldEp && newEp) {
    return { changedFields: ['full_entry_point'], significant: true };
  }
  if (oldEp && !newEp) {
    return { changedFields: ['full_entry_point'], significant: true };
  }
  if (!oldEp || !newEp) {
    return { changedFields: [], significant: false };
  }

  const changedFields: string[] = [];
  const significantFields = [
    'status', 'observability', 'authentication_model',
    'verification_eligibility', 'technology_context', 'confidence',
  ];

  const comparators: [string, any, any][] = [
    ['status', oldEp.status, newEp.status],
    ['authentication_model', oldEp.authentication_model, newEp.authentication_model],
    ['authorization_model', oldEp.authorization_model, newEp.authorization_model],
    ['verification_eligibility', JSON.stringify(oldEp.verification_eligibility), JSON.stringify(newEp.verification_eligibility)],
    ['observability', JSON.stringify(oldEp.observability), JSON.stringify(newEp.observability)],
    ['technology_context', oldEp.technology_context, newEp.technology_context],
    ['confidence', oldEp.confidence, newEp.confidence],
    ['discovery_source', JSON.stringify(oldEp.discovery_source), JSON.stringify(newEp.discovery_source)],
    ['evidence_ids', JSON.stringify(oldEp.evidence_ids), JSON.stringify(newEp.evidence_ids)],
    ['relationships', oldEp.relationships.length, newEp.relationships.length],
  ];

  for (const [field, oldVal, newVal] of comparators) {
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changedFields.push(field);
    }
  }

  const significant = changedFields.some(f => significantFields.includes(f));
  return { changedFields, significant };
}

/**
 * Compute the EntryPointChangeType for a diff.
 */
function classifyChange(
  oldEp: EntryPoint | null,
  newEp: EntryPoint | null,
  changedFields: string[]
): EntryPointChange['change_type'] {
  if (!oldEp && newEp) return 'NEW';
  if (oldEp && !newEp) return 'REMOVED';

  if (changedFields.includes('authentication_model') || changedFields.includes('observability')) {
    if (oldEp!.status !== newEp!.status) return 'CHANGED_STATUS';
    return 'CHANGED_OBSERVABILITY';
  }
  if (changedFields.includes('authentication_model')) return 'CHANGED_AUTH';
  if (changedFields.includes('evidence_ids') || changedFields.includes('discovery_source')) return 'CHANGED_DOCUMENTATION';
  if (changedFields.includes('technology_context')) return 'CHANGED_TECHNOLOGY';
  if (changedFields.includes('status')) return 'CHANGED_STATUS';

  return 'CHANGED_STATUS';
}

/**
 * Detect changes between two sets of entry points (by entry_point_id).
 */
export class EntryPointChangeDetector {
  /**
   * Compare current and prior entry-point snapshots.
   * @param current Current entry points (from this run)
   * @param prior Prior entry points (from a previous run)
   * @returns Array of changes, or empty array if no prior exists
   */
  static detect(
    current: EntryPoint[],
    prior: EntryPoint[] | null
  ): EntryPointChange[] {
    if (!prior) return [];

    const currentById: Record<string, EntryPoint> = {};
    const priorById: Record<string, EntryPoint> = {};

    for (const ep of current) currentById[ep.entry_point_id] = ep;
    for (const ep of prior) priorById[ep.entry_point_id] = ep;

    const changes: EntryPointChange[] = [];
    const now = new Date().toISOString();

    // New entry points (in current, not in prior)
    for (const ep of current) {
      if (!priorById[ep.entry_point_id]) {
        changes.push({
          entry_point_id: ep.entry_point_id,
          change_type: 'NEW',
          surface_url: ep.surface_url,
          old_status: null,
          new_status: ep.status,
          changed_fields: ['full_entry_point'],
          old_values: null,
          new_values: ep,
          evidence_ids: ep.evidence_ids,
          observed_at: now,
        });
      }
    }

    // Removed entry points (in prior, not in current)
    for (const ep of prior) {
      if (!currentById[ep.entry_point_id]) {
        changes.push({
          entry_point_id: ep.entry_point_id,
          change_type: 'REMOVED',
          surface_url: ep.surface_url,
          old_status: ep.status,
          new_status: null,
          changed_fields: ['full_entry_point'],
          old_values: ep,
          new_values: null,
          evidence_ids: ep.evidence_ids,
          observed_at: now,
        });
      }
    }

    // Changed entry points (in both, but with differences)
    for (const [id, currentEp] of Object.entries(currentById)) {
      const priorEp = priorById[id];
      if (!priorEp) continue;

      const { changedFields, significant } = diffEntryPoints(priorEp, currentEp);
      if (changedFields.length > 0) {
        const changeType = classifyChange(priorEp, currentEp, changedFields);
        changes.push({
          entry_point_id: id,
          change_type: changeType,
          surface_url: currentEp.surface_url,
          old_status: priorEp.status,
          new_status: currentEp.status,
          changed_fields: changedFields,
          old_values: significant ? {
            status: priorEp.status,
            observability: priorEp.observability,
            authentication_model: priorEp.authentication_model,
          } : null,
          new_values: significant ? {
            status: currentEp.status,
            observability: currentEp.observability,
            authentication_model: currentEp.authentication_model,
          } : {},
          evidence_ids: [...new Set([...currentEp.evidence_ids, ...priorEp.evidence_ids])],
          observed_at: now,
        });
      }
    }

    return changes;
  }

  /**
   * Compute aggregate telemetry from a set of entry points.
   */
  static computeTelemetry(
    entryPoints: EntryPoint[],
    adaptivePivots: number = 0,
    adaptiveEntryPoints: number = 0
  ): EntryPointTelemetry {
    const bySurfaceType: Record<string, number> = {};
    const byTechnology: Record<string, number> = {};
    const byAuthModel: Record<string, number> = {};
    const byDiscoverySource: Record<string, number> = {};

    let totalAttributed = 0;
    let totalObservable = 0;
    let totalDocumentedOnly = 0;
    let totalAuthRequired = 0;
    let totalVerificationEligible = 0;
    let totalVerified = 0;
    let totalHistorical = 0;
    let totalRejected = 0;
    let crossSourceConfirmed = 0;

    // Corrected metrics
    let physicalPublicSurfaces = 0;
    let contextArtifacts = 0;
    let authorizedOnlySurfaces = 0;
    let historicalSurfaces = 0;
    let documentedOnlySurfaces = 0;

    for (const ep of entryPoints) {
      // Surface type counts
      bySurfaceType[ep.surface_type] = (bySurfaceType[ep.surface_type] || 0) + 1;

      // Technology counts
      const tech = ep.technology_context;
      if (tech !== 'UNKNOWN' && tech !== 'CUSTOM') {
        byTechnology[tech] = (byTechnology[tech] || 0) + 1;
      }

      // Auth model counts
      byAuthModel[ep.authentication_model] = (byAuthModel[ep.authentication_model] || 0) + 1;

      // Discovery source counts
      for (const src of ep.discovery_source) {
        byDiscoverySource[src] = (byDiscoverySource[src] || 0) + 1;
      }

      // Status counts (legacy)
      if (ep.attribution.attribution_confidence !== 'LOW') totalAttributed++;
      if (ep.status === 'PUBLICLY_OBSERVABLE' || ep.status === 'VERIFIED_BEHAVIOR') totalObservable++;
      if (ep.status === 'DOCUMENTED_ONLY') totalDocumentedOnly++;
      if (ep.status === 'AUTHENTICATION_REQUIRED' || ep.status === 'AUTHORIZATION_REQUIRED') totalAuthRequired++;
      if (ep.verification_eligibility.eligible) totalVerificationEligible++;
      if (ep.status === 'VERIFIED_BEHAVIOR') totalVerified++;
      if (ep.status === 'HISTORICAL' || ep.status === 'LEGACY') totalHistorical++;
      if (ep.status === 'REJECTED') totalRejected++;

      // Cross-source confirmed: found via both PUBLIC_OBSERVATION and DOCUMENTATION_REFERENCE
      const ds = ep.discovery_source;
      if (ds.includes('PUBLIC_OBSERVATION') && ds.includes('DOCUMENTATION_REFERENCE')) {
        crossSourceConfirmed++;
      }

      // ── Corrected metrics ─────────────────────────────────────────
      // Physical public surfaces: NOT context artifacts, and publicly observable
      if (!ep.is_context_artifact && (ep.status === 'PUBLICLY_OBSERVABLE' || ep.status === 'VERIFIED_BEHAVIOR')) {
        physicalPublicSurfaces++;
      }
      // Context artifacts: JS bundles, cloud refs, repo mentions
      if (ep.is_context_artifact) {
        contextArtifacts++;
      }
      // Authorized-only surfaces: require auth, not publicly verifiable
      if (ep.status === 'AUTHORIZATION_REQUIRED' || ep.status === 'AUTHENTICATION_REQUIRED') {
        authorizedOnlySurfaces++;
      }
      // Historical surfaces
      if (ep.status === 'HISTORICAL' || ep.status === 'LEGACY') {
        historicalSurfaces++;
      }
      // Documented-only
      if (ep.status === 'DOCUMENTED_ONLY') {
        documentedOnlySurfaces++;
      }
    }

    const adaptiveSuccessRate = adaptivePivots > 0
      ? adaptiveEntryPoints / adaptivePivots
      : 0;

    return {
      total_discovered: entryPoints.length,
      total_attributed: totalAttributed,
      total_publicly_observable: totalObservable,
      total_documented_only: totalDocumentedOnly,
      total_auth_required: totalAuthRequired,
      total_verification_eligible: totalVerificationEligible,
      total_verified: totalVerified,
      total_historical: totalHistorical,
      total_rejected: totalRejected,
      by_surface_type: bySurfaceType,
      by_technology: byTechnology,
      by_auth_model: byAuthModel,
      by_discovery_source: byDiscoverySource,
      cross_source_confirmed: crossSourceConfirmed,
      adaptive_entry_points: adaptiveEntryPoints,
      adaptive_entry_point_success_rate: adaptiveSuccessRate,
      // ── Corrected metrics ─────────────────────────────────────────
      physical_public_surfaces: physicalPublicSurfaces,
      context_artifacts: contextArtifacts,
      authorized_only_surfaces: authorizedOnlySurfaces,
      historical_surfaces: historicalSurfaces,
      documented_only_surfaces: documentedOnlySurfaces,
      organization_count: 1,
    };
  }
}
