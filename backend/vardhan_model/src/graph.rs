//! # Vardhan Dependency Graph (Layer 6e)
//!
//! Explicit relationships between enterprise entities.
//!
//! Example topology:
//! ```text
//!   Application DEPENDS_ON Service
//!   Service RUNS_ON Container
//!   Container HOSTED_ON Node
//!   Service USES CryptoAsset
//!   Identity AUTHORIZES Action
//!   Action PRODUCED_BY Decision
//!   Decision AFFECTS Risk
//!   Incident AFFECTS Service
//!   BusinessProcess DEPENDS_ON Application
//! ```

use crate::entities::EntityId;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};

/// A typed relationship between two entities.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Relationship {
    // ── Forward relationships ──
    /// A depends on B (if B fails, A fails)
    DependsOn,
    /// A runs on B (computational placement)
    RunsOn,
    /// A is hosted on B (container → node)
    HostedOn,
    /// A uses B (service → identity/crypto/asset)
    Uses,
    /// A authorizes action B
    Authorizes,
    /// A produced B (cause → effect)
    ProducedBy,
    /// A affects B (risk, incident, decision impact)
    Affects,
    /// A caused B (decision → action)
    CausedBy,
    /// A requires B (policy → control, process → resource)
    Requires,
    /// A references B (evidence, configuration)
    References,
    /// A owns B (organizational containment)
    Owns,
    /// A contains B (hierarchical grouping)
    Contains,
    // ── Inverse relationships (for bidirectional traversal) ──
    /// B is affected by A (inverse of DependsOn)
    AffectedBy,
    /// B hosts A (inverse of RunsOn/HostedOn)
    Hosts,
    /// B is used by A (inverse of Uses)
    UsedBy,
    /// B is required by A (inverse of Requires)
    RequiredBy,
    /// B is referenced by A (inverse of References)
    ReferencedBy,
    /// B is owned by A (inverse of Owns)
    OwnedBy,
    /// B is contained in A (inverse of Contains)
    ContainedIn,
}

impl Relationship {
    /// Returns true if this relationship is transitive.
    pub fn is_transitive(&self) -> bool {
        matches!(
            self,
            Relationship::DependsOn
                | Relationship::Affects
                | Relationship::Contains
                | Relationship::Owns
        )
    }

    /// Returns true if this is an inverse (backward) relationship variant.
    pub fn is_inverse(&self) -> bool {
        matches!(
            self,
            Relationship::AffectedBy
                | Relationship::Hosts
                | Relationship::UsedBy
                | Relationship::RequiredBy
                | Relationship::ReferencedBy
                | Relationship::OwnedBy
                | Relationship::ContainedIn
        )
    }

    /// Returns the inverse relationship.
    pub fn inverse(&self) -> Self {
        match self {
            Relationship::DependsOn => Relationship::AffectedBy,
            Relationship::RunsOn | Relationship::HostedOn => Relationship::Hosts,
            Relationship::Uses => Relationship::UsedBy,
            Relationship::Authorizes => Relationship::Authorizes, // symmetric for traversal
            Relationship::ProducedBy => Relationship::ProducedBy,
            Relationship::Affects => Relationship::AffectedBy,
            Relationship::CausedBy => Relationship::CausedBy,
            Relationship::Requires => Relationship::RequiredBy,
            Relationship::References => Relationship::ReferencedBy,
            Relationship::Owns => Relationship::OwnedBy,
            Relationship::Contains => Relationship::ContainedIn,
            Relationship::AffectedBy => Relationship::DependsOn,
            Relationship::Hosts => Relationship::RunsOn,
            Relationship::UsedBy => Relationship::Uses,
            Relationship::RequiredBy => Relationship::Requires,
            Relationship::ReferencedBy => Relationship::References,
            Relationship::OwnedBy => Relationship::Owns,
            Relationship::ContainedIn => Relationship::Contains,
        }
    }

