import { API_BASE, ApiError, apiFetch, getToken } from './client'
import { numFields } from './normalize'
import type {
  AgendamentoDatabricksInput, DatabricksColetaStatus, DatabricksConfig, DatabricksConfigInput, TestarDatabricksResponse,
} from '../types/databricksColeta'
import type {
  DatabricksAlerta, DatabricksAnomalias, DatabricksBudget, DatabricksBudgetInput, DatabricksResumo,
  DatabricksCotas,
} from '../types/databricksResumo'
import type { HistoricoItem, PurgeResult } from '../types/coleta'
import type { DatabricksJobRunsResposta } from '../types/databricksJobRuns'
import type {
  DatabricksClusterUtilizacaoResposta, DatabricksQueryHistoryResposta,
  DatabricksAiGatewayResposta, DatabricksStorageOtimizacaoResposta,
} from '../types/databricksAudit'

const NUM_FIELDS: (keyof DatabricksConfig)[] = ['granularidade_dias', 'dia_execucao', 'hora_execucao']
const normalize = (c: DatabricksConfig) => numFields(c, NUM_FIELDS)

export const listDatabricksConfigs = () =>
  apiFetch<DatabricksConfig[]>('GET', '/databricks-coleta/config').then((rows) => rows.map(normalize))

export const createDatabricksConfig = (input: DatabricksConfigInput) =>
  apiFetch<{ ok: boolean }>('POST', '/databricks-coleta/config', input)

export const updateDatabricksConfig = (id: number, input: DatabricksConfigInput) =>
  apiFetch<{ ok: boolean }>('PUT', '/databricks-coleta/config/' + id, input)

export const deleteDatabricksConfig = (id: number) =>
  apiFetch<{ ok: boolean }>('DELETE', '/databricks-coleta/config/' + id)

export const setDatabricksConfigAtivo = (id: number, ativo: boolean) =>
  apiFetch<{ ok: boolean }>('PATCH', '/databricks-coleta/config/' + id + '/ativo', { ativo })

export const setDatabricksConfigPadrao = (id: number) =>
  apiFetch<{ ok: boolean }>('PATCH', '/databricks-coleta/config/' + id + '/padrao')

// Chamada real ao Databricks (token OAuth + SELECT 1 via SQL Warehouse, mais 4 checagens de
// System Tables) — timeout generoso (3 min): o servidor agora faz polling de verdade
// (_databricksRunQuery, server.js) em vez de tratar um SQL Warehouse frio (cold start —
// documentado como levando de dezenas de segundos a poucos minutos pra ligar) como erro.
// Um timeout curto aqui derrubaria a checagem bem no cenário exato que o polling foi
// corrigido pra suportar.
export const testarDatabricksConfig = (id: number) =>
  apiFetch<TestarDatabricksResponse>('POST', '/databricks-coleta/config/' + id + '/testar', undefined, 180000)

// ── Fase 2 — coleta real + agendamento ──────────────────────────
export const coletarDatabricks = (id: number, data_inicio: string, data_fim: string) =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/databricks-coleta/config/' + id + '/coletar', { data_inicio, data_fim })

export const getDatabricksStatus = () => apiFetch<DatabricksColetaStatus>('GET', '/databricks-coleta/status')

export const salvarAgendamentoDatabricks = (id: number, input: AgendamentoDatabricksInput) =>
  apiFetch<{ ok: boolean; config: unknown }>('PUT', '/databricks-coleta/config/' + id + '/agendamento', input)

export const excluirAgendamentoDatabricks = (id: number) =>
  apiFetch<{ ok: boolean; config: unknown }>('PUT', '/databricks-coleta/config/' + id + '/agendamento', { hora_execucao: null, dias_semana: null, auto_coleta: false })

