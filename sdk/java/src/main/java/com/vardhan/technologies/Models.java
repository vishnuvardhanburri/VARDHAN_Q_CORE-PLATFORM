package com.vardhan.technologies;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

public final class Models {
  private Models() {}
  public record Plan(String id, String name, String tier, boolean contact_sales, List<String> entitlements) {}
  public record Organization(String id, String name, String owner, long created_at_ms) {}
  public record Subscription(
      String organization_id,
      String plan_id,
      String status,
      String provider,
      String external_customer_id,
      String external_subscription_id) {}
  public record Usage(String organization_id, long transactions, long bytes_processed) {}
  public record EntitlementResponse(
      String organization_id,
      Plan plan,
      String subscription_status,
      String provider,
      List<String> entitlements,
      String activation) {}

  public static void assertCanonicalFieldNames() {
    try {
      new com.fasterxml.jackson.databind.ObjectMapper().readValue(
          "{\"id\":\"00000000-0000-0000-0000-000000000001\",\"name\":\"Acme\",\"owner\":\"owner@example.com\",\"created_at_ms\":1}",
          Organization.class);
    } catch (Exception e) {
      throw new IllegalStateException("Canonical OpenAPI model compatibility failure", e);
    }
  }
}
