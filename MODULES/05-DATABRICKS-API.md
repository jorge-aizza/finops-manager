# 05-DATABRICKS-API — OAuth M2M, System Tables, Budgets

## Authentication (OAuth 2.0 M2M)
**Endpoint**: `https://accounts.azuredatabricks.net/oidc/accounts/{account_id}/v1/token`
**Flow**: `grant_type=client_credentials`, `scope=all-apis`

```javascript
const response = await fetch(tokenUrl, {
  method: 'POST',
  auth: `${client_id}:${client_secret}` // Basic Auth
});
// response.access_token → Bearer token (valid ~1h)
```

**Alternative**: Personal Access Token (PAT) — workspace-level, less secure for automation.

## System Tables (Consumption)

**Endpoint**: `{workspace_host}/api/2.0/sql/statements`
**Auth**: Bearer token (from M2M flow above) or PAT
**Method**: POST with SQL statement

**Tables accessed:**
- `system.billing.usage` — consumption records per resource (job, cluster, etc.)
- `system.billing.list_prices` — pricing table (SKU → price per DBU)

**Fields in usage**:
```
workspace_id, usage_date, sku_name (e.g., "STANDARD_ALL_PURPOSE_COMPUTE")
product_origin ("JOBS" | "INTERACTIVE" | "SQL" | "MODEL_SERVING")
usage_unit (e.g., "DBU"), usage_quantity, custom_tags (JSON), usage_metadata (JSON)
```

**Query example:**
```sql
SELECT workspace_id, sku_name, usage_date, SUM(usage_quantity) as qty
FROM system.billing.usage
WHERE usage_date BETWEEN '2026-09-01' AND '2026-09-30'
GROUP BY workspace_id, sku_name, usage_date
```

## Statement Execution API

**Endpoint**: `{workspace_host}/api/2.0/sql/statements`
**Request body**:
```json
{
  "warehouse_id": "...",
  "statement": "SELECT ...",
  "wait_timeout": "50s",
  "on_wait_timeout": "CONTINUE"
}
```

**Response**: `{ id, state: "RUNNING|SUCCEEDED|FAILED|CANCELLED" }`

**Polling** (for long-running queries):
```
GET /api/2.0/sql/statements/{id}
```

**Timeout handling**: If query doesn't finish in 50s, state returns as PENDING; app polls via GET until terminal state.

## Account APIs (Budgets, SCIM)

**Budgets API** — create quotas for Genie (AI Gateway):
```
POST https://accounts.azuredatabricks.net/api/2.1/accounts/{account_id}/budgets
{
  "display_name": "Quota Name",
  "budget_configuration": {
    "monthly_budget_amount": 1000.00,
    "shared_limit": 1000.00,
    "resource_type": "BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY"
  },
  "alerts": [
    { "alert_threshold": 75, "alert_type": "EMAIL_NOTIFICATION" }
  ]
}
```

**SCIM API** — principal lookup (user/group by email/name):
```
GET https://accounts.azuredatabricks.net/api/2.0/accounts/{account_id}/scim/v2/Users
  ?filter=emails.value eq "user@example.com"
```

Returns: `{ id (principal_id), email, displayName }`

## Resource Group Detection (RN-DB-001)

Databricks cluster infra lives in managed resource groups:
```
DATABRICKS-RG-*           (older pattern)
MANAGED-RG-ADBX-*         (Unity Catalog pattern)
MANAGED-RG-DBW-*          (Generic Databricks)
managed-rg-dbw-*          (lowercase variant)
MC_*                       (AKS-managed RGs)
```

**Detection in server.js**:
```javascript
const isManagedRg = (name) => {
  const upper = name.toUpperCase();
  return upper.startsWith('DATABRICKS-RG-') ||
         upper.startsWith('MANAGED-RG-') ||
         upper.startsWith('MC_');
};
```

**Impact**: Cluster VMs are billed as a unit, not per-VM. Use `SUM(MAX(horas_por_dia))` not individual VM hours.

## Data Flow

```
Databricks System Tables
        ↓
  Statement Execution API
        ↓
  _executarColetaDatabricks() 
        ↓
  databricks_consumo (table)
        ↓
  Aggregations (_resumo, budgets, anomalies)
        ↓
  Frontend charts
```

## Errors & Retry

- **400 Bad Request**: Invalid SQL or API parameters
- **401 Unauthorized**: Token expired or invalid
- **404 Not Found**: Workspace not found or table missing (System Tables disabled)
- **429 Too Many Requests**: Rate limit (backoff 200ms → 400ms → 600ms)
- **5xx**: Databricks outage (retry up to 3x)

**Circuit breaker**: After 3 consecutive failures, block further attempts for 5 min (avoids hammering broken API).

---

See **01-STARTUP.md** for collection timer scheduling; **06-DATABASE.md** for schema.
