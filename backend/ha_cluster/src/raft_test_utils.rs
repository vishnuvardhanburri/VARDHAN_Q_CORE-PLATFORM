use crate::raft::{
    AppendEntriesArgs, AppendEntriesReply, LogEntry, RaftNode, RequestVoteArgs, RequestVoteReply,
};
use crate::NodeId;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct NetworkController {
    pub partitions: Arc<RwLock<HashSet<(NodeId, NodeId)>>>,
}

impl NetworkController {
    pub fn new() -> Self {
        Self {
            partitions: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    pub async fn is_partitioned(&self, from: &NodeId, to: &NodeId) -> bool {
        let p = self.partitions.read().await;
        p.contains(&(from.clone(), to.clone())) || p.contains(&(to.clone(), from.clone()))
    }

    pub async fn partition(&self, a: NodeId, b: NodeId) {
        let mut p = self.partitions.write().await;
        p.insert((a, b));
    }

    pub async fn heal(&self) {
        let mut p = self.partitions.write().await;
        p.clear();
    }
}

pub struct RaftCluster {
    pub nodes: HashMap<NodeId, Arc<RaftNode>>,
    pub network: NetworkController,
}

impl RaftCluster {
    pub fn new(nodes: Vec<Arc<RaftNode>>) -> Self {
        let mut map = HashMap::new();
        for node in nodes {
            map.insert(node.id.clone(), node);
        }
        Self {
            nodes: map,
            network: NetworkController::new(),
        }
    }

    pub async fn send_request_vote(
        &self,
        from: &NodeId,
        to: &NodeId,
        args: RequestVoteArgs,
    ) -> Option<RequestVoteReply> {
        if self.network.is_partitioned(from, to).await {
            return None;
        }
        let node = self.nodes.get(to)?;
        Some(node.handle_request_vote(args).await)
    }

    pub async fn send_append_entries(
        &self,
        from: &NodeId,
        to: &NodeId,
        args: AppendEntriesArgs,
    ) -> Option<AppendEntriesReply> {
        if self.network.is_partitioned(from, to).await {
            return None;
        }
        let node = self.nodes.get(to)?;
        Some(node.handle_append_entries(args).await)
    }
}
