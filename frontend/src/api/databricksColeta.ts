import { API_BASE, ApiError, apiFetch, getToken } from './client'
import { numFields } from './normalize'
import type {
  AgendamentoDatabricksInput, DatabricksColetaStatus, DatabricksConfig, DatabricksConfigInput, TestarDatabricksResponse,
} from '../types/databricksColeta'
import type {
  DatabricksAlerta, DatabricksBudget, DatabricksBudgetInput, DatabricksResumo,
} from '../types/databricksResumo'
import type { HistoricoItem, PurgeResult } from '../types/coleta'

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

// Chamada real ao Databricks (token OAuth + SELECT 1 via SQL Warehouse) — timeout maior,
// mesmo padrão de testarSP (api/coleta.ts).
export const testarDatabricksConfig = (id: number) =>
  apiFetch<TestarDatabricksResponse>('POST', '/databricks-coleta/config/' + id + '/testar', undefined, 40000)

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
  por_mes: r.por_mes.map((m) => ({ ...m, custo: Number(m.custo) })),
  por_workspace: r.por_workspace.map((w) => ({ ...w, custo: Number(w.custo) })),
  por_sku: r.por_sku.map((s) => ({ ...s, custo: Number(s.custo) })),
  por_usuario: r.por_usuario.map((u) => ({ ...u, custo: Number(u.custo) })),
  free_vs_pago: { free: Number(r.free_vs_pago.free), pago: Number(r.free_vs_pago.pago) },
})

// filtros = drill-down (dashboard): clicar num item de Workspace/SKU/Usuário reconsulta
// TODOS os cards já escopados pelo servidor (ver GET /databricks-coleta/resumo) — não é
// filtro client-side, já que o endpoint só devolve agregados, nunca linhas cruas.
export interface DatabricksResumoFiltros {
  workspace_id?: string
  sku_name?: string
  usuario?: string // '__vazio__' representa a linha "Não identificado"
}

export const getDatabricksResumo = (data_inicio?: string, data_fim?: string, filtros?: DatabricksResumoFiltros) => {
  const q = new URLSearchParams()
  if (data_inicio && data_fim) { q.set('data_inicio', data_inicio); q.set('data_fim', data_fim) }
  if (filtros?.workspace_id) q.set('workspace_id', filtros.workspace_id)
  if (filtros?.sku_name) q.set('sku_name', filtros.sku_name)
  if (filtros?.usuario) q.set('usuario', filtros.usuario)
  const qs = q.toString()
  return apiFetch<DatabricksResumo>('GET', '/databricks-coleta/resumo' + (qs ? '?' + qs : '')).then(normalizeResumo)
}

const BUDGET_NUM_FIELDS: (keyof DatabricksBudget)[] = ['valor_mensal']
const normalizeBudget = (b: DatabricksBudget) => numFields(b, BUDGET_NUM_FIELDS)

export const listDatabricksBudgets = () =>
  apiFetch<DatabricksBudget[]>('GET', '/databricks-coleta/budgets').then((rows) => rows.map(normalizeBudget))

export const createDatabricksBudget = (input: DatabricksBudgetInput) =>
  apiFetch<DatabricksBudget>('POST', '/databricks-coleta/budgets', input).then(normalizeBudget)

export const updateDatabricksBudget = (id: number, input: DatabricksBudgetInput) =>
  apiFetch<DatabricksBudget>('PUT', '/databricks-coleta/budgets/' + id, input).then(normalizeBudget)

export const deleteDatabricksBudget = (id: number) =>
  apiFetch<{ ok: boolean }>('DELETE', '/databricks-coleta/budgets/' + id)

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
