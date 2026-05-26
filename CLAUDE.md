# CLAUDE.md

Developer reference for Claude Code. Deployment instructions are in `README.md`.

## Commands

```bash
npm install          # install dependencies
npm start            # production (node server.js)
npm run dev          # development (nodemon server.js)
node --check <file>  # syntax check before running
```

**Encrypted env:**
```bash
node encrypt-env.js encrypt   # .env → .env.enc + .env.key (AES-256-GCM)
node encrypt-env.js run       # load .env.enc and start server
```

---

## File Map

```
server.js          (~4 520 lines)  All API routes, auth, DB init, middleware, Excel export
app.js             (~4 060 lines)  Setup wizard, login, projects/actions CRUD, reservas, session mgmt
calculadora.js     (~3 300 lines)  Azure cost calculator — self-contained IIFE
index.html         (~3 260 lines)  SPA shell — all views toggled by showView()
styles.css         (~1 430 lines)  Dark-mode CSS, Vivo purple theme
encrypt-env.js     (139 lines)     AES-256-GCM .env encryption utility
favicon.svg                        App icon (SVG)
mascote.png                        Vivo mascot used in login screen (not tracked by git — keep locally)
.finops_setup                      AES-256-CBC encrypted setup config — do not delete
uploads_tmp/                       Multer temp dir — CSVs deleted automatically after import
```

**SQL reference** (manual maintenance — schema managed by server.js at startup):
```
schema.sql                   Core tables reference
init.sql                     DB init reference
azure_costs_migration.sql    azure_costs full schema (80+ fields)
indices_performance.sql      Functional index reference
migration_fix_nulls.sql      NULL deduplication / data cleanup
normalizar_resource_group.sql  resource_group_name case normalisation
```

---

## Architecture

Single-process Node.js + Express backend serving a vanilla-JS SPA. No build step.
`index.html` loads `styles.css`, `app.js`, `calculadora.js` directly from the same directory.

### Startup sequence
1. Load env (`loadEnv()`) — reads `.env.enc`+`.env.key` → falls back to `.env` → system env
2. Console warnings if `JWT_SECRET` or `MASTER_KEY` are using insecure defaults
3. Apply security middleware (helmet, rate-limit on auth routes, CORS)
4. `isConfigured()` — checks for `.finops_setup`; if absent, serves only the setup wizard
5. `initDB()` — creates all core tables with `IF NOT EXISTS`
6. `ensureAzureCostsTable()` — creates `azure_costs` + 11 indexes (incl. functional)
7. `ensurePriceListTable()` — creates `azure_price_list` + indexes (incl. functional on `LOWER(meter_id)`)
8. `ensureAzureColetaTable()` — creates `azure_coleta_historico` + `azure_coleta_sps`
9. `_refreshAzureCache()` — rebuilds `azure_subs_cache` + `azure_rg_cache` in background
10. `_iniciarAgendador()` — starts automated Azure cost collection scheduler
11. SIGTERM/SIGINT handlers registered — close pool + clear keep-alive timer before exit

### Authentication
Three methods — all issue the same JWT payload `{id, nome, email, perfil}`:
- **Local** — bcrypt password hash stored in `usuarios` table
- **Active Directory** — LDAP bind via `ldapjs`; email sanitized before filter construction to prevent LDAP injection
- **Microsoft Entra ID** — OAuth 2.0 redirect flow

Token stored in `sessionStorage` + `localStorage` (fallback).
`authMiddleware` — verifies `Authorization: Bearer <token>`. Returns 401 on failure.
`dbMiddleware` — returns 503 if pool is null (pre-setup state).
Rate limiting: 20 req / 15 min on `/api/auth/login` and `/api/auth/ad`.

### Static file security
`express.static(__dirname)` com middleware de bloqueio antes:
```javascript
const _SENSITIVE = /^\/?(server\.js|encrypt-env\.js|package(-lock)?\.json|\.env(\.\w+)?|\.finops_setup|CLAUDE\.md|README\.md|.*\.sql$|.*\.key$|.*\.enc$)/i;
app.use((req, res, next) => {
  if (_SENSITIVE.test(req.path) || req.path.includes('node_modules')) return res.status(403).end();
  next();
});
app.use(express.static(path.join(__dirname), { index: 'index.html' }));
```
Blocks HTTP access to source code and secrets while serving `index.html`, `app.js`, `styles.css`, `calculadora.js`, `favicon.svg`, `mascote.png` normally.

