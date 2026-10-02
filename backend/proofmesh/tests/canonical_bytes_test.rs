use proofmesh::identity::{VerificationClaimId, CanonicalObjectRef};
use vardhan_state::transition::TransitionType;
use proofmesh::scope::{CanonicalTenantId, VerificationScope};
use vardhan_state::id::TenantId;
use uuid::uuid;
use serde_json::json;

#[test]
fn test_canonical_tenant_id_validation() {
    let global_uuid = uuid!("00000000-0000-0000-0000-000000000001");
    let platform_uuid = uuid!("00000000-0000-0000-0000-000000000002");
    let random_uuid = uuid::Uuid::new_v4();
    
    let global_tenant = CanonicalTenantId(TenantId::from_uuid(global_uuid));
    let platform_tenant = CanonicalTenantId(TenantId::from_uuid(platform_uuid));
    let random_tenant = CanonicalTenantId(TenantId::from_uuid(random_uuid));
    
    // Global scope allows GLOBAL_UUID
    assert!(global_tenant.clone().validate_context(VerificationScope::Global).is_ok());
    // Global scope rejects platform/random
    assert!(platform_tenant.clone().validate_context(VerificationScope::Global).is_err());
    assert!(random_tenant.clone().validate_context(VerificationScope::Global).is_err());
    
    // Platform scope allows PLATFORM_UUID
    assert!(platform_tenant.clone().validate_context(VerificationScope::Platform).is_ok());
    assert!(global_tenant.clone().validate_context(VerificationScope::Platform).is_err());
    
    // Tenant scope allows matching random UUID
    let expected = TenantId::from_uuid(random_uuid);
    assert!(random_tenant.clone().validate_context(VerificationScope::Tenant(expected)).is_ok());
    
    // Tenant scope REJECTS reserved UUIDs even if they match expected!
    let expected_global = TenantId::from_uuid(global_uuid);
    assert!(global_tenant.clone().validate_context(VerificationScope::Tenant(expected_global)).is_err());
}
