import { apiFetch } from './client'
import { numFields } from './normalize'
import type {
  AgendamentoSPInput, AgendamentoStorageInput, AzureResumo, ColetaStatus, ColetarAPIInput,
  CoberturaMes, DiagAgendador, DiagnosticoLinha, HistoricoItem, ImportItem, Pendente, PurgeResult, RGPreview,
  ServicePrincipal, ServicePrincipalInput, StorageConfig, StorageConfigInput,
  SubscriptionPreview, TestarSPResponse, TestarStorageResponse,
} from '../types/coleta'

// ── Service Principals ──────────────────────────────────────────
const SP_NUM_FIELDS: (keyof ServicePrincipal)[] = ['granularidade_dias', 'dia_execucao', 'hora_execucao']
const normalizeSP = (s: ServicePrincipal) => numFields(s, SP_NUM_FIELDS)

export const listSPs = () =>
  apiFetch<ServicePrincipal[]>('GET', '/azure-coleta/sps').then((rows) => rows.map(normalizeSP))

export const createSP = (input: ServicePrincipalInput) =>
  apiFetch<{ ok: boolean }>('POST', '/azure-coleta/sps', input)

export const updateSP = (id: number, input: ServicePrincipalInput) =>
  apiFetch<{ ok: boolean }>('PUT', '/azure-coleta/sps/' + id, input)

export const deleteSP = (id: number) =>
  apiFetch<{ ok: boolean }>('DELETE', '/azure-coleta/sps/' + id)

export const setSPAtivo = (id: number, ativo: boolean) =>
  apiFetch<{ ok: boolean }>('PATCH', '/azure-coleta/sps/' + id + '/ativo', { ativo })

export const setSPPadrao = (id: number) =>
  apiFetch<{ ok: boolean }>('PATCH', '/azure-coleta/sps/' + id + '/padrao')

// ── Fase B — testes/coleta ao vivo (chamadas reais à Azure) ────────
export const testarSP = (id: number) =>
  apiFetch<TestarSPResponse>('POST', '/azure-coleta/sps/' + id + '/testar', undefined, 40000)

export const testarStorage = (id: number) =>
  apiFetch<TestarStorageResponse>('POST', '/azure-coleta/storages/' + id + '/testar', undefined, 40000)

export const executarStorage = (id: number) =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/azure-coleta/storages/' + id + '/executar')

export const coletarAPI = (spId: number, input: ColetarAPIInput) =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/azure-coleta/sps/' + spId + '/coletar-api', input, 20000)

export const cancelarColeta = () =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/azure-coleta/cancelar')

export const getColetaStatus = () => apiFetch<ColetaStatus>('GET', '/azure-coleta/status')

// Wizard — listagem de subscriptions/RGs ao vivo (fallback pro cache local
// no servidor se a Azure não responder — ver server.js). Timeout maior:
// listar-rgs busca todas as subs em paralelo, pode levar bem mais que 30s.
export const listarSubsSP = (id: number) =>
  apiFetch<{ subs: SubscriptionPreview[]; fonte: string }>('POST', '/azure-coleta/sps/' + id + '/listar-subs', undefined, 40000)

export const listarSubsPreview = (creds: { tenant_id: string; client_id: string; client_secret: string }) =>
  apiFetch<{ subs: SubscriptionPreview[]; fonte: string }>('POST', '/azure-coleta/listar-subs-preview', creds, 40000)

export const listarRGsSP = (id: number, subscriptionIds: string[]) =>
  apiFetch<{ rgs: RGPreview[]; fonte: string }>('POST', '/azure-coleta/sps/' + id + '/listar-rgs', { subscription_ids: subscriptionIds }, 120000)

export const patchSPSubscriptions = (id: number, subscriptionIds: string[]) =>
  apiFetch<{ ok: boolean }>('PATCH', '/azure-coleta/sps/' + id, { subscription_ids: subscriptionIds.join(',') || null })

export const salvarAgendamentoSP = (id: number, input: AgendamentoSPInput) =>
  apiFetch<{ ok: boolean; sp: unknown }>('PUT', '/azure-coleta/sps/' + id + '/agendamento', input)

export const excluirAgendamentoSP = (id: number) =>
  apiFetch<{ ok: boolean }>('PUT', '/azure-coleta/sps/' + id + '/agendamento', { hora_execucao: null, dias_semana: null, auto_coleta: false })

export const salvarAgendamentoStorage = (id: number, input: AgendamentoStorageInput) =>
  apiFetch<{ ok: boolean; storage: unknown }>('PUT', '/azure-coleta/storages/' + id + '/agendamento', input)

export const excluirAgendamentoStorage = (id: number) =>
  apiFetch<{ ok: boolean }>('PUT', '/azure-coleta/storages/' + id + '/agendamento', { hora_execucao: null, dias_semana: null })

export const getDiagAgendador = () => apiFetch<DiagAgendador>('GET', '/azure-coleta/diag-agendador')

// ── Expurgo / Diagnóstico de azure_costs ────────────────────────────
export const getAzureResumo = () => apiFetch<AzureResumo>('GET', '/azure-costs/resumo')

