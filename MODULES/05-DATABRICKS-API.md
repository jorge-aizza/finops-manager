# 05-DATABRICKS-API — OAuth M2M / PAT, System Tables, Budgets

> Revisado em 2026-10-03 contra o código atual (`server.js`) — a versão anterior deste
> documento tinha descrições genéricas/desatualizadas (circuit breaker e retry 429 que na
> verdade só existem para a Azure Price List, não para Databricks). Ver também o guia
> não-técnico `MODULES/05-DATABRICKS-SETUP-GUIA.md` para o passo a passo de configuração.

## Dois modos de autenticação (`modo_auth`)

A configuração (`databricks_coleta_config.modo_auth`) aceita dois valores — resolvidos por
`_resolveDbxToken(cfg)` (`server.js`):

### `oauth_m2m` (padrão)
Service Principal de **conta** Databricks (account-level, não workspace-level). Exige
`account_id` + `client_id` + `client_secret`.

**Endpoint**: `https://accounts.azuredatabricks.net/oidc/accounts/{account_id}/v1/token`
**Flow**: `grant_type=client_credentials`, `scope=all-apis`, Basic Auth (`base64(client_id:client_secret)`)

```javascript
// _databricksGetToken(accountId, clientId, clientSecret)
const resp = await fetch(tokenUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
  body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'all-apis' }),
});
// resp.access_token → Bearer token (expires_in informado pela API, tipicamente ~1h)
```

**Causa mais comum de 401 neste modo**: o Service Principal foi criado na CONTA mas nunca
foi adicionado ao WORKSPACE de destino (são dois passos distintos no Databricks — um SP de
conta não tem acesso automático a nenhum workspace). Ver checklist completo no guia de setup.

### `pat` (Personal Access Token)
Alternativa mais simples — não exige acesso de Account Admin. Token gerado por um usuário
(ou Service Principal de workspace) em *User Settings → Developer → Access tokens*, usado
direto como Bearer, sem troca de token. `_resolveDbxToken` só decifra e retorna.

## Statement Execution API (execução das queries)

**Endpoint**: `{workspace_host}/api/2.0/sql/statements` (`_databricksRunQuery`)
**Auth**: Bearer token (dos dois modos acima)
**Request body**:
```json
{ "warehouse_id": "...", "statement": "SELECT ...", "wait_timeout": "50s", "parameters": [] }
```
`wait_timeout` fixo em `50s` (máximo permitido pela API; faixa válida é `0` ou `5s`-`50s`).

**Polling** (quando o estado inicial vem `PENDING`/`RUNNING` — comum em SQL Warehouse "frio"
ou scans grandes): `GET {workspace_host}/api/2.0/sql/statements/{statement_id}` a cada 3s,
por até 5 minutos (`_DBX_POLL_INTERVAL_MS` / `_DBX_POLL_TIMEOUT_MS`). Histórico: antes dessa
correção (2026-08-29), uma query que não terminasse em 30s derrubava a coleta inteira com
"não concluiu" mesmo estando genuinamente ainda em execução no lado do Databricks.

`parameters` usa placeholders `:nome` na SQL (nunca concatenação de string) — mesma prática
usada em todas as queries Postgres deste projeto.

## System Tables (consumo/custo)

Verificadas uma a uma pelo teste de conexão (`POST /api/databricks-coleta/config/:id/testar`,
`_DBX_REQUIRED_TABLES`/`_DBX_OPTIONAL_TABLES`):

**Obrigatórias** (sem elas, "Conexão OK" falha e nenhum dado de custo é coletado):
- `system.billing.usage` — registros de consumo por recurso (job, cluster, SQL warehouse, etc.)
- `system.billing.list_prices` — tabela de preço (SKU → preço por DBU)

**Opcionais** (cada uma habilitada separadamente por um Account Admin em *Catalog Explorer
→ system*; ausência não derruba "Conexão OK", só deixa vazio o card correspondente no
Dashboard):
- `system.lakeflow.job_run_timeline`, `system.lakeflow.jobs` — duração/status de execuções de Job
- `system.compute.node_timeline`, `system.compute.clusters` — utilização de cluster
- `system.query.history` — custo por query
- `system.ai_gateway.usage` — uso do AI Gateway (Genie)
- `system.storage.predictive_optimization_operations_history` — otimização de storage