// ── Fase 3 — dashboard, orçamentos e alertas ────────────────────
// Colunas NUMERIC do Postgres voltam como string (ver normalize.ts) — os
// campos de custo aqui são agregados em SQL (SUM), então normaliza cada um
// explicitamente em vez de depender de numFields (que só cobre campos de
// topo, não arrays aninhados).
const normalizeResumo = (r: DatabricksResumo): DatabricksResumo => ({
  ...r,
  total_custo: Number(r.total_custo),
  por_mes: r.por_mes.map((m) => ({ ...m, custo: Number(m.custo), free: Number(m.free), pago: Number(m.pago) })),
  por_workspace: r.por_workspace.map((w) => ({ ...w, custo: Number(w.custo) })),
  por_sku: r.por_sku.map((s) => ({ ...s, custo: Number(s.custo) })),
  por_usuario: r.por_usuario.map((u) => ({ ...u, custo: Number(u.custo) })),
  free_vs_pago: { free: Number(r.free_vs_pago.free), pago: Number(r.free_vs_pago.pago) },
  dbus_free_vs_pago: { free: Number(r.dbus_free_vs_pago.free), pago: Number(r.dbus_free_vs_pago.pago) },
  por_job: (r.por_job || []).map((j) => ({ ...j, custo: Number(j.custo) })),
  por_cluster: (r.por_cluster || []).map((c) => ({ ...c, custo: Number(c.custo) })),
  por_warehouse: (r.por_warehouse || []).map((w) => ({ ...w, custo: Number(w.custo) })),
  por_model_serving: (r.por_model_serving || []).map((m) => ({ ...m, custo: Number(m.custo) })),
})

// filtros = drill-down (dashboard): clicar num item de Workspace/SKU/Usuário/Job/Cluster/
// Warehouse reconsulta TODOS os cards já escopados pelo servidor (ver GET
// /databricks-coleta/resumo) — não é filtro client-side, já que o endpoint só devolve
// agregados, nunca linhas cruas.
export interface DatabricksResumoFiltros {
  workspace_id?: string
  sku_name?: string
  usuario?: string // '__vazio__' representa a linha "Não identificado"
  job_id?: string
  cluster_id?: string
  warehouse_id?: string
  // mes (clique numa barra da Tendência Mensal, 'YYYY-MM') — igual aos demais filtros de
  // drill-down, escopa o KPI de total e os 6 rankings pra aquele mês; a própria série
  // por_mes (o gráfico) NÃO é afetada por este filtro (ver GET /resumo, server.js) —
  // continua mostrando todos os meses do período pra manter o contexto/comparação.
  mes?: string
}

export const getDatabricksResumo = (data_inicio?: string, data_fim?: string, filtros?: DatabricksResumoFiltros) => {
  const q = new URLSearchParams()
  if (data_inicio && data_fim) { q.set('data_inicio', data_inicio); q.set('data_fim', data_fim) }
  if (filtros?.workspace_id) q.set('workspace_id', filtros.workspace_id)
  if (filtros?.sku_name) q.set('sku_name', filtros.sku_name)
  if (filtros?.usuario) q.set('usuario', filtros.usuario)
  if (filtros?.job_id) q.set('job_id', filtros.job_id)
  if (filtros?.cluster_id) q.set('cluster_id', filtros.cluster_id)
  if (filtros?.warehouse_id) q.set('warehouse_id', filtros.warehouse_id)
  if (filtros?.mes) q.set('mes', filtros.mes)
  const qs = q.toString()
  return apiFetch<DatabricksResumo>('GET', '/databricks-coleta/resumo' + (qs ? '?' + qs : '')).then(normalizeResumo)
}

const BUDGET_NUM_FIELDS: (keyof DatabricksBudget)[] = ['valor_mensal', 'threshold_atencao', 'threshold_critico']
const normalizeBudget = (b: DatabricksBudget) => numFields(b, BUDGET_NUM_FIELDS)

export const listDatabricksBudgets = () =>
  apiFetch<DatabricksBudget[]>('GET', '/databricks-coleta/budgets').then((rows) => rows.map(normalizeBudget))

export const createDatabricksBudget = (input: DatabricksBudgetInput) =>
  apiFetch<DatabricksBudget>('POST', '/databricks-coleta/budgets', input).then(normalizeBudget)

