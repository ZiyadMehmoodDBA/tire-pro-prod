# TirePro — Unit of Work Prompts (Architect Reference)

Each section is a self-contained implementation prompt. Stack-agnostic — usable with any backend (Express, Django, Rails, Spring, FastAPI) and any frontend (React, Vue, Angular, Svelte).

**System context:**
- Multi-tenant, multi-branch tyre retail management SaaS (Pakistan market — currency PKR)
- Auth: JWT access token (15 min) + refresh token (1–30 day)
- Users carry `{ org_id, branch_id, role }` in JWT
- All transactional data is branch-scoped; master data is org-scoped; reference data is global
- Demo org with auto-reset every 30 min for trial users

---

## UOW-01 — Database Schema & Idempotent Migrations

### Purpose
Bootstrap a SQL relational database with all tables on server start. Every migration must be safe to re-run (idempotent — never crash on existing schema).

### Pattern
Use `IF NOT EXISTS` guards for every table creation and every `ALTER TABLE ADD COLUMN`. Group tables by dependency order (reference → parent → child). Never use destructive migrations in boot code — add columns only, never drop.

### Tables to create (in dependency order)

```sql
-- Reference / global (no org scope)
tire_catalog        (id, brand, model, size, pattern, load_index, speed_index, tire_type, source, created_at)
                    UNIQUE(brand, model, size)
vehicle_fitments    (id, category, make, model, year_from, year_to, tire_size, gtr_pattern, position)
catalog_scraper_logs (id, source, status, started_at, finished_at, items_found, items_added, items_updated, error_msg, triggered_by)

-- Org-level entities (shared across branches)
organizations       (id, name, code UNIQUE, type, address, phone, email, currency, logo_url, is_active, created_at)
branches            (id, organization_id, name, code, address, phone, email, is_active, created_at)
users               (id, organization_id, branch_id NULL, name, email UNIQUE, password_hash, role, is_active,
                     first_name, last_name, phone, job_title, department, date_of_birth,
                     emergency_contact_name, emergency_contact_phone, created_at)
refresh_tokens      (id, user_id, token_hash, expires_at, created_at)
settings            (organization_id, key, value, updated_at) PK(organization_id, key)
customers           (id, organization_id, code, name, phone, email, address, balance, vehicle_plate,
                     vehicle_make, vehicle_model, vehicle_year, created_at)
suppliers           (id, organization_id, code, name, phone, email, address, balance, created_at)
products            (id, organization_id, code, name, description, category, unit, cost_price, sale_price, is_active, created_at)
tire_types          (id, organization_id, name, sort_order)
dealer_price_lists  (id, supplier_name, effective_date, notes, created_at)
dealer_price_items  (id, list_id FK, category, size, design, ply_rating, dealer_price,
                     tyre_total, tube_total, flap_total, linked_tire_id)

-- Branch-scoped transactional (isolated per org+branch)
tires               (id, organization_id, branch_id, brand, model, size, type, pattern, load_index, speed_index,
                     stock, cost_price, sale_price, reorder_level, image_url, barcode, created_at)
sales               (id, organization_id, branch_id, invoice_no UNIQUE, customer_id, date,
                     subtotal, tax_rate, tax, discount, total, amount_paid, payment_method,
                     cash_given, status, notes, created_at)
sale_items          (id, sale_id FK CASCADE, tire_id NULL, product_id NULL, description, qty, unit_price, discount, amount)
purchases           (id, organization_id, branch_id, po_no UNIQUE, supplier_id, date,
                     subtotal, tax_rate, tax, total, amount_paid, reference_no, status, notes, created_at)
purchase_items      (id, purchase_id FK CASCADE, tire_id NULL, product_id NULL, description, qty, unit_price, amount)
sale_payments       (id, sale_id FK CASCADE, customer_id, amount, payment_date, payment_method, reference_no, notes, created_at)
purchase_payments   (id, purchase_id FK CASCADE, supplier_id, amount, payment_date, payment_method, reference_no, notes, created_at)
ledger_entries      (id, organization_id, branch_id, entry_date, entity_type, entity_id, entry_type,
                     debit, credit, description, reference_no, sale_id NULL, purchase_id NULL, created_at)
stock_movements     (id, organization_id, branch_id, tire_id, movement_type, qty, reference_type, reference_id, notes, created_at)
audit_logs          (id, organization_id, branch_id, user_id, user_name, action, entity, entity_id,
                     before_json, after_json, created_at)
                    INDEX on (organization_id, created_at DESC)
```

### Boot seed data
- Default org (code='TIREPRO') + branch (code='MAIN') + admin user if none exist
- Default settings per org: company_name, tax_rate=15, currency=PKR, invoice_prefix=INV, po_prefix=PO, etc.
- Default tire types: Passenger, Light Truck, Truck, Tractor, SUV, 4x4, Performance
- Demo org (code='DEMO') + branch + staff user (role=demo) — seed once only
- BG dealer price list (89 SKUs, April 2026) — seed once, skip if already present with tube/flap data

---

## UOW-02 — Authentication System

### Purpose
Stateless JWT auth with short-lived access tokens, rotating refresh tokens, Google OAuth, and a sandboxed demo mode.

### Token design
- Access token: JWT, 15-min expiry, payload `{ userId, orgId, branchId, role }`
- Refresh token: cryptographically random, hashed (bcrypt or SHA-256) before DB storage, 1-day expiry (30-day if "remember me")
- Refresh token rotation: invalidate old on use, issue new; one token per user session (delete old on new login)

### Endpoints

