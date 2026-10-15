use auth_service::profile::AdminProfile;
use auth_service::{CredentialStore, Role};
use tempfile::tempdir;

#[test]
fn authoritative_role_projection_uses_persisted_profile_role() {
    let dir = tempdir().unwrap();
    let store = CredentialStore::open(dir.path()).unwrap();
    store.set_phc_sync("alice", "test-phc").unwrap();
    store
        .save_profile(&AdminProfile {
            username: "alice".to_string(),
            display_name: "Alice".to_string(),
            email: "alice@example.com".to_string(),
            role: "user".to_string(),
            updated_at_ms: 1,
        })
        .unwrap();

    assert_eq!(store.authoritative_role("alice").unwrap(), Role::User);
}

#[test]
fn authoritative_role_projection_does_not_invent_admin_for_missing_profile() {
    let dir = tempdir().unwrap();
    let store = CredentialStore::open(dir.path()).unwrap();
    store.set_phc_sync("alice", "test-phc").unwrap();

    assert_eq!(store.authoritative_role("alice"), None);
}
