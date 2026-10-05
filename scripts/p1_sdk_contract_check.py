#!/usr/bin/env python3
"""Static P1 contract gate for all first-party SDKs."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
OPENAPI = ROOT / "api/openapi.yaml"
SDK_ROOTS = {
    "typescript": ROOT / "sdk/typescript",
    "python": ROOT / "sdk/python",
    "go": ROOT / "sdk/go",
    "rust": ROOT / "sdk/rust",
    "java": ROOT / "sdk/java",
}
REQUIRED_RESOURCE_SUFFIXES = [
    "/organizations", "/organizations/{id}", "/organizations/{id}/entitlements",
    "/organizations/{id}/subscription", "/organizations/{id}/usage",
    "/organizations/{id}/members", "/organizations/{id}/invitations",
    "/organizations/{id}/security/posture", "/organizations/{id}/findings",
    "/organizations/{id}/incidents", "/organizations/{id}/transactions",
    "/organizations/{id}/aer-kep-q/status",
]


def source_text(root: Path) -> str:
    return "\n".join(
        p.read_text(encoding="utf-8", errors="ignore")
        for p in root.rglob("*")
        if p.is_file() and p.suffix in {".ts", ".py", ".go", ".rs", ".java"}
    )


def has_resource(text: str, path: str) -> bool:
    if path in text:
        return True
    if path == "/organizations/{id}":
        return "/organizations/" in text
    suffix = path.split("/organizations/{id}", 1)[-1]
    return bool(suffix) and suffix in text


def main() -> int:
    openapi = OPENAPI.read_text(encoding="utf-8")
    canonical_paths = re.findall(r"^  (/[^:]+):$", openapi, re.MULTILINE)
    missing_contract_paths = [p for p in REQUIRED_RESOURCE_SUFFIXES if p not in canonical_paths]
    if missing_contract_paths:
        print("OpenAPI missing required P1 paths:", *missing_contract_paths, sep="\n  ")
        return 1

    failed = False
    for name, root in SDK_ROOTS.items():
        text = source_text(root)
        lowered = text.lower()
        if "idempotency-key" not in lowered:
            print(f"{name}: missing Idempotency-Key helper")
            failed = True
        if not any(marker in lowered for marker in ("verifywebhooksignature", "verify_webhook_signature", "hmacsha256", "hmac<sha256>")):
            print(f"{name}: missing webhook signature verification helper")
            failed = True
        for path in REQUIRED_RESOURCE_SUFFIXES:
            if not has_resource(text, path):
                print(f"{name}: missing SDK resource coverage for {path}")
                failed = True
    if failed:
        return 1
    print(f"P1 SDK contract gate passed for {len(SDK_ROOTS)} SDKs and {len(REQUIRED_RESOURCE_SUFFIXES)} enterprise resource families.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
