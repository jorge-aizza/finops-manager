# 04-AZURE-API — Resource Manager, Cost Management, Graph

## Service Principal Setup

### Azure RBAC

Assign the built-in **Reader** role to the Service Principal at the scope of every
subscription registered in the system. This is the supported baseline for the system's
read-only ARM, Resource Graph, Change Analysis, and Cost Management queries. Do not assign
Owner or Contributor to a collection SP.

If a custom role is required instead, it must preserve the read operations needed by those
APIs. To read Azure Activity Log events for auditing, it must also include
`Microsoft.Insights/eventtypes/values/read`; this permission alone does not implement event
ingestion (see **17-INVENTARIO.md**).

### Azure resource operations (future write/delete modules)

Keep the collection SP read-only. For modules that create, update, stop/start, deallocate,
or delete Azure resources, use a **separate operational SP** and assign the built-in
**Contributor** role only at the resource group (or individual resource) scopes where the
tool is allowed to operate. Contributor permits resource writes and deletes but does not
permit role assignment management. Do not assign it at tenant or subscription scope unless
the product requirements explicitly authorize operations across that entire scope.

For stricter least privilege, use a custom role limited to the exact resource providers and
operations exposed by the modules. For example, VM lifecycle actions include
`Microsoft.Compute/virtualMachines/start/action`,
`Microsoft.Compute/virtualMachines/powerOff/action`,
`Microsoft.Compute/virtualMachines/deallocate/action`, and
`Microsoft.Compute/virtualMachines/restart/action`; VM update and deletion also require the
provider's corresponding `write` and `delete` actions. This list is not a universal role:
each resource type has its own actions, so finalize the custom role from the implemented
operation allowlist. Include `Microsoft.Insights/eventtypes/values/read` if the operational
SP also reads Activity Log events.

**Actor attribution:** Azure Activity Log records the principal that called ARM. When the
tool calls Azure using an operational SP, Azure will attribute the operation to that SP,
not automatically to the human signed in to the tool. The application must separately audit
the authenticated user, requested action, resource ID, outcome, and Azure correlation/request
ID, then correlate that record with the Activity Log. For actions performed directly by a
human in Azure, Activity Log can identify that human principal.

### Microsoft Graph application permission

To display friendly names instead of author GUIDs, grant the **Microsoft Graph** application
permission `Directory.Read.All` to the same App Registration used by the Inventory SP. This
is an Entra ID API permission, not an Azure RBAC role.

In the Azure portal:

1. Open **Microsoft Entra ID → App registrations** and select the app whose
  **Application (client) ID** matches the `client_id` configured for the Inventory SP.
2. Open **API permissions → Add a permission → Microsoft Graph → Application permissions**.
3. Search for and select `Directory.Read.All`, then choose **Add permissions**.
4. Choose **Grant admin consent for [tenant]** and confirm with an administrator authorized
  to grant tenant-wide consent.
5. Allow consent to propagate and renew the Graph access token. Existing tokens do not gain
  the permission; the new token must contain `Directory.Read.All` in its `roles` claim.

Choose **Application permissions**, not **Delegated permissions**, because the system uses
client credentials without an interactive user. Do not grant `Directory.ReadWrite.All` for
this read-only lookup. Without admin consent, author-name resolution cannot work.

### Optional: Log Analytics

If this SP is used to query Log Analytics workspaces, assign **Log Analytics Reader** at
each workspace. This is separate from the subscription's Azure Resource Manager Reader
assignment; it is not required when the Log Analytics feature is not used.

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

### Cost Export via Storage

