package vardhan

import (
  "context"
  "encoding/json"
  "fmt"
  "net/http"
  "strings"
  "time"
)

type Client struct { BaseURL, Token string; HTTPClient *http.Client }
type APIError struct { Status int; Message, Code, RequestID string }
func (e *APIError) Error() string { return fmt.Sprintf("vardhan api error %d: %s", e.Status, e.Message) }
func New(baseURL, token string) *Client { return &Client{BaseURL: strings.TrimRight(baseURL, "/"), Token: token, HTTPClient: &http.Client{Timeout: 15*time.Second}} }
func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
  req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, nil); if err != nil { return err }
  req.Header.Set("Accept", "application/json"); req.Header.Set("X-Vardhan-SDK", "go/0.1.0"); if c.Token != "" { req.Header.Set("Authorization", "Bearer "+c.Token) }
  res, err := c.HTTPClient.Do(req); if err != nil { return err }; defer res.Body.Close()
  if res.StatusCode < 200 || res.StatusCode >= 300 { var e struct{ Error, Code string }; _ = json.NewDecoder(res.Body).Decode(&e); return &APIError{Status: res.StatusCode, Message: e.Error, Code: e.Code, RequestID: res.Header.Get("X-Request-ID")} }
  if out != nil { return json.NewDecoder(res.Body).Decode(out) }; return nil
}
func (c *Client) Health(ctx context.Context) (map[string]any, error) { var out map[string]any; return out, c.do(ctx, http.MethodGet, "/api/v1/platform/health", nil, &out) }
func (c *Client) Plans(ctx context.Context) ([]map[string]any, error) { var out []map[string]any; return out, c.do(ctx, http.MethodGet, "/api/v1/catalog/plans", nil, &out) }
func (c *Client) Organizations(ctx context.Context) (map[string]any, error) { var out map[string]any; return out, c.do(ctx, http.MethodGet, "/api/v1/organizations", nil, &out) }