### Database — PostgreSQL only
Tables created by `initDB()` at startup with `IF NOT EXISTS`. No migration framework.
Schema changes go directly in `initDB()` — must be idempotent.

**Core tables:** `perfis`, `permissoes`, `usuarios`, `sessoes`, `projetos`, `acoes_finops`

**Reservas table:** `reservas_cloud`
- Columns: `id`, `cloud`, `nome_reserva`, `tipo_escopo`, `subscription_id`, `resource_group_name`, `tipo_recurso`, `instancia`, `quantidade`, `prazo`, `opcao_pagamento`, `custo_total`, `custo_mensal`, `data_inicio`, `data_vencimento`, `status`, `observacoes`, `criado_por`, `criado_em`, `atualizado_em`
- `GET /api/reservas?status=Ativa` — filtered by cloud and/or status, ordered by `data_vencimento ASC`

**Azure tables:**
- `azure_costs` — created lazily by `ensureAzureCostsTable()` on first import
  - UPSERT conflict key: `(subscription_id, resource_id, cost_date, meter_id, charge_type, quantity)`
  - NULL in any conflict column breaks deduplication (PostgreSQL NULL ≠ NULL)
- `azure_subs_cache` — pre-aggregated subscription list (subscription_id PK)
- `azure_rg_cache` — pre-aggregated RG list (subscription_id + resource_group_name_upper PK)

**Price List table:** `azure_price_list` — created by `ensurePriceListTable()`
- Source: Azure Retail Prices API (`prices.azure.com/api/retail/prices`)
- Sync: global USD only (`currencyCode eq 'USD'`); `arm_region_name = 'global'` sentinel
- UPSERT conflict key: `(meter_id, type, reservation_term, currency_code, arm_region_name)`
- `reservation_term` is `NOT NULL DEFAULT ''` — JOIN must use `= ''` not `IS NULL`
- Key indexes: `LOWER(meter_id)` functional index for case-insensitive JOIN
- JOIN with `azure_costs`: `LOWER(pl.meter_id) = LOWER(base._meter_id) AND pl.type IN ('Consumption','DevTestConsumption') AND pl.reservation_term = ''`

**Azure Coleta tables:**
- `azure_coleta_historico` — log of each automated collection run
- `azure_coleta_sps` — Service Principals (tenantId, clientId, clientSecret encrypted)

**Performance indexes on azure_costs:**
```
idx_azure_costs_date              cost_date
idx_azure_costs_sub               subscription_id
idx_azure_costs_rg                resource_group_name
idx_azure_costs_resource_id       resource_id
idx_azure_costs_service           consumed_service
idx_azure_costs_meter_cat         meter_category
idx_azure_costs_importado         importado_em
idx_azure_costs_sub_rg            (subscription_id, resource_group_name)
idx_azure_costs_sub_date          (subscription_id, cost_date)
idx_azure_costs_rg_upper          UPPER(resource_group_name)             — functional
idx_azure_costs_sub_rg_upper      (subscription_id, UPPER(resource_group_name))  — functional
```

### Dropdown cache (`_refreshAzureCache`)
Rebuilds `azure_subs_cache` and `azure_rg_cache` from `azure_costs`.
Called at startup and after every successful import (fire-and-forget).
Subscription and resource-group endpoints fall back to a direct query if cache is empty.
Reduces dropdown load from ~12 s (full GROUP BY) to < 5 ms (tiny cache table scan).

### Azure cost import
`POST /api/azure-costs/import` — multer upload, accepts `.csv` and `.parquet`.
- CSV: streamed line-by-line via `_mapRowCSV`
- Parquet: read via `@dsnp/parquetjs` via `_mapRow`
- Both normalize values with `_toDate()`, `_toNum()`, `_toStr()`
- Azure exports mix casing: `Date`, `SubscriptionId` (Pascal), `invoiceId` (camel) — mappers handle both
- Import runs in background job (`_processarImport`); progress via `GET /api/azure-costs/import-status`
- Temp file deleted after processing; `uploads_tmp/` directory is kept
- `req.setTimeout(0)` / `res.setTimeout(0)` intentionally disabled for large file uploads (up to 2 GB)

### Azure Coleta Automática
Automated cost collection via Azure Management + Storage APIs (no manual CSV needed).

**Service Principals (`azure_coleta_sps`):** each SP stores `tenant_id`, `client_id`, `client_secret` (encrypted with MASTER_KEY). Required Azure RBAC: `Reader` + `Storage Blob Data Reader`.

