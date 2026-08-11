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
server.js               (~6 500 lines)  All API routes, auth, DB init, middleware, Excel export
app.js                  (~5 030 lines)  Setup wizard, login, projects/actions CRUD, reservas, portal config, session mgmt
calculadora.js          (~5 600 lines)  Azure cost calculator — self-contained IIFE
index.html              (~3 650 lines)  SPA shell — all views toggled by showView()
portal.html             (~640 lines)    Portal público — calculadora sem autenticação (serve /portal.html)
styles.css              (~1 650 lines)  Dark/light-mode CSS, Vivo purple theme
encrypt-env.js          (139 lines)     AES-256-GCM .env encryption utility
favicon.svg                             App icon (SVG)
mascote.png                             Vivo mascot used in login screen (not tracked by git — keep locally)
.finops_setup                           AES-256-CBC encrypted setup config — do not delete
uploads_tmp/                            Multer temp dir — CSVs deleted automatically after import
```

**Documentação (v2.4):**
```
docs-implementacao.html   Guia técnico: On-Premises (Linux/Windows), Docker, IaaS VM, PaaS (Railway/Render/Azure App Service), variáveis de ambiente, checklist produção
docs-usuario.html         Manual do usuário: todos os módulos + regras de negócio (RN-006, RN-007, RN-DB-001, pico, Databricks, Reservas, Portal Público) — versão para impressão
docs-faq.html             FAQ interativo para usuários autenticados — busca + filtro por categoria (Calculadora, Importação, Administração, Reservas, Portal Público, Databricks)
docs-portal-faq.html      FAQ simplificado para usuários do portal público — linguagem simples, busca por texto
```

**Integração dos FAQs no sistema:**
- `index.html` top-bar: botão `?` abre `docs-faq.html` em nova aba; "← Voltar ao sistema" aponta para `/`
- `portal.html` header: botão `Ajuda` abre `docs-portal-faq.html` em nova aba; "← Voltar à calculadora" chama `window.close()` (preserva sessão do portal)

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
6. `ensureAzureCostsTable()` — CREATE TABLE only (synchronous, fast); all CREATE INDEX run in background `_bgIdx` after 5s delay; `_azureTableReady = true` set immediately after table check
7. `ensureAzureColetaTable()` — creates `azure_coleta_historico` + `azure_coleta_sps`
8. `ensurePriceListTable()` — creates `azure_price_list` + indexes + `azure_price_list_meta` + materialized views `pl_best_mv` / `pl_sku_mv` (awaited before agendador so meta table exists on first tick)
9. `_iniciarAgendador()` — starts automated Azure cost collection scheduler (first tick at 120s)
10. `_refreshAzureCache()` — rebuilds `azure_subs_cache` + `azure_rg_cache` in background (90s delay)
11. SIGTERM/SIGINT handlers registered — close pool + clear keep-alive timer before exit

**Startup performance notes:**
- `ensureAzureCostsTable()` never blocks on CREATE INDEX — all indexes created sequentially in background; server is fully usable in < 1s after DB connect
- `_iniciarAgendador()` uses 120s initial delay to let background DDL and MV creation finish before first tick
- `_tickAgendador` silently skips Price List schedule check if `azure_price_list_meta` doesn't exist yet (transient startup race — no log spam)

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
// HTML: no-cache para evitar que o browser sirva versão desatualizada após deploy
app.use((req, res, next) => {
  if (/\.html?$/i.test(req.path) || req.path === '/' || req.path === '') {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname), { index: 'index.html', etag: true, lastModified: true }));
```
Blocks HTTP access to source code and secrets while serving `index.html`, `app.js`, `styles.css`, `calculadora.js`, `favicon.svg`, `mascote.png` normally.
JS/CSS served with ETag + Last-Modified for cache revalidation. HTML always bypasses cache (`no-store`) — garante que o browser nunca use versão antiga após deploy.

### Database — PostgreSQL only
Tables created by `initDB()` at startup with `IF NOT EXISTS`. No migration framework.
Schema changes go directly in `initDB()` — must be idempotent.

**Core tables:** `perfis`, `permissoes`, `usuarios`, `sessoes`, `projetos`, `acoes_finops`
- `projetos` has `status VARCHAR(20) DEFAULT 'Ativo'` — migration idempotent via `ADD COLUMN IF NOT EXISTS`

**Portal tables:**
- `portal_config` — chave/valor JSON: `key='config'`, `value=JSON`. Campos: `ativo`, `titulo`, `descricao`, `subscription_ids[]`, `resource_groups[]`, `dominios_aceitos[]`, `taxa_imposto`, `taxa_cond`, `horario_livre`, `solicitar_identificacao`
- `portal_acessos` — log de acessos do portal público: `id`, `nome`, `email`, `ip`, `user_agent`, `acessado_em`

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
- Source: Azure Retail Prices API (`prices.azure.com/api/retail/prices?currencyCode=USD`)
- Sync: USD somente; `arm_region_name` armazena a região real do item (ex: `brazilsouth`, `eastus`)
- Coluna `retail_price_brl NUMERIC(20,10)` — preço em BRL quando importado via CSV com essa coluna
- UPSERT conflict key: `(meter_id, type, reservation_term, currency_code, arm_region_name)`
- `reservation_term` is `NOT NULL DEFAULT ''` — JOIN must use `= ''` not `IS NULL`
- ON CONFLICT: `GREATEST(EXCLUDED.retail_price, current)` — nunca sobrescreve preço válido com 0; `retail_price_brl` usa `COALESCE(EXCLUDED, current)` para preservar valor existente
- `TRUNCATE TABLE azure_price_list` antes de cada sync (apaga **todas** as moedas — dados BRL importados via CSV são perdidos no próximo sync USD)
- Key indexes: `LOWER(meter_id)` functional + partial `idx_pricelist_join` + partial `idx_pricelist_sku_svc` (sku+service)

