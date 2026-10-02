//! Role-based access control (RBAC) and permission model for Vardhan Quantum.

use serde::{Deserialize, Serialize};

/// System roles with graduated privilege levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Admin,
    Operator,
    User,
}

impl Role {
    pub fn from_str(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "admin" | "ciso_admin" | "security_admin" | "root" => Role::Admin,
            "operator" | "cluster_operator" | "ops" => Role::Operator,
            _ => Role::User,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Role::Admin => "ciso_admin",
            Role::Operator => "cluster_operator",
            Role::User => "user",
        }
    }

    /// Evaluates if this role grants the requested permission under least privilege.
    pub fn has_permission(&self, perm: Permission) -> bool {
        match self {
            Role::Admin => true, // Superuser
            Role::Operator => matches!(
                perm,
                Permission::ReadDashboard
                    | Permission::ReadSessions
                    | Permission::RevokeSession
                    | Permission::DrainCluster
                    | Permission::UpdateProfile
                    | Permission::ChangePassword
            ),
            Role::User => matches!(
                perm,
                Permission::ReadDashboard | Permission::UpdateProfile | Permission::ChangePassword
            ),
        }
    }
}

/// Explicit permission gates for administrative operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    ReadDashboard,
    ReadSessions,
    RevokeSession,
    FlushSessions,
    UpdateProfile,
    ChangePassword,
    UpdateSettings,
    ManageApiKeys,
    DrainCluster,
    RebootCluster,
    LedgerAdmin,
}

/// Represents the authenticated caller identity injected by middleware.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthenticatedUser {
    pub username: String,
    pub role: Role,
}

impl AuthenticatedUser {
    pub fn new_admin(username: impl Into<String>) -> Self {
        Self {
            username: username.into(),
            role: Role::Admin,
        }
    }

    pub fn new_user(username: impl Into<String>, role: Role) -> Self {
        Self {
            username: username.into(),
            role,
        }
    }

    pub fn can(&self, perm: Permission) -> bool {
        self.role.has_permission(perm)
    }

    /// Check if caller is authorized to revoke a session belonging to `session_owner`.
    /// Users can revoke their own sessions; Operators and Admins can revoke any session.
    pub fn can_revoke_session(&self, session_owner: &str) -> bool {
        if self.username == session_owner {
            true
        } else {
            self.can(Permission::RevokeSession)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_role_parsing() {
        assert_eq!(Role::from_str("admin"), Role::Admin);
        assert_eq!(Role::from_str("ciso_admin"), Role::Admin);
        assert_eq!(Role::from_str("operator"), Role::Operator);
        assert_eq!(Role::from_str("ops"), Role::Operator);
        assert_eq!(Role::from_str("auditor"), Role::User);
        assert_eq!(Role::from_str("guest"), Role::User);
    }

    #[test]
    fn test_least_privilege_permissions() {
        let admin = AuthenticatedUser::new_admin("admin");
        let op = AuthenticatedUser::new_user("op", Role::Operator);
        let user = AuthenticatedUser::new_user("alice", Role::User);

        // Admin has all permissions
        assert!(admin.can(Permission::DrainCluster));
        assert!(admin.can(Permission::RebootCluster));
        assert!(admin.can(Permission::UpdateSettings));
        assert!(admin.can(Permission::FlushSessions));
        assert!(admin.can(Permission::ManageApiKeys));

        // Operator has operational permissions, but cannot change settings or reboot
        assert!(op.can(Permission::DrainCluster));
        assert!(op.can(Permission::ReadSessions));
        assert!(op.can(Permission::RevokeSession));
        assert!(!op.can(Permission::RebootCluster));
        assert!(!op.can(Permission::UpdateSettings));
        assert!(!op.can(Permission::FlushSessions));
        assert!(!op.can(Permission::ManageApiKeys));

        // User cannot drain, reboot, read arbitrary sessions, or manage API keys
        assert!(!user.can(Permission::DrainCluster));
        assert!(!user.can(Permission::ReadSessions));
        assert!(!user.can(Permission::RevokeSession));
        assert!(user.can(Permission::UpdateProfile));
        assert!(user.can(Permission::ChangePassword));
    }

    #[test]
    fn test_session_revocation_privilege() {
        let admin = AuthenticatedUser::new_admin("admin");
        let op = AuthenticatedUser::new_user("op", Role::Operator);
        let user = AuthenticatedUser::new_user("alice", Role::User);

        // User can revoke their own session
        assert!(user.can_revoke_session("alice"));
        // User cannot revoke another user's session
        assert!(!user.can_revoke_session("bob"));

        // Operator and Admin can revoke any session
        assert!(op.can_revoke_session("alice"));
        assert!(admin.can_revoke_session("alice"));
    }
}
