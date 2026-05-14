-- ============================================================
-- MIGRATION: Corrigir tabela azure_costs existente
-- Execute ANTES de re-importar o arquivo .parquet
-- ============================================================

-- 1) Adicionar constraint UNIQUE se ainda não existir
--    (necessária para o UPSERT do server.js funcionar)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'azure_costs'
      AND constraint_type = 'UNIQUE'
      AND constraint_name = 'azure_costs_upsert_key'
  ) THEN
    -- Antes de criar a constraint, remover duplicatas se houver
    DELETE FROM azure_costs a
    USING azure_costs b
    WHERE a.id > b.id
      AND a.subscription_id IS NOT DISTINCT FROM b.subscription_id
      AND a.resource_id     IS NOT DISTINCT FROM b.resource_id
      AND a.cost_date       IS NOT DISTINCT FROM b.cost_date
      AND a.meter_id        IS NOT DISTINCT FROM b.meter_id
      AND a.charge_type     IS NOT DISTINCT FROM b.charge_type
      AND a.quantity        IS NOT DISTINCT FROM b.quantity;

    ALTER TABLE azure_costs
      ADD CONSTRAINT azure_costs_upsert_key
      UNIQUE (subscription_id, resource_id, cost_date, meter_id, charge_type, quantity);

    RAISE NOTICE 'Constraint UNIQUE criada com sucesso.';
  ELSE
    RAISE NOTICE 'Constraint UNIQUE já existe.';
  END IF;
END $$;

-- 2) Verificar quantos registros têm campos nulos que deveriam ter valor
SELECT
  COUNT(*)                                        AS total_linhas,
  COUNT(*) FILTER (WHERE cost_date IS NULL)       AS cost_date_null,
  COUNT(*) FILTER (WHERE cost_in_billing_currency IS NULL) AS custo_billing_null,
  COUNT(*) FILTER (WHERE cost_in_usd IS NULL)     AS custo_usd_null,
  COUNT(*) FILTER (WHERE effective_price IS NULL) AS preco_null,
  COUNT(*) FILTER (WHERE quantity IS NULL)        AS quantidade_null,
  COUNT(*) FILTER (WHERE billing_period_start_date IS NULL) AS periodo_inicio_null,
  COUNT(*) FILTER (WHERE exchange_rate_date IS NULL) AS taxa_data_null
FROM azure_costs;

-- 3) LIMPAR TODOS os registros para re-importação com dados corretos
--    (descomente a linha abaixo quando estiver pronto para re-importar)
-- TRUNCATE TABLE azure_costs RESTART IDENTITY;

-- 4) OU limpar apenas um arquivo específico:
-- DELETE FROM azure_costs WHERE arquivo_origem = 'part_0_0001.parquet';

-- ============================================================
-- ÍNDICES úteis (criados automaticamente pelo server.js,
-- mas garanta que existam):
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_azure_costs_date        ON azure_costs(cost_date);
CREATE INDEX IF NOT EXISTS idx_azure_costs_sub         ON azure_costs(subscription_id);
CREATE INDEX IF NOT EXISTS idx_azure_costs_rg          ON azure_costs(resource_group_name);
CREATE INDEX IF NOT EXISTS idx_azure_costs_service     ON azure_costs(consumed_service);
CREATE INDEX IF NOT EXISTS idx_azure_costs_meter_cat   ON azure_costs(meter_category);
CREATE INDEX IF NOT EXISTS idx_azure_costs_resource_id ON azure_costs(resource_id);
CREATE INDEX IF NOT EXISTS idx_azure_costs_importado   ON azure_costs(importado_em);
