use super::*;

#[test]
fn control_plane_enforces_tenant_scoped_rbac_and_project_membership() {
    let cp = ControlPlane::new();
    cp.create_tenant(TenantSpec::new("bank-a", "Bank A", SecurityLevel::Enterprise)).unwrap();
    cp.create_user(UserSpec::new("alice", "alice@bank-a.example")).unwrap();
    cp.assign_role("bank-a", "alice", Role::SecurityAdmin).unwrap();
    cp.create_project("bank-a", "payments", "alice").unwrap();
    cp.create_environment("bank-a", "payments", "prod", "alice").unwrap();
    assert!(cp.authorize("bank-a", "alice", Permission::ManagePolicy, "payments").unwrap());
    assert!(cp.authorize("bank-a", "alice", Permission::ManageUsers, "payments").unwrap());
    assert!(!cp.authorize("bank-a", "alice", Permission::ExecuteTransaction, "other").unwrap());
}

#[test]
fn industry_registry_has_all_seven_packages_and_control_mapping() {
    let registry = IndustryRegistry::default();
    assert_eq!(registry.packages().len(), 7);
    let banking = registry.get(Industry::Banking).unwrap();
    assert!(banking.controls.iter().any(|c| c.id == "BANK-PQ-001"));
    assert!(banking.required_integrations.iter().any(|i| *i == IntegrationKind::Siem));
}

#[test]
fn security_operations_escalate_and_remediate_risk() {
    let mut ops = SecurityOperations::default();
    let finding = ops.ingest_finding(RiskFinding::new("asset-1", "exposed-key", 92));
    assert_eq!(ops.risk_score("asset-1"), Some(92));
    let incident = ops.open_incident_from_finding(&finding).unwrap();
    ops.apply_remediation(&incident.id, RemediationAction::QuarantineAsset).unwrap();
    assert_eq!(ops.incident(&incident.id).unwrap().status, IncidentStatus::Contained);
}

#[test]
fn compliance_evidence_and_release_gate_work() {
    let mut assurance = AssuranceEngine::default();
    assurance.add_control(ComplianceControl::new("ISO-A.8", "Identity and access")).unwrap();
    assurance.add_evidence(Evidence::new("ev-1", "ISO-A.8", "access-review.json")).unwrap();
    assurance.add_vulnerability(Vulnerability::new("CVE-TEST", "high", false)).unwrap();
    assert!(!assurance.release_gate_passes());
    assurance.resolve_vulnerability("CVE-TEST").unwrap();
    assert!(assurance.release_gate_passes());
}

#[test]
fn integration_registry_requires_tenant_and_supports_health() {
    let mut integrations = IntegrationRegistry::default();
    let id = integrations.register(IntegrationConfig::new("bank-a", "siem-1", IntegrationKind::Siem)).unwrap();
    integrations.set_health(&id, IntegrationHealth::Healthy).unwrap();
    assert_eq!(integrations.healthy_count("bank-a"), 1);
}

#[test]
fn resilience_manager_prevents_two_active_nodes_and_tracks_backup() {
    let mut resilience = ResilienceManager::default();
    resilience.register_node(ClusterNode::new("node-a", "region-a")).unwrap();
    resilience.register_node(ClusterNode::new("node-b", "region-b")).unwrap();
    resilience.elect_leader("node-a").unwrap();
    assert!(resilience.elect_leader("node-b").is_err());
    let backup = resilience.create_backup("daily-1", "sha256:abc").unwrap();
    assert_eq!(resilience.backup(&backup.id).unwrap().checksum, "sha256:abc");
}

#[test]
fn disabled_user_cannot_authorize_even_with_owner_role() {
    let cp = ControlPlane::new();
    cp.create_tenant(TenantSpec::new("t1", "Tenant", SecurityLevel::Enterprise)).unwrap();
    cp.create_user(UserSpec::new("u1", "u1@example.com")).unwrap();
    cp.assign_role("t1", "u1", Role::Owner).unwrap();
    cp.disable_user("u1").unwrap();
    assert!(!cp.authorize("t1", "u1", Permission::ManageUsers, "*").unwrap());
}

#[test]
fn role_revocation_removes_effective_permission() {
    let cp = ControlPlane::new();
    cp.create_tenant(TenantSpec::new("t1", "Tenant", SecurityLevel::Enterprise)).unwrap();
    cp.create_user(UserSpec::new("u1", "u1@example.com")).unwrap();
    cp.assign_role("t1", "u1", Role::SecurityAdmin).unwrap();
    assert!(cp.authorize("t1", "u1", Permission::ManagePolicy, "*").unwrap());
    cp.revoke_role("t1", "u1", Role::SecurityAdmin).unwrap();
    assert!(!cp.authorize("t1", "u1", Permission::ManagePolicy, "*").unwrap());
}

#[test]
fn scim_provisioning_is_idempotent_and_deprovisioning_revokes_access() {
    let cp = ControlPlane::new();
    cp.create_tenant(TenantSpec::new("t1", "Tenant", SecurityLevel::Enterprise)).unwrap();
    let scim = ScimProvisioner::new(cp.clone());
    let user = ScimUser::new("scim-1", "user@example.com");
    scim.upsert_user("t1", &user).unwrap();
    scim.upsert_user("t1", &user).unwrap();
    scim.assign_group_role("t1", "scim-1", "security-admin").unwrap();
    assert!(cp.authorize("t1", "scim-1", Permission::ManagePolicy, "*").unwrap());
    scim.deprovision_user("t1", "scim-1").unwrap();
    assert!(!cp.authorize("t1", "scim-1", Permission::ManagePolicy, "*").unwrap());
}

#[test]
fn scim_cross_tenant_role_assignment_is_rejected() {
    let cp = ControlPlane::new();
    cp.create_tenant(TenantSpec::new("t1", "Tenant 1", SecurityLevel::Enterprise)).unwrap();
    cp.create_tenant(TenantSpec::new("t2", "Tenant 2", SecurityLevel::Enterprise)).unwrap();
    let scim = ScimProvisioner::new(cp.clone());
    scim.upsert_user("t1", &ScimUser::new("u1", "u1@example.com")).unwrap();
    assert!(scim.assign_group_role("t2", "u1", "owner").is_err());
}