**Materialized views (recriadas a cada startup):**
- `pl_best_mv` — DISTINCT ON `LOWER(meter_id)`, prioriza `type='Consumption'` e `arm_region_name='brazilsouth'`. Colunas: `meter_id_lower`, `currency_code`, `retail_price_norm`, `retail_price_brl_norm` (÷ fator UoM já aplicado)
- `pl_sku_mv` — DISTINCT ON `(LOWER(meter_name), LOWER(meter_category))`, mesmos campos. Fallback quando meter_id não casa
- `REFRESH MATERIALIZED VIEW CONCURRENTLY` disparado após cada sync; fallback sem CONCURRENTLY se o índice único ainda não existir
- JOIN primário: `pl_best_mv pl ON pl.meter_id_lower = LOWER(base._meter_id)`
- JOIN fallback: `pl_sku_mv pls ON pl.meter_id_lower IS NULL AND pls.meter_name_lower = LOWER(base.meter_categories) AND pls.meter_cat_lower = LOWER(base.categoria)` — ativa quando meter_id exato não casa; usa `meter_name` + `meter_category` que são os mesmos namespaces do billing export

**Endpoints de diagnóstico e gestão:**
```
GET    /api/azure-costs/diag            — diagnóstico: contagens, colunas, amostra
POST   /api/azure-costs/refresh-cache   — força rebuild cache de dropdowns
GET    /api/azure-costs/resumo          — sumário geral: total registros, período, custo (cached 5 min)
GET    /api/azure-costs/imports         — lista de arquivos importados com linhas e período (cached 5 min)
GET    /api/azure-costs/purge/preview   — conta registros que seriam removidos (por período ou arquivo)
DELETE /api/azure-costs/purge           — expurgo: sem params = TRUNCATE TABLE (evita deadlock); com params = DELETE com retry 3x em deadlock (código 40P01)
GET    /api/price-list/diag             — cobertura meter_ids billing × PL
```

**Expurgo — notas importantes:**
- "Todos os dados" usa `TRUNCATE TABLE azure_costs` em vez de `DELETE FROM` — evita deadlock com imports concorrentes que fazem UPSERT por linha. TRUNCATE é DDL atômico (sem row-level locks).
- DELETE por período/arquivo tem retry automático (3x, backoff 200 ms/400 ms/600 ms) para o erro 40P01 (deadlock).
- Após qualquer expurgo: invalida `_coberturaCache`, `_resumoCache`, `_importsCache` e dispara `_refreshAzureCache()`.
- `abrirPurge()` em `calculadora.js`: modal abre imediatamente com spinner; `/resumo` e `/imports` carregados em `Promise.all` (paralelo).

**Azure Coleta tables:**
- `azure_coleta_historico` — log of each automated collection run
- `azure_coleta_sps` — Service Principals (tenantId, clientId, clientSecret encrypted)
- `azure_coleta_pendentes` — one-time reprocessing jobs (sp_id, subscription_id, data_inicio, data_fim); scheduler processes and DELETE's them after each run (guaranteed single execution)
- `azure_storage_config.price_list_prefix` — optional blob prefix for Price List CSV/ZIP auto-collection

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
On completion, resets `_coberturaCache`, `_resumoCache`, `_importsCache` to force re-query on next request.

