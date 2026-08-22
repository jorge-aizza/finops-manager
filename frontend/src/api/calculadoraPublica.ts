// Contrato de server.js (/api/public/calculadora/*) — Portal Público Fase B.
// Mesmos endpoints privados por trás (server.js delega /recursos e /estimar
// pro handler de /api/calculadora/*), só filtrados por portalCfg no servidor
// — então o shape de retorno é idêntico ao das funções privadas em
// api/calculadora.ts, reaproveita os mesmos tipos e RECURSO_NUM_FIELDS.
import { apiFetch } from './client'
import { numFields } from './normalize'
import { RECURSO_NUM_FIELDS } from './calculadora'
import type { RecursoBilling, RecursosQuery, ResourceGroupOption, SubscriptionOption } from '../types/calculadora'
import type { Estimativa, EstimativaInput } from '../types/estimativa'

export const listSubscriptionsPublica = () =>
  apiFetch<SubscriptionOption[]>('GET', '/public/calculadora/subscriptions')

export const listResourceGroupsPublica = (subscriptionIds: string[]) =>
  apiFetch<ResourceGroupOption[]>('GET', '/public/calculadora/resource-groups?subscription_id=' + encodeURIComponent(subscriptionIds.join(',')))

export const getRecursosPublica = (q: RecursosQuery) => {
  const params = new URLSearchParams({
    subscription_id: q.subscription_id.join(','),
    resource_group: q.resource_group.join(','),
    data_inicio: q.data_inicio,
    data_fim: q.data_fim,
  })
  if (q.pico) params.set('pico', '1')
  return apiFetch<RecursoBilling[]>('GET', '/public/calculadora/recursos?' + params.toString(), undefined, 3 * 60 * 1000)
    .then((rows) => rows.map((r) => numFields(r, RECURSO_NUM_FIELDS)))
}

// Projetos públicos ativos — mesma tabela `projetos`, mas sem `diretoria`
// no SELECT (ver GET /api/public/calculadora/projetos em server.js).
export interface ProjetoPublico {
  id: number
  nome: string
  descricao: string | null
  status: string
}

export const listProjetosPublica = () => apiFetch<ProjetoPublico[]>('GET', '/public/calculadora/projetos')

export const createEstimativaPublica = (input: EstimativaInput) =>
  apiFetch<Estimativa>('POST', '/public/calculadora/estimativas', input)
