package com.vardhan.technologies;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.*;

public final class VardhanClient {
  private final String baseUrl; private final String token; private final HttpClient http; private final ObjectMapper json = new ObjectMapper();
  public VardhanClient(String baseUrl, String token) { this.baseUrl = baseUrl.replaceAll("/$", ""); this.token = token; this.http = HttpClient.newHttpClient(); }
  public JsonNode get(String path) throws IOException, InterruptedException {
    HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(baseUrl + path)).header("Accept", "application/json").header("X-Vardhan-SDK", "java/0.1.0");
    if (token != null && !token.isBlank()) builder.header("Authorization", "Bearer " + token);
    HttpResponse<String> response = http.send(builder.GET().build(), HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() < 200 || response.statusCode() >= 300) throw new IOException("Vardhan API error " + response.statusCode() + ": " + response.body());
    return json.readTree(response.body());
  }
  public JsonNode health() throws IOException, InterruptedException { return get("/api/v1/platform/health"); }
  public JsonNode plans() throws IOException, InterruptedException { return get("/api/v1/catalog/plans"); }
  public JsonNode me() throws IOException, InterruptedException { return get("/api/v1/me"); }
}