```
POST /auth/login
  Body: { email, password, rememberMe? }
  - Validate password (bcrypt compare)
  - Issue access + refresh tokens
  - Return: { accessToken, refreshToken, user: { id, name, email, role, org_id, branch_id, organization, branches[] } }
  - Rate limit: 50 req / 15 min per IP

POST /auth/refresh
  Body: { refreshToken }
  - Hash incoming token, look up in DB
  - Validate not expired, issue new access + refresh token pair (rotate)
  - Delete old refresh token from DB
  - Return: { accessToken, refreshToken, user }

POST /auth/logout
  Body: { refreshToken }
  - Delete refresh token from DB (invalidate session)
  - Return: 200 OK (always, even if token not found)

POST /auth/register
  Body: { fullName, email, password, phone, org_name, org_type, org_address? }
  - Create organization + branch (code='MAIN') + admin user in one transaction
  - Hash password (bcrypt, cost 12)
  - Seed default settings for the new org
  - Issue tokens immediately (no email verification in MVP)

POST /auth/google
  Body: { credential }  (Google ID token)
  - Verify ID token with Google's public keys
  - Find or create user by email
  - Issue access + refresh tokens
  - Return same shape as /login

POST /auth/demo
  - Find demo org user (role=demo)
  - Issue short-lived access token (no persistent refresh)
  - Return: { accessToken, refreshToken, user }

POST /auth/forgot-password
  Body: { email }
  - Generate 6-digit OTP or signed reset token (15 min TTL)
  - Store hashed in DB; return token in response (dev mode) OR send email (prod)
  - Always return 200 (don't reveal if email exists)

POST /auth/reset-password
  Body: { resetToken, newPassword }
  - Validate token, check TTL
  - Hash new password, update user
  - Invalidate all refresh tokens for that user
```

### Middleware

```
requireAuth(req, res, next):
  - Extract Bearer token from Authorization header
  - Verify JWT signature + expiry
  - Attach req.user = { userId, orgId, branchId, role }
  - On expiry: return 401 { code: 'TOKEN_EXPIRED' }
  - On invalid: return 401 { code: 'INVALID_TOKEN' }

requireRole(...roles):
  - Check req.user.role is in roles array
  - Return 403 if not
```

### Frontend token management
- Store access token in memory or short-lived localStorage key
- Store refresh token in localStorage (persistent) or sessionStorage (session-only) based on "remember me"
- On 401 `TOKEN_EXPIRED`: pause request, call /auth/refresh, retry original request
- Deduplicate concurrent refresh calls (only one refresh in flight at a time)
- On refresh failure: clear all tokens, redirect to login

---

## UOW-03 — Multi-Tenant Architecture (Org + Branch Scoping)

### Purpose
Every API request must be scoped to the correct organisation and branch. Two principals:
- `org_admin` — manages the whole org, can switch branch via header
- Branch staff — locked to a single branch by JWT

### Context extraction

```
getContext(req) → { orgId, branchId }

orgId   = req.user.orgId                         (from JWT, always trusted)
branchId = req.user.branchId                      (if branch-locked user)
         OR parseInt(req.headers['x-branch-id'])  (if org_admin, null branchId in JWT)
```

### Scoping rules (apply to every SQL query)

| Table group | WHERE clause |
|---|---|
| Branch-scoped | `WHERE organization_id = @orgId AND branch_id = @branchId` |
| Org-scoped | `WHERE organization_id = @orgId` |
| Global reference | No filter (tire_catalog, vehicle_fitments, dealer_price_lists) |

### Branch validation middleware

```
validateBranchContext(req, res, next):
  - If req.user.branchId not null: branch is JWT-locked, skip validation
  - Else (org_admin): validate X-Branch-ID belongs to req.user.orgId
  - Cache validation result 5 min (orgId + branchId → valid/invalid)
  - Invalidate cache on branch delete
  - Return 403 if branch belongs to different org
```

### Frontend context
- Store `orgId` and `branchId` in localStorage on login
- Attach `X-Org-ID` + `X-Branch-ID` headers on every authenticated API request
- Org_admin can switch branch via branch picker UI → updates localStorage + re-fetches data

---

## UOW-04 — Role-Based Access Control

### Roles & Permissions

| Role | Access |
|---|---|
| `org_admin` | All routes for their org; all branches; user management; settings; audit log |
| `branch_manager` | All operational routes for their branch; no user/settings admin |
| `staff` | Sales, purchases, inventory, customers, suppliers, payments for their branch |
| `demo` | GET all + whitelisted POSTs only; all mutations blocked; data resets every 30 min |

### Demo guard middleware

```
blockDemoMutations(req, res, next):
  - If req.user.role !== 'demo': next()
  - If req.method === 'GET': next()
  - If path matches blocked patterns (/void, /status, /password, /import-catalog, /scraper/): block
  - If req.method === 'POST' and path in whitelist (/customers, /suppliers, /inventory, /sales, /purchases, /products, /payments): next()
  - Else: return 403 { error: 'Demo accounts cannot perform this action' }
```

### Route-level role guards

```
All /users/* routes: requireRole('org_admin')
All /organizations/* routes: requireRole('org_admin')
All /audit/* routes: requireRole('org_admin')
Settings admin routes: requireRole('org_admin')
Catalog scraper routes: requireRole('org_admin')
```

---

## UOW-05 — Sales Module

### Purpose
Full invoice lifecycle — create, record payments, track status, update stock, generate PDF, void.

### Data model
```
sales: invoice_no (auto-generated: prefix + sequence), customer_id, date, subtotal,
       tax_rate, tax, discount, total, amount_paid, payment_method, cash_given, status, notes
sale_items: sale_id, tire_id OR product_id, description (snapshot), qty, unit_price, discount, amount
sale_payments: sale_id, customer_id, amount, payment_date, method, reference_no
```

### Invoice number generation
`{prefix}{YYYY}{4-digit-sequence}` e.g. `INV20240001`. Sequence restarts per year per org.

