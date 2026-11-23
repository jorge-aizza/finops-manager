const PERIOD_FILTERS = {
  all: '',
  today: 'AND u.usage_date = CURRENT_DATE()',
  month: "AND u.usage_date >= DATE_TRUNC('MONTH', CURRENT_DATE()) AND u.usage_date <= CURRENT_DATE()",
}

function buildGenieCotasPublicaQuery(period = 'month', filtrarUsuarioPortal = true) {
  const dateFilter = PERIOD_FILTERS[period] ?? PERIOD_FILTERS.month
  return `
WITH deleted_budget_names AS (
  SELECT DISTINCT get_json_object(c.request_params['budget'], '$.display_name') AS nome_budget
  FROM system.access.audit c
  JOIN system.access.audit d
    ON get_json_object(c.response.result, '$.budget.budget_configuration_id') = d.request_params['budget_id']
  WHERE c.service_name = 'budgets' AND c.action_name = 'createBudget'
    AND d.service_name = 'budgets' AND d.action_name = 'deleteBudget'
    AND get_json_object(c.request_params['budget'], '$.display_name') IS NOT NULL
),
raw_budgets AS (
  SELECT
    get_json_object(request_params['budget'], '$.display_name') AS nome_budget,
    get_json_object(request_params['budget'], '$.filter.workspace_id.values') AS workspace_ids_json,
    request_params['budget'] AS budget_json,
    get_json_object(request_params['budget'], '$.filter.tags') AS filtro_tags,
    ROW_NUMBER() OVER (
      PARTITION BY get_json_object(request_params['budget'], '$.display_name')
      ORDER BY event_time DESC
    ) AS rn,
    CASE WHEN request_params['budget'] LIKE '%BLOCK_USAGE%' THEN 'Bloqueio' ELSE 'Apenas Alerta' END AS tipo_acao_budget
  FROM system.access.audit
  WHERE service_name = 'budgets'
    AND action_name IN ('createBudget', 'updateBudget')
    AND get_json_object(request_params['budget'], '$.display_name') IS NOT NULL
    AND get_json_object(request_params['budget'], '$.display_name') NOT IN (SELECT nome_budget FROM deleted_budget_names)
),
budget_shared_thresholds AS (
  SELECT
    b.nome_budget, b.workspace_ids_json, b.filtro_tags, b.tipo_acao_budget,
    MAX(CAST(get_json_object(ac.alert_config, '$.quantity_threshold') AS DOUBLE)) AS threshold_maximo_usd
  FROM raw_budgets b
  LATERAL VIEW explode(from_json(get_json_object(b.budget_json, '$.alert_configurations'), 'ARRAY<STRING>')) ac AS alert_config
  WHERE b.rn = 1
    AND get_json_object(ac.alert_config, '$.scope_type') = 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED'
  GROUP BY b.nome_budget, b.workspace_ids_json, b.filtro_tags, b.tipo_acao_budget
),
budget_por_workspace AS (
  SELECT b.nome_budget, b.threshold_maximo_usd, b.filtro_tags, b.tipo_acao_budget, t.ws_id
  FROM budget_shared_thresholds b
  LATERAL VIEW explode(from_json(b.workspace_ids_json, 'ARRAY<BIGINT>')) t AS ws_id
),
budget_per_ws AS (
  SELECT
    ws_id,
    MAX(threshold_maximo_usd) AS quota_usd,
    MAX_BY(nome_budget, threshold_maximo_usd) AS nome_budget,
    MAX_BY(tipo_acao_budget, threshold_maximo_usd) AS tipo_acao_budget,
    CASE
      WHEN MAX_BY(filtro_tags, threshold_maximo_usd) IS NOT NULL
        AND get_json_object(MAX_BY(filtro_tags, threshold_maximo_usd), '$[0].key') = 'databricks-product'
      THEN LOWER(get_json_object(MAX_BY(filtro_tags, threshold_maximo_usd), '$[0].value.values[0]'))
      ELSE NULL
    END AS product_filter
  FROM budget_por_workspace
  GROUP BY ws_id
),
per_user_configs AS (
  SELECT b.nome_budget, b.workspace_ids_json, ac.alert_config
  FROM raw_budgets b
  LATERAL VIEW explode(from_json(get_json_object(b.budget_json, '$.alert_configurations'), 'ARRAY<STRING>')) ac AS alert_config
  WHERE b.rn = 1
    AND get_json_object(ac.alert_config, '$.scope_type') = 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER'
),
per_user_default_candidates AS (
  SELECT
    t.ws_id,
    p.nome_budget,
    CAST(get_json_object(p.alert_config, '$.quantity_threshold') AS DOUBLE) AS limite_padrao_usuario_usd
  FROM per_user_configs p
  LATERAL VIEW explode(from_json(p.workspace_ids_json, 'ARRAY<BIGINT>')) t AS ws_id
),
per_user_default AS (
  SELECT
    ws_id,
    MAX_BY(nome_budget, limite_padrao_usuario_usd) AS nome_budget_per_user,
    MAX(limite_padrao_usuario_usd) AS limite_padrao_usuario_usd
  FROM per_user_default_candidates
  GROUP BY ws_id
),
per_user_overrides_raw AS (
  SELECT p.workspace_ids_json, p.nome_budget, ov.override_item
  FROM per_user_configs p
  LATERAL VIEW explode(from_json(get_json_object(p.alert_config, '$.principal_overrides'), 'ARRAY<STRING>')) ov AS override_item
),
per_user_overrides_candidates AS (
  SELECT
    t.ws_id,
    o.nome_budget,
    CAST(get_json_object(o.override_item, '$.principal_id') AS BIGINT) AS principal_id,
    CAST(get_json_object(o.override_item, '$.override_threshold') AS DOUBLE) AS override_limite_usd
  FROM per_user_overrides_raw o
  LATERAL VIEW explode(from_json(o.workspace_ids_json, 'ARRAY<BIGINT>')) t AS ws_id
),
per_user_overrides AS (
  SELECT
    ws_id,
    principal_id,
    MAX_BY(nome_budget, override_limite_usd) AS nome_budget_per_user,
    MAX(override_limite_usd) AS override_limite_usd
  FROM per_user_overrides_candidates
  GROUP BY ws_id, principal_id
),
principal_to_user AS (
  SELECT
    CAST(request_params['targetUserId'] AS BIGINT) AS principal_id,
    MAX_BY(request_params['targetUserName'], event_time) AS user_email
  FROM system.access.audit
  WHERE request_params['targetUserId'] IS NOT NULL
    AND request_params['targetUserName'] IS NOT NULL
  GROUP BY CAST(request_params['targetUserId'] AS BIGINT)
),
principal_to_group AS (
  SELECT
    CAST(request_params['targetGroupId'] AS BIGINT) AS principal_id,
    MAX_BY(request_params['targetGroupName'], event_time) AS group_name
  FROM system.access.audit
  WHERE request_params['targetGroupId'] IS NOT NULL
    AND request_params['targetGroupName'] IS NOT NULL
  GROUP BY CAST(request_params['targetGroupId'] AS BIGINT)
),
per_user_overrides_resolved AS (
  SELECT
    o.ws_id,
    o.nome_budget_per_user,
    o.principal_id,
    o.override_limite_usd,
    COALESCE(u.user_email, g.group_name) AS principal_name,
    CASE WHEN u.user_email IS NOT NULL THEN 'USER' ELSE 'GROUP' END AS principal_type
  FROM per_user_overrides o
  LEFT JOIN principal_to_user u ON o.principal_id = u.principal_id
  LEFT JOIN principal_to_group g ON o.principal_id = g.principal_id
),
consumo AS (
  SELECT
    u.usage_date,
    u.workspace_id,
    w.workspace_name,
    u.sku_name,
    u.billing_origin_product AS produto,
    u.identity_metadata.run_as AS usuario,
    COALESCE(u.usage_metadata.endpoint_name, 'N/A') AS endpoint_name,
    COALESCE(u.usage_metadata.cluster_id, 'N/A') AS cluster_id,
    DATE_TRUNC('MONTH', u.usage_date) AS mes_referencia,
    ROUND(SUM(u.usage_quantity), 4) AS total_dbus,
    ROUND(MAX(lp.pricing.effective_list.default), 6) AS preco_unitario_usd,
    ROUND(SUM(u.usage_quantity * lp.pricing.effective_list.default), 4) AS custo_usd
  FROM system.billing.usage u
  JOIN system.access.workspaces_latest w ON u.workspace_id = w.workspace_id
  LEFT JOIN system.billing.list_prices lp
    ON u.sku_name = lp.sku_name
    AND u.cloud = lp.cloud
    AND u.usage_unit = lp.usage_unit
    AND u.usage_start_time >= lp.price_start_time
    AND (lp.price_end_time IS NULL OR u.usage_start_time < lp.price_end_time)
  LEFT JOIN budget_per_ws bpw ON u.workspace_id = bpw.ws_id
  WHERE (bpw.product_filter IS NULL OR LOWER(u.billing_origin_product) = bpw.product_filter)
    AND (
      LOWER(u.sku_name) LIKE '%genie%'
      OR LOWER(u.billing_origin_product) LIKE '%genie%'
      OR LOWER(u.billing_origin_product) LIKE '%ai_gateway%'
    )
    ${dateFilter}
  GROUP BY
    u.usage_date, u.workspace_id, w.workspace_name, u.sku_name,
    u.billing_origin_product, u.identity_metadata.run_as,
    u.usage_metadata.endpoint_name, u.usage_metadata.cluster_id,
    DATE_TRUNC('MONTH', u.usage_date)
),
enriquecido AS (
  SELECT
    c.*,
    COALESCE(b.nome_budget, 'Sem budget') AS nome_budget_ws,
    COALESCE(b.tipo_acao_budget, 'Sem budget') AS tipo_acao_budget,
    COALESCE(ov.nome_budget_per_user, pd.nome_budget_per_user, 'Sem budget per-user') AS nome_budget_per_user,
    b.quota_usd AS quota_ws_usd,
    COALESCE(ov.override_limite_usd, pd.limite_padrao_usuario_usd) AS limite_per_user_usd,
    CASE
      WHEN ov.override_limite_usd IS NOT NULL THEN 'Override individual'
      WHEN pd.limite_padrao_usuario_usd IS NOT NULL THEN 'Padrao do budget'
      ELSE 'Sem limite per-user'
    END AS tipo_limite_per_user,
    SUM(c.custo_usd) OVER (PARTITION BY c.workspace_id, c.mes_referencia) AS custo_usd_total_workspace,
    SUM(c.custo_usd) OVER (PARTITION BY c.workspace_id, c.usage_date) AS custo_usd_workspace_dia,
    SUM(c.custo_usd) OVER (PARTITION BY c.workspace_id, c.usuario, c.mes_referencia) AS custo_usd_total_usuario,
    CASE WHEN COALESCE(b.quota_usd, 0) = 0 THEN NULL
      ELSE ROUND(SUM(c.custo_usd) OVER (PARTITION BY c.workspace_id, c.mes_referencia) / b.quota_usd * 100, 2)
    END AS pct_quota_ws,
    CASE WHEN COALESCE(ov.override_limite_usd, pd.limite_padrao_usuario_usd, 0) = 0 THEN NULL
      ELSE ROUND(
        SUM(c.custo_usd) OVER (PARTITION BY c.workspace_id, c.usuario, c.mes_referencia)
          / COALESCE(ov.override_limite_usd, pd.limite_padrao_usuario_usd) * 100, 2)
    END AS pct_limite_per_user,
    CASE
      WHEN COALESCE(b.quota_usd, 0) = 0 THEN 'Sem quota definida'
      WHEN SUM(c.custo_usd) OVER (PARTITION BY c.workspace_id, c.mes_referencia) >= b.quota_usd THEN 'Bloqueado (workspace)'
      ELSE 'Dentro da Quota (workspace)'
    END AS status_quota_ws,
    CASE
      WHEN COALESCE(ov.override_limite_usd, pd.limite_padrao_usuario_usd, 0) > 0
        AND SUM(c.custo_usd) OVER (PARTITION BY c.workspace_id, c.usuario, c.mes_referencia)
          >= COALESCE(ov.override_limite_usd, pd.limite_padrao_usuario_usd) THEN 'Bloqueado (limite per-user)'
      WHEN COALESCE(ov.override_limite_usd, pd.limite_padrao_usuario_usd, 0) > 0 THEN 'Dentro do Limite (per-user)'
      ELSE 'Sem limite per-user'
    END AS status_per_user
  FROM consumo c
  LEFT JOIN budget_per_ws b ON c.workspace_id = b.ws_id
  LEFT JOIN per_user_default pd ON c.workspace_id = pd.ws_id
  LEFT JOIN per_user_overrides_resolved ov
    ON c.workspace_id = ov.ws_id
    AND LOWER(c.usuario) = LOWER(ov.principal_name)
    AND ov.principal_type = 'USER'
)
SELECT * FROM enriquecido
${filtrarUsuarioPortal ? "WHERE LOWER(TRIM(COALESCE(usuario, ''))) = LOWER(TRIM(:portal_usuario))" : ''}
ORDER BY usage_date DESC, custo_usd DESC`
}

