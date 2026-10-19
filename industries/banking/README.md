# Industry Plane: Banking / Financial Services

## Purpose

Banking/FinancialServices industry execution plane over Common Q Core.

Handles: fraud infrastructure detection, payment-system exposure, credential
theft, supply-chain compromise in banking context.

## Compliance Frameworks

- PCI DSS 4.0
- SOX
- FFIEC
- BCBS 239 (risk data aggregation)
- ISO 20022
- BASEL III

## Asset Model

| Asset Type | Examples |
|---|---|
| Payment Systems | SWIFT, Fedwire, SEPA, card networks |
| Banking Applications | Online banking portals, mobile apps |
| Core Banking | Core banking platforms, APIs |
| Customer Data | PII, financial accounts, transaction history |
| Third-Party Services | Payment processors, KYC providers |

## Threat Model

| Threat | Initial Access Vector |
|---|---|
| Payment-card skimming | Exposed payment terminal / POS |
| ATM malware | Physical access to ATM systems |
| SWIFT network compromise | Exposed SWIFT gateway |
| Account takeover (ATO) | Stolen credentials, phishing |
| Business email compromise (BEC) | Email account exposure |
| Supply-chain attack | Third-party vendor compromise |
| Insider fraud | Privileged access abuse |

## Risk Model

| Factor | Weight |
|---|---|
| Financial impact | High |
| Regulatory exposure | High |
| Reputation impact | High |
| Data sensitivity | High |
| Recovery cost | Medium |

## Workflows

- Daily payment-system exposure scan
- Weekly third-party risk assessment
- Monthly ATM/endpoint integrity check
- Quarterly PCI DSS compliance validation

## Controls

- Real-time transaction monitoring
- Fraud detection integration
- PCI DSS network segmentation
- Privileged access management (PAM)
- Key management (HSM-backed)

## Mapping to Common Q Core

| Industry Need | Common Q Core Service |
|---|---|
| Transaction integrity | Transaction state machine |
| Non-repudiation | ML-DSA-87 + Ed25519 receipts |
| Audit trail | Append-only audit ledger |
| Key protection | Key lifecycle (HSM/KMS) |
| Evidence hashing | Full SHA-256 in EvidenceLedger |
| Idempotency | Persistent idempotency store |

## Intelligence Consumption

- Credential theft indicators
- Payment-system vulnerability feeds
- Fraud infrastructure (phishing, SMShing)
- Third-party vendor risk scores
- SWIFT network exposure