export const getPurgePreview = (params: { data_inicio?: string; data_fim?: string; arquivo?: string }) => {
  const q = new URLSearchParams()
  if (params.data_inicio) q.set('data_inicio', params.data_inicio)
  if (params.data_fim) q.set('data_fim', params.data_fim)
  if (params.arquivo) q.set('arquivo', params.arquivo)
  return apiFetch<{ total: number }>('GET', '/azure-costs/purge/preview?' + q.toString())
}

export const executarPurge = (params: { data_inicio?: string; data_fim?: string; arquivo?: string }) => {
  const q = new URLSearchParams()
  if (params.data_inicio) q.set('data_inicio', params.data_inicio)
  if (params.data_fim) q.set('data_fim', params.data_fim)
  if (params.arquivo) q.set('arquivo', params.arquivo)
  const qs = q.toString()
  return apiFetch<PurgeResult>('DELETE', '/azure-costs/purge' + (qs ? '?' + qs : ''), undefined, 60000)
}

export const getDiagnostico = () => apiFetch<DiagnosticoLinha[]>('GET', '/calculadora/diagnostico', undefined, 60000)

// ── Storage Accounts ────────────────────────────────────────────
const STORAGE_NUM_FIELDS: (keyof StorageConfig)[] = ['sp_id']
const normalizeStorage = (s: StorageConfig) => numFields(s, STORAGE_NUM_FIELDS)

export const listStorages = () =>
  apiFetch<StorageConfig[]>('GET', '/azure-coleta/storages').then((rows) => rows.map(normalizeStorage))

export const createStorage = (input: StorageConfigInput) =>
  apiFetch<{ ok: boolean; id: number }>('POST', '/azure-coleta/storages', input)

export const updateStorage = (id: number, input: StorageConfigInput) =>
  apiFetch<{ ok: boolean }>('PUT', '/azure-coleta/storages/' + id, input)

export const deleteStorage = (id: number) =>
  apiFetch<{ ok: boolean }>('DELETE', '/azure-coleta/storages/' + id)

// A rota de storage não tem PATCH parcial — o handler PUT grava TODOS os
// campos do body (inclusive os que faltarem, como null). Pra alternar só o
// "ativo" sem apagar os outros campos, reenvia a linha inteira já carregada
// no cliente com o "ativo" trocado (bug real do app antigo: PUT({ativo})
// sozinho zera nome/storage_account/etc. — evitado aqui sem mudar o backend).
export const setStorageAtivo = (storage: StorageConfig, ativo: boolean) =>
  updateStorage(storage.id, {
    nome: storage.nome,
    storage_account: storage.storage_account,
    storage_container: storage.storage_container,
    storage_prefix: storage.storage_prefix || '',
    price_list_prefix: storage.price_list_prefix || '',
    sp_id: storage.sp_id,
    ativo,
  })

// ── Cobertura por Mês ───────────────────────────────────────────
const COBERTURA_NUM_FIELDS: (keyof CoberturaMes)[] = ['registros', 'dias_com_dados', 'dias_no_mes', 'total_brl']

export const getCoberturaMeses = (force = false) =>
  apiFetch<CoberturaMes[]>('GET', '/azure-coleta/cobertura-meses' + (force ? '?force=1' : ''), undefined, 8 * 60 * 1000)
    .then((rows) => rows.map((r) => numFields(r, COBERTURA_NUM_FIELDS)))

// ── Pendentes ────────────────────────────────────────────────────
export const listPendentes = () => apiFetch<Pendente[]>('GET', '/azure-coleta/pendentes')

export const criarPendente = (input: { sp_id: number; subscription_id: string; sub_name: string; data_inicio: string; data_fim: string; descricao: string }) =>
  apiFetch<{ ok: boolean }>('POST', '/azure-coleta/pendentes', input)

export const deletePendente = (id: number) =>
  apiFetch<{ ok: boolean }>('DELETE', '/azure-coleta/pendentes/' + id)

// ── Histórico de Execuções ──────────────────────────────────────
const HIST_NUM_FIELDS: (keyof HistoricoItem)[] = ['linhas_inseridas', 'linhas_atualizadas', 'linhas_erro']

export const getHistorico = (tipo?: 'api' | 'storage') =>
  apiFetch<HistoricoItem[]>('GET', '/azure-coleta/historico' + (tipo ? '?tipo=' + tipo : ''))
    .then((rows) => rows.map((r) => numFields(r, HIST_NUM_FIELDS)))

export const deleteHistorico = () => apiFetch<{ ok: boolean }>('DELETE', '/azure-coleta/historico')

// Aba "Import Manual" do histórico usa uma fonte de dados diferente
// (importações de CSV/Parquet, não coletas automáticas).
const IMPORT_NUM_FIELDS: (keyof ImportItem)[] = ['linhas', 'total_billing']

export const getImports = () =>
  apiFetch<ImportItem[]>('GET', '/azure-costs/imports').then((rows) => rows.map((r) => numFields(r, IMPORT_NUM_FIELDS)))
