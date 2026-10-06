-- ============================================================
-- ROLLBACK — Performance Indexes v2.0
-- FinOps Manager — aplicado em: 2026-05
-- ============================================================
-- Para reverter TODOS os indexes adicionados na v2.0, execute
-- este arquivo no banco PostgreSQL:
--
--   psql -U postgres -d finops_db -f rollback_performance_indexes.sql
--
-- Os indexes ORIGINAIS (v1.0) NÃO são removidos por este script.
-- Apenas os indexes NOVOS adicionados na v2.0 são dropados.
-- ============================================================

-- ── 1. Tabelas core ─────────────────────────────────────────

-- acoes_finops
DROP INDEX IF EXISTS idx_acoes_status;
DROP INDEX IF EXISTS idx_acoes_projeto;
DROP INDEX IF EXISTS idx_acoes_conclusao;
DROP INDEX IF EXISTS idx_acoes_cloud;

-- sessoes
DROP INDEX IF EXISTS idx_sessoes_usuario;
DROP INDEX IF EXISTS idx_sessoes_criado;

-- estimativas
DROP INDEX IF EXISTS idx_estimativas_projeto;
DROP INDEX IF EXISTS idx_estimativas_criado;

-- reservas_cloud
DROP INDEX IF EXISTS idx_reservas_status_venc;

-- ── 2. azure_costs — novos indexes v2.0 ─────────────────────

-- Composto triplo (subscription + rg + date)
DROP INDEX IF EXISTS idx_azure_costs_sub_rg_date;

-- charge_type e pricing_model
DROP INDEX IF EXISTS idx_azure_costs_charge_type;
DROP INDEX IF EXISTS idx_azure_costs_pricing_model;

-- GIN pg_trgm (unit_of_measure ILIKE)
DROP INDEX IF EXISTS idx_azure_costs_uom_trgm;

-- ── 3. azure_price_list — partial index v2.0 ────────────────

DROP INDEX IF EXISTS idx_pricelist_join;

-- ============================================================
-- Indexes ORIGINAIS (v1.0) — NÃO removidos por este script:
--
-- azure_costs:
--   idx_azure_costs_date, idx_azure_costs_sub, idx_azure_costs_rg,
--   idx_azure_costs_service, idx_azure_costs_meter_cat,
--   idx_azure_costs_resource_id, idx_azure_costs_importado,
--   idx_azure_costs_sub_rg, idx_azure_costs_sub_date,
--   idx_azure_costs_rg_upper, idx_azure_costs_sub_rg_upper,
--   idx_azure_costs_dedup
--
-- azure_price_list:
--   idx_pricelist_meter, idx_pricelist_meter_lower,
--   idx_pricelist_service, idx_pricelist_region, idx_pricelist_type
-- ============================================================
