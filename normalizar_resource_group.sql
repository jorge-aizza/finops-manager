-- ============================================================
-- NORMALIZAÇÃO: resource_group_name → UPPER CASE
-- Execute UMA VEZ para corrigir os dados já importados
-- ============================================================

-- 1. Preview: quantos registros serão afetados
SELECT
  COUNT(*)                          AS total_linhas,
  COUNT(DISTINCT resource_group_name) AS grupos_antes,
  COUNT(DISTINCT UPPER(resource_group_name)) AS grupos_depois
FROM azure_costs
WHERE resource_group_name IS NOT NULL
  AND resource_group_name <> UPPER(resource_group_name);

-- 2. Quais grupos têm variações de case (para confirmar antes de rodar)
SELECT
  UPPER(resource_group_name)        AS nome_normalizado,
  COUNT(DISTINCT resource_group_name) AS variacoes_encontradas,
  STRING_AGG(DISTINCT resource_group_name, ' | ' ORDER BY resource_group_name) AS lista_variacoes,
  COUNT(*)                          AS linhas_afetadas
FROM azure_costs
GROUP BY UPPER(resource_group_name)
HAVING COUNT(DISTINCT resource_group_name) > 1
ORDER BY linhas_afetadas DESC;

-- 3. Executar a normalização (descomente quando pronto)
-- BEGIN;
--   UPDATE azure_costs
--   SET resource_group_name = UPPER(resource_group_name)
--   WHERE resource_group_name IS NOT NULL
--     AND resource_group_name <> UPPER(resource_group_name);
--   -- Verificar resultado
--   SELECT COUNT(DISTINCT UPPER(resource_group_name)) AS grupos_apos_normalizacao
--   FROM azure_costs;
-- COMMIT;