### In-memory query caches (server.js)
Three caches prevent repeated heavy GROUP BY scans on `azure_costs` from concurrent requests:
```
_coberturaCache / _coberturaCacheTs   GET /api/azure-coleta/cobertura-meses   TTL 5 min
_resumoCache    / _resumoCacheTs      GET /api/azure-costs/resumo              TTL 5 min
_importsCache   / _importsCacheTs     GET /api/azure-costs/imports             TTL 5 min
```
- All three are invalidated by `_refreshAzureCache()` (runs after every import/collection) and by `DELETE /api/azure-costs/purge`
- `GET /api/azure-coleta/cobertura-meses?force=1` bypasses cache (used by the ↻ button in the coverage panel)
- `loadCoberturaMeses(force)` passes `force=true` from the ↻ button, 120 s client timeout (heavy query)

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
GET  /api/azure-coleta/status               — current scheduler state + next run time
GET  /api/azure-coleta/historico            — collection history log
DELETE /api/azure-coleta/historico          — clear history
POST /api/azure-coleta/cancelar             — cancel running collection
GET  /api/azure-coleta/cobertura-meses      — monthly data coverage per subscription (cached 5 min; ?force=1 bypasses)
GET  /api/azure-coleta/sps                  — list Service Principals
POST /api/azure-coleta/sps                  — add Service Principal
PUT  /api/azure-coleta/sps/:id              — update SP
DELETE /api/azure-coleta/sps/:id            — remove SP
POST /api/azure-coleta/sps/:id/testar       — test SP credentials
POST /api/azure-coleta/sps/:id/coletar-api  — trigger manual collection
POST /api/azure-coleta/listar-subs-preview  — list subs using credentials from body (no saved SP required — for new SP wizard)
POST /api/azure-coleta/sps/:id/listar-subs  — list subscriptions for saved SP
POST /api/azure-coleta/sps/:id/listar-rgs   — list resource groups for SP
PATCH /api/azure-coleta/sps/:id/ativo       — toggle SP active
PATCH /api/azure-coleta/sps/:id/padrao      — set SP as default
GET  /api/azure-coleta/pendentes            — list pending one-time reprocessing jobs
POST /api/azure-coleta/pendentes            — add pending job (sp_id optional, subscription_id, data_inicio, data_fim)
DELETE /api/azure-coleta/pendentes/:id      — remove pending job
```

**SP modal — subscription listing for new SPs:**
`spBuscarSubs()` checks `sp-edit-id`. If empty (new SP), reads `sp-tenant-id`, `sp-client-id`, `sp-client-secret` from the form and calls `POST /api/azure-coleta/listar-subs-preview` with those values directly — no prior save required. If credential fields are also empty, shows a note to fill them first.

**SP modal — `saveSP()` pitfall:**
`sp-dia` element does not exist in the modal HTML — always use `document.getElementById('sp-dia')?.value` (optional chaining). The entire `saveSP()` body is wrapped in try/catch so any future `null.value` errors surface as a toast instead of silent failure.

### Price List module
`_syncPriceList(currency='USD')` — fetches all pages from Azure Retail Prices API, stores in `azure_price_list`.
- URL: `?api-version=2023-01-01-preview&currencyCode=USD` (sem filtro de região — retorna todos os meters)
- `arm_region_name` armazena a região real do item da API (não mais o sentinel `'global'`)
- Prioridade na MV: `brazilsouth` > outras regiões
- Pagination via `NextPageLink` until exhausted; HTTP 400 "Skip value >= total" treated as end-of-data
- ON CONFLICT usa `GREATEST(EXCLUDED.retail_price, current)` — never overwrites valid price with 0
- Skips items where `retailPrice = 0 AND unitPrice = 0` (free tier / regions without pricing)
- `TRUNCATE TABLE azure_price_list` antes de inserir — apaga **todas** as moedas (incluindo BRL de CSV anterior)
- Após COMMIT: `REFRESH MATERIALIZED VIEW CONCURRENTLY pl_best_mv` + `pl_sku_mv`

`_importPriceListFromCSV(csvPath, filename, clearBefore)` — imports CSV/TSV/ZIP/Parquet.
- `clearBefore=true` (upload manual): `TRUNCATE azure_price_list` before inserting
- `clearBefore=false` (Storage blob): UPSERT incremental
- ZIP: extrai cada entrada com streaming (evita OOM em arquivos grandes); `clearBefore` aplicado só na primeira entrada
- Suporta coluna `retail_price_brl` no CSV — armazenada na coluna homônima da tabela
- ON CONFLICT: `GREATEST` para `retail_price`, `COALESCE(EXCLUDED, current)` para `retail_price_brl`

**Price List coverage cache (`_plCobCache`):** computed in background every 5 min.
- Counts billing meter_ids that have a match in `azure_price_list` (Consumption/DevTest)
- Exposed in `GET /api/price-list/status` as `cobertura { billing_meters, com_pl, cobertura_pct }`

**Price List diagnostic:** `GET /api/price-list/diag` — compares billing vs PL meter_ids.
Returns sample billing meters, sample PL rows, and match percentage.
Button "🔍 Diagnóstico" in the Price List settings screen calls this endpoint.

**Endpoints:**
```
GET  /api/price-list/status        — sync metadata + coverage cache
POST /api/price-list/sync          — triggers sync (background)
POST /api/price-list/import        — upload CSV/ZIP/Parquet (clearBefore=true)
GET  /api/price-list/import-status — import progress
GET  /api/price-list/diag          — meter_id coverage diagnostic
POST /api/price-list/reset-cb      — reset circuit breaker
```

### Calculadora module
`calculadora.js` — IIFE `const Calculadora = (() => { ... })()`.
Exposes public API consumed by `onclick` in `index.html` and by `portal.html`. State is module-private.
Entry point: `Calculadora.init(opts?)`.

```javascript
Calculadora.init({
  apiBase:       '/api/public/calculadora', // troca base de API (portal público)
  publico:       true,                      // desativa import/diagnóstico (features que requerem auth)
  defaultConfig: { taxa_imposto, taxa_cond, horario_livre } // config vinda do servidor
})
```

**State variables relevantes:**
```javascript
_apiBase     = '/api/calculadora'  // sobrescrito pelo portal público
_modoPublico = false               // desativa UI de import quando true
_horarioLivre = { ativo, inicio, fim, dias }  // janela de horas sem cobrança
_dbTaxaMap   = new Map()   // rg_lower → { taxa, valida, totalBrl, hDriver, totalHoras, recursos }
_managedRgMap = new Map()  // rg_upper → { managed_type:'databricks'|'aks', managed_label }
_filtroTipos = new Set()   // tipos selecionados no chip-bar (vazio = todos)
_rgTotalMap  = new Map()   // rg_upper → total billing do período
// v2.1 — pico de billing
_usaPico        = false    // true quando custo_hora_pico > 0 e tipo ≠ reserva/mes e !_dbValidaOv
_usaPicoCluster = false    // true quando custo_hora_pico_cluster > 0 e _dbValidaOv (Databricks)
// perf — lazy pico + cache overlay
_picoCarregado     = false  // flag: pico já carregado para a busca atual
_ultimaUrlRecursos = ''     // URL da última busca — reutilizada por _carregarPico com &pico=1
_ovRMapSrc         = null   // referência de _recursos no momento do último _ovRMap build (cache)
_ovRgSelTotalMap   = null   // Map rg_upper → total BRL dos selecionados (pré-computado em _ovRenderRecursos)
```

**Filter flow:**
subscription dropdown → confirm OK → RG dropdown → confirm OK → date range → Buscar
→ `buscarRecursos()` → `_carregarRecursos()` → `GET /api/calculadora/recursos`

**Tipo de custo (`tipo_custo`) — classificação SQL:**
```
reserva  → charge_type IN ('Purchase','RoundTrustBill') AND pricing_model = 'Reservation'
hora     → unit_of_measure ILIKE '%hour%' OR '%hora%'
dia      → unit_of_measure ILIKE '%day%'
mes      → unit_of_measure ILIKE '%month%' (excl. GB/TiB — ex: serviços faturados por mês)
periodo  → todos os demais (disco, storage, bandwidth, etc.)
```

**Chip-bar de tipos** (`#ctipos-bar`): **sempre visível** quando há ≥ 1 tipo de recurso (`tipos.length < 1` para ocultar — v2.1). `_tipoRecurso(r)` classifica em: `VMs`, `Discos`, `Storage`, `Databricks`, `AKS`, `SQL`, `App Service`, `Rede`, `Rede/CDN`, `Load Balancer`, `Key Vault`, `Monitoramento`, `Reservas`, `Outros`. `_filtroTipos` (Set) controla quais tipos estão ativos. Chip `Databricks` agrupa **ambos os streams**: VMs de infra em `databricks-rg-*` (`consumed_service = Microsoft.Compute`) E linhas de software DBU (`consumed_service = Microsoft.Databricks`) — a detecção é `svc.includes('databricks') || cat.includes('databricks') || rg.startsWith('databricks-rg-')`.

