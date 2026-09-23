# CLAUDE.md — FinOps Manager v4.0

**Developer reference for Claude Code.** Deployment instructions in `README.md`.

## 🚀 Quick Start

```bash
npm install              # Backend dependencies
npm run frontend:install # Frontend React (Vite)
npm run frontend:build   # Build React bundle (REQUIRED before prod)
npm run dev:all          # Dev: Express (3000) + Vite dev server
npm start                # Prod: node server.js
```

⚠️ **Critical**: Production deploys MUST run `frontend:install` + `frontend:build` before starting. Without the bundle, every React screen renders blank.

---

## 📚 Module Reference

| Module | Focus | Key Docs |
|--------|-------|----------|
| **01-STARTUP** | Boot sequence, timers, initialization | Startup phases, 12 background tasks, migration checks |
| **02-ARCHITECTURE** | System design, layers, data flow | SPA architecture, auth flows, database connections |
| **03-AUTHENTICATION** | JWT, LDAP, Entra ID, SSO | Token lifecycle, multi-auth support, permission gates |
| **04-AZURE-API** | Resource Manager, Cost Management, Graph | ARM paths, meter_ids, subscription caching |
| **05-DATABRICKS-API** | OAuth M2M, System Tables, Budgets | Change Analysis, statement execution, quotas |
| **06-DATABASE** | PostgreSQL, schema, migrations | Core tables, performance indexes, materialized views |
| **07-EMAIL-ALERTS** | SMTP, deduplication, event triggers | Alert gates, SMTP config, notification types |
| **08-FRONTEND-REACT** | React migration, bridge, components | Strangler fig, shared auth, state management |
| **09-CALCULADORA** | Financial motor, billing rules (RN-*) | Cost calculation, amortized RI, Databricks cluster |
| **10-DEPLOYMENT** | Docker, Azure, Railway, PM2 | Cloud platforms, environment setup, service config |

👉 **See each module for detailed documentation**

---

## ⚙️ Environment & Secrets

**Critical rule**: Secrets NEVER go in database — only in `.env` (gitignored), held in memory at boot.

Reference: `.env.example` (authoritative template, zero secrets).

**Service Principal naming conventions:**
- `AZURE_TENANT_ID`, `AZURE_SP_CLIENT_ID`, `AZURE_SP_CLIENT_SECRET`
- `DATABRICKS_ACCOUNT_ID`, `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`, `DATABRICKS_WORKSPACE_HOST`
- `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_REDIRECT_URI`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_ADDRESS`, `SMTP_DEFAULT_RECIPIENTS`

**Encryption:**
```bash
node encrypt-env.js encrypt   # .env → .env.enc + .env.key (AES-256-GCM)
node encrypt-env.js run       # Load .env.enc and start server
```

---

## 📋 File Map (Essential)

| File | Purpose | Size |
|------|---------|------|
| `server.js` | API routes, auth, DB init, middleware, Excel export | 13.6 KB |
| `app.js` | Setup wizard, login, CRUD, session, legit backend views | 6.6 KB |
| `calculadora.js` | Azure cost calculator (IIFE, legacy) | 3.8 KB |
| `index.html` | SPA shell, view toggles | 4.0 KB |
| `portal.html` | Public calculator (React, no auth) | < 1 KB |
| `styles.css` | Vivo purple theme, dark/light modes | 1.7 KB |
| `frontend/` | React (Vite) — separate project with its own `package.json` | — |
| `finops-logo.png` / `finops-logo-dark.png` | Logo FinOps — claro / escuro (force-add: `*.png` é gitignored) | — |
| `libs/xlsx.full.min.js` | SheetJS (client-side Excel export) | — |
| `.env.example` | Environment variable template (authoritative) | 6.5 KB |
| `docs-*.html` | User manuals, implementation guide, FAQs | ~150 KB |

---

## 🔐 Authentication

Three methods (all issue same JWT `{id, nome, email, perfil}`):
- **Local**: bcrypt hash in `usuarios` table
- **Active Directory**: LDAP bind + group mapping
- **Microsoft Entra ID**: OAuth 2.0, ID token signature validation via JWKS, group claims

Token storage: `sessionStorage` + `localStorage` (fallback).
Refresh: `GET /api/auth/refresh` validates user still active.
Rate limit: 20 req/15 min on `/api/auth/login` and `/api/auth/ad`.

See **Module 03-AUTHENTICATION** for full flows and code examples.

---

## 📊 Database

**PostgreSQL only.** Schema tables created with `IF NOT EXISTS` at boot (idempotent).

**Core tables:**
- `usuarios`, `perfis`, `permissoes`, `sessoes` (auth)
- `projetos`, `acoes_finops`, `estimativas` (FinOps)
- `reservas_cloud` (reservations)
- `azure_costs`, `azure_*` (Azure billing & inventory)
- `databricks_*` (Databricks consumption, budgets)
- `integracoes` (AD/Entra/SMTP config)

**Performance indexes:**
- `idx_azure_costs_sub_date_rg` (functional, heavy-hitting)
- `idx_azure_costs_resource_id_upper`, `idx_azure_costs_rg_upper`
- 18 single-column indexes on commonly filtered fields

See **Module 06-DATABASE** for full schema, migrations, and index reference.

---

## 🧠 Core Rules (Business Logic)

| Rule | Applies | Effect |
|------|---------|--------|
| **RN-006** | Cost ÷ Qty → `custo_uom_billing` | Price per native unit (R$/GB, R$/DBU) |
| **RN-007** | Amortized RI/SP cost via `effective_price` | `taxa_hora_rate` for `cost=0` lines |
| **RN-DB-001** | Databricks: SUM(cluster VMs/day)/h not per-VM | `suma_h_driver` ÷ horas, cluster-level rate |

See **Module 09-CALCULADORA** for full rule set, RN-* definitions, and test cases.

---

## 🚀 Frontend: React Migration (Strangler Fig)

**Status**: ~90% migrated (Dashboard, Reservas, Ações, Estimativas, Coleta Azure, Calculadora, Portal).

**Pattern**: Legacy SPA (`index.html`) + React bundle (`/react-app/react-app.js`):
- Old views stay in `index.html` as `.view` divs (hidden `display:none`)
- Migrated views mount in `#react-root` via `window.__reactBridge`
- `showView()` (app.js) detects migrated views → calls bridge instead of showing `.view`
- Shared auth: React reads same `sessionStorage 'finops_token'` as legacy, calls `window.logout()` on 401