### Endpoints
```
GET  /sales?from=&to=                 — list with date filter; branch-scoped
GET  /sales/:id                       — detail with items + payment history
POST /sales                           — create sale (validate stock; decrement tires.stock per item; write audit + stock_movement)
PATCH /sales/:id/status               — update status (pending/partial/paid/overdue); demo blocked
POST  /sales/:id/void                 — void sale (restore stock; write audit); demo blocked
DELETE /sales/:id                     — hard delete (restore stock; delete ledger entries)
GET  /sales/stats/dashboard           — aggregate stats for dashboard (today sales, MTD, top products)
GET  /sales/by-tire-type              — group by tire type for pie chart
```

### Status machine
```
pending → partial (payment recorded, amount_paid < total)
partial → paid (amount_paid >= total)
paid → overdue (if due date passed and status != paid — run via cron or recalculate on read)
any → voided
```

### Stock management on sale
```
For each sale_item where tire_id is not null:
  UPDATE tires SET stock = stock - qty WHERE id = tire_id AND branch_id = @branchId
  INSERT INTO stock_movements (tire_id, movement_type='SALE', qty=-qty, reference_type='sale', reference_id=sale.id)
```

### Customer balance update
```
UPDATE customers SET balance = balance + sale.total WHERE id = sale.customer_id
  (payment reduces balance: balance = balance - payment.amount)
```

### Audit
```
writeAudit(orgId, branchId, userId, 'CREATE', 'sale', sale.id, null, { invoice_no, total, customer })
```

---

## UOW-06 — Purchases Module

### Purpose
Supplier purchase orders — create, receive goods (GRN), track status, update stock on receipt.

### Data model
```
purchases: po_no (auto-generated: PO + sequence), supplier_id, date, subtotal, tax_rate, tax,
           total, amount_paid, reference_no, status, notes
purchase_items: purchase_id, tire_id OR product_id, description, qty, unit_price, amount
purchase_payments: purchase_id, supplier_id, amount, payment_date, method, reference_no
```

### Endpoints
```
GET    /purchases                      — list; branch-scoped
GET    /purchases/:id                  — detail with items + payment history
POST   /purchases                      — create PO (no stock change on create — only on received)
PATCH  /purchases/:id/status           — update status; on 'received': increment stock per item
DELETE /purchases/:id                  — delete PO (reverse stock if was received)
```

### Stock update on received
```
For each purchase_item where tire_id is not null:
  UPDATE tires SET stock = stock + qty WHERE id = tire_id AND branch_id = @branchId
  INSERT INTO stock_movements (type='PURCHASE_RECEIVED', qty=+qty, reference_type='purchase')
```

### Supplier balance
```
On PO create:  suppliers.balance += purchase.total
On payment:    suppliers.balance -= payment.amount
```

---

## UOW-07 — Inventory (Tire SKU) Management

### Purpose
Branch-scoped tire SKU catalog — CRUD, stock tracking, bulk import from global tire_catalog.

### Data model
```
tires: brand, model, size, type, pattern, load_index, speed_index,
       stock, cost_price, sale_price, reorder_level, image_url, barcode
       (org + branch scoped)
```

### Endpoints
```
GET    /inventory                      — list all SKUs for branch
GET    /inventory/:id                  — single SKU
POST   /inventory                      — create SKU
PUT    /inventory/:id                  — update SKU
DELETE /inventory/:id                  — delete (block if stock > 0 or referenced in sales/purchases)
POST   /inventory/bulk                 — bulk upsert from Excel import
GET    /inventory/catalog-brands       — distinct brands from global tire_catalog
POST   /inventory/import-catalog       — copy selected brands from tire_catalog into branch tires
```

### Catalog import logic
```
For each entry in tire_catalog WHERE brand IN (selected_brands):
  IF NOT EXISTS (SELECT 1 FROM tires WHERE brand=@b AND model=@m AND size=@s AND org_id=@o AND branch_id=@br):
    INSERT INTO tires (brand, model, size, type, stock=0, cost_price=0, sale_price=0)
```

### Stock alert
Flag SKUs where `stock <= reorder_level` for dashboard low-stock widget.

---

## UOW-08 — Customer Management

### Purpose
Org-scoped customer directory — CRUD, vehicle info tracking, balance display.

### Data model
```
customers: code (unique per org), name, phone, email, address, balance,
           vehicle_plate, vehicle_make, vehicle_model, vehicle_year
```

### Endpoints
```
GET    /customers                      — list; org-scoped
GET    /customers/:id                  — detail with recent sales + balance
POST   /customers                      — create; validate phone uniqueness per org
PUT    /customers/:id                  — update
DELETE /customers/:id                  — soft-delete or block if has outstanding balance
POST   /customers/bulk                 — bulk upsert from Excel
```

### Customer code generation
`C{4-digit-sequence}` e.g. `C0001`. Max existing code + 1, per org.

---

## UOW-09 — Supplier Management

### Purpose
Org-scoped supplier directory — CRUD, balance tracking.

### Data model
```
suppliers: code (unique per org), name, phone, email, address, balance
```

### Endpoints
```
GET    /suppliers                      — list; org-scoped
POST   /suppliers                      — create; generate code S{0001}
PUT    /suppliers/:id                  — update
DELETE /suppliers/:id                  — block if outstanding balance or open POs
POST   /suppliers/bulk                 — bulk upsert from Excel
```

---

## UOW-10 — Payment System

### Purpose
Record partial/full payments against sales and purchase orders. Track outstanding balances.

### Endpoints
```
POST   /payments/sale                  — record payment; update sales.amount_paid; update customer.balance
GET    /payments/sale/:saleId          — list payments for a sale
DELETE /payments/sale/:id              — void payment; reverse balance updates

POST   /payments/purchase              — record supplier payment; update purchases.amount_paid; update supplier.balance
GET    /payments/purchase/:purchaseId  — list payments for a PO
DELETE /payments/purchase/:id          — void payment
```

