from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


class VardhanApiError(RuntimeError):
    def __init__(self, status: int, message: str, code: str | None = None, request_id: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.request_id = request_id


@dataclass(frozen=True)
class Vardhan:
    base_url: str
    token: str | None = None
    timeout: float = 15.0

    def _request(self, path: str, method: str = "GET", body: dict[str, Any] | None = None) -> Any:
        headers = {"Accept": "application/json", "X-Vardhan-SDK": "python/0.1.0"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        data = json.dumps(body).encode() if body is not None else None
        if data:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base_url.rstrip("/") + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                return json.loads(response.read().decode()) if response.length != 0 else None
        except urllib.error.HTTPError as exc:
            try:
                payload = json.loads(exc.read().decode())
            except Exception:
                payload = {}
            raise VardhanApiError(exc.code, payload.get("error", "Vardhan API request failed"), payload.get("code"), exc.headers.get("x-request-id")) from exc

    def health(self):
        return self._request("/api/v1/platform/health")

    def me(self):
        return self._request("/api/v1/me")

    def plans(self):
        return self._request("/api/v1/catalog/plans")

    def organizations(self):
        return self._request("/api/v1/organizations")

    def create_organization(self, name: str):
        return self._request("/api/v1/organizations", "POST", {"name": name})

    def entitlements(self, organization_id: str):
        return self._request(f"/api/v1/organizations/{organization_id}/entitlements")

    def usage(self, organization_id: str):
        return self._request(f"/api/v1/organizations/{organization_id}/usage")
