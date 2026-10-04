# Seven Industry Planes — Overview

Q Core contains exactly seven industry execution planes. These are NOT
seven independent products. They are industry-specific configurations,
workflows, policies, and evidence mappings built over a common Q Core.

## Architecture

```
Common Q Core
      ↓
Industry Plane (one of seven)
      ↓
Industry Policies
      ↓
Industry Assets
      ↓
Industry Security Workflows
      ↓
Industry Evidence / Reporting
```

## Industry Planes

| # | Industry | Directory | Key Compliance Frameworks |
|---|---|---|---|
| 1 | Banking / Financial Services | `industries/banking/` | PCI DSS, SOX, FFIEC, BCBS 239 |
| 2 | Healthcare | `industries/healthcare/` | HIPAA, HITECH, GDPR |
| 3 | Government / Public Sector | `industries/government/` | FISMA, NIST RMF, FedRAMP, CJIS |
| 4 | Telecom | `industries/telecom/` | SOC 2, ISO 27001, GDPR, ePrivacy |
| 5 | Energy / Critical Infrastructure | `industries/energy/` | NERC CIP, NIS, NIST CSF, ISO 27001 |
| 6 | Insurance | `industries/insurance/` | PCI DSS, SOX, GDPR, Solvency II |
| 7 | Education / Research | `industries/education/` | FERPA, GDPR, ISO 27001, NIST CSF |

## Industry Plane Structure

Each industry plane contains:

```
industries/<industry>/
├── README.md                 # Industry purpose and scope
├── assets.md                 # Asset model
├── threats.md               # Threat model
├── policies.md              # Industry-specific policies
├── risk.md                  # Risk model
├── workflows.md             # Security workflows
├── controls.md              # Industry-specific controls
├── compliance.md            # Compliance/control mappings
├── integrations.md          # Industry integrations
└── deployment.md            # Deployment templates
```

## Industry Plane Contracts

Each industry plane defines:

- **Asset model:** What assets are tracked
- **Threat model:** Industry-specific threats
- **Risk model:** Risk scoring methodology
- **Policies:** Industry-specific policy extensions
- **Workflows:** Industry-specific security workflows
- **Controls:** Industry-specific security controls
- **Compliance mappings:** Framework alignment
- **Integrations:** Industry-specific tool integrations
- **Reporting:** Industry-specific report templates

## Common Q Core Services (shared by all industries)

- Trust boundary validation (22 checks)
- Authority / policy evaluation
- Transaction state machine
- ML-DSA-87 + Ed25519 receipt signing
- Append-only audit ledger
- Independent verification
- Tenant isolation
- PQ cryptography (ML-KEM, ML-DSA)
- AER-KEP-Q epoch management

## Industry Intelligence Consumption

Each industry plane defines which intelligence categories it consumes:

| Industry | Key Intelligence Categories |
|---|---|
| Banking | Fraud infrastructure, payment-system exposure, credential theft, supply-chain compromise |
| Healthcare | PHI exposure, medical-device vulnerabilities, ransomware, HIPAA breach patterns |
| Government | APT activity, nation-state infrastructure, classified-data exposure, CUI risks |
| Telecom | Network infrastructure exposure, 5G/SS7 vulnerabilities, carrier-grade attacks |
| Energy | OT/ICS exposure, grid infrastructure, industrial control vulnerabilities |
| Insurance | Claims-fraud patterns, regulatory exposure, third-party risk |
| Education | Student-data exposure, research-data risks, FERPA breach patterns |

## Do NOT Duplicate

Industry planes MUST NOT duplicate:

- Core cryptographic implementations
- Transaction state machine
- Trust boundary validation
- Receipt signing
- Ledger format
- Audit logging
- Tenant isolation
- PQ cryptography
- AER-KEP-Q

Industry planes consume these as services, not copies.
