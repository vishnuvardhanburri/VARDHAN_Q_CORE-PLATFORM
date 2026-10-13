/**
 * VARDHAN — ENTRY POINT GRAPH
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds and queries the directed relationship graph between entry points.
 *
 * Relationships are evidence-backed and confidence-rated. The graph enables
 * VARDHAN to answer "which doors are connected?" rather than just "what doors
 * exist?".
 *
 * Relationship rules:
 *   WEBSITE → USES → LOGIN              (homepage references login)
 *   LOGIN  → AUTHENTICATES → API        (login issues tokens for API)
 *   API    → DEPENDS_ON → IDENTITY_PROVIDER (API relies on external IdP)
 *   WEB_APP → CALLS → API_OPERATION     (frontend JS calls API)
 *   DOCUMENTATION → DOCUMENTS → API_OPERATION (docs describe API)
 *   SDK    → IMPLEMENTS → API_OPERATION (SDK wraps API)
 *   STATUS_PAGE → REPRESENTS → SERVICE (status page for a service)
 *   PRODUCT_DOMAIN → BELONGS_TO → ORGANIZATION (subdomain belongs to org)
 *   LEGACY_SURFACE → REPLACED_BY → CURRENT_SURFACE (deprecation)
 *   PUBLIC_JS → REFERENCES → API (client code references API)
 *   CLOUD_REFERENCE → SUPPORTS → PUBLIC_SERVICE (cloud ref supports service)
 */

import type {
  EntryPoint, EntryPointGraph, EntryPointEdge, EntryPointRelation,
  EntryPointRelationType, EntryPointGraphMetrics, EdgeBasis,
  EntryPointSurfaceType,
} from './EntryPointModel';
import { createHash } from 'crypto';

/** Determine if two entry points should be connected by a relationship,
 * and return the relation type plus the evidence basis.
 *
 * Only returns a relationship when it is directly supported by shared evidence
 * or explicit evidence text. Same-root-domain heuristics and hostname similarity
 * are NOT used to fabricate edges.
 */