### Balance update logic
```
On sale payment:
  sales.amount_paid += payment.amount
  sales.status = amount_paid >= total ? 'paid' : 'partial'
  customers.balance -= payment.amount   (balance = amount owed by customer)

On purchase payment:
  purchases.amount_paid += payment.amount
  suppliers.balance -= payment.amount   (balance = amount owed to supplier)
```

---

## UOW-11 — Financial Ledger (Double-Entry Journal)

### Purpose
Immutable banking-style journal of all financial activity — AR/AP aging, customer/supplier statements.

### Data model
```
ledger_entries: entry_date, entity_type (customer|supplier), entity_id, entry_type,
                debit, credit, description, reference_no, sale_id NULL, purchase_id NULL
```

### Entry types written automatically
- `SALE_INVOICE` — debit customer; credit revenue
- `SALE_PAYMENT` — debit cash; credit customer (reduces AR)
- `PURCHASE_INVOICE` — credit supplier; debit purchases
- `PURCHASE_PAYMENT` — debit supplier; credit cash (reduces AP)
- `SALE_VOID` — reverse of SALE_INVOICE entries

### Endpoints
```
GET /ledger/summary                    — total AR (customer balances > 0), total AP (supplier balances > 0)
GET /ledger/customers                  — list customers with balance + aging breakdown (current, 30d, 60d, 90d+)
GET /ledger/suppliers                  — list suppliers with balance + aging
GET /ledger/customer/:id/statement     — full journal for customer; running balance
GET /ledger/supplier/:id/statement     — full journal for supplier
GET /ledger/customer/:id/unpaid-invoices — sales where amount_paid < total
GET /ledger/supplier/:id/unpaid-pos    — purchases where amount_paid < total
```

### Immutability rule
No UPDATE or DELETE on ledger_entries. Reversals are new entries.

---

## UOW-12 — Audit Log

### Purpose
Immutable record of every CREATE, UPDATE, DELETE across the system. Org_admin-only read access.

### Data model
```
audit_logs: organization_id, branch_id, user_id, user_name, action (CREATE|UPDATE|DELETE),
            entity (sale|purchase|tire|customer|supplier|user|settings...),
            entity_id, before_json, after_json, created_at
```

### Write pattern
```
writeAudit(orgId, branchId, userId, userName, action, entity, entityId, before?, after?):
  INSERT INTO audit_logs ...
  Fire-and-forget (don't block the main request)
```

Call after every successful INSERT/UPDATE/DELETE in every route. Capture `before` by SELECT before mutation.

### Endpoint
```
GET /audit?entity=&action=&from=&to=&page=&limit=
  — org_admin only
  — pagination (default: 50/page, max 200)
  — filter by entity type, action, date range
  — return: { logs, total, page, limit }
```

---

## UOW-13 — User Management

### Purpose
Org_admin-only CRUD for users within the org. Role assignment, branch assignment, status control, password reset.

### Data model (extended)
```
users: name, email, password_hash, role, is_active, organization_id, branch_id NULL,
       first_name, last_name, phone, job_title, department, date_of_birth,
       emergency_contact_name, emergency_contact_phone, emergency_contact_relation
```

### Endpoints (all org_admin only)
```
GET    /users                          — list org users
POST   /users                          — create user; hash password; assign role + branch
PUT    /users/:id                      — update profile fields + role + branch
PATCH  /users/:id/status               — activate / deactivate
PATCH  /users/:id/password             — admin resets another user's password; cannot reset own; cannot reset inactive user
```

### Business rules
- Admin cannot reset their own password via this endpoint (must use /profile/change-password)
- Cannot reset password for inactive users
- Cannot create user in a branch that belongs to a different org
- Email must be unique across the platform (not just per org)

---

## UOW-14 — Organization & Branch Management

### Purpose
Platform-level org CRUD and org-level branch management. Org_admin manages their own branches.

### Endpoints
```
GET    /organizations                  — list all orgs (platform admin view)
GET    /organizations/:id              — detail with branches
POST   /organizations                  — create org + seed default branch + settings
PUT    /organizations/:id              — update org details

GET    /branches                       — list branches for req.user.orgId
GET    /branches/:id                   — branch detail
POST   /branches                       — create branch for the org
PUT    /branches/:id                   — update branch
DELETE /branches/:id                   — delete; invalidate branch context cache; block if has data
```

---

## UOW-15 — Settings System

### Purpose
Key-value configuration store per organisation. Covers company profile, invoice defaults, tax, display preferences.

### Data model
```
settings: (organization_id, key) PK, value TEXT, updated_at
```

### Endpoints
```
GET  /settings                         — return all settings for org as { key: value } map
POST /settings                         — bulk upsert { key: value, ... } for org

GET  /settings/system-info             — server uptime, node version, memory, DB sizes, record counts, active sessions
```

### Standard keys
```
company_name, company_tagline, company_address, company_phone, company_email,
invoice_prefix, po_prefix, default_tax_rate, payment_due_days, default_sale_status,
currency, announcement, refresh_interval, scraper_enabled, scraper_schedule
```

### Frontend caching
Cache settings map in memory on login. Invalidate on POST /settings. Used by invoice PDF, header/sidebar, formatCurrency.

---

## UOW-16 — Products & Services Catalog

### Purpose
Org-scoped non-tire items — services (fitting, balancing, alignment), accessories — usable as line items in sales.

### Data model
```
products: organization_id, code, name, description, category, unit (job/pcs/ltr),
          cost_price, sale_price, is_active
```

### Endpoints
```
GET    /products                       — list active products for org
POST   /products                       — create
PUT    /products/:id                   — update
DELETE /products/:id                   — deactivate (soft delete; block if used in open sales)
```

---

## UOW-17 — Lookup Tables (Tire Types)

### Purpose
Configurable tire type list per org. Drives dropdowns in inventory and reports.