export const updateDatabricksBudget = (id: number, input: DatabricksBudgetInput) =>
  apiFetch<DatabricksBudget>('PUT', '/databricks-coleta/budgets/' + id, input).then(normalizeBudget)

export const deleteDatabricksBudget = (id: number) =>
  apiFetch<{ ok: boolean }>('DELETE', '/databricks-coleta/budgets/' + id)

// Os campos numéricos vêm de colunas NUMERIC (string via pg) e de somas feitas
// em JS no servidor — normalizados aqui na borda, como o resto do módulo.
export const getDatabricksCotas = (mes?: string) =>
  apiFetch<DatabricksCotas>('GET', '/databricks-coleta/cotas' + (mes ? '?mes=' + encodeURIComponent(mes) : ''))
    .then((c) => ({
      ...c,
      por_workspace: c.por_workspace.map((w) => ({
        ...w, custo: Number(w.custo), dbus: Number(w.dbus),
        dbus_free: Number(w.dbus_free), dbus_pago: Number(w.dbus_pago),
        cota: w.cota == null ? null : Number(w.cota),
        pct: w.pct == null ? null : Number(w.pct),
      })),
      por_usuario: c.por_usuario.map((u) => ({
        ...u, custo: Number(u.custo), dbus: Number(u.dbus),
        dbus_free: Number(u.dbus_free), dbus_pago: Number(u.dbus_pago),
        limite: u.limite == null ? null : Number(u.limite),
        pct: u.pct == null ? null : Number(u.pct),
      })),
      resumo: {
        ...c.resumo,
        custo_total: Number(c.resumo.custo_total),
        cota_total: Number(c.resumo.cota_total),
      },
    }))

export const getDatabricksAlertas = () =>
  apiFetch<DatabricksAlerta[]>('GET', '/databricks-coleta/alertas').then((rows) =>
    rows.map((a) => ({ ...a, budget: normalizeBudget(a.budget), custo_atual: Number(a.custo_atual), pct: Number(a.pct) }))
  )

// ── Histórico — alimenta a aba "Coleta Databricks" do seletor de Histórico
// de Execuções em ColetaView.tsx (junto de API Oficial/Via Storage/Import
// Manual, que são todas Azure). O servidor não retorna `tipo` (conceito que
// não existe pra Databricks: uma única query por coleta, sem sub-tipo api/
// storage/price_list) — preenchido aqui como null pra manter o contrato de
// HistoricoItem. validacao_status/validacao_json vêm reais do servidor desde
// 2026-08-27 (ver _validarColetaDatabricks) — os números dentro de
// validacao_json já chegam como number de verdade (JSONB, não NUMERIC de
// topo — sem o problema de string do normalize.ts).
const HIST_NUM_FIELDS: (keyof HistoricoItem)[] = ['linhas_inseridas', 'linhas_atualizadas', 'linhas_erro']
export const getDatabricksHistorico = () =>
  apiFetch<HistoricoItem[]>('GET', '/databricks-coleta/historico').then((rows) =>
    rows.map((r) => numFields({ ...r, tipo: null }, HIST_NUM_FIELDS))
  )

export const deleteDatabricksHistorico = () =>
  apiFetch<{ ok: boolean }>('DELETE', '/databricks-coleta/historico')

// Expurgo de databricks_consumo — espelha getPurgePreview/executarPurge (api/coleta.ts,
// Azure), escopado por workspace_id em vez de arquivo (ver rota no server.js).
export const getDatabricksPurgePreview = (params: { data_inicio?: string; data_fim?: string; workspace_id?: string }) => {
  const q = new URLSearchParams()
  if (params.data_inicio) q.set('data_inicio', params.data_inicio)
  if (params.data_fim) q.set('data_fim', params.data_fim)
  if (params.workspace_id) q.set('workspace_id', params.workspace_id)
  return apiFetch<{ total: number }>('GET', '/databricks-coleta/purge/preview?' + q.toString())
}