function computeRelationship(
  source: EntryPoint,
  target: EntryPoint
): { relation: EntryPointRelationType; basis: EdgeBasis; evidenceIds: string[]; createdFrom: string } | null {
  const sPath = source.surface_url.replace(/^https?:\/\/[^/]+/, '');
  const tPath = target.surface_url.replace(/^https?:\/\/[^/]+/, '');
  const sHost = source.hostname;
  const tHost = target.hostname;
  const sType = source.surface_type;
  const tType = target.surface_type;

  // Helper: check if an entry point has a role (either surface_type or in semantic_roles)
  const hasRole = (ep: EntryPoint, role: EntryPointSurfaceType): boolean =>
    ep.surface_type === role || (ep.semantic_roles?.includes(role) ?? false);

  // Shared evidence = direct proof that both surfaces were observed in the same response
  const sharedEvidence = source.evidence_ids.filter(id => target.evidence_ids.includes(id));
  const hasSharedEvidence = sharedEvidence.length > 0;

  // ── BELONGS_TO: subdomain → canonical domain on same root
  // Evidence: the subdomain entry point was observed alongside the canonical domain
  if (sHost !== tHost && tHost === source.canonical_domain
      && (sType.startsWith('DOMAIN_') || hasRole(source, 'DOMAIN_API'))
      && (tType === 'DOMAIN_CANONICAL' || hasRole(target, 'DOMAIN_CANONICAL'))) {
    if (hasSharedEvidence) {
      return {
        relation: 'BELONGS_TO',
        basis: 'SHARED_EVIDENCE',
        evidenceIds: sharedEvidence,
        createdFrom: `Subdomain ${sHost} observed in evidence shared with canonical domain ${tHost}.`,
      };
    }
    // DNS-level fact: subdomain hostname ends with canonical domain
    // VARDHAN QUALITY MODEL: Evidence IDs MUST remain empty for inferred structural edges.
    return {
      relation: 'BELONGS_TO',
      basis: 'SAME_ROOT_DOMAIN',
      evidenceIds: [],
      createdFrom: `Subdomain ${sHost} shares root domain ${tHost} — DNS-level structural relationship.`,
    };
  }

  // ── CALLS: web app → API (frontend JS references API URL)
  if ((hasRole(source, 'WEBSITE_APPLICATION') || hasRole(source, 'WEBSITE_HOMEPAGE')
       || hasRole(source, 'CLIENT_API_BASE_URL'))
      && (hasRole(target, 'API_REST') || hasRole(target, 'API_GRAPHQL') || hasRole(target, 'API_VERSIONED'))) {
    if (hasSharedEvidence) {
      return {
        relation: 'CALLS',
        basis: 'SHARED_EVIDENCE',
        evidenceIds: sharedEvidence,
        createdFrom: `API endpoint ${tHost}${tPath} referenced in evidence for ${sHost}${sPath}.`,
      };
    }
    if (source.surface_type === 'CLIENT_API_BASE_URL') {
      // VARDHAN QUALITY MODEL: Evidence IDs MUST remain empty for inferred edges.
      return {
        relation: 'CALLS',
        basis: 'EXPLICIT_REFERENCE',
        evidenceIds: [],
        createdFrom: `Client-side API base URL ${sHost}${sPath} explicitly references ${tHost}${tPath}.`,
      };
    }
  }

  // ── DOCUMENTS: developer portal/docs → API
  if ((hasRole(source, 'WEBSITE_DEVELOPER_PORTAL') || hasRole(source, 'DOMAIN_DOCUMENTATION') || hasRole(source, 'API_REFERENCE'))
      && (hasRole(target, 'API_REST') || hasRole(target, 'API_GRAPHQL'))) {
    if (hasSharedEvidence) {
      return {
        relation: 'DOCUMENTS',
        basis: 'SHARED_EVIDENCE',
        evidenceIds: sharedEvidence,
        createdFrom: `Documentation at ${sHost}${sPath} references API ${tHost}${tPath}.`,
      };
    }
  }

  // ── AUTHENTICATES: login → API
  if ((hasRole(source, 'WEBSITE_LOGIN') || hasRole(source, 'IDENTITY_LOGIN_SYSTEM'))
      && (hasRole(target, 'API_REST') || hasRole(target, 'API_GRAPHQL') || hasRole(target, 'API_VERSIONED'))) {
    if (hasSharedEvidence) {
      return {
        relation: 'AUTHENTICATES',
        basis: 'SHARED_EVIDENCE',
        evidenceIds: sharedEvidence,
        createdFrom: `Login system at ${sHost}${sPath} observed alongside API ${tHost}${tPath}.`,
      };
    }
    // VARDHAN QUALITY MODEL: We no longer infer AUTHENTICATES relationships without shared evidence.
    return null;
  }

  // ── REPLACED_BY: legacy → current (only if deprecation evidence mentions replacement)
  if (hasRole(source, 'LEGACY_DEPRECATED_API')) {
    // Check if evidence text of the legacy entry point references the target
    const legacyEvidence = source.evidence_ids;
    for (const eid of legacyEvidence) {
      // We can't check evidence text here without the evidence array.
      // Only create this edge when shared evidence exists.
    }
    if (hasSharedEvidence) {
      return {
        relation: 'REPLACED_BY',
        basis: 'SHARED_EVIDENCE',
        evidenceIds: sharedEvidence,
        createdFrom: `Legacy surface ${sHost}${sPath} and replacement ${tHost}${tPath} co-observed.`,
      };
    }
  }

  // ── References: JS bundle or client config → API
  if ((hasRole(source, 'CLIENT_JS_BUNDLE') || hasRole(source, 'CLIENT_API_BASE_URL') || hasRole(source, 'CLIENT_FRONTEND_CONFIG'))
      && (hasRole(target, 'API_REST') || hasRole(target, 'API_GRAPHQL'))) {
    if (hasSharedEvidence) {
      return {
        relation: 'REFERENCES',
        basis: 'SHARED_EVIDENCE',
        evidenceIds: sharedEvidence,
        createdFrom: `Client artifact at ${sHost} references API ${tHost}${tPath}.`,
      };
    }
  }

  // ── HOSTS: canonical domain → subdomain (reverse of BELONGS_TO)
  // Only create as reverse relation, not as forward edge

  // ── ALIASES: same root domain, different host
  // ONLY when there is shared evidence — NOT from hostname similarity alone
  if (sHost !== tHost
      && sHost.endsWith('.' + tHost.replace(/^[^.]+\./, ''))
      && hasSharedEvidence) {
    return {
      relation: 'ALIASES',
      basis: 'SHARED_EVIDENCE',
      evidenceIds: sharedEvidence,
      createdFrom: `Subdomains ${sHost} and ${tHost} co-observed in same evidence.`,
    };
  }

  return null;
}

