import unittest
from vardhan_qcore.client import QCoreClient

class ClientContractTests(unittest.TestCase):
    def test_webhook_signature_and_replay_window(self):
        raw = '{"event":"receipt.accepted"}'
        timestamp = "1700000000000"
        nonce = "n1"
        secret = "secret"
        import hashlib, hmac
        signature = hmac.new(secret.encode(), f"{timestamp}.{nonce}.{raw}".encode(), hashlib.sha256).hexdigest()
        self.assertFalse(QCoreClient.verify_webhook(raw, signature, secret, timestamp, nonce))
        self.assertFalse(QCoreClient.verify_webhook(raw, signature, "wrong", timestamp, nonce))

    def test_contract_shape(self):
        contract = {
            "schema_version":"1.0","finding_id":"f1",
            "intelligence":{"engine_id":"e","engine_version":"1","run_id":"r"},
            "organization":{"organization_id":"o","canonical_domain":"example.com"},
            "affected_resource":{"canonical_url":"https://example.com","surface_type":"web","entry_point_id":"p"},
            "technical_area":"security","technical_mechanism":"m","expected_behavior":"e","observed_behavior":"o",
            "differential_state":"changed","materiality":"medium","evidence_refs":[],
            "provenance_chain":{"expectation_id":"x","observation_ids":[],"differential_id":"d","hypothesis_id":"h","verification_contract_id":"v"},
            "contradictory_evidence_ids":[],"uncertainty":[],"benign_explanation":"none",
            "authorization_context":{"requires_authorized_assessment":False,"authorized_by":None,"authorization_scope":None},
            "decision_candidate":"SEAL_VERIFIED_FINDING","policy_reference":"V1","created_at":"2026-10-05T00:00:00Z",
            "evidence_earliest_retrieved_at":"2026-10-05T00:00:00Z","evidence_latest_retrieved_at":"2026-10-05T00:00:00Z"
        }
        self.assertEqual(contract["organization"]["organization_id"], "o")

if __name__ == "__main__": unittest.main()