function buildGenieCotasInternaQuery(period = 'month') {
  return buildGenieCotasPublicaQuery(period, false)
}

function aggregateGenieCotasPublicaRows(rows) {
  const porWorkspace = new Map()
  for (const row of rows) {
    const workspaceId = String(row.workspace_id)
    let workspace = porWorkspace.get(workspaceId)
    if (!workspace) {
      workspace = {
        workspace_id: workspaceId,
        workspace_nome: row.workspace_name || workspaceId,
        custo: 0,
        custo_workspace: 0,
        dbus: 0,
        dbus_free: 0,
        quota_nativa: row.quota_ws_usd == null ? null : Number(row.quota_ws_usd),
        limite_per_user: row.limite_per_user_usd == null ? null : Number(row.limite_per_user_usd),
        nome_budget_ws: row.nome_budget_ws || null,
        nome_budget_per_user: row.nome_budget_per_user || null,
        tipo_acao_budget: row.tipo_acao_budget || null,
        status_workspace: row.status_quota_ws || null,
        status_usuario: row.status_per_user || null,
        status: row.status_per_user || row.status_quota_ws || null,
        custoWorkspacePorMes: new Map(),
        dias: new Map(),
        detalhes: [],
      }
      porWorkspace.set(workspaceId, workspace)
    }

    const custo = Number(row.custo_usd) || 0
    const dbus = Number(row.total_dbus) || 0
    workspace.custo += custo
    workspace.dbus += dbus
    if (String(row.sku_name || '').toUpperCase().includes('FREE')) workspace.dbus_free += dbus
    if (row.quota_ws_usd != null) workspace.quota_nativa = Number(row.quota_ws_usd)
    if (row.limite_per_user_usd != null) workspace.limite_per_user = Number(row.limite_per_user_usd)
    if (row.nome_budget_ws) workspace.nome_budget_ws = row.nome_budget_ws
    if (row.nome_budget_per_user) workspace.nome_budget_per_user = row.nome_budget_per_user
    if (row.tipo_acao_budget) workspace.tipo_acao_budget = row.tipo_acao_budget
    if (row.status_quota_ws === 'Bloqueado (workspace)') workspace.status_workspace = row.status_quota_ws
    if (row.status_per_user === 'Bloqueado (limite per-user)') workspace.status_usuario = row.status_per_user
    if (row.status_per_user === 'Bloqueado (limite per-user)' || !workspace.status) {
      workspace.status = row.status_per_user || row.status_quota_ws || workspace.status
    }

    const mes = String(row.mes_referencia || row.usage_date).slice(0, 7)
    if (row.custo_usd_total_workspace != null) {
      workspace.custoWorkspacePorMes.set(mes, Number(row.custo_usd_total_workspace) || 0)
    }

    const dia = String(row.usage_date).slice(0, 10)
    const serie = workspace.dias.get(dia) || { dia, custo: 0, custo_workspace: 0, dbus: 0, dbus_free: 0 }
    serie.custo += custo
    serie.dbus += dbus
    serie.custo_workspace = Math.max(serie.custo_workspace, Number(row.custo_usd_workspace_dia) || 0)
    if (String(row.sku_name || '').toUpperCase().includes('FREE')) serie.dbus_free += dbus
    workspace.dias.set(dia, serie)
    workspace.detalhes.push({
      dia,
      produto: row.produto || 'Genie',
      sku: row.sku_name,
      endpoint: row.endpoint_name,
      dbus,
      custo,
    })
  }

  return [...porWorkspace.values()].map((workspace) => {
    const { custoWorkspacePorMes, ...result } = workspace
    return {
      ...result,
      custo_workspace: [...custoWorkspacePorMes.values()].reduce((total, custo) => total + custo, 0),
      dias: [...workspace.dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
      detalhes: workspace.detalhes.sort((a, b) => b.dia.localeCompare(a.dia) || b.custo - a.custo),
    }
  }).sort((a, b) => b.custo - a.custo)
}

function aggregateGenieCotasPublicasPorUsuario(rows) {
  const rowsByEmail = new Map()
  for (const row of rows) {
    const email = String(row.usuario || '').trim().toLowerCase()
    if (!email) continue
    if (!rowsByEmail.has(email)) rowsByEmail.set(email, [])
    rowsByEmail.get(email).push(row)
  }

  return Object.fromEntries([...rowsByEmail].map(([email, userRows]) => [
    email,
    aggregateGenieCotasPublicaRows(userRows).map((workspace) => {
      const { custo_workspace, status_workspace, dias, ...pessoal } = workspace
      return {
        ...pessoal,
        status: workspace.status_usuario || null,
        dias: dias.map(({ custo_workspace: _custoWorkspace, ...dia }) => dia),
      }
    }),
  ]))
}

const GENIE_FREE_DBU_MENSAL_POR_USUARIO = 150

function _classificarDbuFreePorUsuarioMes(rows) {
  const freePorUsuarioMes = new Map()
  const ordenadas = [...rows].sort((a, b) => {
    const mesA = String(a.mes_referencia || a.usage_date).slice(0, 7)
    const mesB = String(b.mes_referencia || b.usage_date).slice(0, 7)
    return mesA.localeCompare(mesB)
      || String(a.usage_date).localeCompare(String(b.usage_date))
      || String(a.usuario || '').localeCompare(String(b.usuario || ''))
      || String(a.workspace_id).localeCompare(String(b.workspace_id))
      || String(a.sku_name || '').localeCompare(String(b.sku_name || ''))
  })

  return ordenadas.map((row) => {
    const dbus = Math.max(0, Number(row.total_dbus) || 0)
    // Regra de negócio: cada usuário tem franquia mensal de 150 DBU para Genie,
    // independentemente do SKU em que o consumo entrou (FREE/STANDARD/etc.).
    const mes = String(row.mes_referencia || row.usage_date).slice(0, 7)
    const usuario = String(row.usuario || '(não identificado)').trim().toLowerCase()
    const chave = `${mes}|${usuario}`
    const usado = freePorUsuarioMes.get(chave) || 0
    const dbusFree = Math.min(dbus, Math.max(0, GENIE_FREE_DBU_MENSAL_POR_USUARIO - usado))
    freePorUsuarioMes.set(chave, usado + dbusFree)
    return { ...row, _dbus_free: dbusFree, _dbus_pago: dbus - dbusFree }
  })
}

function aggregateGenieCotasInternasRows(rows) {
  const workspaces = new Map()
  const usuarios = new Map()
  const numeroOuNull = (value) => value == null ? null : Number(value)
  const statusCota = (pct, limite) => {
    if (limite == null || limite <= 0 || pct == null) return 'sem_cota'
    if (pct >= 100) return 'estourado'
    if (pct >= 90) return 'critico'
    if (pct >= 75) return 'atencao'
    return 'ok'
  }

  for (const row of _classificarDbuFreePorUsuarioMes(rows)) {
    const workspaceId = String(row.workspace_id)
    let workspace = workspaces.get(workspaceId)
    if (!workspace) {
      const limite = numeroOuNull(row.quota_ws_usd)
      const pct = numeroOuNull(row.pct_quota_ws)
      workspace = {
        workspace_id: workspaceId,
        workspace_nome: row.workspace_name || workspaceId,
        custo: 0,
        dbus: 0,
        dbus_free: 0,
        dbus_pago: 0,
        cota: limite,
        pct,
        budget_nome: row.nome_budget_ws && row.nome_budget_ws !== 'Sem budget' ? row.nome_budget_ws : null,
        budget_acao: row.tipo_acao_budget && row.tipo_acao_budget !== 'Sem budget' ? row.tipo_acao_budget : null,
        status: statusCota(pct, limite),
        custoPorMes: new Map(),
        dias: new Map(),
      }
      workspaces.set(workspaceId, workspace)
    }

    const custo = Number(row.custo_usd) || 0
    const dbus = Number(row.total_dbus) || 0
    workspace.custo += custo
    workspace.dbus += dbus
    workspace.dbus_free += row._dbus_free
    workspace.dbus_pago += row._dbus_pago

    const mes = String(row.mes_referencia || row.usage_date).slice(0, 7)
    if (row.custo_usd_total_workspace != null) {
      workspace.custoPorMes.set(mes, Number(row.custo_usd_total_workspace) || 0)
    }
    const dia = String(row.usage_date).slice(0, 10)
    const diaWorkspace = workspace.dias.get(dia) || { dia, custo: 0, dbus: 0, dbus_free: 0, dbus_pago: 0 }
    const custoWorkspaceDia = Number(row.custo_usd_workspace_dia)
    diaWorkspace.custo = Number.isFinite(custoWorkspaceDia)
      ? Math.max(diaWorkspace.custo, custoWorkspaceDia)
      : diaWorkspace.custo + custo
    diaWorkspace.dbus += dbus
    diaWorkspace.dbus_free += row._dbus_free
    diaWorkspace.dbus_pago += row._dbus_pago
    workspace.dias.set(dia, diaWorkspace)

    const usuario = String(row.usuario || '(não identificado)')
    const chaveUsuario = `${workspaceId}|${usuario.toLowerCase()}`
    let user = usuarios.get(chaveUsuario)
    if (!user) {
      const limite = numeroOuNull(row.limite_per_user_usd)
      const pct = numeroOuNull(row.pct_limite_per_user)
      user = {
        workspace_id: workspaceId,
        usuario,
        custo: 0,
        dbus: 0,
        dbus_free: 0,
        dbus_pago: 0,
        limite,
        pct,
        origem_limite: row.tipo_limite_per_user === 'Override individual' ? 'individual'
          : row.tipo_limite_per_user === 'Padrao do budget' ? 'workspace' : null,
        budget_nome: row.nome_budget_per_user && row.nome_budget_per_user !== 'Sem budget per-user' ? row.nome_budget_per_user : null,
        budget_acao: workspace.budget_acao,
        status: statusCota(pct, limite),
        dias: new Map(),
      }
      usuarios.set(chaveUsuario, user)
    }
    user.custo += custo
    user.dbus += dbus
    user.dbus_free += row._dbus_free
    user.dbus_pago += row._dbus_pago
    const diaUsuario = user.dias.get(dia) || { dia, custo: 0, dbus: 0, dbus_free: 0, dbus_pago: 0 }
    diaUsuario.custo += custo
    diaUsuario.dbus += dbus
    diaUsuario.dbus_free += row._dbus_free
    diaUsuario.dbus_pago += row._dbus_pago
    user.dias.set(dia, diaUsuario)
  }

  return {
    workspaces: [...workspaces.values()].map(({ custoPorMes, dias, ...workspace }) => ({
      ...workspace,
      custo_workspace: [...custoPorMes.values()].reduce((total, custo) => total + custo, 0),
      dias: [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
    })).sort((a, b) => b.custo - a.custo),
    usuarios: [...usuarios.values()].map(({ dias, ...usuario }) => ({
      ...usuario,
      dias: [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
    })).sort((a, b) => b.custo - a.custo),
  }
}

function dedupeGenieCotasRows(groups) {
  const unique = new Map()
  for (const rows of groups) {
    for (const row of rows || []) {
      const key = JSON.stringify(row)
      if (!unique.has(key)) unique.set(key, row)
    }
  }
  return [...unique.values()]
}

module.exports = {
  buildGenieCotasPublicaQuery,
  buildGenieCotasInternaQuery,
  aggregateGenieCotasPublicaRows,
  aggregateGenieCotasPublicasPorUsuario,
  aggregateGenieCotasInternasRows,
  dedupeGenieCotasRows,
}