### Endpoints
```
GET    /lookups/tire-types             — list org tire types (ordered by sort_order)
POST   /lookups/tire-types             — add type { name }
PUT    /lookups/tire-types/:id         — update name / sort_order
DELETE /lookups/tire-types/:id         — delete if not referenced by any tire SKU

GET    /lookups/tire-suggestions       — { brands[], models[], sizes[], patterns[], load_indexes[], speed_indexes[] }
                                         from tire_catalog — powers brand/model/size autocomplete in inventory forms
```

---

## UOW-18 — Dealer Price Lists

### Purpose
Import BG supplier price catalog. Compare against inventory. Bulk-update cost prices or create new SKUs.

*(See UOW-01 in original unitofwork.md — full schema, endpoints, import logic, and frontend spec already documented there.)*

### Key design decisions
- `dealer_price_lists` and `dealer_price_items` are **global** (no org scope) — prices are the same for all tenants
- Inventory matching IS branch-scoped — same price list item may link to different branch inventories
- SET price = tyre_total + tube_total + flap_total (null components = 0)
- Model name rule: Passenger Radial → `design`; all others → `design + ' ' + ply_rating + 'PR'`
- Manual `linked_tire_id` overrides auto-match for import
- Demo users blocked from import + link (mutations)

---

## UOW-19 — Global Tire Catalog & Scraper

### Purpose
Global reference database of tyre brands/models/specs. Feeds brand/model/size autocomplete in inventory. Can be updated via scraper or static file.

### Data model
```
tire_catalog: brand, model, size, pattern, load_index, speed_index, tire_type, source
              UNIQUE(brand, model, size)
```

### Endpoints
```
GET  /catalog/stats                    — total_entries, total_brands, total_models, gtr_entries
GET  /catalog/entries?q=&brand=&model=&size=&page=&limit=  — paginated search
DELETE /catalog/entries/:id             — org_admin only

GET  /catalog/scraper/config           — { enabled, schedule, isRunning, isScheduled, scheduleOptions[] }
POST /catalog/scraper/config           — save enabled + schedule; restart cron if changed
POST /catalog/scraper/run              — manual trigger (org_admin only, demo blocked)
GET  /catalog/scraper/status           — { isRunning, isScheduled, recentLogs[], gtrCounts }
```

### Scraper flow
1. Read GTR catalog from `files/gtr-catalogue.json` (static file) or fetch from external URL
2. Parse each entry into `{ brand, model, size, pattern, load_index, speed_index, tire_type }`
3. Upsert into `tire_catalog` on `(brand, model, size)` conflict → update fields; count inserted vs updated
4. Write result to `catalog_scraper_logs` (status, items_found, items_added, items_updated, error_msg)
5. Cron schedule configurable: every_6h / every_12h / daily_2am / daily_6am / weekly / manual
6. Deduplicate: if scraper already running, skip new invocation

---

## UOW-20 — Vehicle Fitment Guide

### Purpose
Pakistan-market OEM tyre size reference by vehicle make/model/year. Unauthenticated (public reference data). Links fitment sizes to tire_catalog entries.

### Data model
```
vehicle_fitments: category (Car/SUV/Truck/Tractor...), make, model,
                  year_from, year_to, tire_size, gtr_pattern, position (Front|Rear|NULL)
```

### Endpoints (no auth required)
```
GET /fitments/categories               — distinct categories
GET /fitments/makes?category=          — distinct makes, optional category filter
GET /fitments/models?make=&category=   — distinct models for make

POST /fitments/search
  Body: { make?, model?, category? }
  Returns: {
    fitments: [{ id, category, make, model, year_from, year_to, tire_size, gtr_pattern, position }],
    catalogMatches: { [tire_size]: [{ brand, model, size, pattern, load_index, speed_index }] }
  }
  — For each fitment's tire_size, query tire_catalog for matching entries
```

### Seed data
Pakistan-market vehicles: Honda Civic, City, HR-V, CR-V; Toyota Corolla, Fortuner, Prado, Hilux; Suzuki Cultus, Swift, Alto; local tractors (Massey Ferguson, New Holland) with front/rear fitments.

---

## UOW-21 — POS Terminal

### Purpose
Fast point-of-sale interface for walk-in customers. Instant cash sale with change calculation. No open tab — creates sale immediately on checkout.

### UX flow
1. Open POS → select customer (or use walk-in default)
2. Search and add items (tires or services) by brand/model/size or product name
3. Set quantity per line item
4. Apply discount per item or overall
5. Select payment method: cash / card / bank transfer
6. For cash: enter amount given → display change due
7. Checkout → creates sale record + updates stock + prints receipt

### Receipt print
Thermal-style receipt: company name, date, items, subtotal, tax, total, cash given, change. Print via browser `window.print()` with a print-only CSS stylesheet.

### Integration
- POS creates sale via POST /sales with `payment_method`, `cash_given` fields
- On cash payment with cash_given >= total: status = 'paid', amount_paid = total
- On card/bank: status = 'paid', amount_paid = total (assume full payment)
- Walk-in customer: seed one `WALKIN` customer per org (code='WALKIN') for anonymous sales

---

## UOW-22 — PDF Invoice Generation

### Purpose
Generate professional branded PDF invoices for sales. Download + print from the browser.

### Library
jsPDF + jspdf-autotable (or any PDF generation library in your stack).

### Invoice layout
```
Header:   Company logo (if set) | Company name, address, phone, email
Divider
Bill To:  Customer name, phone, address
Invoice:  Invoice No | Date | Due Date | Status badge

Line items table:
  # | Description (brand model size) | Qty | Unit Price | Discount | Amount
  ...
  Subtotal, Tax (rate + amount), Discount, TOTAL

Payment history (if any): Date, Method, Amount, Reference
Footer: "Thank you for your business" | Company tagline
```

### Settings used
`company_name`, `company_tagline`, `company_address`, `company_phone`, `company_email`, `currency`, `invoice_prefix`

---

## UOW-23 — Excel Import / Export