**Scheduler (`_iniciarAgendador`):** runs at configured time/days. Uses `_computeProximaColeta()` to calculate next run. Stores results in `azure_coleta_historico`.

**Circuit breaker (`_cbCanAttempt` / `_cbRecordSuccess` / `_cbRecordFailure`):** prevents hammering Azure API on repeated failures. Opens after 3 consecutive failures; resets after 5 minutes.

**Fetch helper (`_cbFetch`):** wraps `fetch` with timeout (30s), retry (3x) and circuit breaker integration.

**Endpoints:**
```
GET  /api/azure-coleta/status          — current scheduler state + next run time
GET  /api/azure-coleta/historico       — collection history log
DELETE /api/azure-coleta/historico     — clear history
POST /api/azure-coleta/cancelar        — cancel running collection
GET  /api/azure-coleta/sps             — list Service Principals
POST /api/azure-coleta/sps             — add Service Principal
PUT  /api/azure-coleta/sps/:id         — update SP
DELETE /api/azure-coleta/sps/:id       — remove SP
POST /api/azure-coleta/sps/:id/testar  — test SP credentials
POST /api/azure-coleta/sps/:id/coletar-api  — trigger manual collection
POST /api/azure-coleta/sps/:id/listar-subs  — list subscriptions for SP
POST /api/azure-coleta/sps/:id/listar-rgs   — list resource groups for SP
PATCH /api/azure-coleta/sps/:id/ativo  — toggle SP active
PATCH /api/azure-coleta/sps/:id/padrao — set SP as default
```

### Price List module
`_syncPriceList(currency='USD')` — fetches all pages from Azure Retail Prices API, stores in `azure_price_list`.
- No `armRegionName` filter — global sync (filter caused API to return 0 items)
- Pagination via `NextPageLink` until exhausted
- Stores `arm_region_name = 'global'` as sentinel
- `resultKey` declared before `try` block to be accessible in `catch`

`GET /api/price-list/status` — returns last sync metadata (timestamp, record count, errors).
`POST /api/price-list/sync` — triggers sync (background, responds immediately with jobId).

### Calculadora module
`calculadora.js` — IIFE `const Calculadora = (() => { ... })()`.
Exposes public API consumed by `onclick` in `index.html`. State is module-private.
Entry point: `Calculadora.init()`.

**Filter flow:**
subscription dropdown → confirm OK → RG dropdown → confirm OK → date range → Buscar
→ `buscarRecursos()` → `_carregarRecursos()` → `GET /api/calculadora/recursos`

**UoM cost model (unified hourly):**
- UoM contains `hour`/`hora` → `custo_hora = SUM(unit_price × qty) / total_qty`
- All other UoMs → `custo_hora = total_billing / 30 / 24`
- Both types use the hours slider. Non-hour resources show `/h*` label.

**Price List integration (v2.0):**
- `isHora = tipo === 'hora' || tipo === 'dia'` — guard for hourly PL
- `hora`/`dia`: `retailHora = retail_price / uomFactor × convR` — discount badge `▼ X% vs tabela`
- `periodo` (discos/storage): `retailMes = retail_price / uomFactor × convR` — monthly reference
- `reserva`: `retailHoraRsv` = on-demand reference; badge azul `▼ X% reserva vs on-demand`
- `fonte_estimado`: `'price_list'` (verde 📋) or `'billing'` (cinza, custo histórico)
- `temPL = (isHora && retailHora > 0) || (!isHora && retailMes > 0)` — drives UI indicators

**Legenda colapsável** (`#cov-legenda`): botão 📖 na tela Configurar Estimativa abre grid 2 colunas explicando todos os indicadores (fonte, descontos, H.reais, Uso parcial, *, cores do Estimado).

**End-date calendar:** enabled — user can freely select the end date. `_sincDataFim()` only auto-fills fim if field is currently empty.

### Reservas module
`_RSV_SCOPE_CONFIG` — per-cloud scope configuration object in `app.js`. Defines field labels, placeholders, and whether a field uses API-driven CMS dropdown (`api:true`) or manual text input.

`_RSV_DEFAULT_SCOPE` — maps each cloud to its default scope so field labels appear immediately on cloud selection:
```
Azure → Subscription | AWS → Account | GCP → Project | Oracle → Tenancy | Multicloud → Shared
```

