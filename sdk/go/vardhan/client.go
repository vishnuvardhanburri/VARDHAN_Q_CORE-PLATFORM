package vardhan

import (
  "bytes"
  "context"
  "crypto/hmac"
  "crypto/rand"
  "crypto/sha256"
  "encoding/hex"
  "encoding/json"
  "fmt"
  "io"
  "net/http"
  "strings"
  "time"
)

type Client struct { BaseURL, Token string; HTTPClient *http.Client; MaxRetries int }
type APIError struct { Status int; Message, Code, RequestID string }
func (e *APIError) Error() string { return fmt.Sprintf("vardhan api error %d: %s", e.Status, e.Message) }
type RequestOptions struct { IdempotencyKey, CorrelationID string }

func New(baseURL, token string) *Client { return &Client{BaseURL: strings.TrimRight(baseURL, "/"), Token: token, HTTPClient: &http.Client{Timeout: 15*time.Second}, MaxRetries: 2} }
func NewIdempotencyKey() string { var b [16]byte; if _, err := rand.Read(b[:]); err != nil { panic("secure random source unavailable") }; return hex.EncodeToString(b[:]) }
func VerifyWebhookSignature(secret string, body []byte, signatureHex string) bool { supplied, err := hex.DecodeString(strings.TrimSpace(signatureHex)); if err != nil { return false }; mac := hmac.New(sha256.New, []byte(secret)); _, _ = mac.Write(body); return hmac.Equal(mac.Sum(nil), supplied) }

func (c *Client) do(ctx context.Context, method, path string, body any, out any, opts RequestOptions) error {
  var data []byte; var err error
  if body != nil { data, err = json.Marshal(body); if err != nil { return err } }
  for attempt := 0; ; attempt++ {
    req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, bytes.NewReader(data)); if err != nil { return err }
    req.Header.Set("Accept", "application/json"); req.Header.Set("X-Vardhan-SDK", "go/0.3.0")
    if data != nil { req.Header.Set("Content-Type", "application/json") }; if c.Token != "" { req.Header.Set("Authorization", "Bearer "+c.Token) }
    if opts.IdempotencyKey != "" { req.Header.Set("Idempotency-Key", opts.IdempotencyKey) }; if opts.CorrelationID != "" { req.Header.Set("X-Correlation-ID", opts.CorrelationID) }
    res, err := c.HTTPClient.Do(req); if err != nil { if attempt < c.MaxRetries { time.Sleep(time.Duration(250*(1<<attempt))*time.Millisecond); continue }; return err }
    raw, readErr := io.ReadAll(res.Body); res.Body.Close(); if readErr != nil { return readErr }
    if (res.StatusCode == http.StatusTooManyRequests || res.StatusCode >= 500) && attempt < c.MaxRetries { delay := 250 * (1 << attempt); if v := res.Header.Get("Retry-After"); v != "" { if d, e := time.ParseDuration(v+"s"); e == nil { delay = int(d / time.Millisecond) } }; if delay > 5000 { delay = 5000 }; time.Sleep(time.Duration(delay)*time.Millisecond); continue }
    if res.StatusCode < 200 || res.StatusCode >= 300 { var e struct{ Error, Code string }; _ = json.Unmarshal(raw, &e); return &APIError{Status: res.StatusCode, Message: e.Error, Code: e.Code, RequestID: res.Header.Get("X-Request-ID")} }
    if out != nil && len(raw) > 0 { return json.Unmarshal(raw, out) }; return nil
  }
}
func (c *Client) Health(ctx context.Context) (map[string]any, error) { var out map[string]any; return out, c.do(ctx,http.MethodGet,"/api/v1/platform/health",nil,&out,RequestOptions{}) }
func (c *Client) Me(ctx context.Context) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodGet,"/api/v1/me",nil,&out,RequestOptions{}) }
func (c *Client) Plans(ctx context.Context) ([]map[string]any,error) { var out []map[string]any; return out,c.do(ctx,http.MethodGet,"/api/v1/catalog/plans",nil,&out,RequestOptions{}) }
func (c *Client) Organizations(ctx context.Context) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodGet,"/api/v1/organizations",nil,&out,RequestOptions{}) }
func (c *Client) CreateOrganization(ctx context.Context,name string,opts RequestOptions) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodPost,"/api/v1/organizations",map[string]string{"name":name},&out,opts) }
func (c *Client) Organization(ctx context.Context,id string) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodGet,"/api/v1/organizations/"+id,nil,&out,RequestOptions{}) }
func (c *Client) Entitlements(ctx context.Context,id string) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodGet,"/api/v1/organizations/"+id+"/entitlements",nil,&out,RequestOptions{}) }
func (c *Client) Subscription(ctx context.Context,id string) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodGet,"/api/v1/organizations/"+id+"/subscription",nil,&out,RequestOptions{}) }
func (c *Client) RequestPlan(ctx context.Context,id,plan string,opts RequestOptions) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodPost,"/api/v1/organizations/"+id+"/subscription",map[string]string{"plan_id":plan},&out,opts) }
func (c *Client) Usage(ctx context.Context,id string) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodGet,"/api/v1/organizations/"+id+"/usage",nil,&out,RequestOptions{}) }
func (c *Client) RecordUsage(ctx context.Context,id string,transactions,bytesProcessed uint64,opts RequestOptions) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodPost,"/api/v1/organizations/"+id+"/usage/record",map[string]uint64{"transactions":transactions,"bytes_processed":bytesProcessed},&out,opts) }
func (c *Client) Members(ctx context.Context,id string) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodGet,"/api/v1/organizations/"+id+"/members",nil,&out,RequestOptions{}) }
func (c *Client) Invitations(ctx context.Context,id string) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodGet,"/api/v1/organizations/"+id+"/invitations",nil,&out,RequestOptions{}) }
func (c *Client) CreateInvitation(ctx context.Context,id string,body map[string]any,opts RequestOptions) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodPost,"/api/v1/organizations/"+id+"/invitations",body,&out,opts) }
func (c *Client) SecurityPosture(ctx context.Context,id string) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodGet,"/api/v1/organizations/"+id+"/security/posture",nil,&out,RequestOptions{}) }
func (c *Client) Findings(ctx context.Context,id string) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodGet,"/api/v1/organizations/"+id+"/findings",nil,&out,RequestOptions{}) }
func (c *Client) Incidents(ctx context.Context,id string) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodGet,"/api/v1/organizations/"+id+"/incidents",nil,&out,RequestOptions{}) }
func (c *Client) Transactions(ctx context.Context,id string) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodGet,"/api/v1/organizations/"+id+"/transactions",nil,&out,RequestOptions{}) }
func (c *Client) IngestTransaction(ctx context.Context,id string,body map[string]any,opts RequestOptions) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodPost,"/api/v1/organizations/"+id+"/transactions",body,&out,opts) }
func (c *Client) AERKEPQStatus(ctx context.Context,id string) (map[string]any,error) { var out map[string]any; return out,c.do(ctx,http.MethodGet,"/api/v1/organizations/"+id+"/aer-kep-q/status",nil,&out,RequestOptions{}) }
