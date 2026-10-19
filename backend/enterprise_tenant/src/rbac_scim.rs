use super::*;
use std::sync::Arc;

pub trait EnterpriseIdentityControl {
    fn revoke_role(&self, tenant_id: &str, user_id: &str, role: Role) -> Result<(), PlatformError>;
    fn disable_user(&self, user_id: &str) -> Result<(), PlatformError>;
}

impl EnterpriseIdentityControl for ControlPlane {
    fn revoke_role(&self, tenant_id: &str, user_id: &str, role: Role) -> Result<(), PlatformError> {
        self.require_tenant(tenant_id)?;
        self.require_user(user_id)?;
        let mut roles = self.roles.lock().unwrap();
        let key = (tenant_id.to_owned(), user_id.to_owned());
        let entry = roles.get_mut(&key).ok_or(PlatformError::Forbidden)?;
        if !entry.remove(&role) {
            return Err(PlatformError::NotFound(format!("role:{role:?}")));
        }
        if entry.is_empty() {
            roles.remove(&key);
        }
        Ok(())
    }

    fn disable_user(&self, user_id: &str) -> Result<(), PlatformError> {
        let mut users = self.users.lock().unwrap();
        let user = users
            .get_mut(user_id)
            .ok_or_else(|| PlatformError::UserNotFound(user_id.into()))?;
        user.enabled = false;
        drop(users);
        self.roles
            .lock()
            .unwrap()
            .retain(|(_, uid), _| uid != user_id);
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScimUser {
    pub external_id: String,
    pub user_name: String,
    pub active: bool,
}
impl ScimUser {
    pub fn new(external_id: impl Into<String>, user_name: impl Into<String>) -> Self {
        Self {
            external_id: external_id.into(),
            user_name: user_name.into(),
            active: true,
        }
    }
}

fn parse_role(group: &str) -> Option<Role> {
    match group.trim().to_ascii_lowercase().as_str() {
        "owner" => Some(Role::Owner),
        "security-admin" | "securityadmin" => Some(Role::SecurityAdmin),
        "auditor" => Some(Role::Auditor),
        "operator" => Some(Role::Operator),
        "analyst" => Some(Role::Analyst),
        "viewer" => Some(Role::Viewer),
        _ => None,
    }
}

pub struct ScimProvisioner {
    control_plane: Arc<ControlPlane>,
}
impl ScimProvisioner {
    pub fn new(control_plane: Arc<ControlPlane>) -> Self {
        Self { control_plane }
    }

    pub fn upsert_user(&self, tenant_id: &str, user: &ScimUser) -> Result<(), PlatformError> {
        self.control_plane.require_tenant(tenant_id)?;
        if user.external_id.trim().is_empty() || user.user_name.trim().is_empty() {
            return Err(PlatformError::InvalidState(
                "SCIM identity fields required".into(),
            ));
        }
        let existing = self
            .control_plane
            .users
            .lock()
            .unwrap()
            .get(&user.external_id)
            .cloned();
        if existing.is_some() {
            let elsewhere = self
                .control_plane
                .roles
                .lock()
                .unwrap()
                .keys()
                .any(|(t, uid)| uid == &user.external_id && t != tenant_id);
            if elsewhere {
                return Err(PlatformError::Forbidden);
            }
            let mut users = self.control_plane.users.lock().unwrap();
            let stored = users
                .get_mut(&user.external_id)
                .ok_or_else(|| PlatformError::UserNotFound(user.external_id.clone()))?;
            stored.email = user.user_name.clone();
            stored.enabled = user.active;
            if user.active
                && !self
                    .control_plane
                    .roles
                    .lock()
                    .unwrap()
                    .keys()
                    .any(|(t, uid)| t == tenant_id && uid == &user.external_id)
            {
                drop(users);
                self.control_plane
                    .assign_role(tenant_id, &user.external_id, Role::Viewer)?;
            }
            return Ok(());
        }
        self.control_plane.create_user(UserSpec {
            id: user.external_id.clone(),
            email: user.user_name.clone(),
            enabled: user.active,
        })?;
        if user.active {
            self.control_plane
                .assign_role(tenant_id, &user.external_id, Role::Viewer)?;
        }
        Ok(())
    }

    pub fn assign_group_role(
        &self,
        tenant_id: &str,
        user_id: &str,
        group: &str,
    ) -> Result<(), PlatformError> {
        self.control_plane.require_tenant(tenant_id)?;
        self.control_plane.require_user(user_id)?;
        let role = parse_role(group).ok_or_else(|| {
            PlatformError::InvalidState(format!("unsupported SCIM group: {group}"))
        })?;
        let elsewhere = self
            .control_plane
            .roles
            .lock()
            .unwrap()
            .keys()
            .any(|(t, uid)| uid == user_id && t != tenant_id);
        if elsewhere {
            return Err(PlatformError::Forbidden);
        }
        self.control_plane.assign_role(tenant_id, user_id, role)
    }

    pub fn deprovision_user(&self, tenant_id: &str, user_id: &str) -> Result<(), PlatformError> {
        self.control_plane.require_tenant(tenant_id)?;
        self.control_plane.require_user(user_id)?;

        let mut roles = self.control_plane.roles.lock().unwrap();
        let key = (tenant_id.to_owned(), user_id.to_owned());
        if roles.remove(&key).is_none() {
            return Err(PlatformError::Forbidden);
        }
        let elsewhere = roles.keys().any(|(_, uid)| uid == user_id);
        drop(roles);

        if !elsewhere {
            self.control_plane.disable_user(user_id)?;
        }
        Ok(())
    }
}
