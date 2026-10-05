#!/usr/bin/env python3
"""Black-box contract smoke test against a running control plane.

Usage:
  CONTROL_PLANE_BASE_URL=http://127.0.0.1:18080 \
  CONTROL_PLANE_USERNAME=contract@example.com \
  CONTROL_PLANE_PASSWORD='12+ character password' \
  python3 scripts/control_plane_contract_test.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("CONTROL_PLANE_BASE_URL", "http://127.0.0.1:8080").rstrip("/")
USERNAME = os.environ.get("CONTROL_PLANE_USERNAME")
PASSWORD = os.environ.get("CONTROL_PLANE_PASSWORD")


def request(method: str, path: str, token: str | None = None, body: dict | None = None) -> tuple[int, dict, str | None]:
    payload = json.dumps(body).encode() if body is not None else None
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{BASE}{path}", data=payload, headers=headers, method=method)
    
    def extract_new_token(response_headers) -> str | None:
        new_auth = response_headers.get("Authorization-New-Token")
        if new_auth and new_auth.startswith("Bearer "):
            return new_auth[len("Bearer "):]
        return None

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            raw = response.read().decode()
            return response.status, json.loads(raw) if raw else {}, extract_new_token(response.headers)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        return exc.code, json.loads(raw) if raw else {}, extract_new_token(exc.headers)


def expect(status: int, expected: int, label: str) -> None:
    if status != expected:
        raise AssertionError(f"{label}: expected HTTP {expected}, got {status}")


def main() -> int:
    status, _, _ = request("GET", "/api/v1/platform/health")
    expect(status, 200, "health")
    status, _, _ = request("GET", "/api/v1/catalog/plans")
    expect(status, 200, "plans")

    if not USERNAME or not PASSWORD:
        raise SystemExit("CONTROL_PLANE_USERNAME and CONTROL_PLANE_PASSWORD are required")

    status, login, new_token = request("POST", "/api/v1/auth/login", body={"username": USERNAME, "password": PASSWORD})
    expect(status, 200, "login")
    token = new_token or login.get("token")
    if not token:
        raise AssertionError("login response did not contain a session token")

    status, me, new_token = request("GET", "/api/v1/me", token)
    expect(status, 200, "me")
    token = new_token or token
    if me.get("username") != USERNAME:
        raise AssertionError("authenticated principal mismatch")

    status, created, new_token = request("POST", "/api/v1/organizations", token, {"name": "P1 Contract Organization"})
    expect(status, 201, "organization create")
    token = new_token or token
    org = created.get("organization", {})
    org_id = org.get("id")
    if not org_id:
        raise AssertionError("organization create did not return an id")

    checks = [
        f"/api/v1/organizations/{org_id}",
        f"/api/v1/organizations/{org_id}/entitlements",
        f"/api/v1/organizations/{org_id}/subscription",
        f"/api/v1/organizations/{org_id}/usage",
        f"/api/v1/organizations/{org_id}/members",
        f"/api/v1/organizations/{org_id}/invitations",
        f"/api/v1/organizations/{org_id}/security/posture",
        f"/api/v1/organizations/{org_id}/findings",
        f"/api/v1/organizations/{org_id}/incidents",
        f"/api/v1/organizations/{org_id}/transactions",
        f"/api/v1/organizations/{org_id}/aer-kep-q/status",
    ]
    for path in checks:
        status, _, new_token = request("GET", path, token)
        expect(status, 200, path)
        token = new_token or token

    status, _, _ = request("POST", f"/api/v1/organizations/{org_id}/transactions", token, {
        "transaction_id": "p1-contract-transaction",
        "tenant_id": org_id,
        "state": "COMPLETED",
        "kind": "contract-test",
        "subject_id": USERNAME,
        "proposed_action": "contract-test",
        "policy_id": "p1-contract",
        "policy_version": "1",
        "created_at_ms": 1,
        "updated_at_ms": 1,
    })
    expect(status, 200, "transaction ingest")

    print("P1 running-control-plane contract test passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
