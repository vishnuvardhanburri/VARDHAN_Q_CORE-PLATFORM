//! # Vardhan Schema Registry (Layer 6d)
//!
//! Schema versioning and compatibility rules for all Vardhan contracts.
//! Ensures that event schemas, entity definitions, and serialization formats
//! can evolve while maintaining compatibility.

use serde::{Deserialize, Serialize};

/// A semantic version for Vardhan schema contracts.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SchemaVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl SchemaVersion {
    pub const VARDHAN_EVENT: Self = Self {
        major: 1,
        minor: 0,
        patch: 0,
    };
    pub const VARDHAN_ENTERPRISE_MODEL: Self = Self {
        major: 1,
        minor: 0,
        patch: 0,
    };

    pub fn new(major: u32, minor: u32, patch: u32) -> Self {
        Self {
            major,
            minor,
            patch,
        }
    }

    pub fn is_compatible_with(&self, other: &Self) -> bool {
        SchemaCompatibility::check(self, other) != CompatibilityLevel::Incompatible
    }

    pub fn bump_major(&self) -> Self {
        Self {
            major: self.major + 1,
            minor: 0,
            patch: 0,
        }
    }

    pub fn bump_minor(&self) -> Self {
        Self {
            major: self.major,
            minor: self.minor + 1,
            patch: 0,
        }
    }

    pub fn bump_patch(&self) -> Self {
        Self {
            major: self.major,
            minor: self.minor,
            patch: self.patch + 1,
        }
    }
}

impl std::fmt::Display for SchemaVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

/// Result of a compatibility check.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompatibilityLevel {
    Compatible,
    BackwardCompatible,
    Incompatible,
}

/// Semantic compatibility checker.
pub struct SchemaCompatibility;

impl SchemaCompatibility {
    /// Check if `new` is compatible with `current`.
    /// - Same major version = compatible
    /// - Same major, new minor/patch >= current = backward compatible
    /// - Different major = incompatible
    pub fn check(current: &SchemaVersion, new: &SchemaVersion) -> CompatibilityLevel {
        if current.major != new.major {
            return CompatibilityLevel::Incompatible;
        }
        if current.minor == new.minor && current.patch == new.patch {
            return CompatibilityLevel::Compatible;
        }
        if new.minor >= current.minor {
            return CompatibilityLevel::BackwardCompatible;
        }
        CompatibilityLevel::Incompatible
    }
}

/// In-memory schema registry.
#[derive(Clone, Default)]
pub struct SchemaRegistry {
    schemas: std::sync::Arc<std::sync::RwLock<std::collections::HashMap<String, SchemaVersion>>>,
}

impl SchemaRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(
        &self,
        schema_id: impl Into<String>,
        version: SchemaVersion,
    ) -> Result<(), SchemaError> {
        self.schemas
            .write()
            .unwrap()
            .insert(schema_id.into(), version);
        Ok(())
    }

    pub fn lookup(&self, schema_id: &str) -> Option<SchemaVersion> {
        self.schemas.read().unwrap().get(schema_id).cloned()
    }

    pub fn is_compatible(&self, schema_id: &str, new_version: &SchemaVersion) -> bool {
        if let Some(current) = self.lookup(schema_id) {
            SchemaCompatibility::check(&current, new_version) != CompatibilityLevel::Incompatible
        } else {
            true
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SchemaError {
    #[error("incompatible schema evolution: {0}")]
    IncompatibleEvolution(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_schema_version_display() {
        let v = SchemaVersion::new(2, 1, 3);
        assert_eq!(v.to_string(), "2.1.3");
    }

    #[test]
    fn test_compatible_versions() {
        let v1 = SchemaVersion::new(1, 0, 0);
        let v2 = SchemaVersion::new(1, 0, 1);
        assert_eq!(
            SchemaCompatibility::check(&v1, &v2),
            CompatibilityLevel::BackwardCompatible
        );

        let v3 = SchemaVersion::new(1, 0, 0);
        let v4 = SchemaVersion::new(1, 0, 0);
        assert_eq!(
            SchemaCompatibility::check(&v3, &v4),
            CompatibilityLevel::Compatible
        );
    }

    #[test]
    fn test_incompatible_major() {
        let v1 = SchemaVersion::new(1, 5, 3);
        let v2 = SchemaVersion::new(2, 0, 0);
        assert_eq!(
            SchemaCompatibility::check(&v1, &v2),
            CompatibilityLevel::Incompatible
        );
    }

    #[test]
    fn test_bump_operations() {
        let v = SchemaVersion::new(1, 2, 3);
        assert_eq!(v.bump_major(), SchemaVersion::new(2, 0, 0));
        assert_eq!(v.bump_minor(), SchemaVersion::new(1, 3, 0));
        assert_eq!(v.bump_patch(), SchemaVersion::new(1, 2, 4));
    }

    #[test]
    fn test_registry_register_lookup() {
        let reg = SchemaRegistry::new();
        let v = SchemaVersion::new(1, 0, 0);
        reg.register("vardhan_event", v.clone()).unwrap();
        assert_eq!(reg.lookup("vardhan_event"), Some(v));
        assert!(reg.is_compatible("vardhan_event", &SchemaVersion::new(1, 1, 0)));
        assert!(!reg.is_compatible("vardhan_event", &SchemaVersion::new(2, 0, 0)));
    }
}