    /// Returns the forward (canonical) relationship.
    pub fn as_forward(&self) -> Self {
        if self.is_inverse() {
            self.inverse()
        } else {
            *self
        }
    }

    /// All forward relationships.
    pub fn all_forward() -> Vec<Relationship> {
        vec![
            Relationship::DependsOn,
            Relationship::RunsOn,
            Relationship::HostedOn,
            Relationship::Uses,
            Relationship::Authorizes,
            Relationship::ProducedBy,
            Relationship::Affects,
            Relationship::CausedBy,
            Relationship::Requires,
            Relationship::References,
            Relationship::Owns,
            Relationship::Contains,
        ]
    }
}

/// A directed edge in the dependency graph.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Edge {
    /// The source entity (the one that has the relationship)
    pub from: EntityId,
    /// The target entity (the one the relationship points to)
    pub to: EntityId,
    /// The type of relationship
    pub relationship: Relationship,
    /// Optional metadata (e.g., "reason", "evidence_ref")
    #[serde(default)]
    pub metadata: BTreeMap<String, String>,
}

impl Edge {
    pub fn new(from: EntityId, to: EntityId, rel: Relationship) -> Self {
        Self {
            from,
            to,
            relationship: rel,
            metadata: BTreeMap::new(),
        }
    }

    pub fn with_metadata(mut self, key: impl Into<String>, val: impl Into<String>) -> Self {
        self.metadata.insert(key.into(), val.into());
        self
    }
}

/// Result of a graph traversal.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TraversalResult {
    /// All nodes reachable
    pub reachable: BTreeSet<EntityId>,
    /// Traversal paths
    pub paths: Vec<Vec<EntityId>>,
    /// Number of edges traversed
    pub edge_count: usize,
}

impl TraversalResult {
    pub fn is_empty(&self) -> bool {
        self.reachable.is_empty()
    }
    pub fn len(&self) -> usize {
        self.reachable.len()
    }
}

/// Errors from graph operations.
#[derive(Debug, thiserror::Error)]
pub enum GraphError {
    #[error("cycle detected in dependency graph: {0:?}")]
    CycleDetected(Vec<EntityId>),
}

/// The Vardhan dependency graph.
#[derive(Clone, Default)]
pub struct DependencyGraph {
    /// Forward edges: from → [edges]
    forward: HashMap<EntityId, Vec<Edge>>,
    /// Reverse edges: to → [edges]
    reverse: HashMap<EntityId, Vec<Edge>>,
    /// All entity IDs in the graph
    nodes: HashSet<EntityId>,
}

impl DependencyGraph {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a directed relationship.
    pub fn add_edge(&mut self, edge: Edge) -> Result<(), GraphError> {
        // Cycle detection for DependsOn relationships
        if edge.relationship == Relationship::DependsOn {
            if self.path_exists(&edge.to, &edge.from, &[Relationship::DependsOn]) {
                return Err(GraphError::CycleDetected(vec![
                    edge.from.clone(),
                    edge.to.clone(),
                ]));
            }
        }

        self.nodes.insert(edge.from.clone());
        self.nodes.insert(edge.to.clone());
        self.forward
            .entry(edge.from.clone())
            .or_default()
            .push(edge.clone());
        self.reverse.entry(edge.to.clone()).or_default().push(edge);
        Ok(())
    }

    /// Add a simple relationship.
    pub fn add(
        &mut self,
        from: EntityId,
        to: EntityId,
        rel: Relationship,
    ) -> Result<(), GraphError> {
        self.add_edge(Edge::new(from, to, rel))
    }

