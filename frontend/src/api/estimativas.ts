import { apiFetch } from './client'
import { numFields } from './normalize'
import type { Estimativa, EstimativaResumo, EstimativaStatus } from '../types/estimativa'

const NUM_FIELDS: (keyof EstimativaResumo)[] = [
  'pct_imposto', 'pct_cond', 'vl_imposto', 'vl_cond', 'total_brl', 'total_final', 'horas', 'validade_dias',
]

export const listEstimativas = () =>
  apiFetch<EstimativaResumo[]>('GET', '/estimativas').then((rows) => rows.map((r) => numFields(r, NUM_FIELDS)))

export const getEstimativa = (id: number) =>
  apiFetch<Estimativa>('GET', '/estimativas/' + id).then((e) => numFields(e, NUM_FIELDS as (keyof Estimativa)[]))

export const setEstimativaStatus = (id: number, status: EstimativaStatus) =>
  apiFetch<Estimativa>('PUT', '/estimativas/' + id + '/status', { status })

export const deleteEstimativa = (id: number) =>
  apiFetch<{ message: string }>('DELETE', '/estimativas/' + id)
