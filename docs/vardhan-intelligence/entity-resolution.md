# Vardhan Intelligence — Entity Resolution

## Purpose

Resolve duplicate entities across diverse data sources. Maintain canonical
entity IDs. Never silently merge uncertain entities.

## Same Entity, Different Forms

```
company.com          ← canonical domain
www.company.com      ← subdomain
mail.company.com     ← mail server
192.0.2.43           ← A record IP
AS12345              ← ASN
Certificate: *.company.com
github.com/company   ← code repository
app.company.com      ← web application
db.company.com       ← database
```

All of these may refer to the same organization/entity.

## Resolution States

| State | Confidence | Action |
|---|---|---|
| EXACT | 1.0 | Merge without human review |
| HIGH_CONFIDENCE | 0.8–0.99 | Merge, log for review |
| PROBABLE | 0.5–0.79 | Flag for manual review |
| UNCERTAIN | < 0.5 | Do NOT merge, create separate entity |

## Entity Types

| Type | Canonical Form | Examples |
|---|---|---|
| ORGANIZATION | Domain name | `company.com` |
| ASSET | Hostname | `www.company.com` |
| DOMAIN | FQDN | `company.com`, `sub.company.com` |
| IP | CIDR notation | `192.0.2.43/32` |
| CERTIFICATE | SHA-256 fingerprint | `a1b2c3...` |
| REPOSITORY | Full git URL | `github.com/org/repo` |
| VENDOR | Vendor name | `Acme Corp` |
| PERSON | Email or Name+Org | `john@company.com` |

## Resolution Algorithm

1. **Exact match** — identical canonical identifier.
2. **Domain match** — subdomain → parent domain mapping.
3. **Certificate match** — certificate hostname → entity mapping.
4. **IP match** — reverse DNS, ASN, certificate association.
5. **Repository match** — git remote URL → organization match.
6. **Fingerprint match** — certificate SHA-256 → entity binding.

## Confidence Factors

| Factor | Weight | Notes |
|---|---|---|
| Source reliability | 0.3 | HIGH/MEDIUM/LOW |
| Corroboration count | 0.3 | Number of independent sources |
| Temporal consistency | 0.2 | Consistent across collection cycles |
| Structural match | 0.2 | DNS, ASN, network topology |

## Current Implementation

- `intelligence_plane/src/server/providers/EntityResolver.ts` — basic entity
  resolution provider interface.
- `intelligence_plane/src/server/discovery/OrganizationIdentityGraph.ts` —
  organization→asset→technology relationship tracking.

## Improvements Needed

1. Implement cross-source entity matching (not just within-source).
2. Add confidence scoring to entity resolution.
3. Add entity history tracking (aliases, relationship changes).
4. Add entity merge rejection for UNCERTAIN resolution.
5. Add entity canonical ID persistence.
