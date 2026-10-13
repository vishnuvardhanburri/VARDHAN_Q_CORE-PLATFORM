import hashlib
import hmac
import time
from typing import Any, Dict, Optional
import requests

class QCoreClient:
    def __init__(self, base_url: str = "http://localhost:8080", api_key: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        if api_key:
            self.session.headers.update({"Authorization": f"Bearer {api_key}"})

    def _request(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        headers = {"Idempotency-Key": idempotency_key} if idempotency_key else {}
        response = self.session.request(method, f"{self.base_url}{path}", json=payload, headers=headers, timeout=30)
        try: body = response.json()
        except ValueError: body = {"message": response.text}
        if not response.ok: raise RuntimeError(body.get("error") or body.get("message") or f"Q-Core API Error: {response.status_code}")
        return body

    def seal_transaction(self, contract: Dict[str, Any], actor_workload_id: str = "", idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        return self._request("POST", "/api/v1/seal", {"contract": contract, "actor_workload_id": actor_workload_id}, idempotency_key)
    def me(self) -> Dict[str, Any]: return self._request("GET", "/api/v1/me")
    def organizations(self) -> Dict[str, Any]: return self._request("GET", "/api/v1/organizations")
    def create_organization(self, name: str, idempotency_key: Optional[str] = None) -> Dict[str, Any]: return self._request("POST", "/api/v1/organizations", {"name": name}, idempotency_key)
    def members(self, organization_id: str) -> Dict[str, Any]: return self._request("GET", f"/api/v1/organizations/{organization_id}/members")
    def invitations(self, organization_id: str) -> Dict[str, Any]: return self._request("GET", f"/api/v1/organizations/{organization_id}/invitations")
    def create_invitation(self, organization_id: str, email: str, role: str = "viewer", idempotency_key: Optional[str] = None) -> Dict[str, Any]: return self._request("POST", f"/api/v1/organizations/{organization_id}/invitations", {"email": email, "role": role}, idempotency_key)
    def security_posture(self, organization_id: str) -> Dict[str, Any]: return self._request("GET", f"/api/v1/organizations/{organization_id}/security/posture")
    def findings(self, organization_id: str) -> Dict[str, Any]: return self._request("GET", f"/api/v1/organizations/{organization_id}/findings")
    def incidents(self, organization_id: str) -> Dict[str, Any]: return self._request("GET", f"/api/v1/organizations/{organization_id}/incidents")
    def transactions(self, organization_id: str) -> Dict[str, Any]: return self._request("GET", f"/api/v1/organizations/{organization_id}/transactions")
    def aer_kep_q_status(self, organization_id: str) -> Dict[str, Any]: return self._request("GET", f"/api/v1/organizations/{organization_id}/aer-kep-q/status")

    @staticmethod
    def verify_webhook(raw_body: str, signature_hex: str, secret: str, timestamp: str, nonce: str, max_skew_seconds: int = 300) -> bool:
        try:
            ts = int(timestamp)
            if abs(int(time.time() * 1000) - ts) > max_skew_seconds * 1000: return False
            expected = hmac.new(secret.encode(), f"{timestamp}.{nonce}.{raw_body}".encode(), hashlib.sha256).hexdigest()
            return hmac.compare_digest(expected, signature_hex)
        except (TypeError, ValueError): return False
