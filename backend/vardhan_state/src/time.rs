//! # Vardhan State Fabric — Time Context (A3)
//!
//! **Amendment A3**: Four distinct time domains. `logical_time` is optional
//! (assigned at Raft commit). Pre-commit objects have `logical_time = None`
//! and are never authoritative.
//!
//! Sourced from:
//! - `VARDHAN_ARCHITECTURE_CONSTITUTION.md` §A3 (Vardhan Time Model)
//! - `VARDHAN_OBJECT_TRAITS.md` §5 (Time Context)
//! - `VARDHAN_CANONICAL_OBJECT_SPEC.md` §3 (Time Context)
//! - `VARDHAN_STATE_MACHINES.md` §1.1 (State Semantics)

use crate::id::CommitIndex;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Four distinct time domains (A3). All objects that participate in ordering
/// or evidence carry a `TimeContext`.
///
/// Lifecycle semantics:
/// ```text
/// EventTime → known at creation
/// SystemTime → known at observation
/// LogicalTime → assigned when committed (Raft commit_index)
/// ```
///
/// An event can exist in Vardhan's log **before** it is committed.
/// `logical_time` becomes final only when the Raft entry containing the
/// object is committed. Pre-commit objects have `logical_time = None` and
/// are **never** authoritative.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct TimeContext {
    /// Logical Time (A3): Raft commit_index. `None` until Raft commit.
    /// This is the ONLY ordering coordinate for state transitions.
    pub logical_time: Option<CommitIndex>,

    /// Event Time (A3): When the event occurred in the real world (from source).
    /// Preserved for analytical queries but never used for ordering.
    pub event_time: DateTime<Utc>,

    /// System Time (A3): When Vardhan observed/processed the event.
    pub system_time: DateTime<Utc>,

    /// Deadline Time (A3): Human-defined decision/action deadline. Optional.
    pub deadline_time: Option<DateTime<Utc>>,

    /// Creation time: When this object was created in Vardhan.
    pub created_at: DateTime<Utc>,
}

impl TimeContext {
    /// Create a new TimeContext with current system time.
    /// `logical_time` is None (pre-commit).
    pub fn new(event_time: DateTime<Utc>) -> Self {
        let now = Utc::now();
        Self {
            logical_time: None,
            event_time,
            system_time: now,
            deadline_time: None,
            created_at: now,
        }
    }

    /// Create with a specific event time and system time (for testing).
    pub fn with_times(event_time: DateTime<Utc>, system_time: DateTime<Utc>) -> Self {
        Self {
            logical_time: None,
            event_time,
            system_time,
            deadline_time: None,
            created_at: system_time,
        }
    }

    /// Assign a commit_index (Logical Time). Called only at Raft commit.
    /// After this call, `logical_time` is `Some(CommitIndex)`.
    pub fn assign_commit_index(&mut self, index: CommitIndex) {
        self.logical_time = Some(index);
    }

    /// Returns true if this object has been Raft-committed (logical_time is Some).
    pub fn is_committed(&self) -> bool {
        self.logical_time.is_some()
    }

    /// Returns true if this object is still speculative (logical_time is None).
    pub fn is_speculative(&self) -> bool {
        self.logical_time.is_none()
    }

    /// Validate time consistency (T-TIME-07).
    /// EventTime should not be far in the future relative to SystemTime.
    /// Returns Ok if consistent, Err with reason if not.
    pub fn validate_consistency(&self) -> Result<(), String> {
        // EventTime must not be too far in the future
        let now = Utc::now();
        let future_threshold = chrono::Duration::seconds(5);
        if self.event_time > now + future_threshold {
            return Err(
                "event_time is too far in the future (possible clock manipulation)".to_string(),
            );
        }

        // SystemTime must be after or equal to EventTime (we can't observe before it happened)
        if self.system_time < self.event_time {
            return Err("system_time precedes event_time (temporal impossibility)".to_string());
        }

        // If deadline is set, it should be in the future relative to creation
        if let Some(deadline) = self.deadline_time {
            if deadline < self.created_at {
                return Err("deadline_time precedes creation time".to_string());
            }
        }

        Ok(())
    }

    /// Set a deadline time.
    pub fn with_deadline(mut self, deadline: DateTime<Utc>) -> Self {
        self.deadline_time = Some(deadline);
        self
    }

