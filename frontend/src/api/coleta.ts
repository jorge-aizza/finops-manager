import { apiFetch } from './client'
import { numFields } from './normalize'
import type {
  CoberturaMes, HistoricoItem, ImportItem, Pendente,
  ServicePrincipal, ServicePrincipalInput, StorageConfig, StorageConfigInput,
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
