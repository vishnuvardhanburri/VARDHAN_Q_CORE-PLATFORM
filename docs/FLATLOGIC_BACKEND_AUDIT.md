# FLATLOGIC ECOMMERCE BACKEND — FORENSIC AUDIT & REFERENCE SPECIFICATION

**Target**: `reference/flatlogic-ecommerce-backend`  
**Stack**: Node.js, Express 4.21, Sequelize ORM (PostgreSQL/MySQL/SQLite), Passport.js, JWT, Stripe SDK  
**Auditor**: Antigravity Forensic Engineering  
**Role**: Reference ONLY. Not to be executed or merged into Vardhan's security core.

---

## 1. Executive Summary

The Flatlogic backend is a standard Monolithic Node/Express REST API designed around ecommerce business models. It handles user authentication via bcrypt/JWT, manages products, categories, orders, feedback, and customer wishlists in relational tables via Sequelize, and processes transactions through the Stripe API.

**Strict Architectural Mandate**:
The Flatlogic backend will **NOT** run as part of the Vardhan Quantum platform. Vardhan Quantum's security core (`pq_shield`, `auth_service`, `core_crypto`, `proxy_engine`, `ha_cluster`, `audit_ledger`) is implemented in high-performance, memory-safe Rust with FIPS 203/204 post-quantum cryptography, Argon2id password hashing, and append-only Merkle-linked audit logging.

---

## 2. Route & Service Inventory

| Express Route | Controller / Service | Database Entity | Vardhan Rust Core Counterpart |
| :--- | :--- | :--- | :--- |
| `POST /auth/signin/local` | `authService.signin` | `users` | `backend/auth_service`: Argon2id verification, session token generation |
| `POST /auth/signup` | `authService.signup` | `users` | Node-local bootstrap or CISO admin provisioning |
| `GET /auth/me` | `authService.me` | `users` | `GET /api/v1/profile` in `pq_shield` (Admin 8081) |
| `PUT /auth/password-reset` | `authService.passwordReset` | `users` | `PUT /api/v1/profile/password` in `auth_service` |
| `GET /products` | `productsService.list` | `products` | `GET /api/v1/cluster/nodes` in `ha_cluster` |
| `GET /categories` | `categoriesService.list` | `categories` | Cryptographic Policy & Suite Configuration |
| `GET /orders` | `ordersService.list` | `orders` | `GET /api/v1/ledger/records` in `audit_ledger` |
| `POST /payments` | `paymentsService.create` | Stripe charges | Discarded (Commercial contracts handled out-of-band) |
| `GET /feedback` | `feedbackService.list` | `feedback` | Security Alert Queue & Incident Events |
| `GET /users` | `usersService.list` | `users` | `backend/auth_service`: Sled-backed RBAC identity table |

---

## 3. What We Learn From Flatlogic Backend (UI Data Contracts)

1. **Pagination & Query Contracts**:
   - `list` endpoints expect query params: `limit`, `offset`, `filter`, `orderBy`.
   - Response envelope format: `{ rows: [...], count: <total> }`.
   - Frontend components (`react-bootstrap-table`, pagination hooks) rely on this exact contract. Vardhan frontend API bridges will conform to this envelope structure to ensure seamless rendering without breaking component contracts.
2. **Authentication Token Lifecycle**:
   - Authorization header format: `Bearer <jwt_token>`.
   - Standard error response: `{ error: { message: "..." } }` or `{ message: "..." }` with appropriate HTTP status codes (401, 403, 404, 500).
3. **Form Validation Schemas**:
   - Input fields validate required strings, emails, password minimum length, and status enums.
