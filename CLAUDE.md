# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start both frontend (port 5173) and backend (port 3001)
npm start

# Frontend only
npm run dev

# Backend only (with auto-reload)
cd server && npm run dev

# Build for production
npm run build

# Lint
npm run lint

# E2E tests (Playwright)
npm run demo
npm run demo:headed   # with browser visible
npm run demo:ui       # interactive UI
```

## Architecture

### Stack
- **Frontend:** React 19 + TypeScript + Vite, Tailwind CSS v4, Recharts, jsPDF, SheetJS, Lucide
- **Backend:** Node.js + Express 4, Microsoft SQL Server (mssql v10), JWT + bcryptjs
- **Tests:** Playwright (e2e only)

### Request Flow

Every authenticated API request carries two headers set automatically by `src/api/client.ts`:
- `X-Org-ID` — from `localStorage`
- `X-Branch-ID` — from `localStorage` (org_admin can switch branch; branch-scoped users have it baked into JWT)

Backend middleware chain in `server/index.js`:
1. `requireAuth` — validates Bearer JWT, attaches `req.user`
2. `validateBranchContext` — prevents org_admins from targeting branches belonging to other orgs (cached 5 min)
3. Demo role guard — blocks demo users from destructive mutations

Every route handler calls `getContext(req)` (`server/context.js`) to extract `{ orgId, branchId }`.

### Multi-Tenancy Rules

Two scoping patterns — must be used correctly:

| Pattern | Tables | WHERE clause |
|---|---|---|
| Org-scoped | `customers`, `suppliers`, `products`, `tire_types`, `settings` | `organization_id = @orgId` |
| Branch-scoped | `tires`, `sales`, `purchases`, `payments`, `ledger_entries`, `stock_movements`, `audit_logs` | `organization_id = @orgId AND branch_id = @branchId` |

Org admins (`branch_id = null` in JWT) see all branches via `X-Branch-ID` header; branch staff have their branch locked in JWT.

### Database (`server/db.js`)

Auto-migration runs on every server start — `setupDatabase()` creates `TireProDB` if absent, then runs all `IF NOT EXISTS` table creates idempotently. Add new columns via the `ALTER TABLE … ADD … IF NOT EXISTS` pattern already used in db.js.

Single connection pool (max 10 connections), `getPool()` re-connects if pool is closed.

### Auth

- JWT access token: short-lived, contains `{ userId, orgId, branchId, role }`
- Refresh token: hashed in `refresh_tokens` table, rotated on use
- Frontend auto-refreshes on 401 with `code='TOKEN_EXPIRED'` — refresh calls are deduplicated in `src/api/client.ts`
- Password reset via `PATCH /api/users/:id/password` — org_admin only, cannot reset own password, cannot reset inactive user's password

### Roles

| Role | Access |
|---|---|
| `org_admin` | Full system — all routes, all branches in org |
| `branch_manager` | All operations for assigned branch |
| `staff` | Sales, purchases, inventory for assigned branch |
| `demo` | GET all + whitelisted POSTs; blocked from void/status/admin/password routes |

All `/api/users` routes are `org_admin`-only via `router.use(requireRole('org_admin'))`.

### Frontend Routing

No react-router — single `useState` in `src/App.tsx` drives page rendering. Page components live in `src/pages/`. Settings sub-tabs (Company, Users, System) are handled inside `src/pages/Settings.tsx` with a local tab state; the Users tab is `src/pages/settings/UsersTab.tsx`.

### API Client (`src/api/client.ts`)

Typed namespace object — `api.sales.create(...)`, `api.users.resetPassword(...)`, etc. Always use this; never call `fetch` directly from components.

### Audit Logging

Call `writeAudit()` from `server/utils/audit.js` after every INSERT/UPDATE/DELETE. Logs are immutable (no route to edit/delete them). Schema: `{ orgId, branchId, userId, userName, action, entity, entityId, before, after }`.

### Background Jobs

- `server/jobs/catalogScraper.js` — cron-based tire catalog ingestion (shared across orgs, no org scope on `tire_catalog` table)
- `server/jobs/demoCleanup.js` — resets demo org transactional data every 30 min

### Environment

Required vars in `server/.env`:
```
DB_SERVER, DB_USER, DB_PASSWORD, DB_NAME
PORT (default 3001)
ADMIN_PASSWORD   # initial seed password for zmehmood@tirepro.com
JWT_SECRET       # 64-byte hex — generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