`azure_storage_config.storage_prefix` may include `{periodo}`. The Storage reader expands it
to the current month folder `YYYYMM01-YYYYMMDD` for automatic runs, or to an explicitly chosen
month for manual reprocessing. A daily Azure Cost Management export is month-to-date, so the
latest completed run is the snapshot for that month. The importer chooses the latest GUID run
from its manifest, verifies every listed partition and byte count, then stages and checks the
parsed row count against `dataRowCount`. Only after all checks pass does one transaction replace
rows whose `arquivo_origem` is under that month folder. A missing manifest, missing partition,
parse/insert error, or row-count mismatch leaves the previous snapshot untouched. Reprocessing
uses the run GUID shown by Test; if a newer run appears before execution, it asks for a new test.
The Test button performs no import. Optional Price List and Reservations prefixes are skipped
during a cost-only month reprocess.

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

**Storage** — cada `azure_storage_config` pertence a uma SP (`sp_id`). Com mais de uma SP
ativa e habilitada para Storage, vincule explicitamente cada Storage à credencial que lê aquele
container. Configurações antigas com `sp_id` nulo continuam usando a SP padrão com aviso no log,
para não interromper agendamentos existentes; ao criar/editar uma configuração com múltiplas SPs,
a tela exige a escolha explícita. O agendador, o teste de acesso e a execução manual usam a mesma
resolução. Uma SP inativa ou com Storage desabilitado não agenda a configuração.

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

## Armadilhas conhecidas

Coisas que já custaram bug em produção. O índice resumido de todas fica em `CLAUDE.md`.

**Multi-SP — o token de uma SP devolve 403 nas assinaturas de outra.**
`_getInventarioEscopos()` é a abstração central: devolve uma entrada por assinatura carregando a credencial da SP dona. Nunca misture assinaturas de SPs diferentes numa só chamada ARM/Resource Graph. Para rodar a mesma consulta em todas, use `_resourceGraphQueryTodasSps()`.

**Atribuição de SP é por `subscription_id`, nunca por `sp_id`.**
`azure_costs` não tem coluna de SP. As SPs não compartilham assinaturas, então o `subscription_id` já identifica a dona (ver `TenantFilterContext.tsx` e `_subsDaSp()`).

**Coletas simultâneas: estado por execução, não global.**
`_coletasEmExecucao` é um Map com chave `tipo:id` (`api:7`, `storage:3`). Os getters globais (`_coletaProgresso`, `_coletaCancelada`) existem só para compatibilidade e resolvem para a **primeira entrada do Map** — usá-los dentro do fluxo de coleta mistura o progresso de uma SP com o de outra. Toda função auxiliar (`_gerarRelatorioAPI`, `_importarArquivosAPI`, `_comRetentativa`) recebe `progresso`/`isCancelada` por parâmetro; `_logColeta(msg, progresso)` exige o segundo argumento.

**`azure_price_list` está inteiro em USD — `retail_price_brl` é NULL nas 546 mil linhas.**
Nunca escreva "R$" na frente de `retail_price`. Esta conta tem desconto de contrato muito abaixo da tabela pública (medido: ~31% na ingestão, ~68% no Sentinel), então o catálogo só serve para a **forma** da escada de preço; a escala vem da fatura (ver `_sugerirCommitmentTier`, que calibra pelo preço real por GB).

## Ingestão de custo: substituição de snapshot (2026-11-10)

O custo exibido não batia com o portal. Validado contra 4 assinaturas em outubro/2026 (valores
crus, sem o imposto da apresentação): o sistema estava **+9,36%** acima no agregado, uma delas
+25,8%. Depois das correções as quatro fecham **ao centavo**.

Eram dois defeitos independentes, em direções opostas — por isso a divergência era errática.

### 1. Linha legítima descartada na gravação

`idx_azure_costs_dedup` era único em `(subscription_id, resource_id, cost_date, meter_id,
charge_type, quantity)`. O relatório da Azure traz linhas **diferentes** que coincidem nesses seis
campos, e o `ON CONFLICT DO UPDATE` fazia a segunda sobrescrever a primeira.

Invisível por construção: com `DO UPDATE` o `rowCount` é sempre 1, então `ins`/`upd` e o contador
de erro ficavam mudos. A prova veio instrumentando a importação:

