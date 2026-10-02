#!/bin/bash
./target/debug/vardhan-receipt serve --port 8080 &
SERVER_PID=$!
sleep 1

curl -s -X POST http://localhost:8080/api/v1/seal \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "8ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "finding_id": "F-9999-API-CALL",
    "provenance": {
        "source_identity": "Agent-Alpha",
        "timestamp": "2026-10-03T12:00:00Z",
        "version": "1.0"
    },
    "evidence_package": {
        "evidence_id": "EV-001",
        "data_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "category": "NETWORK_SCAN"
    },
    "decision_candidate": {
        "action_type": "BLOCK_PUBLIC_ACCESS",
        "policy_reference": "POL-CLOUD-01"
    }
}' | jq '.'

kill $SERVER_PID
