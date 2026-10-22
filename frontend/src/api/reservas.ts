import { API_BASE, ApiError, apiFetch, getToken } from './client'
import { numFields } from './normalize'
import type { Reserva, ReservaInput } from '../types/reserva'

export interface ReservasFilter {
  cloud?: string
  status?: string
}

const NUM_FIELDS: (keyof Reserva)[] = ['quantidade', 'custo_total', 'custo_mensal']
const normalize = (r: Reserva) => numFields(r, NUM_FIELDS)

export async function listReservas(filter: ReservasFilter = {}): Promise<Reserva[]> {
  const params = new URLSearchParams()
  if (filter.cloud) params.set('cloud', filter.cloud)
  if (filter.status) params.set('status', filter.status)
  const qs = params.toString()
  const rows = await apiFetch<Reserva[]>('GET', '/reservas' + (qs ? '?' + qs : ''))
  return rows.map(normalize)
}

export const createReserva = (input: ReservaInput) =>
  apiFetch<Reserva>('POST', '/reservas', input).then(normalize)

export const updateReserva = (id: number, input: ReservaInput) =>
  apiFetch<Reserva>('PUT', '/reservas/' + id, input).then(normalize)

export const deleteReserva = (id: number) =>
  apiFetch<{ ok: boolean }>('DELETE', '/reservas/' + id)

export interface SincronizarAzureResult {
  ok: boolean
  sp: string
  total: number
  inseridas: number
  atualizadas: number
  avisos: string[]
}

export const sincronizarReservasAzure = (spId?: number) =>
  apiFetch<SincronizarAzureResult>('POST', '/reservas/sincronizar-azure', spId ? { sp_id: spId } : {})

export interface ImportarReservasResult {
  ok: boolean
  arquivo: string
  total: number
  inseridas: number
  atualizadas: number
  invalidas: number
  avisos: string[]
}

// Upload do export "Reservations" do Azure. `apiFetch` serializa JSON, então aqui vai
// `fetch` direto com FormData — mesmo padrão de `uploadImagemMailing`. Não defina
// Content-Type na mão: o browser precisa gerar o boundary do multipart.
export async function importarReservasCSV(file: File): Promise<ImportarReservasResult> {
  const fd = new FormData()
  fd.append('arquivo', file)
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res = await fetch(API_BASE + '/reservas/importar', { method: 'POST', headers, body: fd })
  if (res.status === 401) { window.logout?.(false); throw new ApiError('Sessão expirada') }
  const data = await res.json().catch(() => ({}) as { error?: string })
  if (!res.ok) throw new ApiError((data as { error?: string }).error || `Erro HTTP ${res.status}`)
  return data as ImportarReservasResult
}
