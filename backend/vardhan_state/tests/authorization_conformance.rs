use vardhan_state::authorization::{
    ActionType, AuthLevel, AuthorizationInner, HistoricalBusinessAuthorization, ProvenanceTrail,
    RiskLevel,
};
use vardhan_state::id::{
    ActionId, AuthorizationId, ConfigurationHash, DecisionId, EntityId, EvidenceId, TenantId,
};
use vardhan_state::scope::TenantScoped;
use vardhan_state::time::TimeContext;

#[test]
fn test_action_type_serialization() {
    let systemic = ActionType::SystemicFaultInjection;
    let json = serde_json::to_string(&systemic).unwrap();
    assert_eq!(json, "\"SYSTEMIC_FAULT_INJECTION\"");
    let decoded: ActionType = serde_json::from_str(&json).unwrap();
    assert_eq!(decoded, systemic);

    let exec = ActionType::Execute;
    let json = serde_json::to_string(&exec).unwrap();
    assert_eq!(json, "\"EXECUTE\"");
    let decoded: ActionType = serde_json::from_str(&json).unwrap();
    assert_eq!(decoded, exec);
}

#[test]
fn test_tenant_scoped_authorization_serialization() {
    let auth_inner = AuthorizationInner::Business(HistoricalBusinessAuthorization {
        auth_id: AuthorizationId::new_v4(),
        decision_id: DecisionId::new_v4(),
        action_id: ActionId::new_v4(),
        policy_eval_ref: EvidenceId::new([0u8; 32]),
        assurance_ref: EvidenceId::new([0u8; 32]),
        risk_level: RiskLevel::Medium,
        auth_level: AuthLevel::Standard,
        authorized_by: EntityId::new_v4(),
        authorized_at: TimeContext {
            logical_time: None,
            event_time: chrono::Utc::now(),
            system_time: chrono::Utc::now(),
            deadline_time: None,
            created_at: chrono::Utc::now(),
        },
        config_hash: ConfigurationHash::from([0u8; 32]),
        evidence_refs: vec![],
        provenance: ProvenanceTrail {
            generator_model: "test".into(),
            generation_timestamp: 1000,
            context_hash: "hash".into(),
        },
    });

    let tenant_id = TenantId::new_v4();
    let auth = TenantScoped::new(tenant_id, auth_inner);

    let serialized = serde_json::to_string(&auth).unwrap();
    assert!(serialized.contains("inner"));
    assert!(serialized.contains("scope_hash"));
    assert!(serialized.contains("tenant_id"));
}