    /// Check if a path exists from `start` to `target` via the given relationship types.
    fn path_exists(&self, start: &EntityId, target: &EntityId, rels: &[Relationship]) -> bool {
        let mut visited = HashSet::new();
        let mut queue = VecDeque::new();
        queue.push_back(start.clone());

        while let Some(current) = queue.pop_front() {
            if &current == target {
                return true;
            }
            if visited.contains(&current) {
                continue;
            }
            visited.insert(current.clone());

            // Check forward edges
            if let Some(edges) = self.forward.get(&current) {
                for edge in edges {
                    if rels.contains(&edge.relationship) {
                        queue.push_back(edge.to.clone());
                    }
                }
            }
            // Check reverse edges (for inverse relationships)
            if let Some(edges) = self.reverse.get(&current) {
                for edge in edges {
                    if rels.contains(&edge.relationship) {
                        queue.push_back(edge.from.clone());
                    }
                }
            }
        }
        false
    }

    /// Traverse forward: find all entities reachable from `from` via `rels`.
    pub fn traverse_forward(&self, from: &EntityId, rels: &[Relationship]) -> TraversalResult {
        let mut visited = BTreeSet::new();
        let mut paths = Vec::new();
        let mut edge_count = 0;

        let mut stack = vec![(from.clone(), vec![from.clone()])];
        while let Some((current, path)) = stack.pop() {
            if let Some(edges) = self.forward.get(&current) {
                for edge in edges {
                    if rels.contains(&edge.relationship) && !path.contains(&edge.to) {
                        let mut new_path = path.clone();
                        new_path.push(edge.to.clone());
                        visited.insert(edge.to.clone());
                        edge_count += 1;
                        paths.push(new_path.clone());
                        stack.push((edge.to.clone(), new_path));
                    }
                }
            }
        }
        TraversalResult {
            reachable: visited,
            paths,
            edge_count,
        }
    }

    /// Traverse backward: find all entities that reach `to` via `rels`.
    pub fn traverse_backward(&self, to: &EntityId, rels: &[Relationship]) -> TraversalResult {
        let mut visited = BTreeSet::new();
        let mut paths = Vec::new();
        let mut edge_count = 0;

        let mut stack = vec![(to.clone(), vec![to.clone()])];
        while let Some((current, path)) = stack.pop() {
            if let Some(edges) = self.reverse.get(&current) {
                for edge in edges {
                    if rels.contains(&edge.relationship) && !path.contains(&edge.from) {
                        let mut new_path = path.clone();
                        new_path.push(edge.from.clone());
                        visited.insert(edge.from.clone());
                        edge_count += 1;
                        paths.push(new_path.clone());
                        stack.push((edge.from.clone(), new_path));
                    }
                }
            }
        }
        TraversalResult {
            reachable: visited,
            paths,
            edge_count,
        }
    }

    /// Compute blast radius: given a failed entity, find all entities
    /// that would be affected (transitively via DependsOn).
    pub fn blast_radius(&self, failed: &EntityId) -> TraversalResult {
        self.traverse_backward(failed, &[Relationship::DependsOn])
    }

    /// Compute dependency chain: given an entity, find all entities it
    /// depends on (transitively via DependsOn).
    pub fn dependencies(&self, entity: &EntityId) -> TraversalResult {
        self.traverse_forward(entity, &[Relationship::DependsOn])
    }

    /// Get direct forward neighbors.
    pub fn neighbors(&self, entity: &EntityId) -> Vec<&EntityId> {
        self.forward
            .get(entity)
            .map(|edges| edges.iter().map(|e| &e.to).collect())
            .unwrap_or_default()
    }

    /// All nodes in the graph.
    pub fn nodes(&self) -> &HashSet<EntityId> {
        &self.nodes
    }

    /// Total edge count.
    pub fn edge_count(&self) -> usize {
        self.forward.values().map(|v| v.len()).sum()
    }