export const executarDatabricksPurge = (params: { data_inicio?: string; data_fim?: string; workspace_id?: string }) => {
  const q = new URLSearchParams()
  if (params.data_inicio) q.set('data_inicio', params.data_inicio)
  if (params.data_fim) q.set('data_fim', params.data_fim)
  if (params.workspace_id) q.set('workspace_id', params.workspace_id)
  const qs = q.toString()
  return apiFetch<PurgeResult>('DELETE', '/databricks-coleta/purge' + (qs ? '?' + qs : ''), undefined, 60000)
}

// Importação manual (CSV) — multipart, mesmo padrão de uploadImportFile (api/coleta.ts):
// monta o próprio fetch com FormData, incompatível com o Content-Type: application/json
// fixo do apiFetch. Progresso real vem do polling já existente de getDatabricksStatus
// (DatabricksColetaMonitor) — esta chamada só inicia e retorna assim que o servidor
// aceita o arquivo (202), não espera a importação terminar.
export async function uploadDatabricksImport(file: File): Promise<{ ok: true }> {
  const fd = new FormData()
  fd.append('arquivo', file)
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = 'Bearer ' + token

  const res = await fetch(API_BASE + '/databricks-coleta/import', { method: 'POST', headers, body: fd })
  if (res.status === 401) { window.logout?.(false); throw new ApiError('Sessão expirada') }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as { error?: string })
    throw new ApiError(data.error || `Erro HTTP ${res.status}`)
  }
  return { ok: true }
}

export const validarHistoricoDatabricks = (id: number) =>
  apiFetch<{ validacao_status: string; validacao_json: HistoricoItem['validacao_json'] }>('POST', `/databricks-coleta/historico/${id}/validar`)

// Governança — chaves/valores de custom_tags já vistos em databricks_consumo, pro dropdown
// de "Escopo por tag" do modal de orçamento (ver DatabricksBudgetModal.tsx).
export const getDatabricksTagKeys = () => apiFetch<string[]>('GET', '/databricks-coleta/tags')
export const getDatabricksTagValues = (chave: string) => apiFetch<string[]>('GET', `/databricks-coleta/tags/${encodeURIComponent(chave)}/valores`)

// Anomaly Detection — ver _computeAnomaliasDatabricks (server.js). Números já chegam como
// number de verdade (agregados em SQL/JS no servidor, nunca uma coluna NUMERIC de topo
// devolvida crua) — sem necessidade de numFields aqui.
export const getDatabricksAnomalias = () => apiFetch<DatabricksAnomalias>('GET', '/databricks-coleta/anomalias')

// Execuções de Job — tempo + custo (2026-08-29, pedido do usuário). Números (duracao_segundos/
// custo_estimado) vêm de colunas NUMERIC do Postgres (databricks_job_runs) ou de um SUM
// agregado sobre NUMERIC (custo_estimado, subquery correlacionada em server.js) — ambos
// voltam como string via `pg`, mesmo motivo de sempre (ver normalize.ts). `custo_estimado`
// preserva `null` explicitamente (Number(null) seria 0, que mentiria "custo zero" quando na
// verdade é "sem dado de billing pra correlacionar" — ver nota no tipo).
export interface DatabricksJobRunsFiltros {
  job_id?: string
  workspace_id?: string
  result_state?: string
}
export const getDatabricksJobRuns = (data_inicio?: string, data_fim?: string, filtros?: DatabricksJobRunsFiltros) => {
  const q = new URLSearchParams()
  if (data_inicio && data_fim) { q.set('data_inicio', data_inicio); q.set('data_fim', data_fim) }
  if (filtros?.job_id) q.set('job_id', filtros.job_id)
  if (filtros?.workspace_id) q.set('workspace_id', filtros.workspace_id)
  if (filtros?.result_state) q.set('result_state', filtros.result_state)
  const qs = q.toString()
  return apiFetch<DatabricksJobRunsResposta>('GET', '/databricks-coleta/job-runs' + (qs ? '?' + qs : '')).then((r) => ({
    ...r,
    runs: r.runs.map((run) => ({
      ...run,
      duracao_segundos: run.duracao_segundos == null ? null : Number(run.duracao_segundos),
      custo_estimado: run.custo_estimado == null ? null : Number(run.custo_estimado),
    })),
  }))
}

