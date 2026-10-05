use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

use crate::credentials::{hash_password, verify_password};
use crate::store::CredentialStore;

#[derive(Error, Debug)]
pub enum ProfileError {
    #[error("User not found")]
    UserNotFound,
    #[error("Invalid current password")]
    InvalidCurrentPassword,
    #[error("Password policy violation: {0}")]
    PasswordPolicyViolation(String),
    #[error("Invalid profile data: {0}")]
    InvalidProfileData(String),
    #[error("Database error: {0}")]
    DbError(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdminProfile {
    pub username: String,
    pub display_name: String,
    pub email: String,
    pub role: String,
    pub updated_at_ms: u128,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub display_name: Option<String>,
    pub email: Option<String>,
}

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
    pub confirm_password: String,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub fn validate_email(email: &str) -> Result<(), ProfileError> {
    let email = email.trim();
    if email.is_empty() || email.len() > 128 || !email.contains('@') || !email.contains('.') {
        return Err(ProfileError::InvalidProfileData(
            "Invalid email address format".to_string(),
        ));
    }
    Ok(())
}

pub fn validate_display_name(name: &str) -> Result<(), ProfileError> {
    let name = name.trim();
    if name.is_empty() || name.len() > 64 {
        return Err(ProfileError::InvalidProfileData(
            "Display name must be between 1 and 64 characters".to_string(),
        ));
    }
    Ok(())
}

pub fn validate_new_password(current: &str, new: &str, confirm: &str) -> Result<(), ProfileError> {
    if new != confirm {
        return Err(ProfileError::PasswordPolicyViolation(
            "New password and confirmation do not match".to_string(),
        ));
    }
    if new.len() < 12 {
        return Err(ProfileError::PasswordPolicyViolation(
            "Password must be at least 12 characters".to_string(),
        ));
    }
    if new == current {
        return Err(ProfileError::PasswordPolicyViolation(
            "New password must be different from current password".to_string(),
        ));
    }
    Ok(())
}

impl CredentialStore {
    fn profile_key(username: &str) -> Vec<u8> {
        let mut k = b"profile:".to_vec();
        k.extend_from_slice(username.as_bytes());
        k
    }

    pub fn get_profile(&self, username: &str) -> Result<AdminProfile, ProfileError> {
        let key = Self::profile_key(username);
        let raw = self
            .db
            .get(&key)
            .map_err(|e| ProfileError::DbError(e.to_string()))?;

        match raw {
            Some(ivec) => {
                let profile: AdminProfile = serde_json::from_slice(&ivec)
                    .map_err(|e| ProfileError::DbError(e.to_string()))?;
                Ok(profile)
            }
            None => {
                // Return default bootstrap profile if user exists in creds
                if self.get_phc_sync(username).is_some() {
                    let default_profile = AdminProfile {
                        username: username.to_string(),
                        display_name: "CISO Administrator".to_string(),
                        email: format!("{}@vardhan.internal", username),
                        role: "ciso_admin".to_string(),
                        updated_at_ms: now_ms(),
                    };
                    let _ = self.save_profile(&default_profile);
                    Ok(default_profile)
                } else {
                    Err(ProfileError::UserNotFound)
                }
            }
        }
    }

    /// Resolve the role used for authorization without creating or mutating a profile.
    /// Missing profiles fail closed and return `None`; this is intentionally stricter
    /// than `get_profile`, whose legacy bootstrap behavior may materialize an admin profile.
    pub fn authoritative_role(&self, username: &str) -> Option<crate::authorization::Role> {
        let raw = self.db.get(Self::profile_key(username)).ok().flatten()?;
        let profile: AdminProfile = serde_json::from_slice(&raw).ok()?;
        Some(crate::authorization::Role::from_str(&profile.role))
    }

    pub fn save_profile(&self, profile: &AdminProfile) -> Result<(), ProfileError> {
        let key = Self::profile_key(&profile.username);
        let val = serde_json::to_vec(profile).map_err(|e| ProfileError::DbError(e.to_string()))?;
        self.db
            .insert(key, val)
            .map_err(|e| ProfileError::DbError(e.to_string()))?;
        self.db
            .flush()
            .map_err(|e| ProfileError::DbError(e.to_string()))?;
        Ok(())
    }

    pub fn update_profile(
        &self,
        username: &str,
        display_name: Option<String>,
        email: Option<String>,
    ) -> Result<AdminProfile, ProfileError> {
        let mut profile = self.get_profile(username)?;

        if let Some(name) = display_name {
            validate_display_name(&name)?;
            profile.display_name = name.trim().to_string();
        }

        if let Some(mail) = email {
            validate_email(&mail)?;
            profile.email = mail.trim().to_string();
        }

        profile.updated_at_ms = now_ms();
        self.save_profile(&profile)?;
        Ok(profile)
    }

    pub fn change_user_password(
        &self,
        username: &str,
        current_password: &str,
        new_password: &str,
        confirm_password: &str,
    ) -> Result<(), ProfileError> {
        validate_new_password(current_password, new_password, confirm_password)?;

        let current_phc = self
            .get_phc_sync(username)
            .ok_or(ProfileError::UserNotFound)?;
        if !verify_password(current_password, &current_phc) {
            return Err(ProfileError::InvalidCurrentPassword);
        }

        let new_phc = hash_password(new_password)
            .map_err(|e| ProfileError::DbError(format!("Argon2 hash failed: {e}")))?;

        self.set_phc_sync(username, &new_phc)
            .map_err(|e| ProfileError::DbError(e.to_string()))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_profile_lifecycle() {
        let dir = tempdir().unwrap();
        let store = CredentialStore::open(dir.path()).unwrap();
        let phc = hash_password("test_pass_12345").unwrap();
        store.set_phc_sync("alice", &phc).unwrap();

        let initial = store.get_profile("alice").unwrap();
        assert_eq!(initial.username, "alice");
        assert_eq!(initial.role, "ciso_admin");

        let updated = store
            .update_profile(
                "alice",
                Some("Alice Security Lead".to_string()),
                Some("alice@corp.com".to_string()),
            )
            .unwrap();
        assert_eq!(updated.display_name, "Alice Security Lead");
        assert_eq!(updated.email, "alice@corp.com");
        assert_eq!(updated.role, "ciso_admin");

        let reloaded = store.get_profile("alice").unwrap();
        assert_eq!(reloaded.display_name, "Alice Security Lead");
        assert_eq!(reloaded.email, "alice@corp.com");
    }

    #[test]
    fn authoritative_role_is_strict_and_non_mutating() {
        let dir = tempdir().unwrap();
        let store = CredentialStore::open(dir.path()).unwrap();
        let phc = hash_password("test_pass_12345").unwrap();
        store.set_phc_sync("alice", &phc).unwrap();

        assert_eq!(store.authoritative_role("alice"), None);

        store.save_profile(&AdminProfile {
            username: "alice".to_string(),
            display_name: "Alice".to_string(),
            email: "alice@example.com".to_string(),
            role: "user".to_string(),
            updated_at_ms: 1,
        }).unwrap();
        assert_eq!(store.authoritative_role("alice"), Some(crate::authorization::Role::User));
    }

    #[test]
    fn test_change_password_validation() {
        let dir = tempdir().unwrap();
        let store = CredentialStore::open(dir.path()).unwrap();
        let phc = hash_password("original_password_12").unwrap();
        store.set_phc_sync("bob", &phc).unwrap();

        assert!(store
            .change_user_password(
                "bob",
                "original_password_12",
                "new_secure_password_12",
                "different_confirmation"
            )
            .is_err());
        assert!(store
            .change_user_password("bob", "original_password_12", "short", "short")
            .is_err());
        assert!(store
            .change_user_password(
                "bob",
                "wrong_current_pass",
                "new_secure_password_12",
                "new_secure_password_12"
            )
            .is_err());
        assert!(store
            .change_user_password(
                "bob",
                "original_password_12",
                "new_secure_password_12",
                "new_secure_password_12"
            )
            .is_ok());

        let bob_phc = store.get_phc_sync("bob").unwrap();
        assert!(!verify_password("original_password_12", &bob_phc));
        assert!(verify_password("new_secure_password_12", &bob_phc));
    }
}