```
⚠ edf81567: relatório R$ 315.118,81 × gravado R$ 302.600,37
   — PERDA de R$ 12.518,45 em 1.118 linha(s)
```

R$ 315.118,81 é exatamente o que o portal mostra. O dado chegava correto e era descartado por nós.

**O índice foi removido** e as coletas usam `INSERT` puro.

### 2. Snapshots acumulados

`granularidade_dias = 7` com execução diária: cada dia era recoletado ~7 vezes. A Azure revisa a
quantidade enquanto o billing amadurece e nenhuma via apagava o snapshot anterior, então as
revisões viravam linhas novas que se somavam. Caso real (13/10, mesmo recurso, mesmo medidor,
preço 3,289): três linhas de três importações, 148,7 / 238,8 / 248,9 de quantidade — correto era
R$ 4.272,49, somado dava R$ 10.925,56. Total medido: **2,46 M linhas, R$ 6,41 mi em 4 meses**.

### Por que NÃO se resolve com chave natural

Testado contra o banco e descartado:

| Chave testada | Linhas da MESMA importação que seriam apagadas | Custo real perdido |
|---|---|---|
| `+unit_price +pricing_model` | 430.244 | R$ 606.355 |
| `+additional_info` (md5) | 266.086 | R$ 403.524 |

Em 93% dos grupos restantes **nenhuma** coluna distingue as linhas (testados `meter_sub_category`,
`effective_price`, `resource_name`, `service_info2`, `billing_period`, `invoice_id` — todos variam
em zero grupos). "Última importação por (assinatura, dia)" também é destrutivo: daria R$ 71 mil
onde o portal diz R$ 252 mil.

**A unidade de verdade é o relatório do período, não a linha.**

### Como funciona agora

`_apagarSnapshotAnterior` apaga o escopo **entre o download e a inserção** — os blobs já estão em
disco, então a janela sem dado é curta e a retentativa reapaga e reinsere, autocorretiva. Escopo
por via: API = (assinatura, período do chunk); Storage e upload manual = `arquivo_origem`.

Guardas que não podem sair:
- **Só apaga se o relatório trouxe arquivo.** `_gerarRelatorioAPI` devolve `[]` em 404/204/
  `NoDataFound` SEM lançar; apagar aí destrói dado bom e não repõe nada.
- **Com `rgFilter` ativo o DELETE aplica o MESMO filtro**, senão apaga o que não será restaurado.
- **Usa as strings `chunk.start`/`chunk.end`**, nunca datas reconstruídas (`_splitDateRange` tem
  dependência implícita de fuso).

### Conferência permanente

As três vias comparam o total que o arquivo traz com o que ficou gravado e alertam na diferença.
Foi esse detector que produziu a prova acima — sem ele a perda só aparece comparando com o portal,
uma assinatura por vez.

### Coleta que não terminava

75 das 107 assinaturas ficaram sem nenhum dado em novembro/2026. Causa: os dois SPs disparavam no
mesmo tick, tomavam 429, e três falhas abriam o breaker da família `custo` inteira
(`azureThrottle.js`, `openMs` 5 min). `_comRetentativa` gastava as 3 tentativas em 30s+60s **dentro
da janela**, e a assinatura era abandonada sem nunca ter sido consultada.

Agora: espera do breaker não consome tentativa; coletas de custo são serializadas numa fila (o
breaker é por família, não por SP); `maxPausaMs` subiu de 2 para 5 min para não truncar o
`Retry-After`; e coleta incompleta grava `status='parcial'` com as assinaturas que faltaram —
`concluido` não provava completude, porque cancelamento sai por `break`, não pelo catch.

### Aplicar numa base com dados

A correção **não conserta linha já gravada** — só muda como se grava. Mas não precisa truncar:
recoletar um (assinatura, mês) substitui no lugar. Atenção ao efeito colateral: com janela de 7
dias, os dias recentes se autocuram a cada coleta e o histórico não, então meses antigos continuam
errados até serem recoletados explicitamente.