See **Module 08-FRONTEND-REACT** for bridge details, migration checklist, and component reference.

---

## 🎨 Branding / Logo por tema

- **Escuro é o padrão** e NÃO seta `data-theme`; só o claro seta `data-theme="light"`. Seletor correto para escuro: `:root:not([data-theme="light"])` (nunca `[data-theme="dark"]`).
- Par de imagens por tema: `finops-logo.png` (claro) + `finops-logo-dark.png` (escuro), alternadas por CSS `display`.
- Aplicado em: top-bar e login (`index.html`, classes `.topbar-logo-light/.topbar-logo-dark` em `styles.css`), portal público (`frontend/src/PortalApp.tsx`), `docs-faq.html` e `docs-portal-faq.html` (CSS local, não carregam `styles.css`).
- `.finops-logo` no escuro recebe `brightness(1.9) saturate(1.15)`; as FAQs replicam o filtro para ficar igual ao menu.
- Sidebar (`.brand-icon`) mantém o SVG original de 4 quadrados nos dois temas.
- Pendente: `docs-implementacao.html` e `docs-usuario.html` ainda usam o texto "vivo".

---

## 📮 Email Alerts

**SMTP integration** (new in v4.0):
- Config stored in `integracoes` table (encrypted secrets)
- Triggers: coleta error, orçamento overage, reserva expiring, ação vencendo
- Dedup: 24-hour cooldown per alert type + chave
- Fallback: bell icon in UI (always works, email optional)

See **Module 07-EMAIL-ALERTS** for SMTP config, trigger gates, and dedup logic.

---

## 🌍 Azure & Databricks APIs

**Azure** (Service Principal auth):
- Management API: subscriptions, resource groups, resource properties
- Cost Management: meter_ids, charges, billing aggregations
- Resource Graph: resource inventory, change history, tags
- Activity Log: audit trail (CREATE/UPDATE/DELETE events)
- Microsoft Graph: user/group lookups (Entra ID integration)

**Databricks** (OAuth M2M or PAT):
- System Tables: `system.billing.usage`, `system.billing.list_prices` (Consumption)
- System Tables: `system.lakeflow.job_run_timeline`, `system.compute.clusters` (Inventory)
- Change Analysis: resource-level property diffs (CREATE/UPDATE/DELETE)
- Account APIs: Budgets (quotas), SCIM (principal lookup), Statement Execution

See **Module 04-AZURE-API** and **Module 05-DATABRICKS-API** for endpoint reference, authentication, and code examples.

---

## ✅ Production Checklist

See **DEPLOYMENT_CHECKLIST.md** for the full checklist before shipping to prod.

Key items:
- `JWT_SECRET` and `MASTER_KEY` set (random, ≥32 chars)
- `ALLOWED_ORIGIN` configured for HTTPS domain
- `.env` encrypted (`node encrypt-env.js encrypt`)
- `frontend/dist/` built and deployed
- PostgreSQL accessible, migrations run
- SMTP optional but recommended for alerts
- PM2 or systemd configured for auto-restart

---

## 🔗 Documentation

| Doc | Purpose |
|-----|---------|
| `README.md` | Setup, deployment, environment variables |
| `MODULES/*.md` | 10 specialized modules (see table above) |
| `docs-implementacao.html` | Implementation guide (on-prem, Docker, cloud platforms) |
| `docs-usuario.html` | User manual (all modules + business rules) |
| `docs-faq.html` | FAQ (authenticated users) |
| `docs-portal-faq.html` | Portal FAQ (public users) |

---

## 📝 Last Updated

- **Version**: v4.0.0 (2026-09-23)
- **Modules**: 10 specialized docs in `MODULES/`
- **Migration**: ~90% React (8 views live)
- **Status**: Production-ready

See individual modules for detailed version history, bug fixes, and architectural decisions.

---

**For questions or contributions**: refer to the appropriate module or open an issue on GitHub.