    /// Canonical serialization for hashing: serialize fields in a deterministic order.
    pub fn canonical_bytes(&self) -> Vec<u8> {
        use std::collections::BTreeMap;
        let mut map: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        map.insert(
            "logical_time".to_string(),
            self.logical_time
                .map(|ci| serde_json::Value::Number(serde_json::Number::from(ci.get())))
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "event_time".to_string(),
            serde_json::Value::String(self.event_time.to_rfc3339()),
        );
        map.insert(
            "system_time".to_string(),
            serde_json::Value::String(self.system_time.to_rfc3339()),
        );
        map.insert(
            "deadline_time".to_string(),
            self.deadline_time
                .map(|dt| serde_json::Value::String(dt.to_rfc3339()))
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "created_at".to_string(),
            serde_json::Value::String(self.created_at.to_rfc3339()),
        );
        serde_json::to_vec(&map).unwrap_or_default()
    }
}

// ─── Helper: generate now() ──────────────────────────────────────────────────

/// Get current UTC time.
pub fn now_utc() -> DateTime<Utc> {
    Utc::now()
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_logical_time_none_before_commit() {
        let tc = TimeContext::new(now_utc());
        assert!(
            tc.logical_time.is_none(),
            "logical_time must be None before Raft commit (A3)"
        );
        assert!(tc.is_speculative());
    }

    #[test]
    fn test_logical_time_assigned_at_commit() {
        let mut tc = TimeContext::new(now_utc());
        assert!(!tc.is_committed());

        tc.assign_commit_index(CommitIndex::new(42));
        assert_eq!(tc.logical_time, Some(CommitIndex::new(42)));
        assert!(tc.is_committed());
        assert!(!tc.is_speculative());
    }

    #[test]
    fn test_commit_ordering_independent_of_wall_clock() {
        // E2 has earlier EventTime but later SystemTime
        let event_time_2 = DateTime::parse_from_rfc3339("2025-01-01T10:00:01Z")
            .unwrap()
            .with_timezone(&Utc);
        let system_time_2 = DateTime::parse_from_rfc3339("2025-01-01T10:00:03Z")
            .unwrap()
            .with_timezone(&Utc);
        let event_time_1 = DateTime::parse_from_rfc3339("2025-01-01T10:00:02Z")
            .unwrap()
            .with_timezone(&Utc);
        let system_time_1 = DateTime::parse_from_rfc3339("2025-01-01T10:00:02Z")
            .unwrap()
            .with_timezone(&Utc);

        let mut tc1 = TimeContext::with_times(event_time_1, system_time_1);
        let mut tc2 = TimeContext::with_times(event_time_2, system_time_2);

        // EventTime 2 < EventTime 1, but SystemTime 2 > SystemTime 1
        assert!(
            tc2.event_time < tc1.event_time,
            "E2 event_time should be earlier"
        );
        assert!(
            tc2.system_time > tc1.system_time,
            "E2 system_time should be later"
        );

        // But commit ordering is by commit_index, not EventTime
        tc2.assign_commit_index(CommitIndex::new(42));
        tc1.assign_commit_index(CommitIndex::new(43));

        assert_eq!(tc2.logical_time.unwrap().get(), 42);
        assert_eq!(tc1.logical_time.unwrap().get(), 43);
        // E2 committed first (index 42) despite having earlier EventTime
        assert_ne!(tc1.logical_time, tc2.logical_time);
    }

    #[test]
    fn test_timestamp_manipulation_cannot_reorder() {
        // Event with manipulated (future) EventTime
        let future = now_utc() + chrono::Duration::days(365);
        let tc = TimeContext::new(future);
        // logical_time is still None until commit — EventTime doesn't affect ordering
        assert!(tc.logical_time.is_none());
    }

    #[test]
    fn test_time_sync_failure_detection() {
        // EventTime far in the future → should be rejected by validate_consistency
        let future = now_utc() + chrono::Duration::days(365);
        let tc = TimeContext::new(future);
        assert!(tc.validate_consistency().is_err());
    }

    #[test]
    fn test_canonical_bytes_deterministic() {
        let tc = TimeContext::with_times(
            DateTime::parse_from_rfc3339("2025-01-01T10:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            DateTime::parse_from_rfc3339("2025-01-01T10:00:01Z")
                .unwrap()
                .with_timezone(&Utc),
        );
        let b1 = tc.canonical_bytes();
        let b2 = tc.canonical_bytes();
        assert_eq!(b1, b2, "canonical bytes must be deterministic");
    }

    #[test]
    fn test_deadline_time_optional() {
        let tc = TimeContext::new(now_utc());
        assert!(tc.deadline_time.is_none());

        let deadline = now_utc() + chrono::Duration::hours(24);
        let tc2 = tc.with_deadline(deadline);
        assert!(tc2.deadline_time.is_some());
    }
}
