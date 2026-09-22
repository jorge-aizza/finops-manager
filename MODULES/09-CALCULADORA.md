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

### RN-DB-001 — Databricks Cluster Rate
VMs in cluster run in parallel, not sequentially:
```sql
soma_h_driver = SUM(MAX(horas_por_dia) BY dia)  -- daily approach (accurate)
taxa_cluster = C_total_rg / soma_h_driver
-- estimado_vm_i = (billing_i / soma_h_driver) × slider_horas
```

**Validity threshold**: `H_driver ≥ 24h AND ids_distintos ≥ 2` (workspace must have multi-VMs).

**Fallback**: `custo_hora_billing` (per-VM average) if threshold not met.

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
  Lazy load: GET /api/calculadora/recursos?pico=1
                    ↓
  _calcEstimado() runs on each resource:
  ├─ Determine tipo_custo (reserva/hora/dia/mes/periodo)
  ├─ Apply RN-007 fallback if reserva
  ├─ Apply RN-DB-001 if Databricks cluster
  ├─ Apply pico (if enabled) or average
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

## Databricks Special Cases

**Two billing streams**:
1. **Infra** (VMs in `databricks-rg-*`): Billed per hour, use RN-DB-001 (cluster rate)
2. **Software** (DBUs in workspace RG): Billed per DBU, use RN-006 (`custo_uom_billing` = R$/DBU)

**Total cost/h for workspace**:
```
estimado/h = taxa_cluster + (total_DBU_cost / soma_h_driver)
-- Requires cross-RG addition (not automated, user's math)
```

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
| Pico load timeout | Retry 3x; use average if all fail |
| Cross-RG Databricks | Manual addition (not calculated) |

---

See **02-ARCHITECTURE.md** for calc diagram; **04-AZURE-API.md**/**05-DATABRICKS-API.md** for API structure.