**Grupos de recursos — lazy rendering + chunked interleaved:**
- Grupos colapsados por padrão (`_expandidos[baseId] === true` para expandido; default = colapsado)
- `_toggleGrupo(gIdx)` insere/remove filhas via DOM sem reconstruir a tabela inteira
- `_gBases[]` mapeia índice numérico → baseId (reconstruído a cada `_renderRecursos`)
- `_htmlFilhaRow(r, gIdx, ...)` — função compartilhada por render inicial e lazy expand
- `_renderRecursos` usa **interleaved build+insert**: `tbody.innerHTML=''` imediato → `nextChunk()` constrói e insere 200 grupos por `requestAnimationFrame` → primeiras linhas visíveis em ~32ms sem bloquear o browser
- `selecionarTodos`/`deselecionarTodos` atualiza **`.cck-grupo`** (headers multi-meter) **e `.cck`** (single-meter) — filhos de grupos colapsados não estão no DOM mas `_htmlFilhaRow` lê `_selecionados` ao expandir

**RG dropdown — auto-seleção de filhos gerenciados:**
- `_toggleOpcao('crg', value, checked)` propaga seleção para todos os RGs filhos do pai selecionado
- Detecção: `_dds.crg.data` items com `parent_rg.toUpperCase() === value.toUpperCase()`
- Ao marcar `RG-WORKSPACE` → `DATABRICKS-RG-*` e `MC_*` filhos marcados automaticamente
- Ao desmarcar pai → filhos também desmarcados
- Funciona em ambos os portais (autenticado e público)

**RG gerenciados — `_detectManagedRg(name)` (server.js):**
- `DATABRICKS-RG-*` → `managed_type: 'databricks'`, `managed_label: workspace` (strip último segmento aleatório)
- `MANAGED-RG-ADBX-*` → `managed_type: 'databricks'`, `managed_label: workspace` (strip último segmento)
- `MANAGED-RG-*` (genérico) → `managed_type: 'databricks'`, `managed_label: sufixo completo` — cobre `MANAGED-RG-DBW-*`, `MANAGED-RG-ADB-*` e quaisquer outros prefixos customizados
- `MC_*` → `managed_type: 'aks'`, `managed_label: cluster`, `managed_region`
- Retornado nos endpoints de resource-groups; armazenado em `_managedRgMap` no cliente

**`_resolveParentRgs` — cascata de 5 métodos para encontrar o RG pai:**
1. **Cache** (`_dbWsCache`) — workspace do billing (`resource_id /workspaces/X`) → pai já conhecido; cobre `databricks-rg-{ws}`, `managed-rg-adbx-{ws}`, `managed-rg-{ws}`
2. **Exact** — `managed_label` == nome exato de um RG não-gerenciado
3. **Suffix** — RG normal TERMINA com `-{label}` (ex: `MANAGED-RG-DBW-X` → label=`DBW-X` → pai `RG-DBW-X`); mais confiável que substring
4. **Prefix** — `label-` é prefixo de um RG normal
5. **Substring** — `label` aparece em qualquer posição de um RG normal (menor nome vence)
- Após resolução bem-sucedida: upsert em `azure_ws_cache` → requests subsequentes usam Método 1 (cache, sem heurística)
- `_refreshAzureCache` usa **upsert** (não DELETE+INSERT) em `azure_ws_cache` — preserva entradas `MANAGED-RG-*` entre refreshes
- `_dbWsCache` reconstruído por merge (não substituição) — entradas `MANAGED-RG-*` sobrevivem ao refresh do cache de billing

**Custo/hora billing — 4 níveis de prioridade (SQL):**
```
1. reserva  → total_billing ÷ (8.760h ou 26.280h conforme term 1/3 anos)
2. hora     → total_billing ÷ (SUM(qty) × fator_UoM)
3. dia      → total_billing ÷ (SUM(qty) × 24h)
4. fallback → total_billing ÷ (dias_ativos × 24h)
```

