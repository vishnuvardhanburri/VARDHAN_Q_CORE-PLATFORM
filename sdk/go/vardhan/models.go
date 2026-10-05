package vardhan

// Canonical OpenAPI models shared by generated/client integrations.
type Plan struct { ID string `json:"id"`; Name string `json:"name"`; Tier string `json:"tier"`; ContactSales bool `json:"contact_sales"`; Entitlements []string `json:"entitlements"` }
type Organization struct { ID string `json:"id"`; Name string `json:"name"`; Owner string `json:"owner"`; CreatedAtMS int64 `json:"created_at_ms"` }
type Subscription struct { OrganizationID string `json:"organization_id"`; PlanID string `json:"plan_id"`; Status string `json:"status"`; Provider string `json:"provider"`; ExternalCustomerID *string `json:"external_customer_id,omitempty"`; ExternalSubscriptionID *string `json:"external_subscription_id,omitempty"` }
type Usage struct { OrganizationID string `json:"organization_id"`; Transactions int64 `json:"transactions"`; BytesProcessed int64 `json:"bytes_processed"` }
type EntitlementResponse struct { OrganizationID string `json:"organization_id"`; Plan *Plan `json:"plan,omitempty"`; SubscriptionStatus string `json:"subscription_status"`; Provider string `json:"provider,omitempty"`; Entitlements []string `json:"entitlements"`; Activation string `json:"activation"` }
