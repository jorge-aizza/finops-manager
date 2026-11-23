# 09-CALCULADORA — Financial Motor, Billing Rules (RN-*)

## Cost Classification (`tipo_custo`)

```sql
reserva  → charge_type IN ('Purchase', 'RoundTrustBill') AND pricing_model = 'Reservation'
hora     → unit_of_measure ILIKE '%hour%' OR '%hora%'
dia      → unit_of_measure ILIKE '%day%'
mes      → unit_of_measure ILIKE '%month%' (excl. GB/TiB)
periodo  → all others (storage, bandwidth, etc.)
```

## Core Rules (RN-*)

### RN-006 — Price Per Native Unit
```sql
custo_uom_billing = SUM(cost) / NULLIF(SUM(qty), 0)
-- Returns: R$/GB, R$/DBU, R$/10K transactions, etc.
```
**Used by**: Audit purposes, DBU pricing in Calculadora.

### RN-007 — Amortized RI/SP Cost
For lines with `cost=0` and `effective_price>0` (covered by Reservation/Savings Plan):
```sql
taxa_hora_rate = SUM(effective_price × qty) / NULLIF(SUM(qty) × fator_UoM, 0)
-- Falls back when custo_hora_billing = 0
```
**Impact**: Cluster VMs, SQL databases covered by RIs show amortized cost, not zero.

### RN-RG-001 — Average Hourly Cost by Resource Group
Resources in parent and managed RGs are consolidated once. Variable costs are
allocated by the group's observed operating hours; parallel VM hours must not be
summed as if they were wall-clock hours. Driver hours take priority, then VM hours.
PaaS hourly quantities (for example, Event Hubs capacity-hours) are not uptime anchors:
```sql
H_operacao = MAX(soma_h_driver) when driver data exists
H_operacao = MAX(horas_reais) over VM resources otherwise
C_variavel = SUM(billing_i) for selected non-monthly, non-reservation resources
taxa_rg = C_variavel / H_operacao
estimado_i = (billing_i / H_operacao) × horas_solicitadas
```

**Validity threshold**: at least 24 observed operating hours and one driver/VM anchor.
Parent/managed RG mapping is case-insensitive. Monthly fixed resources remain in
`Infra Fixa`; reservations keep their existing amortized hourly treatment. The daily
peak is no longer used as the default charge rate.

**Fallback**: preserve the existing per-resource billing formula when the group has no
reliable hourly anchor.

## Calculation Flow (Calculadora.tsx)

```
User selects: subscription → resource group → date range → clicks "Buscar"
                    ↓
           GET /api/calculadora/recursos
                    ↓
  Render table with 500+ resources
                    ↓
  User opens "Configurar Estimativa" overlay
                    ↓
  Derive one shared RG rate map from fetched resources and parent/managed RG options
                    ↓
  _calcEstimado() runs on each resource:
  ├─ Determine tipo_custo (reserva/hora/dia/mes/periodo)
  ├─ Apply RN-007 fallback if reserva
  ├─ Apply RN-RG-001 to variable resources where operating hours are reliable
  ├─ Keep fixed monthly costs and amortized reservations on their current paths
  └─ Return { estimado, taxa_hora, mesBrl, usaPico, ...}
                    ↓
  Sum all → overlay Subtotal + Total
  Cards render with col1 (rate) + col4 (estimado)
                    ↓
  User saves → POST /api/estimativas { resources, totals, periodo, ... }
```

## Motor Code (TypeScript)

**Pure functions** (testable):
- `_calcEstimado(r, horas)` — resource cost
- `_dbInfoParaRecurso(r)` — cluster rate validation
- `_tipoRecurso(r)` — resource classification
- `_calcHorasLivres(vInicio, vFim)` — free hours deduction
- `buildEstimativa(resultados)` — output object

**Where**: `frontend/src/lib/calcEstimado.ts` + related files (8 test files, 48 unit tests).

## Databricks and Other Resource Groups

Databricks parent-RG software charges and managed-RG infrastructure are included in
the same RG rate when the parent mapping is available. The same allocation applies to
other RGs with a VM uptime anchor. Usage-only services are included in their group's
variable cost share, but do not define uptime. Groups without driver/VM hours retain the
previous per-resource behavior.

**Managed RG parent links**: AKS `properties.nodeResourceGroup` and Databricks
`properties.managedResourceGroupId` from Azure Resource Graph are persisted by
`(subscription_id, managed_rg_upper)` in `azure_rg_parent_cache`. Startup performs a
read-only backfill for existing subscriptions; inventory reconciliation refreshes links
for new/changed workspaces and clusters. Billing-name heuristics remain fallback only.
Parent options without direct billing are synthesized for the private calculator; the
public calculator adds them only when the parent is present in its configured RG allowlist.

## Horário Livre (Free Hours)

Optional time-of-day discount:
```javascript
horario_livre = { 
  ativo: true,
  inicio: "19:00",
  fim: "06:00",
  dias: [1,2,3,4,5]  // Mon-Fri (0=Sun)
}
```

**Calculation**:
```
horas_livres = SUM(janela_hours BY dia WHERE dia in dias[])
horas_cobradas = horas_total - horas_livres
-- Math.max(1, ...) ensures ≥ 1h (prevents negative)
```

## Portal Público

**Simplified**: Same motor, but:
- Taxas (imposto, condomínio) locked by admin config
- Horário Livre locked by admin config
- Period locked (always last 30 days)
- No import/diagnóstico tabs

Reuses `_calcEstimado()` without changes.

## Errors & Edge Cases

| Case | Handling |
|------|----------|
| No usage data (qty=0) | Skip resource (no estimado) |
| Mixed charge types | Grouped separately (RI + PayG in 2 rows) |
| Missing UoM | Fallback to `periodo` type + daily amortization |
| Missing driver/VM operating data | Keep previous per-resource estimate; do not invent an RG rate |
| Parent/managed RG mapping unavailable | Calculate each RG independently |

---

See **02-ARCHITECTURE.md** for calc diagram; **04-AZURE-API.md**/**05-DATABRICKS-API.md** for API structure.