**Custo médio para período (disco, storage, rede):**
```
custo_mes_billing = SUM(total_billing) ÷ dias_ativos × 30
taxa_hora         = custo_mes_billing ÷ 720      ← rateio proporcional ao uso
estimado          = taxa_hora × horas_slider
```
Usado para **chargeback de projeto**: aloca custo proporcional às horas selecionadas.

**RN-006 — Cost ÷ Qty = taxa por unidade nativa (`custo_uom_billing`):**
```sql
custo_uom_billing = ROUND(SUM(cost_in_billing_currency) / NULLIF(SUM(quantity), 0), 8)
```
- Dá o preço real por unidade de medida nativa: R$/GB, R$/DBU, R$/10K tx, etc.
- Valor infalível para auditar a fatura — independente de desconto, reserva ou período selecionado
- Exibição na **tabela billing** (`_custoHora`):
  - `hora`/`dia`: não exibido diretamente (custo/h já é o rate nativo)
  - `periodo`/`mes` (storage, bandwidth): linha laranja secundária `R$/GB`, `R$/10K`, etc.
  - `periodo` com UoM contendo `DBU`: exibido como **valor principal** em azul `⚡ /DBU cobrado`
- Exibição nos **cards de estimativa**: linha secundária laranja em col1 para `periodo`/`mes` sem PL match

**RN-007 — Amortizado para RI/SP (`usa_amortizado` + `taxa_hora_rate`):**
```sql
usa_amortizado = (SUM(cost_in_billing_currency) = 0 AND SUM(effective_price × qty) > 0)
taxa_hora_rate = SUM(effective_price × qty × exchange_rate_pricing_to_billing)
                 / NULLIF(SUM(qty) × fator_UoM, 0)
```
- VMs cobertas por Reserva ou Savings Plan têm `cost_in_billing_currency = 0` (custo já pago na compra da reserva)
- `taxa_hora_rate` = custo amortizado real via `effective_price` — o Azure distribui o valor da reserva por hora
- Fallback em **todos** os pontos de UI: quando `custo_hora_billing = 0` e `usa_amortizado = true`, usa `taxa_hora_rate`
- Badge `⚡ amort./h` na tabela billing · `⚡ Amort./h` no col1 dos cards de estimativa
- `_hadCustoRecurso` (Horas Adicionais) também usa o fallback amortizado

**Databricks — dois streams de billing independentes:**
```
Stream 1 — Infraestrutura (VMs do cluster):
  resource_group = databricks-rg-{workspace}   ← managed RG criado automaticamente
  consumed_service = Microsoft.Compute
  meter_category   = Virtual Machines
  unit_of_measure  = "1 Hour"
  → custo/h via RN-DB-001 (soma_h_driver) · chip-bar: Databricks

Stream 2 — Software (DBUs — Databricks Units):
  resource_group = workspace RG (user-defined)
  consumed_service = Microsoft.Databricks
  meter_category   = Azure Databricks
  unit_of_measure  = "1 DBU" (tipo=periodo) | "DBU-Hour" (tipo=hora)
  → custo/DBU via RN-006 (custo_uom_billing) · chip-bar: Databricks
```
Os dois streams estão em RGs **sem chave de join direta** no billing export. `taxa_cluster` (RN-DB-001) cobre apenas infra (Stream 1). Custo total real/h = `taxa_cluster + (total_DBU_cost / soma_h_driver)` — requer adição manual ou cross-RG join por workspace name (não implementado por fragilidade).

⚠️ `estimado_DBU = custo_mes_billing / 720 × horas` usa hora de **calendário** (assume 24h/dia). Para all-purpose clusters (24/7) = exato; para job clusters subestima o custo/h real (divide por mais horas que o cluster realmente rodou).

**RN-DB-001 — Databricks cluster rate (workspaces `databricks-rg-*`):**

Clusters Databricks são compostos por driver + N workers que rodam em paralelo. O custo por hora de ambiente ativo é a soma de todos os VMs simultâneos, não de um VM individual.

```
soma_h_driver = SUM(MAX(horas_recurso_dia) por dia)   ← abordagem diária (SQL)
                fallback: MAX(horas_reais) global       ← se soma_h_driver não disponível
taxa_cluster  = C_total_rg / soma_h_driver
                ← custo médio por hora de cluster ativo (inclui todos os workers)
estimado_vm_i = (billing_i / soma_h_driver) × horas_slider
                ← participação proporcional de cada VM no custo do cluster
```

**Por que abordagem diária é mais precisa:**
- Para job-clusters (VMs novas a cada sessão), `MAX(horas_reais)` pega só a sessão mais longa do período.
- `soma_h_driver = SUM(MAX_diário)` soma o uptime real de cada dia, capturando múltiplas sessões.
- Para all-purpose clusters (VMs contínuas), as duas abordagens são equivalentes.

Threshold de validade: `H_driver ≥ 24h AND ids_distintos ≥ 2` — garante que é um workspace real com múltiplos VMs.

Por que não usar `SUM(horas_reais)` como denominador (abordagem "blended"):
- Workers rodam **em paralelo**, não em sequência.
- `C_total / SUM_horas` divide como se fossem sequenciais → subestima muito a taxa real.
- Exemplo: 4 workers × 100h cada = 400h somadas, mas o cluster ficou ativo apenas 100h → taxa blended é ¼ do real.

