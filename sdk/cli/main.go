package main

import (
  "encoding/json"
  "fmt"
  "net/http"
  "os"
  "strings"
)

func main() {
  if len(os.Args) < 2 { usage(); os.Exit(2) }
  base := strings.TrimRight(os.Getenv("VARDHAN_API_URL"), "/")
  token := os.Getenv("VARDHAN_API_TOKEN")
  if base == "" { fmt.Fprintln(os.Stderr, "VARDHAN_API_URL is required"); os.Exit(2) }
  path := map[string]string{"health":"/api/v1/platform/health", "plans":"/api/v1/catalog/plans", "me":"/api/v1/me"}[os.Args[1]]
  if path == "" { usage(); os.Exit(2) }
  req, _ := http.NewRequest(http.MethodGet, base+path, nil); req.Header.Set("Accept", "application/json"); req.Header.Set("X-Vardhan-CLI", "0.1.0")
  if token != "" { req.Header.Set("Authorization", "Bearer "+token) }
  res, err := http.DefaultClient.Do(req); if err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }; defer res.Body.Close()
  if res.StatusCode < 200 || res.StatusCode >= 300 { fmt.Fprintf(os.Stderr, "Vardhan API returned %d\n", res.StatusCode); os.Exit(1) }
  var v any; if err := json.NewDecoder(res.Body).Decode(&v); err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
  out, _ := json.MarshalIndent(v, "", "  "); fmt.Println(string(out))
}
func usage() { fmt.Println("vardhan <health|plans|me>\n\nUses VARDHAN_API_URL and VARDHAN_API_TOKEN. Credentials are never embedded.") }
