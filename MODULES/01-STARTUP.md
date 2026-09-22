# 01-STARTUP — Boot Sequence & Timers

## Startup Sequence (in order)

1. **Load env** → `.env.enc` + `.env.key` (fallback: `.env`, then system env)
2. **Console warnings** → if `JWT_SECRET` or `MASTER_KEY` are defaults (insecure)
3. **Security middleware** → helmet, rate-limit, CORS
4. **Check setup** → `isConfigured()` → if not, serve setup wizard only
5. **Init DB** → create all core tables (`IF NOT EXISTS`)
6. **Ensure Azure costs table** → async, background index creation starts
7. **Ensure Azure coleta table** → creates 46+ tables for Inventory, Databricks, Storage
8. **Ensure Price List table** → creates indexes, materialized views
9. **Start 4 timers** (all idempotent):
   - `_iniciarAgendador()` — coleta Azure/Databricks (5 min tick, 120s delay)
   - `_iniciarAlertasEmail()` — SMTP alerts (hourly)
   - `_iniciarInventarioAgendador()` — Azure Inventory (1st tick 150s, then hourly)
   - `_iniciarRecursoTagsCache()` — rebuild tags (1st tick 4 min, then 6h)
10. **Warm-up `_dbWsCache`** — preload Databricks workspace mappings
11. **4 background tasks** via `setTimeout` (different intervals):
    - `_refreshAzureCache()` (90s) — subscription/RG cache
    - `_getRgStatsCache()` (120s) — RG cost pre-computation
    - Fonte migration (60s)
    - Perf index creation (3 min)
12. **SIGTERM/SIGINT handlers** — graceful shutdown

**Perf note**: No startup blocks on CREATE INDEX or MV refresh; server fully usable in <1s after DB connect.

## Timer Lifecycle (app.js)

```javascript
// Each timer has a named reference that gets cleared on logout:
_dbStatusInterval      // checkDbStatus() every 30s
_notifInterval         // loadNotificacoes() every 5 min
_refreshTimer          // manualRefresh() (configurable, default 10 min)
_countdownTimer        // countdown display (same as _refreshTimer)
_inactivityTimer       // showTimeoutWarning() 15 min idle
_alertasEmailTimer     // hourly email checks
_agendadorTimer        // 5 min coleta scheduler tick
_inventarioTimer       // hourly inventory coleta
_resourceTagsTimer     // 6h tag cache rebuild
```

All cleared on `logout()`. Recreated on login.

## Database Connection

- **Pool**: `pg.Pool` (idle 10s, max 20 connections)
- **Reconnect**: auto on pool error (no manual retry needed)
- **Heartbeat**: SIGTERM/SIGINT handlers call `pool.end()` before exit
- **Pre-setup**: no pool until `setup.sh` completes (wizard operates with temp connection)

## Migrations (idempotent)

Every `ensure*()` call runs migrations if needed:

```sql
CREATE TABLE IF NOT EXISTS ...
ALTER TABLE IF NOT EXISTS ... ADD COLUMN IF NOT EXISTS ...
CREATE INDEX IF NOT EXISTS ...
-- No DROP statements; migrations only add
```

**Rollback not automatic** — see `rollback_performance_indexes.sql` for manual reversal.

## Cold Start Performance

| Phase | Time | Bottleneck |
|-------|------|------------|
| Load env + validate | <100ms | — |
| DB connect | 100–500ms | Network latency |
| `ensureAzureCostsTable()` | 50–200ms | Table scan for indexes |
| `_refreshAzureCache()` | 5–90s | azure_costs GROUP BY (size-dependent) |
| MV refresh (`pl_best_mv`) | 10–50s | Price List size |
| All timers started | <1s | — |
| **Total** | 10–100s | Heavy at first, then stable |

**Optimization**: Background MV refresh doesn't block server start; first request to `/resumo` waits if cache isn't ready yet.

---

See `server.js:1–200` for the full boot function, line by line.
