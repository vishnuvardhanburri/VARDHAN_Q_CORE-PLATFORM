# FLATLOGIC ECOMMERCE FRONTEND — FORENSIC ARCHITECTURE AUDIT

**Target**: `reference/flatlogic-ecommerce-frontend`  
**Framework**: Next.js 10.2.3, React 16.14.0, Redux 4.2.0, Redux Thunk 2.4.1, Reactstrap 8.10.1 (Bootstrap 4.6.1), SCSS (Dart Sass)  
**Auditor**: Antigravity Forensic Engineering  
**Purpose**: Complete technical inventory of all routes, UI patterns, state trees, and components to guide transformation into the Vardhan Quantum Enterprise Platform.

---

## 1. Route Topology & Page Architecture

| Route Path | File Path | Original Purpose | Reusable Structural Value | Vardhan Target Destination |
| :--- | :--- | :--- | :--- | :--- |
| `/` | `pages/index.js` | Consumer shop landing | Hero layout, grid systems, carousels | `/` (Command-Level Enterprise Homepage) |
| `/about` | `pages/about/index.js` | Company boilerplate | Content blocks, split stats, typography | `/platform` (PQC Ingress Architecture) |
| `/about-team` | `pages/about-team/index.js` | Team member cards | Card grid, biography layout | `/research/team` or Security Principles |
| `/shop` | `pages/shop/index.js` | Product listing & filters | Multi-attribute facet filter, dense grid | `/topology` (Global Region & Node Grid) |
| `/categories` | `pages/categories/index.js` | Category directory | Grouped section cards with metrics | `/security` (Layered Defense Model) |
| `/category/[id]` | `pages/category/[id].js` | Filtered product category | Dynamic parameter handling, list view | `/post-quantum` (Cryptographic Suite Specs) |
| `/products/[id]` | `pages/products/[id].js` | Single product detail | Spec sheet, tabs, technical metadata | `/architecture` (Deep Component Architecture) |
| `/billing` | `pages/billing/index.js` | Stripe checkout form | Multi-step form, enterprise input | `/pricing` (Enterprise Security Deployment) |
| `/cart` | `pages/cart/index.js` | Shopping cart table | Line-item table, quantity inputs | `/access` (Request Enterprise Access) |
| `/wishlist` | `pages/wishlist/index.js` | Saved consumer items | Action list, stateful badges | Transformed to Watchlist / Pinned Nodes |
| `/blog` | `pages/blog/index.js` | Generic blog directory | Article cards, category tags, pagination | `/research` (Vardhan Security Research) |
| `/blog/article/[id]` | `pages/blog/article/[id].js` | Blog article reader | Technical article layout, markdown body | `/research/[slug]` (Academic Paper Reader) |
| `/contact` | `pages/contact/index.js` | General contact inquiry | Validated inquiry form, map coordinates | `/contact` (CISO Enterprise Ingress Inquiries) |
| `/faq` | `pages/faq/index.js` | Consumer FAQ accordions | Clean animated accordions (`AnimateHeight`) | `/faq` (Enterprise PQC Technical FAQ) |
| `/login` | `pages/login/index.js` | Consumer email/pass login | Two-column auth card, JWT decode | `/login` (Secure Control Plane Gateway) |
| `/register` | `pages/register/index.js` | Consumer registration | Form validation, password rules | `/request-access` (Enterprise Access) |
| `/forgot` | `pages/forgot/index.js` | Password reset request | Single-field verification flow | Kept as emergency self-service recovery |
| `/reset` | `pages/reset/index.js` | Password reset token | Token validation parameter | Kept for credential rotation |
| `/search` | `pages/search/index.js` | Product search form | Search bar, category selectors | Global Platform & Audit Search |
| `/search-results` | `pages/search-results/index.js` | Search results grid | Filtered search result list | Security Intelligence & Audit Search |
| `/admin` | `pages/admin/index.js` | Redirects to dashboard | Admin layout mounting | `/admin` (Redirect to `/admin/dashboard`) |
| `/admin/dashboard` | `pages/admin/dashboard/index.js`| Ecommerce sales graphs | ApexCharts spline/donut, metrics cards | Command Center (Persona Operating System) |
| `/admin/products` | `pages/admin/products/index.js` | Product management CRUD | Data table, pagination, search, modal | Node / Appliance Inventory Management |
| `/admin/orders` | `pages/admin/orders/index.js` | Order tracking CRUD | Status pill badges, timestamp table | Merkle Audit Ledger Viewer |
| `/admin/categories`| `pages/admin/categories/index.js`| Category taxonomy CRUD | Grouped table, slug editor | Cryptographic Policy & Suite Manager |
| `/admin/users` | `pages/admin/users/index.js` | User list CRUD | Role badges, avatar, status toggle | Identity & RBAC Management |
| `/admin/feedback` | `pages/admin/feedback/index.js` | Customer review table | Tabular rating/feedback items | Security Alerts & Incident Feed |
| `/admin/password` | `pages/admin/password/index.js` | Admin password update | Secure password form | Credential Rotation & HSM Pin Update |

---

## 2. Global State Architecture (Redux)

The application utilizes Redux with `redux-thunk`:
- `auth`: Manages `currentUser`, `isFetching`, `errorMessage`, `loadingInit`. Stores JWT in `localStorage` and injects `Authorization: Bearer <token>` on all Axios requests.
- `navigation`: Controls sidebar collapse state, active item tracking, and mobile drawer toggle.
- `layout`: Controls theme styling, sidebar layout type, and navbar transparency.
- `products`: Product listing, pagination, active filters.
- `categories`: Category taxonomy.
- `orders`: Order history and line items.
- `users`: User directory and permissions.
- `blogs`: Research blog list and article detail.
- `feedback`: Feedback and alert queues.

---

## 3. UI Component Architecture

- **Layout Components**:
  - `components/e-commerce/Header`: Main public navigation, category dropdowns, cart indicator, search and login buttons.
  - `components/e-commerce/Sidebar`: Mobile slide-out drawer with hierarchical accordion navigation.
  - `components/e-commerce/Footer`: Multi-column site map, newsletter subscription, legal links.
  - `components/admin/Layout`: Protected administrative layout with Hammer.js swipe gestures, collapsible sidebar, and breadcrumbs.
  - `components/admin/Header`: Admin top bar with notifications menu, profile dropdown, and search.
  - `components/admin/Sidebar`: Administrative navigation menu with icons and active routes.
- **Form Components**:
  - Validated inputs via Formik / Yup patterns.
  - Image uploader, password visibility toggles, rich text editors (`react-draft-wysiwyg`).
- **Data Display Components**:
  - `react-bootstrap-table` for tabular data with sorting and pagination.
  - `react-apexcharts` for spline areas, bar charts, and donut progress metrics.

---

## 4. Architectural Gaps & Refactoring Mandates

1. **Purge All Consumer Ecommerce Concepts**:
   - Strip all references to carts, Stripe, checkouts, consumer orders, shopping carts, discounts, pricing tags, and shipping addresses.
2. **Eliminate Hardcoded / Fabricated Metrics**:
   - Replace dummy sales numbers ($45,210) with live backend telemetry (`/api/v1/status`, `/api/v1/raft/state`, `/api/v1/ledger/records`).
   - Implement the **Data Truth Rule**: If the backend does not provide a metric, render `DATA NOT AVAILABLE` or `NOT CONFIGURED`.
3. **Glassmorphic Quantum Dark Styling**:
   - Inject the Vision Pro / Quantum Dark design system (`#0B0E14` void black background, `#00F5D4` quantum cyan accents, frosted glass panels with `backdrop-filter: blur(20px)`).