    /// Get all edges for a specific relationship type.
    pub fn edges_for_relationship(&self, rel: Relationship) -> Vec<&Edge> {
        self.forward
            .values()
            .flatten()
            .filter(|e| e.relationship == rel)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eid(s: &str) -> EntityId {
        EntityId::new(s)
    }

    #[test]
    fn test_add_and_traverse() {
        let mut g = DependencyGraph::new();
        g.add(eid("app:api"), eid("svc:backend"), Relationship::DependsOn)
            .unwrap();
        g.add(eid("svc:backend"), eid("node:raft-1"), Relationship::RunsOn)
            .unwrap();
        g.add(eid("svc:backend"), eid("crypto:key-1"), Relationship::Uses)
            .unwrap();

        // Forward traversal via multiple relationship types
        let result = g.traverse_forward(
            &eid("svc:backend"),
            &[Relationship::RunsOn, Relationship::Uses],
        );
        assert!(result.reachable.contains(&eid("node:raft-1")));
        assert!(result.reachable.contains(&eid("crypto:key-1")));
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_blast_radius() {
        let mut g = DependencyGraph::new();
        g.add(eid("app:api"), eid("svc:backend"), Relationship::DependsOn)
            .unwrap();
        g.add(
            eid("svc:backend"),
            eid("node:raft-1"),
            Relationship::DependsOn,
        )
        .unwrap();

        let blast = g.blast_radius(&eid("node:raft-1"));
        assert!(blast.reachable.contains(&eid("svc:backend")));
        assert!(blast.reachable.contains(&eid("app:api")));
    }

    #[test]
    fn test_cycle_detection() {
        let mut g = DependencyGraph::new();
        g.add(eid("a"), eid("b"), Relationship::DependsOn).unwrap();
        // Adding b→a creates a cycle
        let err = g
            .add(eid("b"), eid("a"), Relationship::DependsOn)
            .unwrap_err();
        assert!(matches!(err, GraphError::CycleDetected(_)));
    }

    #[test]
    fn test_bidirectional_traversal() {
        let mut g = DependencyGraph::new();
        g.add(eid("app:api"), eid("svc:backend"), Relationship::DependsOn)
            .unwrap();

        let fwd = g.traverse_forward(&eid("app:api"), &[Relationship::DependsOn]);
        assert!(fwd.reachable.contains(&eid("svc:backend")));

        let rev = g.traverse_backward(&eid("svc:backend"), &[Relationship::DependsOn]);
        assert!(rev.reachable.contains(&eid("app:api")));
    }

    #[test]
    fn test_edge_with_metadata() {
        let edge = Edge::new(eid("a"), eid("b"), Relationship::DependsOn)
            .with_metadata("evidence_ref", "ledger:42");
        assert_eq!(
            edge.metadata.get("evidence_ref"),
            Some(&"ledger:42".to_string())
        );
    }

    #[test]
    fn test_empty_graph() {
        let g = DependencyGraph::new();
        assert!(g.nodes().is_empty());
        assert_eq!(g.edge_count(), 0);
        let result = g.blast_radius(&eid("missing"));
        assert!(result.is_empty());
    }

    #[test]
    fn test_transitive_depends_on() {
        let mut g = DependencyGraph::new();
        g.add(eid("a"), eid("b"), Relationship::DependsOn).unwrap();
        g.add(eid("b"), eid("c"), Relationship::DependsOn).unwrap();

        let deps = g.dependencies(&eid("a"));
        assert!(deps.reachable.contains(&eid("b")));
        assert!(deps.reachable.contains(&eid("c")));
    }

    #[test]
    fn test_relationship_inverse() {
        assert_eq!(Relationship::DependsOn.inverse(), Relationship::AffectedBy);
        assert_eq!(Relationship::AffectedBy.inverse(), Relationship::DependsOn);
        assert!(!Relationship::DependsOn.is_inverse());
        assert!(Relationship::AffectedBy.is_inverse());
        assert_eq!(
            Relationship::AffectedBy.as_forward(),
            Relationship::DependsOn
        );
    }

    #[test]
    fn test_all_forward_no_duplicates() {
        let fwd = Relationship::all_forward();
        let set: HashSet<_> = fwd.iter().collect();
        assert_eq!(fwd.len(), set.len(), "no duplicate forward relationships");
    }
}