**CMS dropdowns (`.cms-wrap`):** used for Azure Subscription and Resource Group fields. State variables:
- `_rsvSubVal`/`_rsvSubName` — committed values
- `_rsvSubPend`/`_rsvSubPendName` — pending (inside open dropdown)
- Subscription display name stored at selection time via `data-lbl` on radio buttons — avoids dependency on `subscription_name` being non-null in DB

**Prazo → Vencimento auto-fill:** `onRsvPrazoChange()` calculates `data_vencimento` from `data_inicio` + years selected in prazo.

**Reserva alerts popup (`modal-rsv-alerts`):** fires on every login (no session guard). `checkRsvAlertsPopup()` fetches `GET /api/reservas?status=Ativa`, filters for `data_vencimento ≤ 90 days`, shows popup if any found. Popup stops appearing automatically when status is updated to Renovada or Cancelada. Severity badges:
- `< 0 dias` → Expirada (red)
- `0–30 dias` → Crítico (orange)
- `31–60 dias` → Atenção (yellow)
- `61–90 dias` → Aviso (blue)

### Excel export
`GET /api/export/excel` — ExcelJS, 3-sheet `.xlsx`:
1. **Sumário Executivo** — status + cloud breakdown
2. **Ações Detalhadas** — full list with auto-filter + freeze pane
3. **Retorno Mensal** — monthly breakdown

Vivo purple palette (ARGB): `FF4A0080` dark · `FF7B2FBE` main · `FFF3E8FF` light · `FF9333EA` accent.

### UI — Vivo purple theme

**CSS variables (`:root` in styles.css):**
```css
--bg:           #0c0014
--bg-card:      rgba(22, 4, 38, 0.82)
--bg-hover:     rgba(45, 8, 72, 0.70)
--border:       #280040
--border-light: #3d0060
--text:         #e8eaf0
--text-muted:   #7b6a9e
--text-dim:     #a990cc
--accent:       #9333ea
--accent-dim:   rgba(147, 51, 234, 0.12)
--accent-glow:  rgba(147, 51, 234, 0.28)
--danger:       #ff4d6a   /* = --red */
--red:          #ff4d6a
--orange:       #ff8c42
--green:        #22c55e
--blue:         #4da6ff
```

**Body background** — radial gradient (fixed):
```css
radial-gradient(ellipse at 25% 45%, rgba(90,0,160,.55) ...) +
radial-gradient(ellipse at 75% 80%, rgba(60,0,100,.30) ...) +
linear-gradient(160deg, #1a0030 → #0c0014 → #04000c)
```

**Glassmorphism layers:**
- `.sidebar`: `rgba(18,2,32,.75)` + `backdrop-filter: blur(18px)`
- `.top-bar`: `rgba(18,2,32,.65)` + `backdrop-filter: blur(18px)` + `z-index: 20`
- `.stat-card`: `rgba(22,4,38,.72)` + `backdrop-filter: blur(12px)`
- `.modal`: `rgba(18,2,32,.88)` + `backdrop-filter: blur(24px)`

**Cloud stats strip** (`.cloud-stats-strip`) — sticky bar at top of views:
- Container: `rgba(22,4,38,.72)` + `backdrop-filter: blur(14px)` + `border-radius: 14px`
- Cards inside: `rgba(22,4,38,.50)` + `border: 1px solid var(--border)` + `border-radius: 10px`
- Active card: `border-color: var(--accent)` + `background: rgba(147,51,234,.18)` + inner glow

**Page titles** (`.page-title`):
- `font-size: 22px`, `font-weight: 700`, `text-transform: uppercase`
- Gradient text: `linear-gradient(90deg, #c084fc → #9333ea → #7c3aed)`
- `filter: drop-shadow(0 0 8px rgba(147,51,234,.5))`

**Button classes:**
- `.btn-primary` — filled accent purple, white text (defined in `styles.css`)
- `.btn-ghost` / `.btn-secondary` — transparent with border, muted text (defined in `styles.css`)
- `.btn-sso` — SSO login buttons (defined inline in `index.html`)
- `.btn-export` — defined in `index.html` inline `<style>` (overrides external CSS)

**Key element rules:**
- `.currency`, `.months-table .positive` → `var(--accent)`
- `.btn-primary`, `.cbtn-go`, `.cms-btn-ok` → `color: #ffffff`
- `.toast.success` → accent background, **white** text (`#ffffff`)

**Compatibility CSS aliases** (in `:root` — do not remove):
- `--surface` → `rgba(22,4,38,.82)` — used by inline styles in index.html
- `--base` → `#0c0014`
- `--surface-alt` → `rgba(12,0,20,.90)`
- `--text-primary` → `#e8eaf0`

