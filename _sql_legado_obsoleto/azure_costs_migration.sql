-- ============================================================
-- Migration: Tabela azure_costs — Azure Cost Management
-- Execute este script se quiser criar a tabela manualmente.
-- O server.js cria automaticamente ao primeiro uso da rota.
-- ============================================================

CREATE TABLE IF NOT EXISTS azure_costs (
  id                               BIGSERIAL PRIMARY KEY,

  -- Faturamento
  invoice_id                       VARCHAR(100),
  previous_invoice_id              VARCHAR(100),
  billing_account_id               VARCHAR(200),
  billing_account_name             VARCHAR(500),
  billing_profile_id               VARCHAR(200),
  billing_profile_name             VARCHAR(500),
  invoice_section_id               VARCHAR(200),
  invoice_section_name             VARCHAR(500),
  reseller_name                    VARCHAR(500),
  reseller_mpn_id                  VARCHAR(100),
  cost_center                      VARCHAR(200),

  -- Períodos
  billing_period_end_date          DATE,
  billing_period_start_date        DATE,
  service_period_end_date          DATE,
  service_period_start_date        DATE,
  cost_date                        DATE,          -- campo "date" no parquet

  -- Serviço / Produto
  service_family                   VARCHAR(200),
  product_order_id                 VARCHAR(200),
  product_order_name               VARCHAR(500),
  consumed_service                 VARCHAR(500),
  meter_id                         UUID,
  meter_name                       VARCHAR(500),
  meter_category                   VARCHAR(200),
  meter_sub_category               VARCHAR(200),
  meter_region                     VARCHAR(200),
  product_id                       VARCHAR(200),
  product_name                     VARCHAR(500),

  -- Subscription / Resource
  subscription_id                  UUID,
  subscription_name                VARCHAR(500),
  publisher_type                   VARCHAR(100),
  publisher_id                     VARCHAR(200),
  publisher_name                   VARCHAR(500),
  resource_group_name              VARCHAR(500),
  resource_id                      TEXT,
  resource_location                VARCHAR(200),
  location                         VARCHAR(200),

  -- Preços e custos
  effective_price                  NUMERIC(20,10),
  quantity                         NUMERIC(20,10),
  unit_of_measure                  VARCHAR(100),
  charge_type                      VARCHAR(100),
  billing_currency                 VARCHAR(10),
  pricing_currency                 VARCHAR(10),
  cost_in_billing_currency         NUMERIC(20,10),
  cost_in_pricing_currency         NUMERIC(20,10),
  cost_in_usd                      NUMERIC(20,10),
  payg_cost_in_billing_currency    NUMERIC(20,10),
  payg_cost_in_usd                 NUMERIC(20,10),
  exchange_rate_pricing_to_billing NUMERIC(20,10),
  exchange_rate_date               DATE,

  -- Créditos / Reservas / Benefícios
  is_azure_credit_eligible         BOOLEAN,
  reservation_id                   VARCHAR(200),
  reservation_name                 VARCHAR(500),
  pricing_model                    VARCHAR(100),   -- OnDemand, Reservation, Spot…
  unit_price                       NUMERIC(20,10),
  payg_price                       NUMERIC(20,10),
  frequency                        VARCHAR(100),
  term                             VARCHAR(100),
  benefit_id                       VARCHAR(200),
  benefit_name                     VARCHAR(500),
  cost_allocation_rule_name        VARCHAR(500),
  provider                         VARCHAR(200),

  -- Metadados
  service_info1                    TEXT,
  service_info2                    TEXT,
  additional_info                  TEXT,           -- JSON serializado
  tags                             TEXT,           -- JSON serializado

  -- Controle de importação
  importado_em                     TIMESTAMP DEFAULT NOW(),
  arquivo_origem                   VARCHAR(500),

  -- Chave de deduplicação (mesmo item no mesmo dia)
  UNIQUE (subscription_id, resource_id, cost_date, meter_id, charge_type, quantity)
);

-- Índices para filtros frequentes
CREATE INDEX IF NOT EXISTS idx_azure_costs_date         ON azure_costs(cost_date);
CREATE INDEX IF NOT EXISTS idx_azure_costs_sub          ON azure_costs(subscription_id);
CREATE INDEX IF NOT EXISTS idx_azure_costs_resource_grp ON azure_costs(resource_group_name);
CREATE INDEX IF NOT EXISTS idx_azure_costs_service      ON azure_costs(consumed_service);
CREATE INDEX IF NOT EXISTS idx_azure_costs_meter_cat    ON azure_costs(meter_category);
CREATE INDEX IF NOT EXISTS idx_azure_costs_charge_type  ON azure_costs(charge_type);
CREATE INDEX IF NOT EXISTS idx_azure_costs_importado    ON azure_costs(importado_em);

-- ============================================================
-- Queries úteis após importação
-- ============================================================

-- Custo total por dia
-- SELECT cost_date, SUM(cost_in_usd) AS total_usd
-- FROM azure_costs GROUP BY cost_date ORDER BY cost_date;

-- Top 10 resource groups por custo
-- SELECT resource_group_name, SUM(cost_in_usd) AS total_usd
-- FROM azure_costs GROUP BY resource_group_name ORDER BY total_usd DESC LIMIT 10;

-- Custo por categoria de serviço
-- SELECT meter_category, SUM(cost_in_usd) AS total_usd
-- FROM azure_costs GROUP BY meter_category ORDER BY total_usd DESC;

-- Custo por subscription
-- SELECT subscription_name, SUM(cost_in_usd) AS total_usd
-- FROM azure_costs GROUP BY subscription_name ORDER BY total_usd DESC;
