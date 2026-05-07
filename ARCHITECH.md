# TirePro — Architecture Reference

High-fidelity context for engineers and AI agents working on this codebase.

---

## System Overview

Multi-tenant, multi-branch tyre retail management platform.
Single-server Node.js API + React SPA. SQL Server for persistence.

```
Browser (React SPA)
  └── Vite dev server (port 5173)  ──proxy──►  Express API (port 3001)
                                                    └── SQL Server (TireProDB)
```

Production: SPA compiled to `dist/`, served statically by the same Express process under `/tire-pro`. Cloudflare tunnel at `mtc.mazdatyrestore.online`.

---

## Backend (`server/`)

### Entry point — `server/index.js`

Boot sequence:
1. `setupDatabase()` — idempotent migrations + seeds
2. `initCatalogScraperJob()` — starts cron background jobs
3. `app.listen(3001)`

Middleware stack (in order, all under `/api`):

| Layer | File | Purpose |
|---|---|---|
| Auth guard | `middleware/auth.js` | Validates Bearer JWT; attaches `req.user`. Skips `/auth/*`, `/health`, `/fitments`. |
| Branch validation | `middleware/validateBranchContext.js` | Prevents org_admin using X-Branch-ID from another org (5-min cache). |
| Demo guard | inline in `index.js` | Blocks demo role from mutations. GET always allowed; POST allowed on whitelist; DELETE/PUT/PATCH blocked. |

### Database — `server/db.js`

`setupDatabase()` runs on every boot. Pattern: `IF NOT EXISTS` — safe to re-run. Adds new columns via `ALTER TABLE … ADD … IF NOT EXISTS`.

Pool: single `mssql.ConnectionPool`, max 10 connections. `getPool()` reconnects if pool closed/errored.

### Context — `server/context.js`

```js
getContext(req) → { orgId, branchId }
```

Every route handler calls this. `orgId` comes from JWT. `branchId`: from JWT if branch-locked user, else from `X-Branch-ID` header (org_admin switching branch).

### Multi-Tenancy Scoping

| Scope | Tables | WHERE |
|---|---|---|
| Org | `customers`, `suppliers`, `products`, `tire_types`, `settings` | `organization_id = @orgId` |
| Branch | `tires`, `sales`, `purchases`, `payments`, `ledger_entries`, `stock_movements`, `audit_logs` | `organization_id = @orgId AND branch_id = @branchId` |
| Global | `dealer_price_lists`, `dealer_price_items`, `tire_catalog`, `vehicle_fitments` | no org filter (shared reference data) |

### Auth & Tokens

- JWT payload: `{ userId, orgId, branchId, role }`
- Short-lived access token + long-lived refresh token (hashed in `refresh_tokens` table, rotated on use)
- Frontend auto-refreshes on `401 { code: 'TOKEN_EXPIRED' }` — deduplicated in `src/api/client.ts`

### Roles

| Role | Scope |
|---|---|
| `org_admin` | All branches in org. branch_id = null in JWT. |
| `branch_manager` | Assigned branch only. All operations. |
| `staff` | Assigned branch. Sales/purchases/inventory. |
| `demo` | GET all + whitelisted POSTs. Mutations blocked. Data reset every 30 min. |

### Background Jobs

| Job | File | Schedule |
|---|---|---|
| Catalog scraper | `jobs/catalogScraper.js` | Configurable cron (default: daily) |
| Demo cleanup | `jobs/demoCleanup.js` | Every 30 min — resets demo org transactional data |

Both run in isolated worker process (`server/worker.js`) via `demoCleanup` job extraction.

### Audit Logging

`writeAudit()` from `server/utils/audit.js`. Call after every INSERT/UPDATE/DELETE.
Schema: `{ orgId, branchId, userId, userName, action, entity, entityId, before, after }`.
Logs are immutable — no route deletes them.

---

## Frontend (`src/`)

### Routing

No react-router. Single `useState<string>` in `src/App.tsx` drives page rendering.

```ts
const allPages: Record<string, { title, subtitle, component, adminOnly? }> = { ... }
```

Adding a page = add entry here + import component + (optionally) add to Sidebar navGroups.

### API Client — `src/api/client.ts`