Campos armazenados em `_dbTaxaMap` por RG:
```javascript
{ taxa, valida, totalBrl, hDriver, totalHoras, recursos }
// taxa       = C_total / soma_h_driver  (taxa do workspace — abordagem diária)
// hDriver    = soma_h_driver arredondado (ou MAX global como fallback)
// totalHoras = SUM(horas_reais)          (soma acumulada — só para log)
// recursos   = nº de resource_ids distintos
```

**Pico cluster (v2.1):** `pico_databricks` CTE retorna `custo_hora_pico_cluster` — taxa do pior dia do cluster inteiro. Quando disponível (`_usaPicoCluster = true`), substitui `taxaEfOv` no estimado. VMs Databricks **não** usam `pico_periodo` (pico por VM individual seria semanticamente incorreto para cluster paralelo). `_usaPico` exclui Databricks via `&& !_dbValidaOv`.

Endpoint de diagnóstico: `GET /api/calculadora/diag-databricks?data_inicio=&data_fim=` — compara abordagem atual vs diária por RG, retorna `delta_pct` para avaliar impacto.

UI — cards de estimativa:
- col1 mostra `⚡ Cluster/h` com tooltip `billing_vm ÷ H_driver` + `taxa_cluster` do workspace
- Badge `⚡ Databricks` (azul) na chip-strip de cada VM do cluster

UI — tabela de billing (`_custoHora`):
- VMs em `databricks-rg-*` (tipo=hora): mostra `/h cobrado` + linha `⚡ cluster: R$/h` (contribuição proporcional ao uptime)
- Linhas DBU (UoM contém "DBU", tipo=periodo): mostra `⚡ /DBU cobrado` como valor principal via `custo_uom_billing`
- Linhas DBU-Hour (UoM "DBU-Hour", tipo=hora): mostra `⚡ /DBU·h` como sublabel em vez de `/h cobrado`
- Badge `⚡ DBU` (azul) nos cards de estimativa para linhas de software Databricks (fora de `databricks-rg-*`)
- Col1 dos cards para linhas DBU: `⚡ DBU/mês*` com tooltip informando taxa unitária `R$/DBU`

**Price List integration:** SQL JOINs com `pl_best_mv` / `pl_sku_mv` ainda existem no banco (campos `retail_price_unit`, `desconto_pct` retornados pela query), mas **toda a UI foi removida na v2.1** — sem ícones `📋`, sem badges `▼%`, sem col1 verde. `fonte_estimado` é sempre `'billing'`. Estimado sempre cinza (billing) ou azul (Databricks) ou laranja (pico).

**Pico de billing — Configurar Estimativa (v2.1):**

Usado **apenas** nos cards de estimativa (`_ovRenderRecursos`). A tabela de billing (`_custoHora`) mantém a média histórica.

`pico_periodo` CTE (server.js) — recursos normais:
```sql
-- Agrupa por resource_id + uom + cost_date dentro do ${where} (período selecionado)
-- DISTINCT ON (resource_id, uom) ORDER BY custo_dia DESC → dia de maior billing
-- hora/dia: custo_hora_pico = custo_dia ÷ horas_reais (qty × fator)
-- periodo:  custo_hora_pico = custo_dia ÷ 24
```

`pico_databricks` CTE (server.js) — cluster Databricks:
```sql
-- Agrupa por UPPER(resource_group_name) + cost_date (SOMA todas as VMs do RG)
-- WHERE UPPER(resource_group_name) LIKE 'DATABRICKS-RG-%' ${andCond}
-- DISTINCT ON (rg) ORDER BY pico_custo_rg DESC → dia mais caro do cluster inteiro
-- custo_hora_pico_cluster = pico_custo_rg ÷ pico_h_driver (driver hours naquele dia)
-- Captura autoscale: dia com mais workers → maior custo/h do cluster
```

JS — lógica de ativação:
```javascript
_usaPico        = _picoBrl > 0 && tipo !== 'reserva' && tipo !== 'mes' && !_dbValidaOv
_usaPicoCluster = _dbValidaOv && _picoClusterBrl > 0
```

Col1 priority order em `_ovRenderRecursos`:
1. `reserva` → `Amort./h 🔒`
2. `mes` → `🔒 Fixo/mês`
3. `_usaPico` hora/dia → `⚠ Pico/h` (laranja) com tooltip: data, custo dia, horas
4. `_usaPico` periodo → `⚠ Pico/mês*` (laranja)
5. `_usaPicoCluster` → `⚠ Pico Cluster/h` (laranja) com tooltip: data, custo RG, h_driver
6. `_dbValidaOv` → `⚡ Cluster/h` (azul — fallback sem pico)
7. demais → `Custo/h` / `Custo/mês*`

Col4 Estimado: laranja `⚠` para pico (ambos `_usaPico` e `_usaPicoCluster`); azul `⚡` para Databricks sem pico; cinza para billing normal.

**CSV/TSV import fix:** `_lerCSV` e `_lerCSVBatched` detectam TAB antes de `;` e `,`.
Azure Cost Management exporta `.csv` separado por TAB em exportações recentes (MCA).

**Mapeamento de colunas `_mapRowCSV`:** fallback case-insensitive via `_ci()` para
subscription_id (`SubscriptionGuid`, `Subscription Id`, etc.) e cost_date (`UsageDateTimeKey`).

**Diagnóstico de cache** (`_diagCache`/`_forcarRefreshCache`): exibido no dropdown de
assinatura quando 0 resultados — mostra estado de azure_costs, meter_ids e Price List.

