import { apiFetch } from './client'
import { numFields } from './normalize'
import type {
  AgendamentoDatabricksInput, DatabricksColetaStatus, DatabricksConfig, DatabricksConfigInput, TestarDatabricksResponse,
} from '../types/databricksColeta'
import type {
  DatabricksAlerta, DatabricksBudget, DatabricksBudgetInput, DatabricksResumo,
} from '../types/databricksResumo'
import type { HistoricoItem } from '../types/coleta'

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

export const getDatabricksResumo = (data_inicio?: string, data_fim?: string) => {
  const qs = data_inicio && data_fim ? `?data_inicio=${data_inicio}&data_fim=${data_fim}` : ''
  return apiFetch<DatabricksResumo>('GET', '/databricks-coleta/resumo' + qs).then(normalizeResumo)
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
// Manual, que são todas Azure). O servidor não retorna tipo/validacao_status/
// validacao_json (conceitos que não existem pra Databricks hoje — ver rota
// no server.js) — preenchidos aqui como null pra manter o contrato de
// HistoricoItem, do qual ColetaView.tsx já sabe renderizar "—" pra ambos.
const HIST_NUM_FIELDS: (keyof HistoricoItem)[] = ['linhas_inseridas', 'linhas_atualizadas', 'linhas_erro']
export const getDatabricksHistorico = () =>
  apiFetch<HistoricoItem[]>('GET', '/databricks-coleta/historico').then((rows) =>
    rows.map((r) => numFields({ ...r, tipo: null, validacao_status: null, validacao_json: null }, HIST_NUM_FIELDS))
  )

export const deleteDatabricksHistorico = () =>
  apiFetch<{ ok: boolean }>('DELETE', '/databricks-coleta/historico')
