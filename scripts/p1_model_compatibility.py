#!/usr/bin/env python3
"""Verify first-party SDK model fields stay aligned with canonical OpenAPI schemas."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SDK_ROOTS = [ROOT / "sdk/typescript", ROOT / "sdk/python", ROOT / "sdk/go", ROOT / "sdk/rust", ROOT / "sdk/java"]
CANONICAL_FIELDS = {
    "Organization": {"id", "name", "owner", "created_at_ms"},
    "Subscription": {"organization_id", "plan_id", "status", "provider", "external_customer_id", "external_subscription_id"},
    "Usage": {"organization_id", "transactions", "bytes_processed"},
    "Plan": {"id", "name", "tier", "contact_sales", "entitlements"},
}


def text(root: Path) -> str:
    return "\n".join(p.read_text(encoding="utf-8", errors="ignore") for p in root.rglob("*") if p.is_file() and p.suffix in {".ts", ".py", ".go", ".rs", ".java"})


def main() -> int:
    failed = False
    for root in SDK_ROOTS:
        content = text(root)
        missing = sorted({field for fields in CANONICAL_FIELDS.values() for field in fields if field not in content})
        if missing:
            print(f"{root.relative_to(ROOT)}: missing canonical model fields: {', '.join(missing)}")
            failed = True
    if failed:
        return 1
    print("P1 generated-model compatibility field gate passed for 5 SDKs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
