import { apiFetch } from './client'
import { numFields } from './normalize'
import type {
  AgendamentoDatabricksInput, DatabricksColetaStatus, DatabricksConfig, DatabricksConfigInput, TestarDatabricksResponse,
} from '../types/databricksColeta'

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