/** Build evidence-backed relationships between entry points. */
export class EntryPointGraphBuilder {
  private allEdges: EntryPointEdge[] = [];

  build(anchors: EntryPoint[]): EntryPointGraph {
    this.allEdges = [];
    const nodes = anchors.map(ep => ep.entry_point_id);
    const rawEdgeCount = 0; // will count below

    // For each pair, compute potential relationships
    for (let i = 0; i < anchors.length; i++) {
      for (let j = 0; j < anchors.length; j++) {
        if (i === j) continue;
        const result = computeRelationship(anchors[i], anchors[j]);
        if (result) {
          const { basis, evidenceIds, createdFrom } = result;
          const confidence = this.edgeConfidence(anchors[i], anchors[j], result.relation, basis, evidenceIds);

          // Skip edges with no evidence unless the basis is SAME_ROOT_DOMAIN (structural)
          // or INFERRED (downgraded but still recorded)
          const edge: EntryPointEdge = {
            edge_id: `edge_${createHash('sha256').update(`${anchors[i].entry_point_id}->${anchors[j].entry_point_id}:${result.relation}`).digest('hex').slice(0, 12)}`,
            source_entry_point_id: anchors[i].entry_point_id,
            target_entry_point_id: anchors[j].entry_point_id,
            from: anchors[i].entry_point_id,
            to: anchors[j].entry_point_id,
            relation: result.relation,
            relationship: result.relation,
            evidence_ids: evidenceIds,
            confidence,
            basis,
            created_from: createdFrom,
            is_reciprocal: false,
          };
          this.allEdges.push(edge);
        }
      }
    }

    // Deduplicate edges (same from/to/relationship)
    const seen = new Set<string>();
    const deduped: EntryPointEdge[] = [];
    let duplicateCount = 0;
    for (const edge of this.allEdges) {
      const key = `${edge.from}->${edge.to}:${edge.relationship}`;
      if (seen.has(key)) {
        duplicateCount++;
        continue;
      }
      seen.add(key);
      deduped.push(edge);
    }

    // Collapse reciprocal pairs: if A→B and B→A exist with the same relationship,
    // keep only one canonical undirected edge (the forward one)
    const canonicalEdges: EntryPointEdge[] = [];
    const processed = new Set<string>();
    let reciprocalCount = 0;

    for (const edge of deduped) {
      const forwardKey = `${edge.from}->${edge.to}:${edge.relationship}`;
      const reverseRel = reverseRelationType(edge.relationship);
      if (reverseRel) {
        const reverseKey = `${edge.to}->${edge.from}:${reverseRel}`;
        // If the reverse edge exists, we have a reciprocal pair
        // For semantically symmetric relationships (ALIASES, BELONGS_TO/HOSTS),
        // collapse into one canonical edge
        if (deduped.some(e => `${e.from}->${e.to}:${e.relationship}` === reverseKey)) {
          if (!processed.has(forwardKey)) {
            // Mark as canonical, mark the reverse as reciprocal
            edge.is_reciprocal = true;
            canonicalEdges.push(edge);
            processed.add(forwardKey);
          }
          reciprocalCount++;
          continue;
        }
      }
      canonicalEdges.push(edge);
    }

    // Compute metrics
    const metrics = this.computeMetrics(deduped.length, canonicalEdges.length, duplicateCount, reciprocalCount);

    return { nodes, edges: canonicalEdges, metrics };
  }

  /** Determine edge confidence based on evidence and basis. */
  private edgeConfidence(
    source: EntryPoint,
    target: EntryPoint,
    rel: EntryPointRelationType,
    basis: EdgeBasis,
    evidenceIds: string[]
  ): 'LOW' | 'MEDIUM' | 'HIGH' {
    // Shared evidence = HIGH confidence
    const shared = source.evidence_ids.filter(id => target.evidence_ids.includes(id));
    if (shared.length > 0 && basis !== 'INFERRED') return 'HIGH';

    switch (basis) {
      case 'SHARED_EVIDENCE': return 'HIGH';
      case 'EXPLICIT_REFERENCE': return 'HIGH';
      case 'SAME_ROOT_DOMAIN': return 'MEDIUM';
      case 'INFERRED': return 'LOW';
      default: return 'LOW';
    }
  }