### Purpose
Bulk data operations via Excel files. Import customers, suppliers, inventory from .xlsx. Export reports.

### Import (customers, suppliers, inventory)
1. User uploads .xlsx file
2. Parse sheet rows into objects (SheetJS `XLSX.utils.sheet_to_json`)
3. Validate required fields per entity type
4. Show preview with error rows highlighted
5. POST /customers/bulk (or suppliers/inventory) with validated rows
6. Backend upserts on unique key (code for customers/suppliers, brand+model+size for tires)
7. Return: `{ inserted: N, updated: M, errors: [...] }`

### Export (reports, lists)
```
exportToExcel(data: object[], filename: string):
  - Convert data array to worksheet (XLSX.utils.json_to_sheet)
  - Set column widths
  - Trigger browser download as .xlsx
```

---

## UOW-24 — Dashboard & Analytics

### Purpose
Home page KPIs, charts, and alerts for the authenticated user's branch.

### Data fetched
```
GET /sales/stats/dashboard → {
  today_sales_count, today_sales_total,
  mtd_sales_total, mtd_purchase_total,
  pending_invoices_count, overdue_invoices_count,
  monthly_sales[12], monthly_purchases[12]   (for trend charts)
}
GET /sales/by-tire-type → [{ tire_type, item_count, revenue }]   (for pie chart)
GET /ledger/summary → { total_ar, total_ap }
```

### UI components
- Stat cards: Today's Sales, MTD Revenue, Pending Invoices, Overdue Invoices
- Area chart: Monthly Sales vs Purchases (12 months)
- Pie chart: Revenue by Tire Type
- Finance summary: Total Receivables (AR) vs Payables (AP)
- Quick-access cards: New Sale, New Purchase, Inventory, Customers
- Announcement banner (from settings.announcement)

---

## UOW-25 — Reports & Analytics

### Purpose
Business performance reports by date range. Export to Excel.

### Report types
- Sales summary by period (daily/weekly/monthly)
- Top selling tire brands/models by revenue
- Customer revenue ranking
- Supplier spend ranking
- Stock valuation report (cost_price × stock per SKU)
- Profit/loss summary (sale total - cost total for period)

### Endpoints (extend /sales and /purchases)
All reports are computed server-side from existing sales/purchases tables with GROUP BY and date filters. Return pre-aggregated data for charting.

---

## UOW-26 — Demo Mode & Auto-Reset

### Purpose
Sandboxed demo org for prospective users. Data resets every 30 minutes to keep the demo fresh. Master data stays; only transactional data resets.

### Demo user
- role = 'demo', organization_id = demo_org_id, branch_id = demo_branch_id
- Issued a session-only refresh token (no persistent session)
- Blocked from all mutations except whitelisted POSTs (see UOW-04)

### Reset cycle (every 30 min via cron)
1. Delete from sale_payments, purchase_payments, ledger_entries (FK order)
2. Delete from sale_items, purchase_items (FK order)
3. Delete from sales, purchases
4. Reset customers.balance = 0, suppliers.balance = 0
5. Restore demo tires stock to original values
6. Re-seed 6 demo sales + 3 demo purchases with varied statuses and payment states

### What persists (not reset)
- Demo customers, suppliers, tire inventory, services, products
- These are seeded once when demo org is first created

### Demo banner
Display a persistent banner in the UI: "Demo Mode — Data resets every 30 minutes". Show a countdown or "Exit Demo" button.

---

## UOW-27 — API Client Layer (Frontend)

### Purpose
Typed, centralized HTTP client. All API calls go through one object. Auto-attaches auth + context headers. Auto-refreshes on token expiry.

### Design
```typescript
// Single request function — all other methods wrap this
async function request<T>(path, options?, isRetry?): Promise<T>
  - Add headers: Authorization (Bearer), X-Org-ID, X-Branch-ID, Content-Type
  - On 401 { code: TOKEN_EXPIRED }: call refreshAccessToken() (deduplicated), retry once
  - On refresh fail: clearTokens(), trigger logout callback
  - On non-2xx: throw Error(response.error)

// Logout callback registration (avoids circular dep)
registerLogoutCallback(fn: () => void)

// Namespace object
export const api = {
  auth: { login, register, google, demo, refresh, logout, forgotPassword, resetPassword },
  organizations: { list, get, create, update },
  branches: { list, get, create, update, delete },
  customers: { list, get, create, update, delete, bulk },
  suppliers: { list, get, create, update, delete, bulk },
  inventory: { list, get, create, update, delete, bulk, catalogBrands, importFromCatalog },
  sales: { list, listFiltered, get, create, updateStatus, void, delete, bulk, byTireType, dashboardStats },
  purchases: { list, get, create, updateStatus, delete, bulk },
  settings: { get, update, systemInfo },
  products: { list, create, update, delete },
  lookups: { tireTypes, addTireType, updateTireType, deleteTireType, tireSuggestions },
  payments: { recordSalePayment, getSalePayments, deleteSalePayment,
               recordPurchasePayment, getPurchasePayments, deletePurchasePayment },
  users: { list, create, update, setStatus, resetPassword },
  profile: { get, update, changePassword },
  catalog: { stats, scraperConfig, saveScraperConfig, runScraper, scraperStatus, entries, deleteEntry },
  fitments: { categories, makes, models, search },
  priceLists: { list, items, import, link },
  audit: { list },
  ledger: { summary, customers, suppliers, customerStatement, supplierStatement, unpaidInvoices, unpaidPOs },
}
```

### Deduplication of refresh calls
```typescript
let _refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = doRefresh().finally(() => { _refreshPromise = null; });
  return _refreshPromise;
}
```

---

## UOW-28 — Colour Theme System

### Purpose
Multiple visual skins selectable per user. Applies instantly across the entire UI. Persisted in browser localStorage. No page reload.