**Known latent issue — do not touch:**
- `calculadora.js` element ID `ccondominио` contains Cyrillic chars (и, о). It works because HTML and JS use the identical string. Do not refactor this ID without replacing all 6+ occurrences atomically.

### Top-bar brand
Left group: hamburger button + `div.topbar-vivo-brand` containing a single SVG `<text>` "vivo" in `#9333ea` (58×26 px, Arial Black 900, `drop-shadow` glow). No canvas, no mascote, no load delay.
Hidden on mobile via `@media (max-width: 768px) { .topbar-vivo-brand { display: none !important; } }`.

### Login screen
- Background: dark `#0c0014` + `::before` radial glow + `::after` conic-gradient rays (animated)
- `.login-rays` + `.login-glow` — extra animated ray layers for depth
- Logo: SVG "vivo" text (`#9333ea`, 46px Arial Black) com canvas do `mascote.png` ao lado
  - Canvas starts at `opacity:0`; `onload` revela ambos juntos para evitar flash
  - **`onerror` handler:** se `mascote.png` falhar, SVG "vivo" aparece sozinho (canvas hidden)
  - `mascote.png` não está no git (`.gitignore: *.png`) — manter cópia local no servidor
- Card: `rgba(18,2,32,.78)` + `backdrop-filter: blur(24px)` + purple border + float animation
- **Dark theme is the default** — `doLogin()` removes `data-theme` attribute and clears `localStorage 'finops-theme'` on every login

### Navigation
`openNavGroup(id)` — always opens a sidebar nav group (adds `.open`).
`toggleNavGroup(id)` — toggles open/closed.
Dashboard header calls `openNavGroup('dashboard')`. Chevron icon calls `toggleNavGroup` with `stopPropagation`.

Nav group CSS is defined **once** in styles.css (~line 213). Do not add a second block — a duplicate existed and was removed.

### Notification panel
Bell icon opens `#notif-panel`. Light theme: `rgba(110, 30, 170, 0.95)` (medium Vivo purple). Dark theme: default dark surface.

### Auto-refresh
`setRefreshInterval(minutes)` — covers dashboard, projetos, ações, estimativas, reservas, and custos views. Countdown shown in FAB button. Timer stored in `_refreshTimer` + `_countdownTimer`, both cleared on logout and before recreation.

### Interval lifecycle (app.js)
All recurring timers have named references and are cleared on logout:
```
_dbStatusInterval   checkDbStatus()       every 30 s
_notifInterval      loadNotificacoes()    every 5 min
_refreshTimer       manualRefresh()       configurable (default 10 min)
_countdownTimer     countdown display     same as _refreshTimer
_inactivityTimer    showTimeoutWarning()  15 min idle
```

---

## Environment variables

```
JWT_SECRET      string   Required in prod — default 'finops-secret-2024' triggers startup warning
JWT_EXPIRES     string   Token TTL, default '8h'
MASTER_KEY      string   Required in prod — default triggers startup warning
DB_HOST         string   PostgreSQL host
DB_PORT         number   default 5432
DB_NAME         string   default 'finops_db'
DB_USER         string   default 'postgres'
DB_PASSWORD     string   required
PORT            number   default 3000
ALLOWED_ORIGIN  string   CORS origin — null reflects all origins (dev only); set in prod
DATABASE_URL    string   Optional — parsed into DB_* vars (Railway/Render/Fly.io)
```

Config priority: `DB_HOST` env var → `DATABASE_URL` → `.finops_setup` file → setup wizard.

---

## Generating JWT_SECRET and MASTER_KEY

Never invent these values manually. Use one of the commands below to generate cryptographically secure strings:

**Node.js (recommended — already on the server):**
```bash
node -e "const c=require('crypto'); console.log('JWT_SECRET=' + c.randomBytes(48).toString('hex')); console.log('MASTER_KEY=' + c.randomBytes(48).toString('hex'));"
```
Prints both lines ready to paste into `.env`.