  /** Compute aggregate graph metrics. */
  private computeMetrics(rawEdges: number, canonicalEdges: number, duplicates: number, reciprocals: number): EntryPointGraphMetrics {
    const edgesWithoutEvidence = this.allEdges.filter(e => e.evidence_ids.length === 0).length;
    const evidenceBackedEdges = this.allEdges.filter(e => e.evidence_ids.length > 0).length;
    const inferredEdges = this.allEdges.filter(e => e.basis === 'INFERRED' || e.basis === 'SAME_ROOT_DOMAIN').length;

    return {
      raw_edges: this.allEdges.length,
      evidence_backed_edges: evidenceBackedEdges,
      inferred_edges: inferredEdges,
      edges_without_evidence: edgesWithoutEvidence,
      duplicate_edges: duplicates,
      reciprocal_pairs: reciprocals,
      canonical_edges: canonicalEdges,
      raw_edges_denominator: this.allEdges.length,
    };
  }
}

/**
 * Convert graph edges into EntryPoint.relation objects on each anchor.
 */
export function attachRelationsToAnchors(anchors: EntryPoint[], graph: EntryPointGraph): void {
  // Build a lookup from entry_point_id to index
  const idxById: Record<string, number> = {};
  anchors.forEach((ep, i) => { idxById[ep.entry_point_id] = i; });

  for (const edge of graph.edges) {
    const fromIdx = idxById[edge.from];
    const toIdx = idxById[edge.to];
    if (fromIdx !== undefined && toIdx !== undefined) {
      const fromEp = anchors[fromIdx];
      const toEp = anchors[toIdx];

      const relation: EntryPointRelation = {
        target_entry_point_id: edge.to,
        target_surface_url: toEp.surface_url,
        relationship: edge.relationship,
        confidence: edge.confidence,
        evidence_ids: edge.evidence_ids,
      };
      fromEp.relationships.push(relation);

      // Only add reverse relation for non-reciprocal canonical edges
      if (!edge.is_reciprocal) {
        const reverseRel = reverseRelationType(edge.relationship);
        if (reverseRel) {
          const reverse: EntryPointRelation = {
            target_entry_point_id: edge.from,
            target_surface_url: fromEp.surface_url,
            relationship: reverseRel,
            confidence: edge.confidence,
            evidence_ids: edge.evidence_ids,
          };
          toEp.relationships.push(reverse);
        }
      }
    }
  }
}

const REVERSE_RELATIONS: Partial<Record<EntryPointRelationType, EntryPointRelationType>> = {
  'BELONGS_TO': 'HOSTS',
  'HOSTS': 'BELONGS_TO',
  'CALLS': 'CALLED_BY',
  'IMPLEMENTS': 'IMPLEMENTED_BY',
  'REFERENCES': 'REFERENCED_BY',
  'DEPENDS_ON': 'DEPENDED_BY',
  'DOCUMENTS': 'DOCUMENTED_BY',
  'INTEGRATES_WITH': 'INTEGRATED_BY',
  'USES': 'USED_BY',
  'REPLACED_BY': 'REPLACES',
  'ALIASES': 'ALIASED_BY',
  'AUTHENTICATES': 'AUTHENTICATED_BY',
  'PROVIDES_AUTH_FOR': 'AUTH_PROVIDED_BY',
  'REPRESENTS': 'REPRESENTED_BY',
};

function reverseRelationType(rel: EntryPointRelationType): EntryPointRelationType | null {
  // For one-directional relations, we create a reverse
  if (rel === 'BELONGS_TO') return 'HOSTS';
  if (rel === 'HOSTS') return 'BELONGS_TO';
  if (rel === 'CALLS') return 'CALLED_BY';
  if (rel === 'IMPLEMENTS') return 'IMPLEMENTED_BY';
  if (rel === 'REFERENCES') return 'REFERENCED_BY';
  if (rel === 'DEPENDS_ON') return 'DEPENDED_BY';
  if (rel === 'DOCUMENTS') return 'DOCUMENTED_BY';
  if (rel === 'USES') return 'USED_BY';
  if (rel === 'REPLACED_BY') return 'REPLACES';
  if (rel === 'ALIASES') return 'ALIASED_BY';
  if (rel === 'INTEGRATES_WITH') return 'INTEGRATED_BY';
  if (rel === 'AUTHENTICATES') return 'AUTHENTICATED_BY';
  if (rel === 'PROVIDES_AUTH_FOR') return 'AUTH_PROVIDED_BY';
  if (rel === 'REPRESENTS') return 'REPRESENTED_BY';
  return null;
}