### Architecture (CSS custom property override)
In Tailwind v4, every colour utility (e.g. `bg-teal-500`) resolves to `var(--color-teal-500)`. Override the CSS variable in a `[data-theme]` selector on `<html>` — all utility classes cascade-update instantly with zero component changes.

### Themes
| Theme | Palette | Primary (`teal-500`) |
|---|---|---|
| Ocean Teal (default) | Teal/cyan | `#0d9488` |
| Lavender Fields | Violet/purple | `#7C3AED` |
| Iris Garden | Indigo/blue | `#4F46E5` |
| Spiced Chai | Amber/cinnamon | `#D97706` |

### CSS variable blocks
```css
/* Override every shade used in the app */
[data-theme="lavender"] {
  --color-teal-50: #F5F3FF; --color-teal-100: #EDE9FE;
  --color-teal-200: #DDD6FE; --color-teal-300: #C4B5FD;
  --color-teal-400: #A78BFA; --color-teal-500: #7C3AED;
  --color-teal-600: #6D28D9; --color-teal-700: #5B21B6;
  --color-cyan-400: #C4B5FD; --color-cyan-500: #A78BFA;
  --app-bg: #F4F3FF;
}
/* Similarly for iris and chai */
```

### Why `teal-500` = `#7C3AED` not `#8B5CF6` for Lavender
Violet-500 (#8B5CF6) has insufficient contrast against white text on buttons (WCAG fails). Shifted one step to Violet-600 (#7C3AED) which passes at ~5.7:1.

### Implementation
```typescript
// lib/theme.ts
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('tirepro_theme', theme);
}

export function initTheme(): void {
  const saved = localStorage.getItem('tirepro_theme') || 'default';
  if (saved !== 'default') document.documentElement.setAttribute('data-theme', saved);
}
// Call initTheme() BEFORE React renders (in main.tsx) to avoid flash of default theme
```

### UI: Appearance settings tab (Settings → Appearance)
- Grid of theme cards with gradient swatch + colour dots
- Click card → sets `pending` state (visual highlight only)
- "Apply Theme" button → calls `applyTheme(pending)` → instant cascade
- Button disabled when pending === confirmed (no changes)
- Current theme marked "Active"

### App shell background
Body background is hardcoded `#f0f4f7` by default — replace with `var(--app-bg)` via a `.bg-app-shell` CSS class. Apply to every top-level layout div.

---

## UOW-29 — Background Jobs & Worker Process

### Purpose
Long-running cron jobs decoupled from the HTTP request lifecycle. Run in an isolated worker process to avoid blocking the main API.

### Jobs

**Demo Cleanup (every 30 min)**
- Delete all transactional data for demo org in FK-safe order
- Re-seed fresh demo transactions
- Runs in `server/worker.js` (separate OS process from API server)

**Catalog Scraper (configurable schedule)**
- Default: daily at 2am
- Reads schedule from `settings.scraper_schedule` for org 1
- Options: every_6h / every_12h / daily_2am / daily_6am / weekly / manual
- Deduplicate: skip if `isRunning = true`
- Log results to `catalog_scraper_logs`
- Can also be triggered manually via POST /catalog/scraper/run

### Worker process setup
```javascript
// server/worker.js
async function main() {
  await setupDatabase();       // ensure tables exist
  await initDemoCleanupJob();  // start the 30-min cron
  console.log('Worker running');
}
main();
```

Run the worker separately from the API server:
```
pm2 start server/worker.js --name tirepro-worker
pm2 start server/index.js  --name tirepro-api
```

---

## UOW-30 — User Profile Management

### Purpose
Allow users to view and edit their own profile. Change own password (requires old password). Extended profile fields for HR use.

### Endpoints
```
GET  /profile                          — current user's full profile
PUT  /profile                          — update: name, first_name, last_name, phone, address,
                                         job_title, department, date_of_birth,
                                         emergency_contact_name/phone/relation

POST /profile/change-password
  Body: { currentPassword, newPassword }
  - Verify currentPassword against hash
  - Hash new password
  - Update password_hash
  - Invalidate all existing refresh tokens for this user (force re-login on other devices)
  - Issue new refresh token (user stays logged in on current device)
  - Return: { success: true, refreshToken: newRefreshToken }
```

---

## UOW-31 — Login Form Security (Credential Prefill Prevention)

### Purpose
Login screen must always load with empty fields. Browser password managers must not inject saved credentials.

### Implementation
```html
<form autocomplete="off">
  <input type="email"    autocomplete="off"           />  <!-- email -->
  <input type="password" autocomplete="new-password"  />  <!-- login password -->
  <input type="password" autocomplete="new-password"  />  <!-- register / confirm password -->
</form>
```

**Why `new-password` not `off` on password fields:** Browsers ignore `autocomplete="off"` on password fields by spec (to protect users from malicious sites). `new-password` reliably suppresses autofill across Chrome, Firefox, Safari.

### State rules
- Form state initialises as `{}` — all fields render empty via `value = state[field] ?? ''`
- On failed login: clear password field from state before showing error
- On view switch (login ↔ register ↔ forgot): reset entire form state to `{}`
- No credentials ever stored in localStorage, sessionStorage, or cookies

---

## UOW-32 — Post-Login Navigation

### Purpose
After any login event (email, Google, demo, silent session restore), always land on the Dashboard page.

### Rule
Reset `activePage` to `'dashboard'` synchronously **before** setting authenticated user in state. This ensures the first render after login always shows Dashboard.

```typescript
function handleAuthSuccess(payload) {
  storeTokens(payload.accessToken, payload.refreshToken, payload.rememberMe);
  setOrgContext(payload.org_id, payload.branch_id);
  setActivePage('dashboard');  // ← BEFORE setUser
  setUser(payload.user);
}
```

Applies to: email login, Google SSO, demo login, silent session restore (refresh token on page load).

---

## Appendix A — Shared Invariants

Apply to ALL units of work:

| Rule | Detail |
|---|---|
| **Branch scope** | Every query on branch-scoped tables: `WHERE org_id = ? AND branch_id = ?` |
| **Org scope** | Org-level tables: `WHERE org_id = ?` only |
| **Global tables** | `tire_catalog`, `vehicle_fitments`, `dealer_price_*`: no org filter |
| **Idempotent migrations** | All schema changes in `IF NOT EXISTS` guards — safe to re-run on every boot |
| **Audit trail** | Call `writeAudit()` after every INSERT/UPDATE/DELETE on business entities; fire-and-forget |
| **Demo guard** | Demo users may read everything; mutations blocked at middleware level, not per-route |
| **Never trust client IDs** | org_id and branch_id come from JWT (server-verified), not from request body |
| **Token rotation** | Every refresh token use invalidates old token and issues a new one |
| **Password hashing** | bcrypt, cost factor 12; never store plaintext |

---

## Appendix B — Tech Stack (Current Implementation)

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript, Vite, Tailwind CSS v4 |
| Charts | Recharts |
| PDF | jsPDF + jspdf-autotable |
| Excel | SheetJS (xlsx) |
| Icons | Lucide React |
| Backend | Node.js + Express 4 |
| Database | Microsoft SQL Server (mssql v10) |
| Auth | jsonwebtoken + bcryptjs |
| Jobs | node-cron |
| Process mgmt | PM2 |
| Security | helmet, express-rate-limit |
| Dev proxy | Vite proxy → localhost:3001 |
| Production | Express serves Vite dist at `/tire-pro`; Cloudflare tunnel |

---

## Appendix C — File Map

```
server/
  index.js              API entry, middleware chain, route mounts
  db.js                 All table migrations + seed data (~900 lines)
  context.js            getContext() — extracts orgId/branchId from req
  worker.js             Isolated worker process for background jobs
  middleware/
    auth.js             requireAuth(), requireRole()
    demo.js             blockDemo()
    validateBranchContext.js
  routes/
    auth.js             Login, register, refresh, OAuth, demo (17 endpoints)
    sales.js            CRUD + void + stats (10 endpoints)
    purchases.js        CRUD + status (6 endpoints)
    inventory.js        CRUD + catalog import (8 endpoints)
    customers.js        CRUD + bulk (6 endpoints)
    suppliers.js        CRUD + bulk (5 endpoints)
    products.js         CRUD (4 endpoints)
    payments.js         Sale + purchase payments (6 endpoints)
    ledger.js           Journal + statements + aging (7 endpoints)
    audit.js            List with filters (1 endpoint)
    users.js            CRUD + status + password (5 endpoints)
    organizations.js    CRUD (4 endpoints)
    branches.js         CRUD (5 endpoints)
    settings.js         Get/update + system-info (3 endpoints)
    profile.js          Get + update + change-password (3 endpoints)
    lookups.js          Tire types + suggestions (5 endpoints)
    catalog.js          Stats + scraper control + entries (7 endpoints)
    fitments.js         Categories/makes/models/search (4 endpoints)
    priceLists.js       List + items + import + link (4 endpoints)
  jobs/
    catalogScraper.js   Configurable cron for catalog updates
    demoCleanup.js      30-min reset + transaction re-seeder
  scraper/
    scraperService.js   Scraper orchestration + logging
    gtrScraper.js       GTR catalog file parser + upsert
  seeds/
    tireCatalog.js      Global tire reference seed
    vehicleFitments.js  Pakistan OEM fitment seed
  utils/
    audit.js            writeAudit() fire-and-forget helper

src/
  main.tsx              initTheme() + React root mount
  App.tsx               Auth state, page routing, session restore
  api/client.ts         Typed API namespace object + token refresh
  lib/
    auth.ts             Token storage (localStorage/sessionStorage)
    appSettings.ts      Settings cache
    theme.ts            Theme types + applyTheme() + initTheme()
    utils.ts            cn(), formatCurrency(), formatDate()
    invoicePdf.ts       jsPDF invoice generation
    reportExport.ts     SheetJS Excel export
    useAutoRefresh.ts   Polling hook
    useFetch.ts         Data fetching + loading state hook
    usePagination.ts    Pagination state hook
    usePaymentForm.ts   Payment form logic hook
    useAsyncAction.ts   Async op hook with loading + error
    calculations.ts     Business calc helpers
  types/models.ts       TypeScript interfaces for all entities
  components/
    Sidebar.tsx         Desktop navigation
    Header.tsx          Top bar with org/branch picker
    BottomNav.tsx       Mobile navigation
    POSTerminal.tsx     Point-of-sale interface
    [30+ modal components for CRUD operations]
  pages/
    Auth.tsx            Login, register, forgot/reset password
    Dashboard.tsx       KPIs, charts, quick actions
    Sales.tsx           Invoice list + management
    Purchases.tsx       PO list + management
    Invoices.tsx        Invoice history
    Inventory.tsx       Tire SKU management
    Customers.tsx       Customer directory
    Suppliers.tsx       Supplier directory
    Services.tsx        Services/products management
    Ledger.tsx          Financial journal + statements
    AuditLog.tsx        Immutable audit trail
    Organizations.tsx   Multi-org management
    Settings.tsx        Settings hub (9 tabs)
    Profile.tsx         User profile + password change
    Reports.tsx         Business analytics + export
    PriceLists.tsx      Dealer price catalog + import
    TyreFitment.tsx     Vehicle fitment advisor
    settings/
      CompanyTab.tsx    Company profile settings
      UsersTab.tsx      User management
      DefaultsTab.tsx   Invoice + tax defaults
      LookupsTab.tsx    Tire type management
      ProductsTab.tsx   Product catalog settings
      ServicesTab.tsx   Services management
      AppearanceTab.tsx Theme picker
      CatalogScraperTab.tsx  Scraper control
      SystemInfoTab.tsx Server stats
```
