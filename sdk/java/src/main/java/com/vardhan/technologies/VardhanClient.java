package com.vardhan.technologies;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;

public final class VardhanClient {
  private final String baseUrl;
  private final String token;
  private final HttpClient http;
  private final ObjectMapper json = new ObjectMapper();

  public VardhanClient(String baseUrl, String token) {
    this.baseUrl = baseUrl.replaceAll("/$", "");
    this.token = token;
    this.http = HttpClient.newHttpClient();
  }

  public static String idempotencyKey() { return UUID.randomUUID().toString(); }

  public JsonNode request(String method, String path, JsonNode body, String idempotencyKey) throws IOException, InterruptedException {
    HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(baseUrl + path))
        .header("Accept", "application/json")
        .header("X-Vardhan-SDK", "java/0.2.0");
    if (token != null && !token.isBlank()) builder.header("Authorization", "Bearer " + token);
    if (idempotencyKey != null && !idempotencyKey.isBlank()) builder.header("Idempotency-Key", idempotencyKey);
    else if ("POST".equalsIgnoreCase(method)) builder.header("Idempotency-Key", idempotencyKey());
    if (body != null) builder.header("Content-Type", "application/json");
    String payload = body == null ? "" : json.writeValueAsString(body);
    HttpRequest.BodyPublisher publisher = payload.isEmpty() ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(payload);
    HttpRequest request = switch (method.toUpperCase()) {
      case "POST" -> builder.POST(publisher).build();
      case "PUT" -> builder.PUT(publisher).build();
      case "PATCH" -> builder.method("PATCH", publisher).build();
      case "DELETE" -> builder.DELETE().build();
      default -> builder.GET().build();
    };
    HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      throw new IOException("Vardhan API error " + response.statusCode() + ": " + response.body());
    }
    return response.body().isBlank() ? json.createObjectNode() : json.readTree(response.body());
  }

  public JsonNode get(String path) throws IOException, InterruptedException { return request("GET", path, null, null); }
  public JsonNode post(String path, JsonNode body, String idempotencyKey) throws IOException, InterruptedException { return request("POST", path, body, idempotencyKey); }
  public JsonNode health() throws IOException, InterruptedException { return get("/api/v1/platform/health"); }
  public JsonNode plans() throws IOException, InterruptedException { return get("/api/v1/catalog/plans"); }
  public JsonNode me() throws IOException, InterruptedException { return get("/api/v1/me"); }
  public JsonNode organizations() throws IOException, InterruptedException { return get("/api/v1/organizations"); }
  public JsonNode organization(String id) throws IOException, InterruptedException { return get("/api/v1/organizations/" + id); }
  public JsonNode entitlements(String id) throws IOException, InterruptedException { return get("/api/v1/organizations/" + id + "/entitlements"); }
  public JsonNode subscription(String id) throws IOException, InterruptedException { return get("/api/v1/organizations/" + id + "/subscription"); }
  public JsonNode usage(String id) throws IOException, InterruptedException { return get("/api/v1/organizations/" + id + "/usage"); }
  public JsonNode members(String id) throws IOException, InterruptedException { return get("/api/v1/organizations/" + id + "/members"); }
  public JsonNode invitations(String id) throws IOException, InterruptedException { return get("/api/v1/organizations/" + id + "/invitations"); }
  public JsonNode securityPosture(String id) throws IOException, InterruptedException { return get("/api/v1/organizations/" + id + "/security/posture"); }
  public JsonNode findings(String id) throws IOException, InterruptedException { return get("/api/v1/organizations/" + id + "/findings"); }
  public JsonNode incidents(String id) throws IOException, InterruptedException { return get("/api/v1/organizations/" + id + "/incidents"); }
  public JsonNode transactions(String id) throws IOException, InterruptedException { return get("/api/v1/organizations/" + id + "/transactions"); }
  public JsonNode aerKepQStatus(String id) throws IOException, InterruptedException { return get("/api/v1/organizations/" + id + "/aer-kep-q/status"); }
  public JsonNode createOrganization(JsonNode body, String idempotencyKey) throws IOException, InterruptedException { return post("/api/v1/organizations", body, idempotencyKey); }
  public JsonNode createInvitation(String id, JsonNode body, String idempotencyKey) throws IOException, InterruptedException { return post("/api/v1/organizations/" + id + "/invitations", body, idempotencyKey); }
    public JsonNode ingestTransaction(String id, JsonNode body, String idempotencyKey) throws IOException, InterruptedException { return post("/api/v1/organizations/" + id + "/transactions", body, idempotencyKey); }
  public JsonNode requestPlan(String id, JsonNode body, String idempotencyKey) throws IOException, InterruptedException { return post("/api/v1/organizations/" + id + "/subscription", body, idempotencyKey); }
  public JsonNode recordUsage(String id, JsonNode body, String idempotencyKey) throws IOException, InterruptedException { return post("/api/v1/organizations/" + id + "/usage/record", body, idempotencyKey); }
  public JsonNode updateMemberRole(String id, String member, JsonNode body, String idempotencyKey) throws IOException, InterruptedException { return post("/api/v1/organizations/" + id + "/members/" + member + "/role", body, idempotencyKey); }
  public JsonNode revokeInvitation(String id, String invitationId, String idempotencyKey) throws IOException, InterruptedException { return post("/api/v1/organizations/" + id + "/invitations/" + invitationId, json.createObjectNode(), idempotencyKey); }
  public JsonNode acceptInvitation(JsonNode body, String idempotencyKey) throws IOException, InterruptedException { return post("/api/v1/invitations/accept", body, idempotencyKey); }

  public static boolean verifyWebhookSignature(String secret, byte[] body, String signatureHex, long timestamp, long toleranceSecs) {
    if (timestamp > 0) {
      long now = System.currentTimeMillis() / 1000;
      if (Math.abs(now - timestamp) > toleranceSecs) return false;
    }
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      byte[] expected = mac.doFinal(body);
      byte[] supplied = HexFormat.of().parseHex(signatureHex);
      return MessageDigest.isEqual(expected, supplied);
    } catch (Exception e) {
      return false;
    }
  }
  public static boolean verifyWebhookSignature(String secret, byte[] body, String signatureHex) {
    return verifyWebhookSignature(secret, body, signatureHex, 0, 0);
  }
}