**Legenda colapsável** (`#cov-legenda`): botão 📖 na tela Configurar Estimativa abre grid 2 colunas explicando todos os indicadores (fonte, descontos, H.reais, Uso parcial, /mês*, cores do Estimado, reserva).

**End-date calendar:** enabled — user can freely select the end date. `_sincDataFim()` only auto-fills fim if field is currently empty.

**Horas Adicionais (`#chad-card`) — estimativa de custo incremental:**
- Visível apenas no modo Período, após o primeiro Buscar (oculto no modo Horas)
- `_horasAdd = { ativo, hExtra, dias }` — config em memória (sessão)
- Inputs: `#chad-h-extra` (horas extras/dia), `#chad-dias` (dias do projeto)
- Cálculo: `hTotal = hExtra × dias`; custo por recurso via `_hadCustoRecurso(r, isBRL, taxaBrl)`:
  - `hora/dia` → `custo_hora_billing × hTotal`
  - `periodo` → `(custo_mes_billing ÷ 720) × hTotal`
  - `reserva` → R$ 0 (custo fixo, já pago)
- Quando ativo: adiciona coluna `⏱ Adicional` (laranja) na tabela + banner de resumo acima da tabela
- RG multi-meter: subtotal adicional exibido no header do grupo
- `_hadAtualizarBaseline()` — mostra média h/dia do período billing no card (chamado após busca)
- `_hadToggle(ativo)` / `_hadChange()` — controles expostos no public API

**Horário Livre (`#chl-card`) — desconto de horas fora do expediente:**
- Visível apenas no modo Período (oculto no modo Horas)
- `_horarioLivre = { ativo, inicio, fim, dias[] }` — persiste durante a sessão; ★ Padrão salva em `localStorage`
- `_calcHorasLivres(vIni, vFim)` — itera dia a dia, soma `janela` (hFim-hIni) para cada dia que bate em `dias[]`
  - ⚠️ Conta dias parciais (início/fim do período) como dias completos — para períodos curtos pode subtrair mais horas do que o total; `Math.max(1, horas - livres)` impede resultado ≤ 0
- `_periodos` armazena `{ inicio, fim, horas: horasCobradas, horasTotal, horasLivres }` após aplicar o desconto
- Card exibe resumo: "Xh totais → −Yh livres → Zh cobradas"
- UI: `_hlToggle(ativo)` mostra/esconde `#chl-corpo`; `_hlChange()` relê inputs e atualiza resumo; `_hlSalvarPadrao()` / `_hlLimparPadrao()` persistem em `localStorage 'hl_config'`
- **Portal público:** se `_defaultConfig.horario_livre` existe → `_hlCarregar` bloqueia todos os inputs (`disabled`), oculta botões ★/↺, exibe "⚙ Configurado pelo administrador"; dias marcados em verde (`accentColor:#22c55e`), desmarcados esmaecidos. Se admin não configurou → usuário edita livremente

**Taxas Adicionais — portal público:**
- `_carregarTaxas()`: se `_defaultConfig.taxa_imposto != null` → campo Imposto bloqueado (`disabled`, tooltip "Configurado pelo administrador"); idem para `taxa_cond`
- Se admin não configurou o campo (null/undefined) → usuário pode editar livremente
- Campo Gordura (`cgordura-col`) e botões ★/↺ (`ctaxas-btns`) sempre ocultos no portal público

**Período padrão — ambos os portais:**
- Ao confirmar assinatura (`_confirmarSub` — autenticado) ou ao buscar (`_carregarRecursos` — portal público com período bloqueado): usa `periodo_fim − 30 dias → periodo_fim` da assinatura selecionada
- Garante que o período pré-preenchido sempre aponta para dados reais importados
- Fallback: se `periodo_fim` não disponível, usa hoje como referência

**Configurar Estimativa overlay — performance:**
- `_ovRenderRecursos`: Schwartzian transform no sort (`O(S)` extrações + `O(S log S)` sort de strings puras vs `O(2S log S)` Map lookups inline)
- `_ovRMap` cacheado por referência de `_recursos` (`_ovRMapSrc`) — evita rebuild O(N) em aberturas consecutivas sem nova busca
- IntersectionObserver (`rootMargin: 200px`) no final de cada lote — substitui botão "Carregar mais"; próximos 100 cards carregam automaticamente ao rolar
- `_carregarPico()`: lazy — busca `?pico=1` em background ao abrir overlay; quando resolve, re-renderiza se modal ainda estiver aberto

### Portal Público
`portal.html` — calculadora Azure pública, sem login. Serve `/portal.html` diretamente via `express.static`.

**Ativação:** admin habilita via Configurações → Portal Público → toggle Ativar + Salvar. Config armazenada em `portal_config` (key=`'config'`).

**Tema claro/escuro:** `portal.html` suporta alternância de tema via botão sol/lua no header.
- Inline script antes do primeiro render lê `localStorage 'finops-theme'` e aplica `data-theme="light"` no `<html>` antes do paint (evita flash)
- `_portalToggleTheme()` alterna `data-theme` + salva em `localStorage 'finops-theme'`
- Tema compartilhado com o app autenticado — preferência persiste entre portal e sistema principal
- Header roxo (`#6d28d9`) mantém elementos brancos no tema claro via `[data-theme="light"] .portal-header { background: #6d28d9 }`
- Classe `.crcard-ov` adicionada nos cards do overlay Configurar Estimativa (`calculadora.js`) para permitir sobrescrita via CSS no tema claro

