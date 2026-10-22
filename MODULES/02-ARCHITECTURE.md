# 02-ARCHITECTURE — System Design & Layers

## High-Level Architecture

```
┌─────────────────┐
│  Browser (SPA)  │  index.html (legacy) + React bundle
└────────┬────────┘
         │ HTTP/REST
┌────────▼────────────────────────┐
│   Express.js (Node, port 3000)  │
├─────────────────────────────────┤
│  Middleware (auth, rate-limit)  │
│  API Routes (/api/*)            │
│  Static file server             │
└────────┬────────────────────────┘
         │ SQL
┌────────▼────────────────────┐
│   PostgreSQL (AWS RDS/local) │
│   Connection Pool (20 conn)  │
└─────────────────────────────┘

┌─────────────────────────────────────────┐
│  External APIs (in parallel)            │
├─────────────────────────────────────────┤
│  Azure Management API                   │
│  Azure Cost Management API              │
│  Azure Resource Graph                   │
│  Microsoft Graph (AAD lookup)           │
│  Databricks OAuth 2.0                   │
│  Databricks System Tables (SQL)         │
│  SMTP Server (email alerts)             │
└─────────────────────────────────────────┘
```

## SPA Topology

**Frontend** (single HTML shell):
- `index.html` — all views toggle with `showView(id)`
- `.view` divs — legacy vanilla-JS views (hidden for migrated)
- `#react-root` — React mounting point (replaced views)
- `app.js` — session management, UI toggling, legacy backend calls
- `calculadora.js` — self-contained cost calculator (legacy)
- `styles.css` — Vivo purple theme, responsive
- `libs/xlsx.full.min.js` — SheetJS (client-side Excel)

**React Bundle** (separate build):
- `frontend/` — Vite project, own `package.json`
- `frontend/dist/react-app.js` + `.css` — production bundle
- `frontend/dist/portal-app.js` — separate bundle for public portal
- Loaded in `index.html` after `app.js` via `<script type="module">`

**Bridge**: `window.__reactBridge` (typescript in `frontend/src/bridge.ts`)
- `mount(viewName)` — Mount React component for that view
- `refresh()` — Invalidate React Query cache
- `logout()` — Cleanup & redirect to login

## Request Flow

### Authentication
1. User enters creds → `POST /api/auth/login` (or `/api/auth/ad`, `/api/auth/entra/callback`)
2. Server issues JWT
3. Client stores in `sessionStorage['finops_token']`
4. Every request includes `Authorization: Bearer <token>`
5. `authMiddleware` validates, sets `req.user`

### Data Fetch (React)
1. Component calls API via `api()` function
2. Automatically includes `Authorization` header
3. Server validates JWT, executes query
4. Response → TanStack Query cache
5. Component re-renders with fresh data

### Static Files
- `express.static()` serves from repo root
- Blocked: `server.js`, `.env*`, `node_modules/`, `frontend/` (except `frontend/dist/`)
- HTML files: `Cache-Control: no-cache` (always revalidate)
- JS/CSS: ETag + Last-Modified (browser decides)

## Caching Strategy

| Layer | What | TTL | Invalidation |
|-------|------|-----|--------------|
| Browser | SPA HTML | no-cache | — |
| Browser | JS/CSS | ETag | — |
| React Query | API responses | varies | manual invalidate |
| Redis / Memory | azure_subs_cache | 5 min | after import/coleta |
| Memory | _resumoCache | 5 min | after purge |
| Memory | _coberturaCache | 5 min | after coleta |
| Database | materialized views | manual REFRESH | `_syncPriceList()` |

## Authorization Model

```
perfil (stored in JWT + usuarios table):
├─ admin       → full access, can manage users/integrations
├─ finops      → can view/edit all modules, export
└─ reader      → view-only access
```

**Gates**:
- `adminMiddleware` → only admins
- `authMiddleware` → any authenticated user
- Row-level access — not implemented (future: per-subscription ACLs)

## Error Handling

| Type | Handling | Response |
|------|----------|----------|
| **400** | Validation error | JSON: `{error: "msg"}` |
| **401** | Auth fail / expired | JSON + 401 status → client logs out |
| **403** | Permission denied | JSON + 403 status |
| **404** | Not found | Plain text "Not found" |
| **409** | Conflict (e.g., duplicate) | JSON: `{error: "msg"}` |
| **503** | DB unavailable | Returns immediately |
| **5xx** | Unexpected error | JSON + 500 (logged) |

See `server.js` error handling section for try/catch patterns.

---

Reference: Full startup sequence in **01-STARTUP.md**, auth flows in **03-AUTHENTICATION.md**, database schema in **06-DATABASE.md**.

## Armadilhas conhecidas

Coisas que já custaram bug em produção. O índice resumido de todas fica em `CLAUDE.md`.

**`server.js` NÃO roda em modo estrito, apesar do `'use strict'` na linha 3.**
O arquivo começa com BOM e com código executável (`process.env.TZ = ...`) antes da diretiva — e
diretiva só vale como primeira instrução. Confirmado lendo os bytes (`od -c`). Consequência:
variável sem `const`/`let` vira global solta em vez de lançar `ReferenceError`, então esse tipo
de erro passa despercebido por anos. `node --check` também não pega.

**`frontend/dist/` é gitignored.** Deploy sem `npm run frontend:build` serve tela em branco.

**Rota literal depois de rota com `:param` no mesmo prefixo é engolida em silêncio.**
`POST /api/integrations/alertas-tipos` nunca executou: `/api/integrations/:tipo`, registrado
antes, casava primeiro e gravava uma linha solta com `tipo='alertas-tipos'`, devolvendo
`{ok:true}` sem salvar nada. Por isso o endpoint hoje é `/api/alertas-tipos`, fora do prefixo.
Express casa por ordem de registro, então o sintoma é "salvou e não persistiu" — só aparece em
teste que RELÊ o estado depois de gravar.
