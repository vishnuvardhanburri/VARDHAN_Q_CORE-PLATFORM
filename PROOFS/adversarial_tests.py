import requests
import json
import sys

API_URL = "http://localhost:8080/api/v1/seal"

def test_case(name, payload, expected_code, description):
    print(f"Testing {name}...")
    try:
        resp = requests.post(API_URL, json=payload)
        data = resp.json()
        if resp.status_code == 400 and data.get("code") == expected_code:
            print(f"  ✅ PASS: {description} (Got {expected_code})")
            return True
        else:
            print(f"  ❌ FAIL: {description} (Got {resp.status_code} - {data})")
            return False
    except Exception as e:
        print(f"  ❌ ERROR: {e}")
        return False

# Base valid contract template
def get_contract(finding_id, tenant_id="org-sc-01"):
    return {
        "schema_version": "1.0",
        "finding_id": finding_id,
        "intelligence": {"engine_id": "engine-v2", "engine_version": "2.0.0", "run_id": "run-1"},
        "organization": {"organization_id": tenant_id, "canonical_domain": "sc.com"},
        "affected_resource": {"canonical_url": "https://sc.com", "surface_type": "WEBSITE", "entry_point_id": "ep-1"},
        "technical_area": "CRYPTOGRAPHIC_EXPOSURE",
        "technical_mechanism": "RSA-2048",
        "expected_behavior": "Quantum-Resistant",
        "observed_behavior": "Quantum-Vulnerable",
        "differential_state": "CONFIRMED_MISMATCH",
        "materiality": "HIGH",
        "evidence_refs": [{"evidence_id": "ev-1", "public_url": "https://sc.com/", "temporal_status": "CURRENT", "is_context_artifact": False, "evidence_origin": "web-research", "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}],
        "provenance_chain": {"expectation_id": "exp-1", "observation_ids": ["obs-1"], "differential_id": "diff-1", "hypothesis_id": "hyp-1", "verification_contract_id": "verif-1"},
        "contradictory_evidence_ids": [],
        "uncertainty": [],
        "benign_explanation": "",
        "authorization_context": {"requires_authorized_assessment": False},
        "decision_candidate": "SEAL_VERIFIED_FINDING",
        "policy_reference": "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
        "created_at": "2026-10-14T00:00:00Z",
        "evidence_earliest_retrieved_at": "2026-10-14T00:00:00Z",
        "evidence_latest_retrieved_at": "2026-10-14T00:00:00Z",
    }

def run_all():
    # 1. Replay Attack (Requires two identical requests)
    fid_replay = "FIND-REPLAY-001"
    print("Establishing initial seal for replay test...")
    requests.post(API_URL, json={"contract": get_contract(fid_replay), "actor_workload_id": "intelligence-plane-orchestrator"})
    
    print("Testing Replay Attack...")
    test_case("Replay Attack", 
              {"contract": get_contract(fid_replay), "actor_workload_id": "intelligence-plane-orchestrator"}, 
              "REJECTED_REPLAY", "Should reject duplicate finding_id")

    # 2. Unknown Tenant
    fid_tenant = "FIND-TENANT-001"
    test_case("Unknown Tenant", 
              {"contract": get_contract(fid_tenant, "org-unknown-evil"), "actor_workload_id": "intelligence-plane-orchestrator"}, 
              "DENY_TENANT_UNKNOWN", "Should reject unregistered tenant")

    # 3. Unauthorized Actor
    fid_actor = "FIND-ACTOR-001"
    test_case("Unauthorized Actor", 
              {"contract": get_contract(fid_actor), "actor_workload_id": "rogue-workload-01"}, 
              "DENY_ACTOR_NOT_AUTHORIZED", "Should reject unauthorized workload prefix")

if __name__ == "__main__":
    run_all()
