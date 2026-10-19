#!/usr/bin/env python3
"""Validate the seven executable industry-plane contracts without external dependencies."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDUSTRIES = ("banking", "healthcare", "government", "telecom", "energy", "insurance", "education")
REQUIRED_LISTS = ("compliance", "assets", "threats", "policies", "workflows", "controls", "integrations", "qcore_services")
REQUIRED_QCORE = {
    "trust_boundary", "authority_policy", "transaction_state", "signed_receipt",
    "audit_ledger", "independent_verification", "pq_crypto", "aer_kep_q",
}


def load_plane(industry: str) -> dict:
    path = ROOT / "industries" / industry / "plane.json"
    if not path.is_file():
        raise AssertionError(f"missing executable plane contract: {path}")
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    if data.get("schema_version") != 1:
        raise AssertionError(f"{industry}: unsupported schema_version")
    if data.get("industry") != industry:
        raise AssertionError(f"{industry}: industry identifier mismatch")
    if not data.get("name"):
        raise AssertionError(f"{industry}: missing name")
    for field in REQUIRED_LISTS:
        value = data.get(field)
        if not isinstance(value, list) or not value or any(not isinstance(x, str) or not x.strip() for x in value):
            raise AssertionError(f"{industry}: {field} must be a non-empty string list")
        if len(value) != len(set(value)):
            raise AssertionError(f"{industry}: {field} contains duplicates")
    missing_qcore = REQUIRED_QCORE.difference(data["qcore_services"])
    if missing_qcore:
        raise AssertionError(f"{industry}: missing common Q-Core services: {sorted(missing_qcore)}")

    risk = data.get("risk")
    if not isinstance(risk, dict) or not isinstance(risk.get("factors"), list) or not isinstance(risk.get("weights"), dict):
        raise AssertionError(f"{industry}: invalid risk model")
    factors = set(risk["factors"])
    weights = risk["weights"]
    if factors != set(weights):
        raise AssertionError(f"{industry}: risk factors and weights differ")
    if len(factors) < 5:
        raise AssertionError(f"{industry}: risk model must contain at least five factors")
    if any(not isinstance(v, int) or not 1 <= v <= 5 for v in weights.values()):
        raise AssertionError(f"{industry}: risk weights must be integers from 1 to 5")

    deployment = data.get("deployment")
    if not isinstance(deployment, dict) or not deployment.get("modes") or deployment.get("telemetry") != "tenant_bound_qcore":
        raise AssertionError(f"{industry}: invalid deployment contract")
    if deployment.get("requires_hsm_for_private_keys") is not True:
        raise AssertionError(f"{industry}: private-key protection must require HSM/KMS")
    return data


def validate() -> None:
    planes = [load_plane(industry) for industry in INDUSTRIES]
    names = [plane["name"] for plane in planes]
    if len(names) != len(set(names)):
        raise AssertionError("industry plane names must be unique")
    print(f"validated {len(planes)} industry planes: {', '.join(INDUSTRIES)}")


if __name__ == "__main__":
    validate()