**Middleware `_portalMiddleware`:** lê `portal_config`, bloqueia com 403 se `ativo=false`. Injeta `req.portalCfg` para os handlers seguintes.

**Identificação de usuário (opcional):**
- `solicitar_identificacao=true` OU `dominios_aceitos` não vazio → exibe modal de nome+email antes da calculadora
- `POST /api/public/calculadora/identificar` valida domínio e registra em `portal_acessos`
- Sessão armazenada em `sessionStorage 'portal_ident'` — sem JWT, sem cookies
- ⚠️ XSS: `verAcessosPortal()` em `app.js:2647` renderiza `r.nome` e `r.ip` sem escape em `innerHTML` — fix pendente

**Filtragem de dados:**
- `subscription_ids[]` — apenas essas subs são expostas no portal
- `resource_groups[]` — filtro de RG existe na config mas **não é persistido via UI** (bug em `savePortalConfig` app.js:2568 — `rgs` calculado mas não incluído no body do POST); campo sempre retorna `[]`
- Recursos: `GET /api/public/calculadora/recursos` valida `subscription_id` do request contra `allowedSubs` da config
- Estimativa: `POST /api/public/calculadora/estimar` valida `resource_id` contra `azure_costs` + `allowedSubs`

**Delegação interna para handler privado:**
```javascript
// Encontra o último handler da rota privada via app._router.stack
const handler = app._router.stack
  .filter(l => l.route?.path === '/api/calculadora/recursos')
  .map(l => l.route.stack[l.route.stack.length - 1].handle)[0];
await handler(req, res, () => {});
// ⚠️ Se handler === undefined, nenhuma resposta é enviada (requisição fica presa)
```

**Endpoints públicos (sem auth):**
```
GET  /api/public/calculadora/config          — título, descrição, taxa_imposto, taxa_cond, horario_livre
POST /api/public/calculadora/identificar     — registra acesso (nome, email, ip)
GET  /api/public/calculadora/subscriptions   — subs permitidas pelo admin
GET  /api/public/calculadora/resource-groups — RGs filtrados pela config
GET  /api/public/calculadora/recursos        — delega para handler privado (auth bypassado)
POST /api/public/calculadora/estimar         — estima custo (valida resource_ids)
GET  /api/public/calculadora/projetos        — projetos com status='Ativo'
```

**Endpoints admin (authMiddleware):**
```
GET  /api/admin/portal-config   — lê config atual
POST /api/admin/portal-config   — salva config (sem resource_groups — ver bug acima)
GET  /api/admin/portal-acessos  — log de acessos (limit max 500)
```

**`Calculadora.init` no portal:**
```javascript
Calculadora.init({
  apiBase: '/api/public/calculadora',
  publico: true,
  defaultConfig: { taxa_imposto, taxa_cond, horario_livre }  // vem de /api/public/calculadora/config
});
```
`_modoPublico=true` desativa `_setupImport()` e esconde `#cvista-detalhe`, `#cvista-servico`, `#cimport-area` via CSS `.portal-mode`.

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
--bg:           #040009
--bg-card:      rgba(12, 2, 22, 0.94)
--bg-hover:     rgba(20, 4, 36, 0.80)
--border:       #1e0040
--border-light: #2a0058
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

**Body background** — quase preto com sutilíssimo toque roxo, fixo:
```css
background:
  radial-gradient(ellipse at 20% 50%, rgba(80,0,140,.14) 0%, transparent 50%),
  radial-gradient(ellipse at 80% 20%, rgba(50,0,100,.08) 0%, transparent 45%),
  linear-gradient(170deg, #07000f 0%, #040009 60%, #020006 100%);
background-attachment: fixed;
/* --bg: #040009 — usado por portal.html e elementos que referenciam var(--bg) */
```
`portal.html` usa `background: var(--bg)` (flat). `docs-faq.html` e `docs-portal-faq.html` têm degradê roxo próprio mais intenso.

**Glassmorphism layers:**
- `.sidebar`: `rgba(6,0,14,.92)` + `backdrop-filter: blur(18px)`
- `.top-bar`: `rgba(6,0,14,.86)` + `backdrop-filter: blur(18px)` + `z-index: 20`
- `.stat-card`: `rgba(14,2,28,.90)` + `backdrop-filter: blur(12px)`
- `.modal`: `rgba(8,0,18,.96)` + `backdrop-filter: blur(24px)`

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

**Date/time input styling (styles.css):**
- `::-webkit-calendar-picker-indicator` com `filter: invert(93%) sepia(8%) saturate(200%) hue-rotate(200deg) brightness(105%)` — torna o ícone do calendário/relógio da mesma cor do texto `#e8eaf0` em todos os inputs `type="date"` e `type="time"` do sistema
- Aplicado globalmente em `styles.css` — cobre app autenticado, portal público e qualquer tela

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
`setRefreshInterval(minutes)` — covers dashboard, projetos, ações, estimativas, reservas, coleta, and calculadora views. Countdown shown in FAB button. Timer stored in `_refreshTimer` + `_countdownTimer`, both cleared on logout and before recreation.

`manualRefresh()` — `try/catch/finally` wrapping all views; errors shown as error toast. `calculadora` view calls `Calculadora.buscarRecursos()` to re-run the current search.

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
- [ ] Portal Público: se ativado, verificar que `subscription_ids` está configurado — sem isso, nenhum dado é exposto
- [ ] Portal Público: `solicitar_identificacao=true` ou `dominios_aceitos` configurado para restringir acesso
