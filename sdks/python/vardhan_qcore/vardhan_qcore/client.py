import requests
import json
from typing import Dict, Any, Optional

class QCoreClient:
    def __init__(self, base_url: str = "http://localhost:8080", api_key: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.session = requests.Session()
        if self.api_key:
            self.session.headers.update({"Authorization": f"Bearer {self.api_key}"})
        self.session.headers.update({"Content-Type": "application/json"})

    def seal_transaction(self, tenant_id: str, finding_id: str, actor: str, action: str, policy: str, evidence_id: str, data_hash: str) -> Dict[str, Any]:
        """
        Submits an operation to the Q-Core substrate for authority evaluation and cryptographic sealing.
        """
        payload = {
            "tenant_id": tenant_id,
            "finding_id": finding_id,
            "provenance": {
                "source_identity": actor,
                "timestamp": "2026-10-03T12:00:00Z", # In production, use current ISO time
                "version": "1.0"
            },
            "evidence_package": {
                "evidence_id": evidence_id,
                "data_hash": data_hash,
                "category": "SDK_SUBMISSION"
            },
            "decision_candidate": {
                "action_type": action,
                "policy_reference": policy
            }
        }

        response = self.session.post(f"{self.base_url}/api/v1/seal", json=payload)
        
        if not response.ok:
            raise Exception(f"Q-Core API Error: {response.status_code} - {response.text}")
            
        return response.json()
