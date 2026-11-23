const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildGenieCotasPublicaQuery,
  buildGenieCotasInternaQuery,
  aggregateGenieCotasPublicaRows,
  aggregateGenieCotasPublicasPorUsuario,
  aggregateGenieCotasInternasRows,
  dedupeGenieCotasRows,
} = require('../genieCotasPublicaQuery')

test('a consulta pessoal filtra o usuário depois dos totais de workspace e de usuário', () => {
  const sql = buildGenieCotasPublicaQuery('all')
  assert.match(sql, /SUM\(c\.custo_usd\) OVER \(PARTITION BY c\.workspace_id, c\.mes_referencia\)/)
  assert.match(sql, /WHERE LOWER\(TRIM\(COALESCE\(usuario, ''\)\)\) = LOWER\(TRIM\(:portal_usuario\)\)/)
  assert.doesNotMatch(sql, /u\.identity_metadata\.run_as\s*=\s*['"]/)
})

test('o período hoje usa CURRENT_DATE e períodos desconhecidos voltam ao mês atual', () => {
  assert.match(buildGenieCotasPublicaQuery('today'), /u\.usage_date = CURRENT_DATE\(\)/)
  assert.match(buildGenieCotasPublicaQuery('other'), /DATE_TRUNC\('MONTH', CURRENT_DATE\(\)\)/)
})

test('os níveis per-user são consolidados antes de juntar ao consumo', () => {
  const sql = buildGenieCotasPublicaQuery()
  assert.match(sql, /per_user_default AS \([\s\S]*?MAX\(limite_padrao_usuario_usd\)/)
  assert.match(sql, /per_user_overrides AS \([\s\S]*?MAX\(override_limite_usd\)/)
})

test('a SQL interna reaproveita a consulta do portal sem filtrar por usuário', () => {
  const sql = buildGenieCotasInternaQuery()
  assert.match(sql, /system\.billing\.usage/)
  assert.match(sql, /system\.access\.audit/)
  assert.match(sql, /billing_origin_product\) LIKE '%ai_gateway%'/)
  assert.doesNotMatch(sql, /:portal_usuario/)
  assert.doesNotMatch(sql, /WHERE LOWER\(TRIM\(COALESCE\(usuario/)
})

test('agrega consumo pessoal e deduplica o total mensal compartilhado por SKU', () => {
  const rows = aggregateGenieCotasPublicaRows([
    { workspace_id: '10', workspace_name: 'Produção', usage_date: '2026-11-02', mes_referencia: '2026-11-01', sku_name: 'GENIE_FREE', produto: 'GENIE', total_dbus: '10', custo_usd: '0', custo_usd_total_workspace: '350', quota_ws_usd: '500', limite_per_user_usd: '80', status_quota_ws: 'Dentro da Quota (workspace)', status_per_user: 'Dentro do Limite (per-user)' },
    { workspace_id: '10', workspace_name: 'Produção', usage_date: '2026-11-02', mes_referencia: '2026-11-01', sku_name: 'GENIE_STANDARD', produto: 'GENIE', total_dbus: '5', custo_usd: '25', custo_usd_total_workspace: '350', quota_ws_usd: '500', limite_per_user_usd: '80', status_quota_ws: 'Dentro da Quota (workspace)', status_per_user: 'Dentro do Limite (per-user)' },
    { workspace_id: '10', workspace_name: 'Produção', usage_date: '2026-10-28', mes_referencia: '2026-10-01', sku_name: 'GENIE_STANDARD', produto: 'GENIE', total_dbus: '4', custo_usd: '20', custo_usd_total_workspace: '300', quota_ws_usd: '500', limite_per_user_usd: '80', status_quota_ws: 'Bloqueado (workspace)', status_per_user: 'Bloqueado (limite per-user)' },
  ])

  assert.equal(rows.length, 1)
  assert.equal(rows[0].custo, 45)
  assert.equal(rows[0].dbus, 19)
  assert.equal(rows[0].custo_workspace, 650)
  assert.equal(rows[0].quota_nativa, 500)
  assert.equal(rows[0].limite_per_user, 80)
  assert.equal(rows[0].status_workspace, 'Bloqueado (workspace)')
  assert.equal(rows[0].status_usuario, 'Bloqueado (limite per-user)')
  assert.equal(rows[0].dias.find((dia) => dia.dia === '2026-11-02').dbus_free, 10)
})

test('gera snapshots isolados por email e remove consumo agregado do workspace', () => {
  const snapshots = aggregateGenieCotasPublicasPorUsuario([
    { workspace_id: '10', workspace_name: 'Produção', usage_date: '2026-11-02', mes_referencia: '2026-11-01', usuario: 'Ana@Example.com', sku_name: 'GENIE_STANDARD', produto: 'GENIE', endpoint_name: 'ana-endpoint', total_dbus: '5', custo_usd: '25', custo_usd_total_workspace: '100', custo_usd_workspace_dia: '40', quota_ws_usd: '500', limite_per_user_usd: '80', status_quota_ws: 'Dentro da Quota (workspace)', status_per_user: 'Dentro do Limite (per-user)' },
    { workspace_id: '10', workspace_name: 'Produção', usage_date: '2026-11-02', mes_referencia: '2026-11-01', usuario: 'bob@example.com', sku_name: 'GENIE_STANDARD', produto: 'GENIE', endpoint_name: 'bob-endpoint', total_dbus: '7', custo_usd: '35', custo_usd_total_workspace: '100', custo_usd_workspace_dia: '40', quota_ws_usd: '500', limite_per_user_usd: null, status_quota_ws: 'Dentro da Quota (workspace)' },
  ])

  assert.deepEqual(Object.keys(snapshots), ['ana@example.com', 'bob@example.com'])
  assert.equal(snapshots['ana@example.com'][0].custo, 25)
  assert.equal(snapshots['ana@example.com'][0].detalhes[0].endpoint, 'ana-endpoint')
  assert.equal(snapshots['ana@example.com'][0].custo_workspace, undefined)
  assert.equal(snapshots['ana@example.com'][0].status_workspace, undefined)
  assert.equal(snapshots['ana@example.com'][0].dias[0].custo_workspace, undefined)
  assert.equal(snapshots['bob@example.com'][0].custo, 35)
})

test('agrega quotas internas por workspace e usuário sem duplicar o total do workspace', () => {
  const resultado = aggregateGenieCotasInternasRows([
    { workspace_id: '10', workspace_name: 'Produção', usage_date: '2026-11-02', mes_referencia: '2026-11-01', usuario: 'ana@example.com', sku_name: 'GENIE_FREE', total_dbus: '10', custo_usd: '0', custo_usd_total_workspace: '25', custo_usd_workspace_dia: '25', quota_ws_usd: '100', pct_quota_ws: '25', nome_budget_ws: 'Limite workspace', tipo_acao_budget: 'Bloqueio', limite_per_user_usd: '50', pct_limite_per_user: '0', nome_budget_per_user: 'Limite por pessoa', tipo_limite_per_user: 'Padrao do budget' },
    { workspace_id: '10', workspace_name: 'Produção', usage_date: '2026-11-02', mes_referencia: '2026-11-01', usuario: 'bob@example.com', sku_name: 'GENIE_STANDARD', total_dbus: '5', custo_usd: '25', custo_usd_total_workspace: '25', custo_usd_workspace_dia: '25', quota_ws_usd: '100', pct_quota_ws: '25', nome_budget_ws: 'Limite workspace', tipo_acao_budget: 'Bloqueio', limite_per_user_usd: null, pct_limite_per_user: null, nome_budget_per_user: 'Sem budget per-user', tipo_limite_per_user: 'Sem limite per-user' },
    { workspace_id: '10', workspace_name: 'Produção', usage_date: '2026-11-03', mes_referencia: '2026-11-01', usuario: 'ana@example.com', sku_name: 'GENIE_FREE', total_dbus: '2', custo_usd: '0', custo_usd_total_workspace: '30', custo_usd_workspace_dia: '5', quota_ws_usd: '100', pct_quota_ws: '30', nome_budget_ws: 'Limite workspace', tipo_acao_budget: 'Bloqueio', limite_per_user_usd: '50', pct_limite_per_user: '0', nome_budget_per_user: 'Limite por pessoa', tipo_limite_per_user: 'Padrao do budget' },
  ])

  assert.equal(resultado.workspaces[0].custo, 25)
  assert.equal(resultado.workspaces[0].custo_workspace, 30)
  assert.equal(resultado.workspaces[0].dbus_free, 17)
  assert.equal(resultado.workspaces[0].dbus_pago, 0)
  assert.equal(resultado.workspaces[0].cota, 100)
  assert.equal(resultado.workspaces[0].budget_acao, 'Bloqueio')
  assert.deepEqual(resultado.workspaces[0].dias.map(({ dia, custo, dbus, dbus_free, dbus_pago }) => ({ dia, custo, dbus, dbus_free, dbus_pago })), [
    { dia: '2026-11-02', custo: 25, dbus: 15, dbus_free: 15, dbus_pago: 0 },
    { dia: '2026-11-03', custo: 5, dbus: 2, dbus_free: 2, dbus_pago: 0 },
  ])
  assert.equal(resultado.usuarios.length, 2)
  assert.equal(resultado.usuarios.find((user) => user.usuario === 'ana@example.com').limite, 50)
  assert.equal(resultado.usuarios.find((user) => user.usuario === 'ana@example.com').pct, 0)
  assert.deepEqual(resultado.usuarios.find((user) => user.usuario === 'ana@example.com').dias, [
    { dia: '2026-11-02', custo: 0, dbus: 10, dbus_free: 10, dbus_pago: 0 },
    { dia: '2026-11-03', custo: 0, dbus: 2, dbus_free: 2, dbus_pago: 0 },
  ])
  assert.deepEqual(resultado.usuarios.find((user) => user.usuario === 'bob@example.com').dias, [
    { dia: '2026-11-02', custo: 25, dbus: 5, dbus_free: 5, dbus_pago: 0 },
  ])
})

test('limita Genie Free a 150 DBU por usuário no mês somando workspaces', () => {
  const rows = [
    { workspace_id: '10', workspace_name: 'Dev', usage_date: '2026-11-01', mes_referencia: '2026-11-01', usuario: 'ana@example.com', sku_name: 'GENIE_FREE', total_dbus: '120', custo_usd: '0' },
    { workspace_id: '20', workspace_name: 'Prod', usage_date: '2026-11-02', mes_referencia: '2026-11-01', usuario: 'ana@example.com', sku_name: 'GENIE_FREE', total_dbus: '50', custo_usd: '0' },
    { workspace_id: '20', workspace_name: 'Prod', usage_date: '2026-11-03', mes_referencia: '2026-11-01', usuario: 'ana@example.com', sku_name: 'GENIE_FREE', total_dbus: '30', custo_usd: '0' },
  ]

  const resultado = aggregateGenieCotasInternasRows(rows)
  const userRows = resultado.usuarios.filter((row) => row.usuario === 'ana@example.com')
  const userTotals = userRows.reduce((total, row) => ({
    free: total.free + row.dbus_free,
    paid: total.paid + row.dbus_pago,
  }), { free: 0, paid: 0 })
  const workspaceProd = resultado.workspaces.find((row) => row.workspace_id === '20')

  assert.deepEqual(userTotals, { free: 150, paid: 50 })
  assert.equal(workspaceProd.dbus_free, 30)
  assert.equal(workspaceProd.dbus_pago, 50)
  assert.deepEqual(workspaceProd.dias.map(({ dia, dbus_free, dbus_pago }) => ({ dia, dbus_free, dbus_pago })), [
    { dia: '2026-11-02', dbus_free: 30, dbus_pago: 20 },
    { dia: '2026-11-03', dbus_free: 0, dbus_pago: 30 },
  ])
})

test('aplica franquia de 150 DBU mesmo quando o consumo vem só em SKU pago', () => {
  const rows = [
    { workspace_id: '10', workspace_name: 'Dev', usage_date: '2026-11-01', mes_referencia: '2026-11-01', usuario: 'carol@example.com', sku_name: 'GENIE_STANDARD', total_dbus: '90', custo_usd: '450' },
    { workspace_id: '10', workspace_name: 'Dev', usage_date: '2026-11-02', mes_referencia: '2026-11-01', usuario: 'carol@example.com', sku_name: 'GENIE_STANDARD', total_dbus: '80', custo_usd: '400' },
  ]

  const resultado = aggregateGenieCotasInternasRows(rows)
  const carol = resultado.usuarios.find((row) => row.usuario === 'carol@example.com')

  assert.ok(carol)
  assert.equal(carol.dbus, 170)
  assert.equal(carol.dbus_free, 150)
  assert.equal(carol.dbus_pago, 20)
})

test('deduplica linhas Genie idênticas consultadas por conexões do mesmo account', () => {
  const base = { workspace_id: '10', usage_date: '2026-11-02', usuario: 'ana@example.com', total_dbus: '12' }
  const rows = dedupeGenieCotasRows([
    [base, { ...base, workspace_id: '20' }],
    [{ ...base }, { ...base, workspace_id: '20' }],
  ])

  assert.deepEqual(rows, [base, { ...base, workspace_id: '20' }])
})