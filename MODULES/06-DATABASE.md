# 06-DATABASE — PostgreSQL Schema & Migrations

## Core Tables

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `usuarios` | Auth | id, nome, email, perfil, tipo ('local'\|'ad'\|'entra'), ativo |
| `perfis` | Roles | id, nome |
| `permissoes` | Permissions | id, perfil_id, recurso, acao |
| `sessoes` | Login tracking | usuario_id, token_hash, ip, user_agent, criado_em |
| `integracoes` | API config | tipo ('ad'\|'entra'\|'smtp'), config (JSONB encrypted) |
| `projetos` | FinOps | id, nome, descricao, status ('Ativo'\|...) |
| `acoes_finops` | Actions | id, projeto_id, titulo, responsavel, status, datas |
| `estimativas` | Estimates | id, projeto_id, recursos (JSONB), totais, status |
| `reservas_cloud` | Reservations | id, cloud, tipo_escopo, subscription_id, resource_group_name, prazo, data_vencimento |

## Azure Tables

| Table | Purpose |
|-------|---------|
| `azure_costs` | Billing detail (1M+ rows typical) |
| `azure_subs_cache` | Cached subscriptions (populated by `_refreshAzureCache`) |
| `azure_rg_cache` | Cached resource groups |
| `azure_price_list` | Retail Prices API sync (optional, v4.0 not used in UI) |
| `azure_recursos_inventario` | Resource inventory (CREATE/UPDATE/DELETE audit) |
| `azure_recursos_auditoria_eventos` | Event log (Activity Log, 14-day retention) |
| `azure_recursos_sku_historico` | VM SKU changes (history of resizes) |
| `azure_coleta_config` | Service Principals for coleta |
| `azure_coleta_historico` | Coleta run log |

## Databricks Tables

| Table | Purpose |
|-------|---------|
| `databricks_coleta_config` | Connection config (OAuth M2M or PAT) |
| `databricks_consumo` | Billing (cost per resource per day) |
| `databricks_coleta_historico` | Collection run log |
| `databricks_budgets` | Budget/quota config |
| `databricks_job_runs` | Job execution records |
| `databricks_cluster_utilizacao` | CPU % by cluster/day |
| `databricks_storage_otimizacao` | Storage optimization ops |

## Performance Indexes (18 total)

**Heavy hitters**:
```sql
idx_azure_costs_sub_date_rg        -- (subscription_id, cost_date, UPPER(rg))
idx_azure_costs_resource_id_upper  -- UPPER(resource_id) functional
idx_azure_costs_rg_upper           -- UPPER(resource_group_name) functional
```

**Single-column** (on commonly filtered fields):
- `cost_date`, `subscription_id`, `resource_id`, `consumed_service`, `meter_category`, `charge_type`, `pricing_model`, etc.

All created in background during startup; server usable immediately.

## Migrations (Idempotent)

Example pattern (all migrations follow this):
```sql
-- Add column safely
ALTER TABLE azure_resources 
ADD COLUMN IF NOT EXISTS sku_atual VARCHAR;

-- Create index safely
CREATE INDEX IF NOT EXISTS idx_name 
ON table_name(column) 
WHERE condition;

-- One-time data migration (guarded by column existence check)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name='xyz' AND column_name='old_col') THEN
    UPDATE table SET new_col = old_col WHERE new_col IS NULL;
    ALTER TABLE table DROP COLUMN old_col;
  END IF;
END $$;
```

**No destructive operations**: all migrations only ADD, never DROP (manual reversions via `DROP INDEX`/`DROP COLUMN` run by hand if ever needed).

## Connection Pooling

```javascript
const pool = new pg.Pool({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  max: 20,           // max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});
```

**Error recovery**: pool auto-reconnects on transient errors (no manual retry in app code).

**Shutdown**: SIGTERM/SIGINT handlers call `pool.end()` before exit.

## Materialized Views (Deprecated in v4.0)

```sql
pl_best_mv  -- Price List best-price-per-meter (no longer refreshed)
pl_sku_mv   -- Price List SKU aggregation (no longer refreshed)
```

Removed from UI in v2.1; still exist in old databases (safe to leave, just orphaned).

## NULL Handling

- `cost_in_billing_currency = 0` for lines covered by Reservation/Savings Plan (not NULL)
- `resource_group_name = NULL` for some system-level charges (valid Azure output)
- **Case-sensitivity**: always use `UPPER(field)` for JOINs across Azure sources (casing varies)

## Backup Strategy

No automated backup in this code. Use:
- **AWS RDS**: automated snapshots
- **Azure**: Database for PostgreSQL backups
- **Local**: `pg_dump` daily cron + store offsite

See **10-DEPLOYMENT.md** for per-platform backup checklist.

---

Schema reference: `.env.example` lists all DB_* variables. The schema itself lives only in `server.js` (`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, idempotent, run on startup) — there are no separate `.sql` migration files to keep in sync; a prior set of `schema.sql`/`init.sql`/etc. files (v1.0/v2.0, with diverging column types) was removed to avoid someone running an out-of-date script against a production database.
