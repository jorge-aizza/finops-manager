import { apiFetch } from './client'
import { numFields } from './normalize'
import { MESES } from '../config/acaoOptions'
import type { Acao, AcaoInput } from '../types/acao'

export interface AcoesFilter {
  projeto_id?: number
  status?: string
  cloud?: string
}

const NUM_FIELDS: (keyof Acao)[] = [
  'projeto_id', 'impacto_atual_mes', 'retorno_ano_atual', 'retorno_proximo_ano',
  ...MESES.flatMap((m) => [`atual_${m.key}` as keyof Acao, `proximo_${m.key}` as keyof Acao]),
]
const normalize = (a: Acao) => numFields(a, NUM_FIELDS)

export async function listAcoes(filter: AcoesFilter = {}): Promise<Acao[]> {
  const params = new URLSearchParams()
  if (filter.projeto_id) params.set('projeto_id', String(filter.projeto_id))
  if (filter.status) params.set('status', filter.status)
  if (filter.cloud) params.set('cloud', filter.cloud)
  const qs = params.toString()
  const rows = await apiFetch<Acao[]>('GET', '/acoes' + (qs ? '?' + qs : ''))
  return rows.map(normalize)
}

export const createAcao = (input: AcaoInput) =>
  apiFetch<Acao>('POST', '/acoes', input).then(normalize)

export const updateAcao = (id: number, input: AcaoInput) =>
  apiFetch<Acao>('PUT', '/acoes/' + id, input).then(normalize)

export const deleteAcao = (id: number) =>
  apiFetch<{ message: string }>('DELETE', '/acoes/' + id)
