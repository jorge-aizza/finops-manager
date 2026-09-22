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

---

See **01-STARTUP.md** for token refresh strategy; **03-AUTHENTICATION.md** for how Service Principal credentials are stored.