**PowerShell (Windows):**
```powershell
# Run twice — once per variable
[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

**Rules:**
- Minimum **32 characters** (both methods above produce 96)
- Never share `JWT_SECRET` — anyone who has it can forge valid login tokens
- If `MASTER_KEY` changes after setup, `.finops_setup` becomes unreadable — store it in a safe place
- Server prints a console warning on startup if either value is still the insecure default

---

## Cloud deployment

### Railway (quickest start)
1. Create project → **+ New > Database > PostgreSQL** — `DATABASE_URL` injected automatically
2. Add variables: `JWT_SECRET`, `MASTER_KEY`, `ALLOWED_ORIGIN`
3. Start command: `node server.js`
4. `DATABASE_URL` is parsed automatically into `DB_*` vars — no need to set them separately

### Render
1. Web Service: Build = `npm install`, Start = `node server.js`
2. Create PostgreSQL → copy **Internal Database URL** → set as `DATABASE_URL` in env vars
3. Add `JWT_SECRET`, `MASTER_KEY`, `ALLOWED_ORIGIN`

### Fly.io
```bash
fly launch --name finops-manager --region gru   # gru = São Paulo
fly postgres create --name finops-db
fly postgres attach finops-db                   # injects DATABASE_URL
fly secrets set JWT_SECRET=<value> MASTER_KEY=<value> ALLOWED_ORIGIN=https://...
fly deploy
```

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```
```bash
docker run -d --name finops -p 3000:3000 \
  -e JWT_SECRET=... -e MASTER_KEY=... -e DATABASE_URL=... -e ALLOWED_ORIGIN=... \
  -v finops-data:/app \          # persists .finops_setup + uploads_tmp + mascote.png
  finops-manager
```

### Azure PaaS — App Service + PostgreSQL Flexible Server
```bash
az group create --name rg-finops --location brazilsouth
az postgres flexible-server create \
  --resource-group rg-finops --name finops-pg \
  --location brazilsouth --version 16 \
  --admin-user pgadmin --admin-password <senha> \
  --sku-name Standard_B1ms --tier Burstable
az postgres flexible-server db create --resource-group rg-finops \
  --server-name finops-pg --database-name finops_db
az webapp create --resource-group rg-finops --plan finops-plan \
  --name finops-manager --runtime "NODE:18-lts"
az webapp config set --resource-group rg-finops \
  --name finops-manager --startup-file "node server.js"
az webapp config appsettings set --resource-group rg-finops \
  --name finops-manager --settings \
  DATABASE_URL="postgresql://pgadmin:<senha>@finops-pg.postgres.database.azure.com:5432/finops_db?sslmode=require" \
  JWT_SECRET=<gerado> MASTER_KEY=<gerado> \
  ALLOWED_ORIGIN=https://finops-manager.azurewebsites.net
zip -r finops.zip . -x "node_modules/*" -x ".env" -x "uploads_tmp/*"
az webapp deploy --resource-group rg-finops \
  --name finops-manager --src-path finops.zip --type zip
```

---

## Configuring as a system service

### PM2 — Linux & Windows (recommended)
```bash
npm install -g pm2
pm2 start server.js --name finops-manager
pm2 save
pm2 startup
```
Key commands: `pm2 status` · `pm2 logs finops-manager` · `pm2 restart finops-manager`

### systemd — Linux
Create `/etc/systemd/system/finops-manager.service`:
```ini
[Unit]
Description=FinOps Manager - Vivo
After=network.target postgresql.service

[Service]
Type=simple
User=finops
WorkingDirectory=/opt/finops-manager
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/opt/finops-manager/.env

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable finops-manager
sudo systemctl start finops-manager
sudo journalctl -u finops-manager -f
```

### Windows Service — NSSM
```powershell
nssm install FinOpsManager
nssm set FinOpsManager Application  "C:\Program Files\nodejs\node.exe"
nssm set FinOpsManager AppDirectory "C:\finops-manager"
nssm set FinOpsManager AppParameters "server.js"
nssm set FinOpsManager Start SERVICE_AUTO_START
nssm start FinOpsManager
```

---

## Production checklist

- [ ] `JWT_SECRET` set to a long random string (≥ 32 chars)
- [ ] `MASTER_KEY` set to a long random string (≥ 32 chars)
- [ ] `ALLOWED_ORIGIN` set to the exact frontend domain
- [ ] `DB_PASSWORD` set and not default
- [ ] `.env.enc` used instead of plain `.env` (run `node encrypt-env.js encrypt`)
- [ ] HTTPS termination at reverse proxy (nginx / Caddy) — Node runs HTTP only
- [ ] `uploads_tmp/` writable by the Node process
- [ ] PostgreSQL accessible from Node host on configured port
- [ ] `mascote.png` present in the app directory (not tracked by git — copy manually)
- [ ] Windows Firewall: port 3000 open for inbound connections (if accessed from network)
- [ ] PM2 or systemd configured for auto-restart on crash/reboot
