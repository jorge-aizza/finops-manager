-- ============================================================
-- ÍNDICES FUNCIONAIS — azure_costs
-- Execute UMA VEZ no banco para resolver a lentidão
-- Estes índices cobrem as queries de subscription, RG e recursos
-- ============================================================

-- Índice funcional para UPPER(resource_group_name)
-- Resolve o GROUP BY UPPER() sem full scan
CREATE INDEX IF NOT EXISTS idx_azure_costs_rg_upper
  ON azure_costs (UPPER(resource_group_name));

-- Índice funcional para UPPER(unit_of_measure)
-- Resolve o ILIKE '%hour%' de forma mais eficiente
CREATE INDEX IF NOT EXISTS idx_azure_costs_uom
  ON azure_costs (unit_of_measure);

-- Índice composto para as queries mais comuns
-- (subscription + data + resource_group)
CREATE INDEX IF NOT EXISTS idx_azure_costs_sub_date_rg
  ON azure_costs (subscription_id, cost_date, UPPER(resource_group_name));

-- Índice para charge_type (filtro NOT IN aplicado em todas queries)
CREATE INDEX IF NOT EXISTS idx_azure_costs_charge_type
  ON azure_costs (charge_type);

-- Verificar índices criados
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'azure_costs'
ORDER BY indexname;
