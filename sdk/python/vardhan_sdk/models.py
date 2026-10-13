from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

@dataclass(frozen=True)
class Plan:
    id: str; name: str; tier: str; contact_sales: bool; entitlements: list[str]

@dataclass(frozen=True)
class Organization:
    id: str; name: str; owner: str; created_at_ms: int

@dataclass(frozen=True)
class Subscription:
    organization_id: str; plan_id: str; status: str; provider: str
    external_customer_id: Optional[str] = None; external_subscription_id: Optional[str] = None

@dataclass(frozen=True)
class Usage:
    organization_id: str; transactions: int; bytes_processed: int

@dataclass(frozen=True)
class EntitlementResponse:
    organization_id: str; subscription_status: str; entitlements: list[str]; activation: str
    plan: Optional[Plan] = None; provider: Optional[str] = None
