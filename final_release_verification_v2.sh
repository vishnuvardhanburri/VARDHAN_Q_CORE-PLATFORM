#!/bin/bash
set -e

export VARDHAN_CONTROL_PLANE_DATA_DIR="./control_plane_data_final_v2"
export VARDHAN_ADMIN_USERNAME="admin"
echo "strong-password-12345" > admin_pass_v2.txt
export VARDHAN_ADMIN_PASSWORD_FILE="./admin_pass_v2.txt"
export VARDHAN_NODE_ID="control-plane-final"
mkdir -p $VARDHAN_CONTROL_PLANE_DATA_DIR

./target/release/control_plane_api & 
API_PID=$!
sleep 5

# Function to get a fresh token
get_token() {
  curl -s -X POST http://localhost:8080/api/v1/auth/login \
       -H "Content-Type: application/json" \
       -d '{"username": "admin", "password": "strong-password-12345"}' | \
       grep -o '"token":"[^"]*' | cut -d'"' -f4
}

TOKEN=$(get_token)
echo "Initial Token: $TOKEN"

# Define a unique contract
cat << 'INNER_EOF' > final_static_contract_unique_v2.json
{
  "contract": {
    "schema_version": "1.0",
    "finding_id": "find-unique-final-v2",
    "intelligence": { "engine_id": "engine-v2", "engine_version": "2.0.0", "run_id": "run-1" },
    "organization": { "organization_id": "org-vardhan-intelligence", "canonical_domain": "vardhan.org" },
    "affected_resource": { "canonical_url": "https://api.vardhan.org", "surface_type": "API_REST", "entry_point_id": "ep-1" },
    "technical_area": "STATIC_ANALYSIS",
    "technical_mechanism": "SQLi",
    "expected_behavior": "safe",
    "observed_behavior": "vulnerable",
    "differential_state": "CONFIRMED_MISMATCH",
    "materiality": "HIGH",
    "evidence_refs": [{
      "evidence_id": "ev-1",
      "public_url": "https://evidence.org",
      "temporal_status": "CURRENT",
      "is_context_artifact": false,
      "evidence_origin": "scan",
      "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    }],
    "provenance_chain": {
      "expectation_id": "exp-1",
      "observation_ids": ["obs-1"],
      "differential_id": "diff-1",
      "hypothesis_id": "hyp-1",
      "verification_contract_id": "verif-1"
    },
    "contradictory_evidence_ids": [],
    "uncertainty": [],
    "benign_explanation": "",
    "authorization_context": { "requires_authorized_assessment": false },
    "decision_candidate": "SEAL_VERIFIED_FINDING",
    "policy_reference": "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
    "created_at": "2026-10-13T12:00:00Z",
    "evidence_earliest_retrieved_at": "2026-10-13T11:00:00Z",
    "evidence_latest_retrieved_at": "2026-10-13T11:30:00Z"
  },
  "actor_workload_id": "svc:vardhan-intelligence:test-01"
}
INNER_EOF

echo -e "\n--- [GATE 1] Sealing ---"
curl -s -X POST http://localhost:8080/api/v1/organizations/org-vardhan-intelligence/security/validate \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -d @final_static_contract_unique_v2.json

echo -e "\n\n--- [GATE 2] Replay ---"
# Refresh token just in case
TOKEN=$(get_token)
curl -s -X POST http://localhost:8080/api/v1/organizations/org-vardhan-intelligence/security/validate \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -d @final_static_contract_unique_v2.json

echo -e "\n\n--- [GATE 3] Malformed ---"
TOKEN=$(get_token)
curl -s -X POST http://localhost:8080/api/v1/organizations/org-vardhan-intelligence/security/validate \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"contract": {"schema_version": "bad"}, "actor_workload_id": "test"}'

kill $API_PID
rm admin_pass_v2.txt
