use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan { pub id: String, pub name: String, pub tier: String, pub contact_sales: bool, pub entitlements: Vec<String> }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Organization { pub id: String, pub name: String, pub owner: String, pub created_at_ms: u64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    pub organization_id: String,
    pub plan_id: String,
    pub status: String,
    pub provider: String,
    pub external_customer_id: Option<String>,
    pub external_subscription_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage { pub organization_id: String, pub transactions: u64, pub bytes_processed: u64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntitlementResponse {
    pub organization_id: String,
    pub plan: Option<Plan>,
    pub subscription_status: String,
    pub provider: Option<String>,
    pub entitlements: Vec<String>,
    pub activation: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_openapi_models_deserialize() {
        let organization: Organization = serde_json::from_str(r#"{"id":"00000000-0000-0000-0000-000000000001","name":"Acme","owner":"owner@example.com","created_at_ms":1}"#).unwrap();
        assert_eq!(organization.name, "Acme");
        let subscription: Subscription = serde_json::from_str(r#"{"organization_id":"00000000-0000-0000-0000-000000000001","plan_id":"enterprise","status":"Active","provider":"verified"}"#).unwrap();
        assert_eq!(subscription.plan_id, "enterprise");
        let usage: Usage = serde_json::from_str(r#"{"organization_id":"00000000-0000-0000-0000-000000000001","transactions":2,"bytes_processed":64}"#).unwrap();
        assert_eq!(usage.bytes_processed, 64);
    }
}
