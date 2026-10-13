# VARDHAN QUANTUM — COMPREHENSIVE MIGRATION MATRIX

This matrix defines the complete transformation from Flatlogic's legacy ecommerce shell into the **Vardhan Quantum Post-Quantum Security Platform** and **Spatial Control Plane**.

---

## 1. Public Surface Transformation Matrix

| Legacy Route | Legacy Purpose | Vardhan Quantum Route | Vardhan Enterprise Purpose | Backend Data Source |
| :--- | :--- | :--- | :--- | :--- |
| `/` | Ecommerce Home (Sale banners, products) | `/` | **Command Landing Page**: High-assurance post-quantum security infrastructure. Hero positioning, architectural SVG, FIPS 203/204 highlights, live cluster beacon. | Live backend status via `/api/v1/status` |
| `/about` | Consumer About Us | `/platform` | **PQC Ingress Platform**: Deep architectural dive into PQ Shield, Proxy Engine, AEAD Wire Transport, Cluster Consensus, and Merkle Ledger. | Static architectural specifications & crate docs |
| `/about-team` | Team bio cards | `/research/team` | **Research Group & Cryptographic Principles**: Zero-trust, memory-safety, formal verification, and post-quantum cryptographic posture. | Static research governance documentation |
| `/shop` | Consumer product catalogue & price filter | `/topology` | **Global Topology Viewer**: Interactive Region and Node grid displaying real-time cluster membership, Raft roles, session counts, and heartbeat timestamps. | `/api/v1/cluster/nodes` & `/api/v1/raft/state` |
| `/categories` | Consumer category grid | `/security` | **Layered Security Model**: 10-tier defense-in-depth architecture (Crypto $\rightarrow$ Identity $\rightarrow$ Protocol $\rightarrow$ Runtime $\rightarrow$ Telemetry $\rightarrow$ Detection $\rightarrow$ Policy $\rightarrow$ Containment $\rightarrow$ Evidence $\rightarrow$ Recovery). | Static architectural matrix |
| `/category/[id]` | Category product list | `/post-quantum` | **Post-Quantum Cryptography**: FIPS 203 ML-KEM-1024, FIPS 204 ML-DSA-87, AES-256-GCM wire frames, HKDF-SHA256, BLAKE3, Argon2id. | Static NIST FIPS specifications |
| `/products/[id]` | Product detail & Add to Cart | `/architecture` | **Technical Architecture & Data Plane Flow**: Detailed packet routing, Wire Frame structure (magic, sequence, nonce, tag, payload), and proxy engine internals. | Wire frame specifications from `proxy_engine` |
| `/billing` | Stripe payment checkout | `/pricing` | **Enterprise Security Deployment**: Dedicated, Single-Tenant, Multi-Region deployment models, KMS/HSM integration, RTO/RPO SLAs, and bespoke commercial agreements (£15M–£25M+). | Enterprise commercial framework |
| `/cart` | Consumer shopping cart | `/access` | **Request Enterprise Access**: High-assurance enterprise inquiry form for CISO and infrastructure security teams. | Form submission to enterprise contact handler |
| `/wishlist` | Saved consumer items | `/pinned` | **Pinned Infrastructure Watchlist**: Pinned critical nodes, regions, or audit transactions for active monitoring. | Local browser state |
| `/blog` | Consumer blogs | `/research` | **Vardhan Quantum Research**: Research publications across 12 disciplines (PQC, Threat Research, Distributed Systems, Adversarial ML, K8s Security, Cloud IAM). | `pages/api/blogs.js` or static research corpus |
| `/blog/article/[id]`| Blog reader | `/research/[id]` | **Research Article Reader**: In-depth technical papers with citations (NIST, IEEE, ACM, USENIX, NDSS). | Markdown paper viewer |
| `/faq` | Consumer shipping/return FAQ | `/faq` | **Enterprise Technical FAQ**: 18 deep technical questions on PQC key protection, KMS failure, Raft partition tolerance, and Merkle ledger proofs. | Static FAQ database |
| `/contact` | Generic contact form | `/contact` | **Enterprise Security Ingress**: Secure communication channel for enterprise infrastructure teams. | Validated contact handler |
| `/login` | Consumer login | `/login` | **Secure Control Plane Gateway**: Argon2id credentials, session token issuance, RBAC routing. | `POST /auth/signin/local` |
| `/register` | Consumer sign up | `/request-access` | **Request Access**: Self-registration disabled; enterprise access request form. | Enterprise access queue |
| `/forgot` | Forgot password | `/forgot` | **Emergency Credential Recovery**: Emergency administrative recovery flow. | Emergency runbook |

---

## 2. Authenticated Control Plane Transformation Matrix

| Legacy Admin Route | Legacy Purpose | Vardhan Control Plane Route | Vardhan Enterprise Purpose | Backend Data Source |
| :--- | :--- | :--- | :--- | :--- |
| `/admin/dashboard` | Sales & revenue charts | `/admin/dashboard` | **Command Center**: Spatial glassmorphic operating dashboard with 4 presentation modes (Executive, Security/IT, SOC, Auditor). Cluster health, Raft role, active sessions, wire entropy. | `/api/v1/status`, `/api/v1/raft/state`, `/events` SSE |
| `/admin/products` | Product inventory table | `/admin/nodes` | **Cluster Nodes & Appliances**: Node inventory, Raft term, role (Leader/Follower/Candidate), last heartbeat, CPU/memory, drain action. | `/api/v1/cluster/nodes`, `POST /api/v1/cluster/drain` |
| `/admin/orders` | Customer orders table | `/admin/ledger` | **Merkle Audit Ledger**: Append-only tamper-evident audit records. Sequence, block hash, parent hash, ML-DSA-87 signature, actor, result. | `/api/v1/ledger/records`, `/api/v1/ledger/verify` |
| `/admin/categories`| Categories manager | `/admin/crypto` | **Cryptographic Policy Manager**: Suite configuration (FIPS 203 ML-KEM-1024, FIPS 204 ML-DSA-87), re-encryption policies, KEK rotation status. | `/api/v1/crypto/status`, `settings:v1` |
| `/admin/users` | Customer user directory | `/admin/identity` | **Identity & RBAC Control**: Administrative identities, roles (Admin, Auditor, Operator, ReadOnly), session counts, MFA status. | `/api/v1/users`, `/api/v1/sessions` |
| `/admin/feedback` | Customer reviews table | `/admin/events` | **Security Alert Queue & Live Telemetry**: Streaming security alerts, rate-limit drops, replay detections, drain events. | Live SSE `/events` from `pq_shield` |
| `/admin/password` | Profile password form | `/admin/password` | **Credential & Key Management**: Argon2id password rotation, API key provisioning (`vq_live_...`), KEK status. | `PUT /api/v1/profile/password`, `/api/v1/admin/api-keys` |

---

## 3. Data Truth Enforcement Rules

1. **Rule 1 — Absolute Reality**:
   - If an operational metric is provided by `pq_shield` (e.g. Raft commit index, cluster state, active sessions): display the exact value.
   - If an operational metric is NOT provided: display `DATA NOT AVAILABLE` or `NOT CONFIGURED`.
2. **Rule 2 — Zero Fabricated Security Claims**:
   - No fake "99.99% secure", "14.5K attacks blocked", or "100% quantum protected".
3. **Rule 3 — AI Subordination**:
   - AI and ML modules (e.g. `orchestration_ai`) are classified as observational/decision-support only. They can never bypass deterministic cryptographic policy or perform destructive administrative actions without verified RBAC approval.
