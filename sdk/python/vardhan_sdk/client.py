from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


class VardhanApiError(RuntimeError):
    def __init__(self, status: int, message: str, code: str | None = None, request_id: str | None = None):
        super().__init__(message); self.status = status; self.code = code; self.request_id = request_id


@dataclass(frozen=True)
class Vardhan:
    base_url: str
    token: str | None = None
    timeout: float = 15.0
    max_retries: int = 2

    def _request(self, path: str, method: str = "GET", body: dict[str, Any] | None = None,
                 idempotency_key: str | None = None, correlation_id: str | None = None) -> Any:
        headers = {"Accept": "application/json", "X-Vardhan-SDK": "python/0.2.0"}
        if self.token: headers["Authorization"] = f"Bearer {self.token}"
        if idempotency_key: headers["Idempotency-Key"] = idempotency_key
        if correlation_id: headers["X-Correlation-ID"] = correlation_id
        data = json.dumps(body).encode() if body is not None else None
        if data: headers["Content-Type"] = "application/json"
        attempt = 0
        while True:
            req = urllib.request.Request(self.base_url.rstrip("/") + path, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as response:
                    raw = response.read(); return json.loads(raw.decode()) if raw else None
            except urllib.error.HTTPError as exc:
                if exc.code == 429 or exc.code >= 500:
                    if attempt < self.max_retries:
                        retry_after = exc.headers.get("retry-after")
                        delay = min(float(retry_after), 5.0) if retry_after and retry_after.isdigit() else min(0.25 * (2 ** attempt), 5.0)
                        attempt += 1; time.sleep(delay); continue
                try: payload = json.loads(exc.read().decode())
                except Exception: payload = {}
                raise VardhanApiError(exc.code, payload.get("error", "Vardhan API request failed"), payload.get("code"), exc.headers.get("x-request-id")) from exc

    def health(self): return self._request("/api/v1/platform/health")
    def me(self): return self._request("/api/v1/me")
    def plans(self): return self._request("/api/v1/catalog/plans")
    def organizations(self): return self._request("/api/v1/organizations")
    def create_organization(self, name: str, **kwargs): return self._request("/api/v1/organizations", "POST", {"name": name}, **kwargs)
    def organization(self, organization_id: str): return self._request(f"/api/v1/organizations/{organization_id}")
    def entitlements(self, organization_id: str): return self._request(f"/api/v1/organizations/{organization_id}/entitlements")
    def subscription(self, organization_id: str): return self._request(f"/api/v1/organizations/{organization_id}/subscription")
    def request_plan(self, organization_id: str, plan_id: str, **kwargs): return self._request(f"/api/v1/organizations/{organization_id}/subscription", "POST", {"plan_id": plan_id}, **kwargs)
    def usage(self, organization_id: str): return self._request(f"/api/v1/organizations/{organization_id}/usage")
    def record_usage(self, organization_id: str, transactions: int, bytes_processed: int, **kwargs):
        return self._request(f"/api/v1/organizations/{organization_id}/usage/record", "POST", {"transactions": transactions, "bytes_processed": bytes_processed}, **kwargs)
