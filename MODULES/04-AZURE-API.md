# 04-AZURE-API — Resource Manager, Cost Management, Graph

## Service Principal Setup

**Required permissions (Reader role covers all)**:
- Microsoft.Resources (subscriptions, resource groups, resources)
- Microsoft.CostManagement (billing data)
- Microsoft.Authorization (resource properties via Graph)

**Naming convention:**
```
AZURE_TENANT_ID = Tenant GUID
AZURE_SP_CLIENT_ID = Service Principal app ID (GUID)
AZURE_SP_CLIENT_SECRET = Client secret (never database)
```

## Three APIs in Use

### 1. Azure Management (ARM)
**Endpoint**: `https://management.azure.com`
**Auth**: OAuth 2.0 Bearer token, scope `https://management.azure.com/.default`

**Typical calls:**
```
GET /subscriptions
GET /subscriptions/{id}/resourceGroups
GET /subscriptions/{id}/resourceGroups/{rg}/resources
GET /subscriptions/{id}/providers/Microsoft.Authorization/roleAssignments
```

### 2. Cost Management API
**Endpoint**: `https://management.azure.com`
**Auth**: Same as ARM (merged service)

**Usage in app:**
```
GET /subscriptions/{id}/providers/Microsoft.CostManagement/query
  POST body: { type: "Usage", timeframe: "...", aggregation: {...}, groupBy: [...] }
```

Returns: `azure_costs` export (meter_id, qty, cost_usd, charge_type, etc.)

### 3. Resource Graph (RP/RP)
**Endpoint**: `https://management.azure.com/providers/Microsoft.ResourceGraph/resources`
**Auth**: Same Bearer token
**Request**: POST with KQL query

**Typical queries:**
```kql
Resources
| where type =~ 'microsoft.compute/virtualmachines'
| project id, name, resourceGroup, properties, tags
```

## Microsoft Graph (AAD Lookup)
**Endpoint**: `https://graph.microsoft.com`
**Auth**: OAuth 2.0, scope `https://graph.microsoft.com/.default`
**Used for**: Entra ID user/group lookups when resolving audit event owners

```
GET /directoryObjects/getByIds
  POST body: { ids: ["GUID", ...], types: ["user", "group"] }
```

Returns: `displayName`, `userPrincipalName` for each GUID.

## Key Data Structures

**azure_costs fields** (from Cost Management export):
- `subscription_id`, `cost_date`, `resource_id` (ARM path, case-varying)
- `consumed_service`, `meter_id`, `meter_category`, `meter_name`
- `quantity`, `unit_of_measure`, `cost_in_billing_currency`, `effective_price`, `pricing_model`
- `charge_type` (Usage | Purchase | RoundTrustBill)
- `tags` (JSONB, custom tags from resource)

**Meter ID** — unique identifier per Azure service/region/tier:
- Example: `B0C45E19-6D1E-446F-B3E5-8E5CE65D1B04` (opaque GUID)
- Used to JOIN with Price List table (rarely, UI removed in v2.1)

## Caching Strategy

| Cache | TTL | Invalidation |
|-------|-----|--------------|
| `azure_subs_cache` | 5 min | After import/coleta |
| `azure_rg_cache` | 5 min | After import/coleta |
| Case mapping (UPPER) | Per-session | Functional indexes handle it |

**Note**: Resource Graph queries are always fresh (no cache); ARM subscription/RG calls check cache first.

## Error Handling

- **400 Bad Request**: Invalid query/filter (check KQL syntax)
- **401 Unauthorized**: Token expired or invalid credentials
- **403 Forbidden**: Service Principal lacks required role
- **404 Not Found**: Subscription/RG doesn't exist
- **429 Too Many Requests**: Rate limit (backoff + retry)
- **500+**: Transient Azure outage (retry with backoff)

**Retry logic**: `_cbFetch` (server.js) handles 3x retry + circuit breaker on repeated 5xx.

⚠️ **403 em multi-SP geralmente não é falta de role** — é token da SP errada. Cada Service
Principal só enxerga as próprias assinaturas; o token da SP-A devolve 403 nas assinaturas da SP-B.
Veja a seção abaixo.

## Multi-Service Principal (v4.2)

`azure_coleta_config` é multi-linha: várias SPs (tenants) podem estar cadastradas e agendadas.

**Escopo de credencial** — `_getInventarioEscopos()` é a abstração central: devolve uma entrada
por assinatura, cada uma carregando a credencial da SP dona. Nunca monte uma chamada ARM ou
Resource Graph misturando assinaturas de SPs diferentes. Para rodar a mesma consulta em todas,
use `_resourceGraphQueryTodasSps()`. `_makeTokenGetter` já é por-SP e suporta concorrência.

**Execução simultânea** — o estado da coleta vive em `_coletasEmExecucao`, um `Map` de módulo com
chave `tipo:id` (`api:7`, `storage:3` — os IDs das duas tabelas são sequências independentes, daí
o prefixo). Helpers: `_coletaAtiva`, `_iniciarColetaEntry`, `_finalizarColetaEntry`. Cada entrada
guarda `{ iniciadoEm, cancelada, progresso, histId }` e só é sobrescrita na execução seguinte
daquela chave, para o frontend ainda mostrar o resultado final.

Os getters globais (`_coletaProgresso`, `_coletaCancelada`, `_coletaEmExecucao`) existem **apenas
para compatibilidade** com consumidores antigos e resolvem para a *primeira* entrada do Map. Usar
qualquer um deles dentro do fluxo de coleta mistura o progresso de uma SP com o de outra — foi
exatamente essa a origem dos vazamentos de log entre SPs corrigidos na v4.2 (26 chamadas de
`_logColeta` sem o argumento de progresso). Toda função auxiliar (`_gerarRelatorioAPI`,
`_importarArquivosAPI`, `_comRetentativa`) recebe `progresso`/`isCancelada` por parâmetro, e
`_logColeta(msg, progresso)` exige o segundo argumento.

**Agendador** — `_tickAgendador` dispara **todas** as configs due no mesmo tick (antes era
`LIMIT 1` + `return`), persistindo `proxima_coleta` antes de disparar e usando fire-and-forget.
A safety valve de 6h itera o Map e reseta entradas travadas individualmente; `_cbCore.reset()`
é global, então só é chamado se não houver outra execução saudável em andamento.

**Circuit breaker compartilhado (decisão deliberada)** — `azureThrottle.js` / `_cbCore` continuam
particionados por família de API (custo, resourcegraph…), não por SP. Uma SP que toma 429 pode
pausar outra por no máximo `maxPausaMs` (2 min) por tentativa — tolerável frente ao custo de
thread-ar `spId` por ~32 call sites de `_cbFetch`. Visível no painel `circuit_breaker` do status;
revisitar só se aparecer como problema real.

**Atribuição de dados** — as tabelas de dados (`azure_costs`, inventário, Log Analytics, price
list) **não têm coluna de SP** e não vão ter: `subscription_id` é um GUID globalmente único e as
SPs não compartilham assinaturas, então ele já identifica a dona. O filtro de Tenant resolve por
`subscription_id` via `_subsDaSp()`, nunca por `sp_id`.

**Risco conhecido, fora de escopo** — `UPDATE azure_costs SET fonte='api' WHERE importado_em >= $1`
filtra por janela de tempo, não por SP; com duas coletas no mesmo instante, o UPDATE de uma pode
recapturar linhas da outra. Inofensivo (o valor gravado é o mesmo), só menos preciso.

---

See **01-STARTUP.md** for token refresh strategy; **03-AUTHENTICATION.md** for how Service Principal credentials are stored.