Typed namespace object. All fetch calls go through `request<T>()` which:
- Attaches `Authorization: Bearer <token>` + `X-Org-ID` + `X-Branch-ID`
- Handles 401 → auto-refresh → retry (deduplicated)
- Forces logout on refresh failure

**Never call `fetch` directly from components.** Always use `api.*`.

### State Management

No Redux/Zustand. Local component state + prop drilling. Settings cached via `src/lib/appSettings.ts` (populated once after login).

---

## Dealer Price Lists Feature

**Added:** 2026-05-08

### Purpose

Import BG supplier dealer prices into inventory. Provides a reference catalog of all BG tyre SKUs with dealer SET prices (tyre + tube + flap, incl. 18% GST). Users can:
- View all SKUs with inventory match status
- Set a margin % and preview retail price
- Select SKUs and import to inventory (creates new tyre records or updates cost prices)
- Manually link a price list item to any existing inventory SKU

### DB Tables (global — no org scope)

```sql
dealer_price_lists
  id, supplier_name, effective_date, notes, created_at

dealer_price_items
  id, list_id, category, size, design, ply_rating,
  dealer_price,          -- SET = tyre + tube + flap
  tyre_total,            -- tyre component price
  tube_total,            -- tube price (null for tubeless)
  flap_total,            -- flap price (null if not applicable)
  linked_tire_id         -- manual override link to tires.id
```

Seeded on boot: BG April 2026 price list (89 SKUs across Passenger/LT Bias/LT Radial/Truck/Tractor categories).

### Auto-Inventory Matching

`GET /api/price-lists/:id/items` auto-joins to `tires` table:
- Brand = `'BG'`
- Model = design (Passenger Radial) or `design + ' ' + plyRating + 'PR'` (all other categories)
- Size = exact match
- Scoped to `orgId + branchId` (inventory is branch-scoped)

Manual link (`linked_tire_id`) takes precedence over auto-match for import.

### Import Logic (`POST /api/price-lists/:id/import`)

```
for each selected item_id:
  if linked_tire_id → UPDATE tires.cost_price (linked tire, org+branch scoped)
  else if BG match found → UPDATE tires.cost_price
  else → INSERT new tires row (brand='BG', stock=0, sale_price=dealer_price*(1+margin/100))
```

Returns `{ imported: N, updated: M }`.

### Files

| File | Role |
|---|---|
| `server/routes/priceLists.js` | 4 routes: list, items, link, import |
| `server/db.js` | Table creation + BG seed in `setupDatabase()` |
| `server/index.js` | Route mount at `/api/price-lists` |
| `src/api/client.ts` | `api.priceLists.{list, items, import, link}` |
| `src/pages/PriceLists.tsx` | Full page component |
| `src/App.tsx` | Page registration |
| `src/components/Sidebar.tsx` | Nav item under INVENTORY group |

---

## Adding a New Feature — Checklist

1. **DB migration** — add `IF NOT EXISTS` table/column block in `server/db.js` `setupDatabase()`
2. **Route file** — create `server/routes/myFeature.js`, use `getContext(req)` for org/branch
3. **Register route** — add `app.use('/api/my-feature', require('./routes/myFeature'))` in `server/index.js`
4. **Demo guard** — decide: add path to `DEMO_ALLOWED_POST_PREFIXES` or leave blocked
5. **API client** — add namespace to `api` object in `src/api/client.ts`
6. **Page component** — create `src/pages/MyFeature.tsx`
7. **Register page** — add entry to `allPages` in `src/App.tsx`
8. **Sidebar** — add `{ id, label, icon }` to appropriate `navGroups` entry in `src/components/Sidebar.tsx`
9. **Audit** — call `writeAudit()` after mutating operations
10. **Admin-only?** — set `adminOnly: true` in allPages and add id to `ADMIN_ONLY` set if restricted

---

## Environment Variables (`server/.env`)

```
DB_SERVER       SQL Server host
DB_USER         SQL login
DB_PASSWORD     SQL password
DB_NAME         Database name (default: TireProDB)
PORT            API port (default: 3001)
ADMIN_PASSWORD  Initial seed password for zmehmood@tirepro.com
JWT_SECRET      64-byte hex string
```

Generate JWT_SECRET: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