// ── Auditoria 2026-08-29 — 4 endpoints novos, cada um lendo um schema de System Tables
// separado de system.billing (ver _DBX_OPTIONAL_TABLES/server.js). Todos os números
// numéricos vêm de colunas NUMERIC/BIGINT do Postgres (voltam como string via `pg`) — mesmo
// motivo de sempre pra normalizar explicitamente em vez de confiar no tipo declarado.

export const getDatabricksClusterUtilizacao = (data_inicio?: string, data_fim?: string, workspace_id?: string) => {
  const q = new URLSearchParams()
  if (data_inicio && data_fim) { q.set('data_inicio', data_inicio); q.set('data_fim', data_fim) }
  if (workspace_id) q.set('workspace_id', workspace_id)
  const qs = q.toString()
  return apiFetch<DatabricksClusterUtilizacaoResposta>('GET', '/databricks-coleta/cluster-utilizacao' + (qs ? '?' + qs : '')).then((r) => ({
    ...r,
    clusters: r.clusters.map((c) => ({
      ...c,
      avg_cpu_percent: c.avg_cpu_percent == null ? null : Number(c.avg_cpu_percent),
      avg_mem_percent: c.avg_mem_percent == null ? null : Number(c.avg_mem_percent),
      dias_observados: Number(c.dias_observados),
    })),
  }))
}

export const getDatabricksQueryHistory = (data_inicio?: string, data_fim?: string, filtros?: { warehouse_id?: string; executed_by?: string }) => {
  const q = new URLSearchParams()
  if (data_inicio && data_fim) { q.set('data_inicio', data_inicio); q.set('data_fim', data_fim) }
  if (filtros?.warehouse_id) q.set('warehouse_id', filtros.warehouse_id)
  if (filtros?.executed_by) q.set('executed_by', filtros.executed_by)
  const qs = q.toString()
  return apiFetch<DatabricksQueryHistoryResposta>('GET', '/databricks-coleta/query-history' + (qs ? '?' + qs : '')).then((r) => ({
    ...r,
    queries: r.queries.map((qi) => ({
      ...qi,
      duracao_total_ms: qi.duracao_total_ms == null ? null : Number(qi.duracao_total_ms),
      custo_estimado: qi.custo_estimado == null ? null : Number(qi.custo_estimado),
    })),
  }))
}

export const getDatabricksAiGatewayUsage = (data_inicio?: string, data_fim?: string, workspace_id?: string) => {
  const q = new URLSearchParams()
  if (data_inicio && data_fim) { q.set('data_inicio', data_inicio); q.set('data_fim', data_fim) }
  if (workspace_id) q.set('workspace_id', workspace_id)
  const qs = q.toString()
  return apiFetch<DatabricksAiGatewayResposta>('GET', '/databricks-coleta/ai-gateway-usage' + (qs ? '?' + qs : '')).then((r) => ({
    ...r,
    destinos: r.destinos.map((d) => ({ ...d, requisicoes: Number(d.requisicoes), input_tokens: Number(d.input_tokens), output_tokens: Number(d.output_tokens) })),
  }))
}

export const getDatabricksStorageOtimizacao = (data_inicio?: string, data_fim?: string, workspace_id?: string) => {
  const q = new URLSearchParams()
  if (data_inicio && data_fim) { q.set('data_inicio', data_inicio); q.set('data_fim', data_fim) }
  if (workspace_id) q.set('workspace_id', workspace_id)
  const qs = q.toString()
  return apiFetch<DatabricksStorageOtimizacaoResposta>('GET', '/databricks-coleta/storage-otimizacao' + (qs ? '?' + qs : '')).then((r) => ({
    ...r,
    operacoes: r.operacoes.map((o) => ({ ...o, operacoes: Number(o.operacoes), dbus: Number(o.dbus), sucesso: Number(o.sucesso) })),
  }))
}
