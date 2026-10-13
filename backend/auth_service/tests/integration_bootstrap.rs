use auth_service::secrets::{SecretReader, SecretError};
use std::env;
use std::fs;
use tempfile::tempdir;

#[test]
fn test_secure_bootstrap_password_file_succeeds() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("admin_pass.txt");
    fs::write(&path, "super_secure_production_password_123!").unwrap();

    env::set_var("VARDHAN_ADMIN_PASSWORD_FILE", path.to_str().unwrap());
    
    let pass = SecretReader::read_bootstrap_password().expect("Should read password from file");
    assert_eq!(*pass, "super_secure_production_password_123!");

    env::remove_var("VARDHAN_ADMIN_PASSWORD_FILE");
}

#[test]
fn test_legacy_environment_only_password_cannot_bootstrap() {
    env::remove_var("VARDHAN_ADMIN_PASSWORD_FILE");
    env::set_var("VARDHAN_ADMIN_PASSWORD", "should_be_ignored");

    let result = SecretReader::read_bootstrap_password();
    assert!(result.is_err(), "Must fail closed if only legacy env var is used");

    if let Err(SecretError::NotFound(msg)) = result {
        assert!(msg.contains("No secure bootstrap password source configured"));
    } else {
        panic!("Expected NotFound error");
    }

    env::remove_var("VARDHAN_ADMIN_PASSWORD");
}

#[test]
fn test_missing_secure_bootstrap_configuration_fails_closed() {
    env::remove_var("VARDHAN_ADMIN_PASSWORD_FILE");
    env::remove_var("VARDHAN_ADMIN_PASSWORD");

    let result = SecretReader::read_bootstrap_password();
    assert!(result.is_err(), "Must fail closed if no config provided");
}
