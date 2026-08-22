import { apiFetch } from './client'
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
