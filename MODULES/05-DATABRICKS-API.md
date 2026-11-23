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
Na coleta longa, o access token OAuth é renovado 60 segundos antes da expiração e uma
resposta 401/403 cujo corpo identifica token inválido força uma renovação e uma única nova
tentativa. Se a renovação não resolver, confira a configuração/credenciais do Service
Principal e o acesso dele ao workspace.

### `pat` (Personal Access Token)
Alternativa mais simples — não exige acesso de Account Admin. Token gerado por um usuário
(ou Service Principal de workspace) em *User Settings → Developer → Access tokens*, usado
direto como Bearer, sem troca de token. `_resolveDbxToken` só decifra e retorna.
PAT expirado, revogado ou inválido não pode ser renovado pela aplicação: atualize o token
salvo na conexão e repita o intervalo que ficou incompleto.

## Statement Execution API (execução das queries)

**Endpoint**: `{workspace_host}/api/2.0/sql/statements` (`_databricksRunQuery`)
**Auth**: Bearer token (dos dois modos acima)
**Request body** (billing por dia usa `INLINE`; consultas auxiliares que cobrem vários dias
usam `EXTERNAL_LINKS` para não exceder o limite inline):
```json
{ "warehouse_id": "...", "statement": "SELECT ...", "wait_timeout": "50s", "parameters": [], "disposition": "INLINE", "format": "JSON_ARRAY" }
```
`wait_timeout` fixo em `50s` (máximo permitido pela API; faixa válida é `0` ou `5s`-`50s`).

**Carga de billing**: `_executarColetaDatabricks` consulta e grava um dia por vez. Quando o
resultado inline de um dia ultrapassa 25 MiB, a query é subdividida por `workspace_id` e,
se necessário, por `sku_name`. Cada resposta inline pagina todos os chunks indicados no
manifest antes de gravar. Se uma partição workspace/SKU ainda exceder o limite, a coleta
falha explicitamente nessa partição; não aplica `LIMIT` nem descarta linhas. Lotes já
gravados são idempotentes e permanecem disponíveis para reexecução do período.

As consultas auxiliares de Job Runs, Utilização de Cluster, Query History, AI Gateway e Storage
Otimização cobrem o intervalo selecionado e usam `EXTERNAL_LINKS`; isso evita o limite de 25 MiB
da resposta `INLINE`. A coleta de billing continua diária, em `INLINE`, com subdivisão por
workspace/SKU quando necessário. Se o download externo falhar, somente a consulta auxiliar é
marcada como indisponível; os dados de billing já persistidos não são revertidos.

O período da coleta manual é informado independentemente de `granularidade_dias`, que
continua controlando a recorrência. Para backfill, a interface inicia com os últimos 90 dias
fechados (até ontem), mas permite escolher outras datas. Para coleta diária, habilite o
agendamento e use granularidade de 1 dia.

`EXTERNAL_LINKS` retorna URLs SAS temporárias de Storage. O cliente deve baixá-las sem o
Bearer token. Se o endpoint retornar `AuthorizationFailure`, verifique as regras de rede do
Storage/Private Endpoint que atende o workspace; não conceda permissões adicionais ao
Service Principal Databricks como substituto de acesso de rede.

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

**Moeda exibida**: o dashboard Databricks apresenta os custos de `system.billing.usage ×
system.billing.list_prices.pricing.effective_list.default` em USD (`US$`), sem conversão
cambial. A tabela de preços também contém `currency_code`; se o sistema passar a coletar uma
conta com preços em outra moeda, a moeda deverá ser persistida e tratada explicitamente.
Limites dos orçamentos internos são valores configurados pelos usuários e não são convertidos
automaticamente — revise os limites cadastrados antes de usá-los após a mudança de rótulo.

**Opcionais** (cada uma habilitada separadamente por um Account Admin em *Catalog Explorer
→ system*; ausência não derruba "Conexão OK", só deixa vazio o card correspondente no
Dashboard):
- `system.lakeflow.job_run_timeline`, `system.lakeflow.jobs` — duração/status de execuções de Job
- `system.compute.node_timeline`, `system.compute.clusters` — utilização de cluster
- `system.query.history` — custo por query
- `system.ai_gateway.usage` — uso do AI Gateway (Genie)
- `system.storage.predictive_optimization_operations_history` — otimização de storage

**Transporte das consultas auxiliares**: as cinco coletas acima usam Statement Execution
com resultado `INLINE`, consultando um dia por vez e persistindo cada partição antes de
avançar. Isso evita depender dos links temporários para Storage (`EXTERNAL_LINKS`), que
podem falhar por bloqueio de rede/firewall no servidor. Se uma partição diária exceder o
limite inline, a coleta auxiliar é marcada como indisponível no histórico; o billing
principal permanece salvo e não é desfeito.

**Agendamento da coleta Databricks**: com `auto_coleta` ativo, a agenda configurada executa
o billing, respeitando `hora_execucao`, `dias_semana` e `granularidade_dias`. As cinco consultas
auxiliares têm frequência independente em `granularidade_auxiliar_dias` (1 a 30; padrão 1,
preserva o comportamento anterior) e rodam somente quando vencidas. Em cargas manuais,
`incluir_auxiliares=false` permite backfill de billing sem repetir auxiliares. Não há
atualização incremental automática por hora. Os dados de `system.billing.usage` ainda podem
ser publicados pelo Databricks com atraso de até cerca de 12 horas.

**Múltiplas conexões**: o agendador enfileira todas as configurações ativas vencidas e as executa
em série; uma falha não bloqueia as próximas. A coleta manual usa a mesma fila, rejeita duplicata
da mesma configuração e informa quantas configurações aguardam. A importação manual não roda
enquanto houver coleta em execução ou na fila. O dashboard agrega `databricks_consumo` por
workspace, então workspaces visíveis por mais de uma conexão fazem upsert na mesma chave natural.

**Limite de escopo Genie/Budgets**: os snapshots de consumo Genie consultam todas as conexões
ativas, removem linhas idênticas repetidas e preservam avisos por conexão que falhou. As APIs de
Budgets/SCIM são de conta e continuam usando a conexão Databricks padrão OAuth M2M; não misture
budgets de contas Databricks distintas sem um identificador de account no contrato dos budgets.

**Snapshot de consumo Genie oficial**: `GET /api/databricks-coleta/genie-cotas` persiste o
resultado agregado em `databricks_genie_cotas_cache`, por período. O período mensal é
coletado no startup (após 2 min) e a cada 6 horas. Os períodos `today` e `all` mantêm TTL de
60 min. A API entrega o último snapshot sem esperar o SQL Warehouse quando já existe snapshot;
se ele venceu, atualiza em segundo plano e mantém o último resultado válido em caso de falha.
Na primeira consulta antes da coleta inicial, a requisição aguarda a geração do snapshot. A
resposta informa `cache.atualizado_em`,
`desatualizado` e `atualizando`.
Na mesma coleta, `databricks_genie_cotas_public_cache` recebe snapshots separados por e-mail
normalizado. O endpoint público seleciona somente o e-mail assinado no token Entra ID; a tela
não recebe consumo agregado do workspace nem dados de outros usuários.

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