**Campos em `system.billing.usage`**: `workspace_id, usage_date, sku_name` (ex.:
`"STANDARD_ALL_PURPOSE_COMPUTE"`), `product_origin` (`"JOBS"|"INTERACTIVE"|"SQL"|"MODEL_SERVING"`),
`usage_unit` (ex.: `"DBU"`), `usage_quantity`, `custom_tags` (JSON), `usage_metadata` (JSON).

## Account APIs (Budgets, SCIM)

**Budgets API** — orçamentos do AI Gateway (Genie), `POST
https://accounts.azuredatabricks.net/api/2.1/accounts/{account_id}/budgets`:
```json
{
  "display_name": "Quota Name",
  "budget_configuration": {
    "monthly_budget_amount": 1000.00, "shared_limit": 1000.00,
    "resource_type": "BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY"
  },
  "alerts": [{ "alert_threshold": 75, "alert_type": "EMAIL_NOTIFICATION" }]
}
```

**SCIM API** — lookup de principal por e-mail/nome: `GET
https://accounts.azuredatabricks.net/api/2.0/accounts/{account_id}/scim/v2/Users
?filter=emails.value eq "user@example.com"` → `{ id (principal_id), email, displayName }`.

## Resource Group Detection (RN-DB-001)

Infra de cluster Databricks vive em resource groups gerenciados da Azure (`_detectManagedRg`):
```
DATABRICKS-RG-*       MANAGED-RG-ADBX-*     MANAGED-RG-*  (genérico, inclui MANAGED-RG-DBW-*)
MC_*                  (AKS-managed, não Databricks, mas mesma família de detecção)
```
**Impacto no custo**: VMs de cluster são rateadas como unidade (RN-DB-001, taxa por hora do
cluster inteiro = billing total ÷ horas do driver), não por VM individual — ver
`calcEstimado.ts`/`isDatabricksRg`/`dbInfoParaRecurso` no frontend da Calculadora.

**Importante — imposto**: recursos de VM/compute que rodam dentro desses RGs são billing
normal da Azure (`azure_costs`, com `publisher_type` real) e **recebem o imposto configurável
Microsoft/Marketplace normalmente**, como qualquer outro recurso — não há exclusão por
resource group. O que fica estruturalmente fora do imposto é só o domínio de consumo DBU
(`databricks_consumo`/`databricks_budgets`, auditado e confirmado em 2026-10-03), que nunca
passa por `_comImpostoSplit` por ser uma tabela/billing completamente separada.

## Data Flow

```
Databricks System Tables
        ↓
  Statement Execution API (_databricksRunQuery)
        ↓
  _executarColetaDatabricks()
        ↓
  databricks_consumo (table)
        ↓
  Aggregations (_resumo, budgets, anomalias, genie-quota)
        ↓
  Frontend (DatabricksDashboardView, Minha Cota Genie)
```

## Erros — o que cada código realmente significa aqui

- **400 Bad Request**: SQL ou parâmetros inválidos — `Query Databricks falhou (400): <corpo>`.
- **401 Unauthorized**: a causa real quase sempre é de permissão no lado do Databricks, não
  do código — ver checklist no guia de setup. Resumo: (1) Service Principal de conta nunca
  adicionado ao workspace; (2) sem permissão "Can Use" no SQL Warehouse; (3) sem `SELECT`
  no catálogo `system`; (4) `account_id` incorreto; (5) PAT expirado/revogado.
- **404 Not Found**: workspace não encontrado (`workspace_host` errado) ou tabela ausente
  (schema do System Tables não habilitado — ver seção acima).
- **429 / 5xx**: **não há retry nem circuit breaker dedicado para Databricks** (decisão
  deliberada, ver comentário em `_dbxFetch`/`server.js` — reaproveitar o circuit breaker da
  Azure acoplaria falhas dos dois sistemas um ao outro). Fase 1 é só teste de conexão pontual;
  um circuit breaker dedicado fica para quando existir um job agendado recorrente de verdade.
- Todas as mensagens de erro (`e.message`) incluem o corpo cru da resposta do Databricks —
  nunca mostrar só o código HTTP pro usuário, o texto completo é o que permite diagnosticar.

---

Ver **01-STARTUP.md** para agendamento do timer de coleta; **06-DATABASE.md** para o schema;
**`MODULES/05-DATABRICKS-SETUP-GUIA.md`** para o passo a passo de configuração orientado a
usuário final (não-técnico).
